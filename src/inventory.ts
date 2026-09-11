import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

// ---------- Types ----------

export interface ComponentInfo {
  className: string;
  selectors: string[];
  file: string; // relative to root
  templateFile?: string; // relative, if templateUrl
  inputs: string[];
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
  components: ComponentInfo[];
  clusters: Cluster[];
  quasiComponents: ClassPattern[];
  stats: {
    total: number;
    public: number;
    private: number;
    unused: number;
  };
}

// ---------- Filesystem walk ----------

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', '.nx', '.angular', 'coverage', '.git', 'tmp', 'out-tsc', 'storybook-static',
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
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
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) {
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

function extractComponents(sourceFile: ts.SourceFile, root: string): Omit<ComponentInfo, 'public' | 'usages' | 'usedIn'>[] {
  const result: Omit<ComponentInfo, 'public' | 'usages' | 'usedIn'>[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const dec = decoratorsOf(node).find((d) => decoratorName(d) === 'Component');
      if (dec) {
        const meta = decoratorArg(dec);
        const selector = meta ? stringProp(meta, 'selector') : undefined;
        const templateUrl = meta ? stringProp(meta, 'templateUrl') : undefined;
        const inputs: string[] = [];
        const outputs: string[] = [];
        for (const m of node.members) {
          if (ts.isPropertyDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
            const names = decoratorsOf(m).map(decoratorName);
            const prop = m.name.getText();
            if (names.includes('Input')) inputs.push(prop);
            else if (names.includes('Output')) outputs.push(prop);
            else if (ts.isPropertyDeclaration(m)) {
              const k = signalKind(m.initializer);
              if (k === 'input') inputs.push(prop);
              if (k === 'output') outputs.push(prop);
            }
          }
        }
        result.push({
          className: node.name.text,
          selectors: selector ? selector.split(',').map((s) => s.trim()).filter(Boolean) : [],
          file: path.relative(root, sourceFile.fileName),
          templateFile: templateUrl ? path.relative(root, path.resolve(path.dirname(sourceFile.fileName), templateUrl)) : undefined,
          inputs,
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
function inlineTemplates(sourceFile: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const dec = decoratorsOf(node).find((d) => decoratorName(d) === 'Component');
      const meta = dec && decoratorArg(dec);
      const tpl = meta && stringProp(meta, 'template');
      if (tpl) map.set(node.name.text, tpl);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return map;
}

// ---------- Public API resolution ----------

const ENTRY_FILES = new Set(['index.ts', 'public-api.ts', 'public_api.ts']);

function resolveModule(from: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [base + '.ts', path.join(base, 'index.ts'), path.join(base, 'public-api.ts'), base];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

/** Set of files reachable through re-exports from any entry file. */
function publicFiles(entryFiles: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entryFiles];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        const target = resolveModule(f, st.moduleSpecifier.text);
        if (target) queue.push(target);
      }
    }
  }
  return seen;
}

// ---------- Usage counting ----------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching a selector inside a template: `<app-card` or `appHighlight` as attribute. */
function selectorRegex(selector: string): RegExp | undefined {
  const attr = selector.match(/^\[([\w-]+)\]$/);
  if (attr) return new RegExp(`[\\s(\\[]\\(?\\[?${escapeRe(attr[1])}\\]?[\\s=>\\]/)]`, 'g');
  if (/^[\w-]+$/.test(selector)) return new RegExp(`<${escapeRe(selector)}[\\s>/]`, 'g');
  return undefined; // class selectors, complex selectors: skipped
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

export function scan(rootInput: string): Inventory {
  const root = path.resolve(rootInput);
  const files = walk(root);
  const tsFiles = files.filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts') && !f.endsWith('.stories.ts'));
  const htmlFiles = files.filter((f) => f.endsWith('.html'));

  const components: ComponentInfo[] = [];
  // template text by owning file (relative path) — html files + inline templates
  const templates = new Map<string, string>();

  for (const f of htmlFiles) templates.set(path.relative(root, f), fs.readFileSync(f, 'utf8'));

  for (const f of tsFiles) {
    const text = fs.readFileSync(f, 'utf8');
    if (!text.includes('@Component')) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const found = extractComponents(sf, root);
    const inline = inlineTemplates(sf);
    for (const c of found) {
      components.push({ ...c, public: false, usages: 0, usedIn: [] });
      const tpl = inline.get(c.className);
      if (tpl) templates.set(c.file + '#' + c.className, tpl);
    }
  }

  // Public API
  const entries = tsFiles.filter((f) => ENTRY_FILES.has(path.basename(f)));
  const pub = publicFiles(entries);
  for (const c of components) c.public = pub.has(path.join(root, c.file));

  // Usages
  for (const c of components) {
    const own = new Set([c.templateFile, c.file + '#' + c.className].filter(Boolean));
    for (const sel of c.selectors) {
      const re = selectorRegex(sel);
      if (!re) continue;
      for (const [tplFile, tpl] of templates) {
        if (own.has(tplFile)) continue;
        const n = tpl.match(re)?.length ?? 0;
        if (n > 0) {
          c.usages += n;
          const fileOnly = tplFile.split('#')[0];
          if (!c.usedIn.includes(fileOnly)) c.usedIn.push(fileOnly);
        }
      }
    }
  }

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
    components,
    clusters,
    quasiComponents,
    stats: {
      total: components.length,
      public: components.filter((c) => c.public).length,
      private: components.filter((c) => !c.public).length,
      unused: components.filter((c) => c.usages === 0).length,
    },
  };
}

// ---------- Markdown report ----------

export function toMarkdown(inv: Inventory): string {
  const L: string[] = [];
  const { stats } = inv;
  L.push(`# Inventaire des composants Angular`, '');
  L.push(`Racine : \`${inv.root}\`  `);
  L.push(`**${stats.total} composants** — ${stats.public} exportés (API publique), ${stats.private} privés, ${stats.unused} jamais référencés dans un template.`, '');

  if (inv.clusters.length) {
    L.push(`## Concepts en doublon potentiel`, '');
    L.push(`| Concept | Nb | Composants |`, `|---|---|---|`);
    for (const c of inv.clusters) L.push(`| ${c.concept} | ${c.components.length} | ${c.components.join(', ')} |`);
    L.push('');
  }

  if (inv.quasiComponents.length) {
    L.push(`## Quasi-composants (mêmes classes CSS répétées)`, '');
    L.push(`Signatures de classes (≥ 4 classes) répétées ≥ 3 fois dans ≥ 2 fichiers : un composant qui n'a jamais été extrait.`, '');
    for (const q of inv.quasiComponents.slice(0, 15)) {
      L.push(`- **×${q.count}** dans ${q.files.length} fichiers — \`${q.classes}\``);
    }
    L.push('');
  }

  L.push(`## Catalogue`, '');
  L.push(`| Composant | Sélecteur | Public | Usages | Inputs | Outputs | Fichier |`, `|---|---|---|---|---|---|---|`);
  for (const c of inv.components) {
    L.push(`| ${c.className} | \`${c.selectors.join(', ') || '—'}\` | ${c.public ? '✅' : '—'} | ${c.usages} | ${c.inputs.join(', ') || '—'} | ${c.outputs.join(', ') || '—'} | ${c.file} |`);
  }
  L.push('');

  const unused = inv.components.filter((c) => c.usages === 0 && c.selectors.length);
  if (unused.length) {
    L.push(`## Jamais utilisés dans un template`, '');
    L.push(`Peuvent être des pages routées (normal) ou du code mort.`, '');
    for (const c of unused) L.push(`- ${c.className} (\`${c.selectors[0]}\`) — ${c.file}`);
    L.push('');
  }
  return L.join('\n');
}
