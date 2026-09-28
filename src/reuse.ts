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
interface Target { file: string; name: string }
const posix = (value: string) => value.split(path.sep).join('/');
const entryName = /(?:^|[/\\])(?:index|public-api|public_api)\.ts$/;
const same = (a: Target, b: Target) => a.file === b.file && a.name === b.name;

/** Resolve only value exports in the scanned workspace; never infer an import from a filename alone. */
export function enrichReuse(root: string, sources: Map<string, ts.SourceFile>, components: ComponentInfo[], warnings: string[]): void {
  let options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Node10 };
  const config = ['tsconfig.json', 'tsconfig.base.json'].map((f) => path.join(root, f)).find(fs.existsSync);
  if (config) {
    const read = ts.readConfigFile(config, ts.sys.readFile);
    if (read.error) warnings.push('Configuration TypeScript illisible : les alias ne sont pas tous résolus.');
    else {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, config);
      options = { ...options, ...parsed.options };
      if (parsed.errors.some((e) => e.code !== 18003)) warnings.push('Configuration TypeScript partiellement résolue : vérifier les suggestions d’import.');
    }
  }
  const resolve = (from: string, spec: string): string | undefined => {
    const resolved = ts.resolveModuleName(spec, from, options, ts.sys).resolvedModule?.resolvedFileName;
    if (resolved && sources.has(path.resolve(resolved))) return path.resolve(resolved);
    return undefined;
  };
  const local = (file: string, name: string, seen: Set<string>): Target | undefined => {
    const sf = sources.get(file);
    if (!sf) return;
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name?.text === name) return { file, name };
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue;
      const target = resolve(file, st.moduleSpecifier.text);
      if (!target) continue;
      if (st.importClause?.name?.text === name) return exportsOf(target, seen).get('default');
      const bindings = st.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const binding = bindings.elements.find((e) => e.name.text === name && !e.isTypeOnly);
        if (binding) return exportsOf(target, seen).get(binding.propertyName?.text ?? binding.name.text);
      }
    }
  };
  const exportsOf = (file: string, ancestors = new Set<string>()): Map<string, Target> => {
    const result = new Map<string, Target>();
    if (ancestors.has(file)) return result;
    const sf = sources.get(file);
    if (!sf) return result;
    const seen = new Set(ancestors).add(file);
    const explicit = new Set<string>();
    const ambiguous = new Set<string>();
    for (const st of sf.statements) {
      if (ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if ((ts.isFunctionDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) explicit.add(st.name.text);
        if (ts.isVariableStatement(st)) {
          const names = (name: ts.BindingName): void => {
            if (ts.isIdentifier(name)) explicit.add(name.text);
            else for (const element of name.elements) if (ts.isBindingElement(element)) names(element.name);
          };
          for (const declaration of st.declarationList.declarations) names(declaration.name);
        }
      }
      if (ts.isClassDeclaration(st) && st.name && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        explicit.add(st.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : st.name.text);
      }
      if (ts.isExportAssignment(st) && !st.isExportEquals) explicit.add('default');
      if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) if (!e.isTypeOnly) explicit.add(e.name.text);
      }
    }
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const name = st.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : st.name.text;
        result.set(name, { file, name: st.name.text });
      }
      if (ts.isExportAssignment(st) && !st.isExportEquals && ts.isIdentifier(st.expression)) {
        const target = local(file, st.expression.text, seen);
        if (target) result.set('default', target);
      }
      if (!ts.isExportDeclaration(st) || st.isTypeOnly) continue;
      const module = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resolve(file, st.moduleSpecifier.text) : undefined;
      if (st.moduleSpecifier && !module) continue;
      const exported = module ? exportsOf(module, seen) : undefined;
      if (!st.exportClause && exported) {
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
          const target = exported ? exported.get(original) : local(file, original, seen);
          if (target) result.set(e.name.text, target);
        }
      }
    }
    return result;
  };
  const exports = new Map([...sources.keys()].map((file) => [file, exportsOf(file)]));
  const aliases = new Map<string, Set<string>>();
  const addAlias = (file: string, alias: string) => {
    if (!aliases.has(file)) aliases.set(file, new Set());
    aliases.get(file)!.add(alias);
  };
  // Reverse explicit and wildcard tsconfig paths, verifying every candidate through TS resolution.
  const base = options.baseUrl ?? path.dirname(config ?? path.join(root, 'tsconfig.json'));
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    for (const target of targets) {
      if (!alias.includes('*') && !target.includes('*')) {
        const file = resolve(path.join(root, '__inventory__.ts'), alias);
        if (file) addAlias(file, alias);
        continue;
      }
      const absolute = posix(path.resolve(base, target));
      const [prefix, suffix = ''] = absolute.split('*');
      if (!target.includes('*') || !alias.includes('*')) continue;
      for (const file of sources.keys()) {
        const candidates = [posix(file), posix(file).replace(/\.tsx?$/, ''), posix(file).replace(/[/\\]index\.ts$/, '')];
        for (const candidate of candidates) {
          if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) continue;
          const middle = candidate.slice(prefix.length, suffix ? -suffix.length : undefined);
          const spec = alias.replace('*', middle);
          if (resolve(path.join(root, '__inventory__.ts'), spec) === file) addAlias(file, spec);
        }
      }
    }
  }
  // Also preserve workspace aliases demonstrated by real imports.
  for (const [file, sf] of sources) for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text.startsWith('.')) continue;
    const target = resolve(file, st.moduleSpecifier.text);
    if (target) addAlias(target, st.moduleSpecifier.text);
  }
  for (const c of components) {
    const identity = { file: path.join(root, c.file), name: c.className };
    c.public = false;
    for (const [file, names] of exports) {
      for (const [name, target] of names) {
        if (!same(target, identity)) continue;
        const entry = entryName.test(file);
        if (entry) c.public = true;
        const specs: { from: string; kind: ImportSuggestion['kind'] }[] = [...(aliases.get(file) ?? [])].map((from) => ({ from, kind: 'alias' as const }));
        if (entry || file === identity.file) specs.push({ from: './' + posix(path.relative(root, file)).replace(/\.ts$/, ''), kind: entry ? 'entry-point' : 'source' });
        for (const { from, kind } of specs) {
          if (name !== 'default' && !/^[$A-Z_a-z][$\w]*$/.test(name)) continue;
          const clause = name === 'default' ? c.className : `{ ${name}${name !== c.className ? ` as ${c.className}` : ''} }`;
          c.imports.push({ from, name, kind, statement: `import ${clause} from ${JSON.stringify(from)};` });
        }
      }
    }
    const rank = { alias: 0, 'entry-point': 1, source: 2 };
    c.imports.sort((a, b) => rank[a.kind] - rank[b.kind] || a.from.length - b.from.length || a.from.localeCompare(b.from));
  }
  const record = (target: Target | undefined, file: string, node: ts.Node, sf: ts.SourceFile) => {
    if (!target) return;
    const component = components.find((c) => same(target, { file: path.join(root, c.file), name: c.className }));
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    if (component && !component.routeReferences.some((r) => r.file === path.relative(root, file) && r.line === line)) {
      component.routeReferences.push({ file: path.relative(root, file), line });
    }
  };
  for (const [file, sf] of sources) {
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)
        && node.parent.properties.some((p) => p.name && ['path', 'matcher'].includes(p.name.getText(sf).replace(/['"]/g, '')))) {
        const key = node.name.getText(sf).replace(/['"]/g, '');
        if (key === 'component' && ts.isIdentifier(node.initializer)) record(local(file, node.initializer.text, new Set()), file, node, sf);
        if (key === 'loadComponent' && ts.isArrowFunction(node.initializer)) {
          let body: ts.Node = node.initializer.body;
          if (ts.isBlock(body)) {
            const returns = body.statements.filter(ts.isReturnStatement);
            if (returns.length === 1 && returns[0].expression) body = returns[0].expression;
          }
          if (ts.isCallExpression(body)) {
            let imported: ts.CallExpression | undefined;
            let exportedName: string | undefined;
            if (body.expression.kind === ts.SyntaxKind.ImportKeyword) { imported = body; exportedName = 'default'; }
            else if (ts.isPropertyAccessExpression(body.expression) && body.expression.name.text === 'then'
              && ts.isCallExpression(body.expression.expression) && body.expression.expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
              imported = body.expression.expression;
              const callback = body.arguments[0];
              if (callback && ts.isArrowFunction(callback) && ts.isPropertyAccessExpression(callback.body)
                && ts.isIdentifier(callback.body.expression) && callback.parameters[0]?.name.getText(sf) === callback.body.expression.text) exportedName = callback.body.name.text;
            }
            if (imported && exportedName && imported.arguments[0] && ts.isStringLiteral(imported.arguments[0])) {
              const resolved = resolve(file, imported.arguments[0].text);
              record(resolved ? exports.get(resolved)?.get(exportedName) : undefined, file, node, sf);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}
