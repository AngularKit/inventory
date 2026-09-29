import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import type { ComponentInfo } from './inventory.js';

export interface ImportSuggestion {
  from: string;
  name: string;
  statement: string;
  kind: 'alias' | 'entry-point' | 'source';
}
export interface SourceReference { file: string; line: number }
export interface UsageExample extends SourceReference { snippet: string }

/** A class declared in `file` under `name` (its local name, not the exported one). */
interface Target { file: string; name: string }
type Resolve = (from: string, spec: string) => string | undefined;

const posix = (value: string) => value.split(path.sep).join('/');
const entryName = /(?:^|[/\\])(?:index|public-api|public_api)\.ts$/;
const same = (a: Target, b: Target) => a.file === b.file && a.name === b.name;
const keyOf = (t: Target) => `${t.file}#${t.name}`;
const isExported = (st: ts.Statement) => ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isDefault = (st: ts.Statement) => ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

/** Resolve only value exports in the scanned workspace; never infer an import from a filename alone. */
export function enrichReuse(root: string, sources: Map<string, ts.SourceFile>, components: ComponentInfo[], warnings: string[]): void {
  const { options, config } = compilerOptions(root, warnings);
  const resolve = createResolver(root, sources, options);
  const exportIndex = new ExportIndex(sources, resolve);
  const aliases = collectAliases(root, sources, options, config, resolve);
  const byTarget = new Map(components.map((c) => [keyOf({ file: path.join(root, c.file), name: c.className }), c]));
  suggestImports(root, sources, components, exportIndex, aliases);
  collectNgModules(root, sources, exportIndex, byTarget);
  collectRouteReferences(root, sources, resolve, exportIndex, byTarget);
}

// ---------- TypeScript configuration and module resolution ----------

function compilerOptions(root: string, warnings: string[]): { options: ts.CompilerOptions; config?: string } {
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Node10 };
  const config = ['tsconfig.json', 'tsconfig.base.json'].map((f) => path.join(root, f)).find(fs.existsSync);
  if (!config) return { options };
  const read = ts.readConfigFile(config, ts.sys.readFile);
  if (read.error) {
    warnings.push('Configuration TypeScript illisible : les alias ne sont pas tous résolus.');
    return { options, config };
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, config);
  // 18003: no input files found, irrelevant for alias resolution.
  if (parsed.errors.some((e) => e.code !== 18003)) warnings.push('Configuration TypeScript partiellement résolue : vérifier les suggestions d’import.');
  return { options: { ...options, ...parsed.options }, config };
}

/** Module resolution restricted to scanned sources, cached per directory and specifier. */
function createResolver(root: string, sources: Map<string, ts.SourceFile>, options: ts.CompilerOptions): Resolve {
  const tsCache = ts.createModuleResolutionCache(root, (f) => f, options);
  const cache = new Map<string, string | undefined>();
  return (from, spec) => {
    const key = `${path.dirname(from)}\0${spec}`;
    if (cache.has(key)) return cache.get(key);
    const resolved = ts.resolveModuleName(spec, from, options, ts.sys, tsCache).resolvedModule?.resolvedFileName;
    const file = resolved && sources.has(path.resolve(resolved)) ? path.resolve(resolved) : undefined;
    cache.set(key, file);
    return file;
  };
}

// ---------- Exports ----------

/**
 * Value exports of each file, following re-exports. Ambiguous `export *` names are dropped,
 * type-only exports are ignored. Results are memoized unless an export cycle truncated them.
 */
class ExportIndex {
  private readonly cache = new Map<string, Map<string, Target>>();
  private cycleHits = 0;

  constructor(private readonly sources: Map<string, ts.SourceFile>, private readonly resolve: Resolve) {}

  exportsOf(file: string, ancestors = new Set<string>()): Map<string, Target> {
    const cached = this.cache.get(file);
    if (cached) return cached;
    if (ancestors.has(file)) { this.cycleHits++; return new Map(); }
    const sf = this.sources.get(file);
    if (!sf) return new Map();
    const hitsBefore = this.cycleHits;
    const result = this.compute(file, sf, new Set(ancestors).add(file));
    if (this.cycleHits === hitsBefore) this.cache.set(file, result);
    return result;
  }

  /** Class a local identifier refers to: declared in the file or imported (value import) from a scanned file. */
  local(file: string, name: string, seen = new Set<string>()): Target | undefined {
    const sf = this.sources.get(file);
    if (!sf) return;
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name?.text === name) return { file, name };
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue;
      const target = this.resolve(file, st.moduleSpecifier.text);
      if (!target) continue;
      if (st.importClause?.name?.text === name) return this.exportsOf(target, seen).get('default');
      const bindings = st.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const binding = bindings.elements.find((e) => e.name.text === name && !e.isTypeOnly);
        if (binding) return this.exportsOf(target, seen).get(binding.propertyName?.text ?? binding.name.text);
      }
    }
  }

  private compute(file: string, sf: ts.SourceFile, seen: Set<string>): Map<string, Target> {
    const result = new Map<string, Target>();
    const explicit = explicitExportNames(sf);
    const ambiguous = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name && isExported(st)) {
        result.set(isDefault(st) ? 'default' : st.name.text, { file, name: st.name.text });
      }
      if (ts.isExportAssignment(st) && !st.isExportEquals && ts.isIdentifier(st.expression)) {
        const target = this.local(file, st.expression.text, seen);
        if (target) result.set('default', target);
      }
      if (!ts.isExportDeclaration(st) || st.isTypeOnly) continue;
      const module = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? this.resolve(file, st.moduleSpecifier.text) : undefined;
      if (st.moduleSpecifier && !module) continue;
      const exported = module ? this.exportsOf(module, seen) : undefined;
      if (!st.exportClause && exported) {
        // `export * from`: local declarations win, conflicting stars cancel each other.
        for (const [name, target] of exported) {
          if (name === 'default' || explicit.has(name) || ambiguous.has(name)) continue;
          const previous = result.get(name);
          if (previous && !same(previous, target)) {
            result.delete(name);
            ambiguous.add(name);
          } else result.set(name, target);
        }
      } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) {
          if (e.isTypeOnly) continue;
          const original = e.propertyName?.text ?? e.name.text;
          const target = exported ? exported.get(original) : this.local(file, original, seen);
          if (target) result.set(e.name.text, target);
        }
      }
    }
    return result;
  }
}

/** Names a file exports itself (any value kind), which shadow `export *` re-exports. */
function explicitExportNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(element.name);
  };
  for (const st of sf.statements) {
    if (isExported(st)) {
      if ((ts.isFunctionDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) names.add(st.name.text);
      if (ts.isVariableStatement(st)) for (const declaration of st.declarationList.declarations) addBinding(declaration.name);
      if (ts.isClassDeclaration(st) && st.name) names.add(isDefault(st) ? 'default' : st.name.text);
    }
    if (ts.isExportAssignment(st) && !st.isExportEquals) names.add('default');
    if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) if (!e.isTypeOnly) names.add(e.name.text);
    }
  }
  return names;
}

// ---------- Import suggestions ----------

/**
 * Workspace aliases of each file: reversed tsconfig paths (explicit and wildcard), plus
 * non-relative specifiers seen in real imports. Every candidate is verified by TS resolution.
 */
function collectAliases(root: string, sources: Map<string, ts.SourceFile>, options: ts.CompilerOptions, config: string | undefined, resolve: Resolve): Map<string, Set<string>> {
  const aliases = new Map<string, Set<string>>();
  const add = (file: string, alias: string) => {
    if (!aliases.has(file)) aliases.set(file, new Set());
    aliases.get(file)!.add(alias);
  };
  const probe = path.join(root, '__inventory__.ts');
  const base = options.baseUrl ?? path.dirname(config ?? path.join(root, 'tsconfig.json'));
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    for (const target of targets) {
      if (!alias.includes('*') && !target.includes('*')) {
        const file = resolve(probe, alias);
        if (file) add(file, alias);
        continue;
      }
      if (!target.includes('*') || !alias.includes('*')) continue;
      const [prefix, suffix = ''] = posix(path.resolve(base, target)).split('*');
      for (const file of sources.keys()) {
        const candidates = [posix(file), posix(file).replace(/\.tsx?$/, ''), posix(file).replace(/[/\\]index\.ts$/, '')];
        for (const candidate of candidates) {
          if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) continue;
          const middle = candidate.slice(prefix.length, suffix ? -suffix.length : undefined);
          const spec = alias.replace('*', middle);
          if (resolve(probe, spec) === file) add(file, spec);
        }
      }
    }
  }
  for (const [file, sf] of sources) for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text.startsWith('.')) continue;
    const target = resolve(file, st.moduleSpecifier.text);
    if (target) add(target, st.moduleSpecifier.text);
  }
  return aliases;
}

const importRank = { alias: 0, 'entry-point': 1, source: 2 };

/** Marks public components (exported by an entry file) and lists verified import statements. */
function suggestImports(root: string, sources: Map<string, ts.SourceFile>, components: ComponentInfo[], exportIndex: ExportIndex, aliases: Map<string, Set<string>>): void {
  // Reverse index: declared class -> every (file, exported name) that exposes it.
  const exposures = new Map<string, { file: string; name: string }[]>();
  for (const file of sources.keys()) {
    for (const [name, target] of exportIndex.exportsOf(file)) {
      const key = keyOf(target);
      if (!exposures.has(key)) exposures.set(key, []);
      exposures.get(key)!.push({ file, name });
    }
  }
  for (const c of components) {
    const identity = { file: path.join(root, c.file), name: c.className };
    c.public = false;
    for (const { file, name } of exposures.get(keyOf(identity)) ?? []) {
      const entry = entryName.test(file);
      if (entry) c.public = true;
      if (name !== 'default' && !/^[$A-Z_a-z][$\w]*$/.test(name)) continue;
      const specs: { from: string; kind: ImportSuggestion['kind'] }[] = [...(aliases.get(file) ?? [])].map((from) => ({ from, kind: 'alias' }));
      if (entry || file === identity.file) specs.push({ from: './' + posix(path.relative(root, file)).replace(/\.ts$/, ''), kind: entry ? 'entry-point' : 'source' });
      const clause = name === 'default' ? c.className : `{ ${name}${name !== c.className ? ` as ${c.className}` : ''} }`;
      for (const { from, kind } of specs) c.imports.push({ from, name, kind, statement: `import ${clause} from ${JSON.stringify(from)};` });
    }
    c.imports.sort((a, b) => importRank[a.kind] - importRank[b.kind] || a.from.length - b.from.length || a.from.localeCompare(b.from));
  }
}

// ---------- NgModules ----------

/** Literal `declarations` / `exports` arrays of `@NgModule` classes; computed metadata is not followed. */
function collectNgModules(root: string, sources: Map<string, ts.SourceFile>, exportIndex: ExportIndex, byTarget: Map<string, ComponentInfo>): void {
  for (const [file, sf] of sources) {
    for (const st of sf.statements) {
      if (!ts.isClassDeclaration(st) || !st.name) continue;
      const decorator = ts.getDecorators(st)?.find((d) => ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression) && d.expression.expression.text === 'NgModule');
      const meta = decorator && ts.isCallExpression(decorator.expression) ? decorator.expression.arguments[0] : undefined;
      if (!meta || !ts.isObjectLiteralExpression(meta)) continue;
      const targets = (key: string): Target[] => {
        const prop = meta.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === key);
        if (!prop || !ts.isPropertyAssignment(prop) || !ts.isArrayLiteralExpression(prop.initializer)) return [];
        return prop.initializer.elements.flatMap((element) => {
          const target = ts.isIdentifier(element) ? exportIndex.local(file, element.text) : undefined;
          return target ? [target] : [];
        });
      };
      const declared = targets('declarations').map(keyOf);
      const exported = new Set(targets('exports').map(keyOf));
      for (const key of new Set([...declared, ...exported])) {
        byTarget.get(key)?.ngModules.push({ name: st.name.text, file: path.relative(root, file), exported: exported.has(key) });
      }
    }
  }
}

// ---------- Routes ----------

const binds = (name: ts.BindingName, target: string): boolean => ts.isIdentifier(name) ? name.text === target
  : name.elements.some((element) => ts.isBindingElement(element) && binds(element.name, target));

type Loader = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/**
 * Function behind a `loadComponent` value, resolved in its lexical scope through `const`
 * aliases and named functions. Parameters, catch bindings, mutable bindings and cycles stay unknown.
 */
function loaderOf(node: ts.Node, seen = new Set<ts.Node>()): Loader | undefined {
  if (seen.has(node)) return;
  const next = new Set(seen).add(node);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return node;
  if (ts.isParenthesizedExpression(node)) return loaderOf(node.expression, next);
  if (!ts.isIdentifier(node)) return;
  for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some((p) => binds(p.name, node.text))) return;
    if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name, node.text)) return;
    if (!ts.isSourceFile(scope) && !ts.isBlock(scope)) continue;
    for (const st of scope.statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === node.text) return loaderOf(st, next);
      if (!ts.isVariableStatement(st)) continue;
      for (const declaration of st.declarationList.declarations) {
        if (!binds(declaration.name, node.text)) continue;
        const isConst = !!(st.declarationList.flags & ts.NodeFlags.Const);
        return ts.isIdentifier(declaration.name) && isConst && declaration.initializer ? loaderOf(declaration.initializer, next) : undefined;
      }
    }
  }
}

/** `import('./x')` (default export) or `import('./x').then(m => m.Name)`. */
function lazyImport(loader: Loader, sf: ts.SourceFile): { specifier: string; exportName: string } | undefined {
  if (!loader.body) return;
  let body: ts.Node = loader.body;
  if (ts.isBlock(body)) {
    const returns = body.statements.filter(ts.isReturnStatement);
    if (returns.length === 1 && returns[0].expression) body = returns[0].expression;
  }
  if (!ts.isCallExpression(body)) return;
  let imported: ts.CallExpression | undefined;
  let exportName: string | undefined;
  if (body.expression.kind === ts.SyntaxKind.ImportKeyword) { imported = body; exportName = 'default'; }
  else if (ts.isPropertyAccessExpression(body.expression) && body.expression.name.text === 'then'
    && ts.isCallExpression(body.expression.expression) && body.expression.expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
    imported = body.expression.expression;
    const callback = body.arguments[0];
    if (callback && ts.isArrowFunction(callback) && ts.isPropertyAccessExpression(callback.body)
      && ts.isIdentifier(callback.body.expression) && callback.parameters[0]?.name.getText(sf) === callback.body.expression.text) {
      exportName = callback.body.name.text;
    }
  }
  const specifier = imported?.arguments[0];
  if (!exportName || !specifier || !ts.isStringLiteral(specifier)) return;
  return { specifier: specifier.text, exportName };
}

/** Route objects (with `path` or `matcher`) referring to a component eagerly or lazily. */
function collectRouteReferences(root: string, sources: Map<string, ts.SourceFile>, resolve: Resolve, exportIndex: ExportIndex, byTarget: Map<string, ComponentInfo>): void {
  for (const [file, sf] of sources) {
    const record = (target: Target | undefined, node: ts.Node) => {
      const component = target && byTarget.get(keyOf(target));
      if (!component) return;
      const reference = { file: path.relative(root, file), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
      if (!component.routeReferences.some((r) => r.file === reference.file && r.line === reference.line)) component.routeReferences.push(reference);
    };
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)
        && node.parent.properties.some((p) => p.name && ['path', 'matcher'].includes(p.name.getText(sf).replace(/['"]/g, '')))) {
        const key = node.name.getText(sf).replace(/['"]/g, '');
        if (key === 'component' && ts.isIdentifier(node.initializer)) record(exportIndex.local(file, node.initializer.text), node);
        const loader = key === 'loadComponent' ? loaderOf(node.initializer) : undefined;
        const lazy = loader && lazyImport(loader, sf);
        if (lazy) {
          const resolved = resolve(file, lazy.specifier);
          record(resolved ? exportIndex.exportsOf(resolved).get(lazy.exportName) : undefined, node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}
