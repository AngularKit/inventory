import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { search } from './search.js';
import { matchesSelector, templateTags, templateSearchText, type TemplateTag } from './templates.js';
import { collectFiles, type ScanScope } from './files.js';
import { enrichReuse, type ImportSuggestion, type SourceReference, type UsageExample } from './reuse.js';

// ---------- Types ----------

export interface InputInfo {
  name: string;
  binding: string;
  required: boolean;
  type?: string;
}

export interface ComponentInfo {
  className: string;
  description: string;
  templateText: string;
  standalone: boolean | null; // null when Angular version or metadata cannot be resolved
  ngModules: { name: string; file: string; exported: boolean }[];
  selectors: string[];
  file: string; // relative to root
  templateFile?: string; // relative, if templateUrl
  inputs: string[];
  inputDetails: InputInfo[];
  imports: ImportSuggestion[];
  examples: UsageExample[];
  routeReferences: SourceReference[];
  usageStatus: 'templates' | 'routes' | 'templates-and-routes' | 'unconfirmed';
  outputs: string[];
  public: boolean; // reachable from an index.ts / public-api.ts
  usages: number; // occurrences of its element/attribute selector in other templates
  usedIn: string[]; // files (relative) where it is used
}

export interface Cluster {
  concept: string;
  components: string[]; // className
}

export interface ClassPattern {
  classes: string; // normalized, sorted
  count: number;
  files: string[];
}

export interface Inventory {
  root: string;
  scannedAt: string;
  scope: ScanScope;
  components: ComponentInfo[];
  clusters: Cluster[];
  quasiComponents: ClassPattern[];
  stats: {
    total: number;
    public: number;
    private: number;
    unused: number; // compatibility: no template usage, not evidence of dead code
    routed: number;
    unconfirmed: number;
  };
}

// ---------- Decorator extraction ----------

function decoratorsOf(node: ts.ClassDeclaration | ts.PropertyDeclaration | ts.SetAccessorDeclaration): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function decoratorName(d: ts.Decorator): string | undefined {
  const e = d.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

function decoratorArg(d: ts.Decorator): ts.ObjectLiteralExpression | undefined {
  const e = d.expression;
  if (ts.isCallExpression(e) && e.arguments[0] && ts.isObjectLiteralExpression(e.arguments[0])) {
    return e.arguments[0];
  }
  return undefined;
}

function stringProp(obj: ts.ObjectLiteralExpression, name: string): string | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText().replace(/^['"]|['"]$/g, '') === name) {
      const init = p.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    }
  }
  return undefined;
}

/** Detects `x = input(...)`, `input.required(...)`, `model(...)`, `output(...)` (signal-based APIs). */
function signalKind(init: ts.Expression | undefined): 'input' | 'output' | undefined {
  if (!init || !ts.isCallExpression(init)) return undefined;
  const callee = init.expression;
  let name: string | undefined;
  if (ts.isIdentifier(callee)) name = callee.text;
  else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) name = callee.expression.text; // input.required
  if (name === 'input' || name === 'model') return 'input';
  if (name === 'output' || name === 'outputFromObservable') return 'output';
  return undefined;
}

function propertyNamed(obj: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return obj.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name);
}

/** `@Input()`, `@Input('alias')`, `@Input({ alias, required })`. */
function decoratorInput(member: ts.PropertyDeclaration | ts.SetAccessorDeclaration, decorator: ts.Decorator): InputInfo {
  const name = member.name.getText();
  const arg = ts.isCallExpression(decorator.expression) ? decorator.expression.arguments[0] : undefined;
  const options = arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
  const alias = arg && ts.isStringLiteral(arg) ? arg.text : options && stringProp(options, 'alias');
  const required = options ? propertyNamed(options, 'required')?.initializer.kind === ts.SyntaxKind.TrueKeyword : false;
  const type = ts.isPropertyDeclaration(member) ? member.type : member.parameters[0]?.type;
  return { name, binding: alias || name, required, type: type?.getText() };
}

/** `input(initial, { alias })`, `input.required<T>({ alias })`, `model(...)`. */
function signalInput(member: ts.PropertyDeclaration, call: ts.CallExpression): InputInfo {
  const name = member.name.getText();
  const required = ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'required';
  const arg = call.arguments[required ? 0 : 1];
  const alias = arg && ts.isObjectLiteralExpression(arg) ? stringProp(arg, 'alias') : undefined;
  return { name, binding: alias || name, required, type: call.typeArguments?.[0]?.getText() };
}

function jsDocDescription(node: ts.Node): string {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
    .map((doc) => typeof doc.comment === 'string' ? doc.comment : doc.comment?.map((part) => part.text).join('') ?? '')
    .join(' ');
}

/** Static accessibility labels declared on the host element. */
function hostLabels(meta: ts.ObjectLiteralExpression | undefined): string {
  const host = meta && propertyNamed(meta, 'host');
  if (!host || !ts.isObjectLiteralExpression(host.initializer)) return '';
  const labels = host.initializer;
  return ['aria-label', 'title', 'alt'].map((key) => stringProp(labels, key) ?? '').join(' ').trim();
}

/** null when metadata is computed or the flag is not a boolean literal. */
function standaloneOf(meta: ts.ObjectLiteralExpression | undefined, defaultStandalone: boolean | null): boolean | null {
  if (!meta || meta.properties.some(ts.isSpreadAssignment)) return null;
  const prop = propertyNamed(meta, 'standalone');
  if (!prop) return defaultStandalone;
  if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

type ExtractedComponent = Omit<ComponentInfo, 'public' | 'usages' | 'usedIn' | 'imports' | 'examples' | 'routeReferences' | 'usageStatus'>;

function extractComponents(sourceFile: ts.SourceFile, root: string, defaultStandalone: boolean | null): ExtractedComponent[] {
  const result: ExtractedComponent[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const dec = decoratorsOf(node).find((d) => decoratorName(d) === 'Component');
      if (dec) {
        const meta = decoratorArg(dec);
        const selector = meta ? stringProp(meta, 'selector') : undefined;
        const templateUrl = meta ? stringProp(meta, 'templateUrl') : undefined;
        const inputs: string[] = [];
        const inputDetails: InputInfo[] = [];
        const outputs: string[] = [];
        for (const m of node.members) {
          if (ts.isPropertyDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
            const decorators = decoratorsOf(m);
            const inputDecorator = decorators.find((d) => decoratorName(d) === 'Input');
            const prop = m.name.getText();
            if (inputDecorator) {
              inputs.push(prop);
              inputDetails.push(decoratorInput(m, inputDecorator));
            }
            else if (decorators.some((d) => decoratorName(d) === 'Output')) outputs.push(prop);
            else if (ts.isPropertyDeclaration(m)) {
              const k = signalKind(m.initializer);
              if (k === 'input' && m.initializer && ts.isCallExpression(m.initializer)) {
                inputs.push(prop);
                inputDetails.push(signalInput(m, m.initializer));
              }
              if (k === 'output') outputs.push(prop);
            }
          }
        }
        result.push({
          className: node.name.text,
          description: jsDocDescription(node),
          templateText: hostLabels(meta),
          standalone: standaloneOf(meta, defaultStandalone),
          ngModules: [],
          selectors: selector ? selector.split(',').map((s) => s.trim()).filter(Boolean) : [],
          file: path.relative(root, sourceFile.fileName),
          templateFile: templateUrl ? path.relative(root, path.resolve(path.dirname(sourceFile.fileName), templateUrl)) : undefined,
          inputs,
          inputDetails,
          outputs,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/** Inline templates (`template: \`...\``) of every component in a file, keyed by class name. */
function inlineTemplates(sourceFile: ts.SourceFile): Map<string, { text: string; offset?: number }> {
  const map = new Map<string, { text: string; offset?: number }>();
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const dec = decoratorsOf(node).find((d) => decoratorName(d) === 'Component');
      const meta = dec && decoratorArg(dec);
      const tpl = meta && stringProp(meta, 'template');
      if (tpl && meta) {
        const property = meta.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'template');
        if (property && ts.isPropertyAssignment(property)) {
          const raw = property.initializer.getText(sourceFile);
          map.set(node.name.text, { text: tpl, offset: raw.slice(1, -1) === tpl ? property.initializer.getStart(sourceFile) + 1 : undefined });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return map;
}

// ---------- Clustering by concept ----------

const SYNONYMS: string[][] = [
  ['card', 'tile', 'panel', 'box', 'carte', 'vignette'],
  ['modal', 'dialog', 'popup', 'popin', 'overlay', 'drawer', 'sheet'],
  ['button', 'btn', 'bouton', 'cta'],
  ['input', 'field', 'champ', 'textfield'],
  ['select', 'dropdown', 'combobox', 'picker'],
  ['list', 'liste', 'table', 'grid', 'datagrid', 'tableau'],
  ['toast', 'snackbar', 'notification', 'alert', 'banner', 'message'],
  ['spinner', 'loader', 'loading', 'skeleton', 'progress'],
  ['badge', 'chip', 'tag', 'pill', 'label'],
  ['tabs', 'tab', 'onglet', 'stepper', 'wizard'],
  ['nav', 'navbar', 'menu', 'sidebar', 'header', 'toolbar'],
  ['avatar', 'icon', 'icone', 'logo', 'image'],
  ['form', 'formulaire'],
  ['tooltip', 'popover', 'hint'],
  ['page', 'view', 'screen', 'container', 'layout'],
];
const STOPWORDS = new Set(['component', 'app', 'ui', 'lib', 'shared', 'common', 'base', 'item', 'wrapper', 'element']);

function conceptOf(token: string): string {
  const t = token.toLowerCase().replace(/s$/, '');
  for (const group of SYNONYMS) if (group.includes(t)) return group[0];
  return t;
}

function tokens(c: { className: string; selectors: string[] }): string[] {
  const src = [c.className, ...c.selectors].join(' ');
  return src
    .replace(/[\[\]]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function clusterComponents(components: ComponentInfo[]): Cluster[] {
  const byConcept = new Map<string, Set<string>>();
  for (const c of components) {
    const toks = tokens(c);
    // Drop the most common prefix token (first token of every selector, e.g. "app")
    for (const t of toks) {
      const concept = conceptOf(t);
      if (concept.length < 3) continue;
      if (!byConcept.has(concept)) byConcept.set(concept, new Set());
      byConcept.get(concept)!.add(c.className);
    }
  }
  return [...byConcept.entries()]
    .filter(([, set]) => set.size >= 2)
    .map(([concept, set]) => ({ concept, components: [...set].sort() }))
    .sort((a, b) => b.components.length - a.components.length);
}

// ---------- Quasi-components (repeated class signatures) ----------

function classSignatures(template: string): string[] {
  const out: string[] = [];
  const re = /\bclass="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    const classes = m[1].split(/\s+/).filter(Boolean);
    if (classes.length >= 4) out.push([...new Set(classes)].sort().join(' '));
  }
  return out;
}

// ---------- Main ----------

/**
 * Standalone default from the Angular major (standalone since 19). Prefer the installed
 * version, accept an unambiguous major in package.json; unknown is safer than a guess.
 */
function angularDefaultStandalone(root: string): boolean | null {
  for (const manifest of ['node_modules/@angular/core/package.json', 'package.json']) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
      const version = manifest.startsWith('node_modules') ? pkg.version : pkg.dependencies?.['@angular/core'] ?? pkg.devDependencies?.['@angular/core'];
      const major = typeof version === 'string' && version.match(/^[~^]?(\d+)\.\d+(?:\.\d+)?(?:-[\w.-]+)?$/);
      if (major) return Number(major[1]) >= 19;
    } catch { /* missing or unreadable manifest: try the next one */ }
  }
  return null;
}

/** 1-based line of a tag, in the .ts file for inline templates (when the offset is known). */
function exampleLine(templateText: string, tag: TemplateTag, source?: ts.SourceFile, offset?: number): number | undefined {
  if (!source) return templateText.slice(0, tag.start).split('\n').length;
  if (offset === undefined) return undefined;
  return source.text.slice(0, offset + tag.start).split('\n').length;
}

function usageStatusOf(c: ComponentInfo): ComponentInfo['usageStatus'] {
  const routed = c.routeReferences.length > 0;
  if (c.usages) return routed ? 'templates-and-routes' : 'templates';
  return routed ? 'routes' : 'unconfirmed';
}

export function scan(rootInput: string): Inventory {
  const root = path.resolve(rootInput);
  const { files, scope } = collectFiles(root);
  const tsFiles = files.filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts') && !f.endsWith('.stories.ts'));
  const htmlFiles = files.filter((f) => f.endsWith('.html'));

  const defaultStandalone = angularDefaultStandalone(root);
  const components: ComponentInfo[] = [];
  const sources = new Map<string, ts.SourceFile>();
  // template text by owning file (relative path) — html files + inline templates
  const templates = new Map<string, string>();
  const templateOffsets = new Map<string, number>();

  for (const f of htmlFiles) templates.set(path.relative(root, f), fs.readFileSync(f, 'utf8'));

  for (const f of tsFiles) {
    const text = fs.readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    sources.set(f, sf);
    if (!text.includes('@Component')) continue;
    const found = extractComponents(sf, root, defaultStandalone);
    const inline = inlineTemplates(sf);
    for (const c of found) {
      components.push({ ...c, public: false, usages: 0, usedIn: [], imports: [], examples: [], routeReferences: [], usageStatus: 'unconfirmed' });
      const tpl = inline.get(c.className);
      if (tpl) {
        const key = c.file + '#' + c.className;
        templates.set(key, tpl.text);
        if (tpl.offset !== undefined) templateOffsets.set(key, tpl.offset);
      }
    }
  }

  enrichReuse(root, sources, components, scope.warnings);

  const parsedTemplates = new Map([...templates].map(([file, text]) => [file, templateTags(text)]));
  for (const c of components) {
    const own = new Set([c.templateFile, c.file + '#' + c.className].filter(Boolean));
    c.templateText = [c.templateText, ...[...own].map((file) => templateSearchText(templates.get(file!) ?? ''))].join(' ').trim();
    for (const [tplFile, tags] of parsedTemplates) {
      if (own.has(tplFile)) continue;
      const matches = tags.filter((tag) => c.selectors.some((selector) => matchesSelector(tag, selector)));
      if (!matches.length) continue;
      c.usages += matches.length;
      const fileOnly = tplFile.split('#')[0];
      if (!c.usedIn.includes(fileOnly)) c.usedIn.push(fileOnly);
      if (c.examples.length >= 3 || c.examples.some((e) => e.file === fileOnly)) continue;
      const tag = matches[0];
      const line = exampleLine(templates.get(tplFile)!, tag, sources.get(path.join(root, fileOnly)), templateOffsets.get(tplFile));
      if (line !== undefined) c.examples.push({ file: fileOnly, line, snippet: tag.snippet });
    }
  }

  for (const c of components) c.usageStatus = usageStatusOf(c);

  // Quasi-components
  const sigs = new Map<string, Set<string>>();
  for (const [tplFile, tpl] of templates) {
    for (const s of classSignatures(tpl)) {
      if (!sigs.has(s)) sigs.set(s, new Set());
      sigs.get(s)!.add(tplFile.split('#')[0]);
    }
  }
  const sigCounts = new Map<string, number>();
  for (const [, tpl] of templates) for (const s of classSignatures(tpl)) sigCounts.set(s, (sigCounts.get(s) ?? 0) + 1);
  const quasiComponents: ClassPattern[] = [...sigs.entries()]
    .map(([classes, fileSet]) => ({ classes, count: sigCounts.get(classes) ?? 0, files: [...fileSet].sort() }))
    .filter((p) => p.count >= 3 && p.files.length >= 2)
    .sort((a, b) => b.count - a.count);

  components.sort((a, b) => a.file.localeCompare(b.file));
  const clusters = clusterComponents(components);

  return {
    root,
    scannedAt: new Date().toISOString(),
    scope,
    components,
    clusters,
    quasiComponents,
    stats: {
      total: components.length,
      public: components.filter((c) => c.public).length,
      private: components.filter((c) => !c.public).length,
      unused: components.filter((c) => c.usages === 0).length,
      routed: components.filter((c) => c.routeReferences.length > 0).length,
      unconfirmed: components.filter((c) => c.usageStatus === 'unconfirmed').length,
    },
  };
}

// ---------- Markdown report ----------

export interface MarkdownOptions {
  /** Append one reuse sheet per component (import, required inputs, examples). Large on big workspaces. */
  details?: boolean;
}

export function toMarkdown(inv: Inventory, options: MarkdownOptions = {}): string {
  const L: string[] = [];
  const { stats } = inv;
  L.push(`# Inventaire des composants Angular`, '');
  L.push(`Racine : \`${inv.root}\`  `);
  L.push(`**${stats.total} composants** — ${stats.public} exportés (API publique), ${stats.private} privés, ${stats.routed} référencés dans des routes, ${stats.unconfirmed} sans usage confirmé.`, '');

  L.push(`Périmètre : ${inv.scope.mode === 'git' ? 'fichiers suivis et fichiers non ignorés par Git' : 'fichiers locaux avec exclusions intégrées'}. Les fichiers de tests et copies Stryker sont exclus.`, '');
  for (const warning of inv.scope.warnings) L.push(`> ${warning}`, '');

  if (inv.clusters.length) {
    L.push(`## Concepts en doublon potentiel`, '', 'Rapprochements lexicaux à examiner : ce ne sont pas des doublons confirmés.', '');
    L.push(`| Concept | Nb | Composants |`, `|---|---|---|`);
    for (const c of inv.clusters) L.push(`| ${c.concept} | ${c.components.length} | ${c.components.join(', ')} |`);
    L.push('');
  }

  if (inv.quasiComponents.length) {
    L.push(`## Quasi-composants (mêmes classes CSS répétées)`, '');
    L.push(`Signatures de classes (≥ 4 classes) répétées ≥ 3 fois dans ≥ 2 fichiers. Ces répétitions sont des pistes à examiner, pas une recommandation automatique d’extraction.`, '');
    for (const q of inv.quasiComponents.slice(0, 15)) {
      L.push(`- **×${q.count}** dans ${q.files.length} fichiers — \`${q.classes}\``);
    }
    L.push('');
  }

  L.push(`## Catalogue`, '');
  L.push(`| Composant | Sélecteur | Public | Usages | Inputs | Outputs | Import | Fichier |`, `|---|---|---|---|---|---|---|---|`);
  for (const c of inv.components) {
    const statement = c.imports[0]?.statement.replace(/\|/g, '\\|');
    L.push(`| ${c.className} | \`${c.selectors.join(', ') || '—'}\` | ${c.public ? '✅' : '—'} | ${c.usages} | ${c.inputs.join(', ') || '—'} | ${c.outputs.join(', ') || '—'} | ${statement ? `\`${statement}\`` : '—'} | ${c.file} |`);
  }
  L.push('');

  const unused = inv.components.filter((c) => c.usageStatus === 'unconfirmed');
  if (unused.length) {
    L.push(`## Usages non confirmés`, '');
    L.push(`Aucun usage dans les templates ou les formes de routes prises en charge. Les créations dynamiques et certaines routes peuvent échapper au scan : ce n’est pas une preuve de code mort.`, '');
    for (const c of unused) L.push(`- ${c.className} (\`${c.selectors[0] ?? 'sans sélecteur'}\`) — ${c.file}`);
    L.push('');
  }
  if (options.details) {
    L.push('## Réutiliser un composant', '');
    for (const c of inv.components) L.push(...componentDetails(c));
  } else {
    L.push('Fiches de réutilisation (imports, entrées requises, exemples) : `--search <termes>` ou `--details`.', '');
  }
  return L.join('\n');
}

/** Reuse details shared by the full catalogue and search results. */
export function componentDetails(c: ComponentInfo): string[] {
  const lines = [`### ${c.className}`, '', `Source : \`${c.file}\``, ''];
  if (c.description) lines.push(c.description, '');
  lines.push(c.standalone === true ? 'Intégration : composant standalone, à ajouter aux imports du composant appelant.'
    : c.standalone === false ? 'Intégration : composant non standalone ; utiliser un NgModule qui le déclare ou l’exporte.'
    : 'Intégration standalone/NgModule non déterminée : vérifier les métadonnées et la version Angular.', '');
  for (const module of c.ngModules) lines.push(`NgModule : \`${module.name}\` — \`${module.file}\` (${module.exported ? 'composant exporté' : 'déclaré mais non exporté ; indisponible hors de ce module'}).`, '');
  const suggestion = c.imports[0];
  if (suggestion) {
    lines.push(suggestion.kind === 'alias' ? 'Import via un alias résolu dans le projet :' : 'Import relatif à la racine analysée — adapter le chemin au fichier appelant :',
      '', '```ts', suggestion.statement, '```', '');
  } else lines.push('Aucun import exporté confirmé.', '');
  const required = c.inputDetails.filter((input) => input.required);
  lines.push(required.length ? `Entrées requises déclarées : ${required.map((input) => `\`${input.binding}\`${input.type ? ` (${input.type.replace(/\|/g, '\\|')})` : ''}`).join(', ')}.` : 'Aucune entrée requise détectée dans la classe ; les entrées héritées ne sont pas analysées.', '');
  for (const example of c.examples) lines.push(`Usage existant — \`${example.file}:${example.line}\` (extrait) :`, '', '```html', example.snippet, '```', '');
  for (const route of c.routeReferences) lines.push(`Référence dans une route : \`${route.file}:${route.line}\`.`, '');
  if (!c.examples.length && !c.routeReferences.length) lines.push('Aucun exemple d’usage confirmé.', '');
  return lines;
}

export interface SearchResult { component: ComponentInfo; score: number; reasons: string[] }

/** Deterministic lexical search, with evidence rather than a semantic-confidence claim. */
export function searchComponents(inv: Inventory, query: string, limit = 5): SearchResult[] {
  return search(inv, query, limit);
}

export function searchToMarkdown(results: SearchResult[], query: string): string {
  const lines = [`# Recherche de composants : ${query}`, '', 'Correspondances lexicales expliquées : noms, entrées/sorties, descriptions et textes des templates. Les chemins se recherchent avec une barre oblique. Chaque terme significatif doit correspondre.', ''];
  if (!results.length) lines.push('Aucun candidat trouvé. Essayer un nom, un sélecteur ou un terme plus court.');
  for (const result of results) lines.push(...componentDetails(result.component), `Pourquoi : ${result.reasons.join(' ; ')}.`, '');
  return lines.join('\n');
}
