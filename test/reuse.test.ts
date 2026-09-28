import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, searchComponents, searchToMarkdown, toMarkdown } from '../src/inventory.js';

function project(files: Record<string, string>, git = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  if (git) execFileSync('git', ['init', '--quiet', root]);
  return { root, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const component = (name: string) => `@Component({selector: 'app-${name.toLowerCase()}', template: ''}) export class ${name} {}`;

test('Git ignores, nested negations, current tracked edits and Stryker copies', () => {
  const p = project({
    '.gitignore': 'cache/\ntracked.ts\n',
    'cache/copy.ts': component('Cache'),
    'tracked.ts': component('Tracked'),
    'libs/.gitignore': '*.ts\n!keep.ts\n',
    'libs/keep.ts': component('Kept'),
    'libs/drop.ts': component('Ignored'),
    '.stryker-tmp/copy.ts': component('Mutation'),
    'test-setup.ts': component('Dummy'),
    'extra.test.ts': component('Test'),
    '__tests__/helper.ts': component('Helper'),
  }, true);
  try {
    execFileSync('git', ['-C', p.root, 'add', '-f', 'tracked.ts']);
    fs.writeFileSync(path.join(p.root, 'tracked.ts'), component('Edited'));
    const inv = scan(p.root);
    assert.equal(inv.scope.mode, 'git');
    assert.deepEqual(inv.components.map((c) => c.className).sort(), ['Edited', 'Kept']);
    assert.deepEqual(scan(path.join(p.root, 'libs')).components.map((c) => c.className), ['Kept']);
  } finally { p.close(); }
});

test('outside Git the report explicitly states the ignore limitation and skips symlinks', () => {
  const p = project({ 'card.ts': component('Card'), '.stryker-tmp/copy.ts': component('Copy') });
  try {
    fs.symlinkSync(p.root, path.join(p.root, 'loop'), 'dir');
    const inv = scan(p.root);
    assert.equal(inv.stats.total, 1);
    assert.equal(inv.scope.mode, 'filesystem');
    assert.match(toMarkdown(inv), /pas les fichiers .gitignore/);
  } finally { p.close(); }
});

test('required inputs preserve member names, binding aliases and declared types', () => {
  const p = project({ 'card.ts': `@Component({selector:'app-card'}) export class Card {
    title = input.required<string>({alias: 'heading'});
    selected = model.required<boolean>();
    optional = input('hello', {alias: 'caption'});
    @Input({required: true, alias: 'item'}) value!: Product;
    @Input('subtitle') text = '';
    @Input({required: true}) set count(value: number) {}
  }` });
  try {
    const c = scan(p.root).components[0];
    assert.deepEqual(c.inputs, ['title', 'selected', 'optional', 'value', 'text', 'count']);
    assert.deepEqual(c.inputDetails.filter((i) => i.required).map((i) => [i.binding, i.type]),
      [['heading', 'string'], ['selected', 'boolean'], ['item', 'Product'], ['count', 'number']]);
    assert.equal(c.inputDetails.find((i) => i.name === 'optional')?.binding, 'caption');
    assert.equal(c.inputDetails.find((i) => i.name === 'text')?.binding, 'subtitle');
  } finally { p.close(); }
});

test('only actually exported symbols are public; named re-exports and aliases preserve import names', () => {
  const p = project({
    'tsconfig.base.json': JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@demo/ui':['libs/ui/index.ts']}}}),
    'tsconfig.json': JSON.stringify({extends:'./tsconfig.base.json'}),
    'libs/ui/card.ts': component('Card') + '\n' + component('Hidden'),
    'libs/ui/index.ts': "export { Card as PublicCard } from './card'; export type { Hidden } from './card';",
  });
  try {
    const inv = scan(p.root);
    const card = inv.components.find((c) => c.className === 'Card')!;
    const hidden = inv.components.find((c) => c.className === 'Hidden')!;
    assert.equal(card.public, true);
    assert.equal(hidden.public, false);
    assert.deepEqual(card.imports[0], {from:'@demo/ui',name:'PublicCard',kind:'alias',statement:'import { PublicCard as Card } from "@demo/ui";'});
    assert.ok(!hidden.imports.some((i) => i.from === '@demo/ui'));
  } finally { p.close(); }
});

test('wildcard aliases, local re-exports, default exports and export cycles', () => {
  const p = project({
    'tsconfig.json': JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@demo/*':['libs/*/index.ts']}}}),
    'libs/card/card.ts': '@Component({selector:"app-card"}) export default class Card {}',
    'libs/card/index.ts': "import Card from './card'; export { Card }; export * from './cycle';",
    'libs/card/cycle.ts': "export * from './index';",
  });
  try {
    const c = scan(p.root).components[0];
    assert.equal(c.public, true);
    assert.equal(c.imports[0].from, '@demo/card');
    assert.match(c.imports.find((i) => i.kind === 'source')!.statement, /^import Card from/);
  } finally { p.close(); }
});

test('eager and lazy route references resolve aliases without confusing same-name classes', () => {
  const p = project({
    'a.ts': component('Page'),
    'b.ts': component('Page'),
    'lazy.ts': component('Lazy'),
    'default.ts': '@Component({}) export default class DefaultPage {}',
    'routes.ts': `import { Page as Eager } from './a';
export const routes = [
{path:'a',component:Eager},
{path:'lazy',loadComponent:()=>import('./lazy').then(m=>m.Lazy)},
{path:'default',loadComponent:()=>import('./default')}
];`,
  });
  try {
    const inv = scan(p.root);
    assert.equal(inv.components.find((c) => c.file === 'a.ts')?.usageStatus, 'routes');
    assert.equal(inv.components.find((c) => c.file === 'b.ts')?.usageStatus, 'unconfirmed');
    assert.equal(inv.components.find((c) => c.className === 'Lazy')?.routeReferences[0].line, 4);
    assert.equal(inv.components.find((c) => c.className === 'DefaultPage')?.usageStatus, 'routes');
    assert.equal(inv.stats.routed, 3);
    assert.equal(inv.stats.unconfirmed, 1);
  } finally { p.close(); }
});

test('usage excerpts point to real external and inline template lines', () => {
  const p = project({
    'card.ts': component('Card'),
    'page.html': '\n<section>\n  <app-card [title]="title" [active]="count > 0">Text</app-card>\n</section>',
    'page.ts': "@Component({template:`\n<div>\n<app-card />\n</div>`}) export class Page {}",
  });
  try {
    const c = scan(p.root).components.find((c) => c.className === 'Card')!;
    assert.equal(c.examples.length, 2);
    assert.ok(c.examples.every((e) => e.line === 3));
    assert.equal(c.examples[0].snippet, '<app-card [title]="title" [active]="count > 0">');
    for (const e of c.examples) assert.ok(fs.readFileSync(path.join(p.root, e.file), 'utf8').split('\n')[e.line - 1].includes(e.snippet));
  } finally { p.close(); }
});

test('search explains exact and synonym matches, filters all terms, and respects the limit', () => {
  const p = project({ 'card.ts': component('Card'), 'profile-tile.ts': component('ProfileTile'), 'button.ts': component('Button') });
  try {
    const inv = scan(p.root);
    const results = searchComponents(inv, 'card');
    assert.deepEqual(results.map((r) => r.component.className), ['Card', 'ProfileTile']);
    assert.ok(results[0].reasons.some((r) => r.includes('Nom exact')));
    assert.ok(results[1].reasons.some((r) => r.includes('Synonyme')));
    assert.equal(searchComponents(inv, 'card', 1).length, 1);
    assert.deepEqual(searchComponents(inv, 'card profile').map((r) => r.component.className), ['ProfileTile']);
    assert.deepEqual(searchComponents(inv, '   '), []);
    assert.match(searchToMarkdown([], 'missing'), /Aucun candidat/);
    assert.ok(searchComponents(inv, 'app-card')[0].reasons.some((r) => r.includes('Sélecteur exact')));
  } finally { p.close(); }
});

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test('CLI rejects missing option values and never scans an accidental positional value', () => {
  for (const args of [['--search'], ['--md'], ['--limit','0'], ['--limit','2'], ['--unknown']]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {encoding:'utf8'});
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /Erreur/);
  }
});

test('CLI search emits reusable JSON and Markdown, with query options before the directory', () => {
  const p = project({ 'card.ts': component('Card') });
  try {
    const json = path.join(p.root, 'result.json');
    const md = path.join(p.root, 'result.md');
    const result = spawnSync(process.execPath, ['--import','tsx',cli,'--search','card',p.root,'--limit','1','--quiet','--json',json,'--md',md], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    const data = JSON.parse(fs.readFileSync(json,'utf8'));
    assert.equal(data.query, 'card');
    assert.equal(data.results[0].component.className, 'Card');
    assert.match(fs.readFileSync(md,'utf8'), /Pourquoi : Nom exact/);
  } finally { p.close(); }
});

test('CLI catalogue stays compact by default; --details adds one reuse sheet per component', () => {
  const p = project({ 'card.ts': component('Card') });
  try {
    const run = (...extra: string[]) => spawnSync(process.execPath, ['--import','tsx',cli,p.root,...extra], {encoding:'utf8'});
    const compact = run();
    assert.equal(compact.status, 0, compact.stderr);
    assert.match(compact.stdout, /\| Card \| `app-card` \|/);
    assert.doesNotMatch(compact.stdout, /### Card/);
    assert.match(run('--details').stdout, /## Réutiliser un composant[\s\S]*### Card/);
  } finally { p.close(); }
});

test('ambiguous star exports do not invent a usable barrel import', () => {
  const p = project({
    'a.ts': component('Card'), 'b.ts': component('Card'),
    'index.ts': "export * from './a'; export * from './b';",
  });
  try {
    const inv = scan(p.root);
    assert.ok(inv.components.every((c) => !c.public));
    assert.ok(inv.components.every((c) => c.imports.every((i) => i.kind === 'source')));
    fs.writeFileSync(path.join(p.root, 'index.ts'), "export * from './a'; export * from './b'; export {Card} from './b';");
    const explicit = scan(p.root);
    assert.equal(explicit.components.find((c) => c.file === 'a.ts')?.public, false);
    assert.equal(explicit.components.find((c) => c.file === 'b.ts')?.public, true);
  } finally { p.close(); }
});

test('a barrel value that shadows a star-exported component is not suggested', () => {
  const p = project({ 'card.ts': component('Card'), 'index.ts': "export const Card = 'not a component'; export * from './card';" });
  try {
    const c = scan(p.root).components[0];
    assert.equal(c.public, false);
    assert.ok(c.imports.every((i) => i.kind === 'source'));
  } finally { p.close(); }
});

test('compound attribute selectors count real tags once and preserve exact examples', () => {
  const p = project({
    'button.ts': `@Component({selector:'button[kb-button], [kb-button][extra]', template:''}) export class Button {}`,
    'page.html': `<!-- <button kb-button> -->
<div title="kb-button <button kb-button>"></div>
<button kb-button extra [disabled]="count > 0">ok</button>
<button [kb-button]="active"></button>
<button (kb-button)="onClick()"></button>
<a kb-button></a>
<script>const fake = '<button kb-button>';</script>`,
  });
  try {
    const button = scan(p.root).components[0];
    assert.equal(button.usages, 2);
    assert.equal(button.examples[0].line, 3);
    assert.equal(button.examples[0].snippet, '<button kb-button extra [disabled]="count > 0">');
  } finally { p.close(); }
});

test('test utility directories are excluded with and without Git', () => {
  for (const git of [false, true]) {
    const p = project({ 'src/test-utils/render.ts': component('Test'), 'src/test-helpers/host.ts': component('Host'), 'src/real.ts': component('Real') }, git);
    try { assert.deepEqual(scan(p.root).components.map((c) => c.className), ['Real']); }
    finally { p.close(); }
  }
});

test('named route loaders follow const aliases and functions but not cycles or shadowed parameters', () => {
  const p = project({
    'page.ts': component('Page'),
    'routes.ts': `const loadPage = () => import('./page').then(m => m.Page);
const alias = loadPage;
function defaultLoader() { return import('./page').then(m => m.Page); }
const cycleA = cycleB; const cycleB = cycleA;
export const routes = [{path:'a',loadComponent:alias},{path:'b',loadComponent:defaultLoader},{path:'cycle',loadComponent:cycleA}];
function fake(loadPage) { return [{path:'shadow',loadComponent:loadPage}]; }
let mutable = loadPage;
const nope = [{path:'mutable',loadComponent:mutable}];
function destructured({loadPage}) { return [{path:'shadow2',loadComponent:loadPage}]; }
function localShadow() { const {loadPage} = external; return [{path:'shadow3',loadComponent:loadPage}]; }`,
  });
  try {
    const c = scan(p.root).components[0];
    assert.equal(c.usageStatus, 'routes');
    assert.deepEqual(c.routeReferences.map((r) => r.line), [5]); // same-line references deduplicated
  } finally { p.close(); }
});

test('standalone defaults depend on Angular major; NgModules identify declaration and export boundaries', () => {
  for (const [version, expected] of [['^18.2.0', false], ['^22.0.0', true], ['workspace:*', null]] as const) {
    const p = project({
      'package.json': JSON.stringify({dependencies:{'@angular/core': version}}),
      'auto.ts': component('Auto'),
      'legacy.ts': `@Component({standalone:false, selector:'legacy'}) export class Legacy {}`,
      'module.ts': `import {Legacy as Local} from './legacy'; @NgModule({declarations:[Local],exports:[]}) export class InternalModule {}`,
    });
    try {
      const inv = scan(p.root), legacy = inv.components.find((c) => c.className === 'Legacy')!;
      assert.equal(inv.components.find((c) => c.className === 'Auto')!.standalone, expected);
      assert.equal(legacy.standalone, false);
      assert.deepEqual(legacy.ngModules, [{name:'InternalModule',file:'module.ts',exported:false}]);
      assert.match(toMarkdown(inv, { details: true }), /déclaré mais non exporté/);
      assert.doesNotMatch(toMarkdown(inv), /## Réutiliser un composant/);
      fs.writeFileSync(path.join(p.root,'module.ts'), `import {Legacy} from './legacy'; @NgModule({declarations:[Legacy],exports:[Legacy]}) export class PublicModule {}`);
      assert.equal(scan(p.root).components.find((c) => c.className === 'Legacy')!.ngModules[0].exported, true);
    } finally { p.close(); }
  }
});

test('search indexes descriptions, aliased inputs, outputs and literal template labels with evidence', () => {
  const p = project({
    'picker.ts': `/** Choisir la couleur du profil. */
@Component({selector:'palette-control',template:'<input placeholder="Chercher une nuance" [title]="secretBinding" /><img alt="{{ secretInterpolation }}"><span data-value=\\'title="secretAttribute"\\'></span><style>.secretCss {}</style><!-- secretComment -->'})
export class Palette { value = input('', {alias:'teinte'}); confirmed = output(); }`,
    'list.ts': `@Component({selector:'plain-list',template:'<ul><li>Un élément</li></ul>'}) export class List {}`,
    'icon.ts': component('Icon'),
  });
  try {
    const inv = scan(p.root);
    for (const query of ['choisir couleur', 'chercher nuance', 'teinte', 'confirmed']) {
      const found = searchComponents(inv, query);
      assert.deepEqual(found.map((r) => r.component.className), ['Palette'], query);
      assert.ok(found[0].reasons.some((r) => /Description|template|Entrée ou sortie/.test(r)));
    }
    for (const query of ['table', 'avatar', 'secretBinding', 'secretCss', 'secretComment', 'secretInterpolation', 'secretAttribute']) assert.deepEqual(searchComponents(inv, query), [], query);
    assert.deepEqual(searchComponents(inv, 'les couleurs du profil').map((r) => r.component.className), ['Palette']);
  } finally { p.close(); }
});

test('strong name matches rank first and drop template mentions, not documented candidates; host accessibility labels are searchable', () => {
  const p = project({
    'card.ts': component('ProductCard'),
    'page.ts': `@Component({template:'<p>Product card</p>'}) export class Page {}`,
    'teaser.ts': `/** Compact product card for listings. */ @Component({selector:'app-teaser'}) export class Teaser {}`,
    'picker.ts': `@Component({selector:'theme-picker',host:{'aria-label':'Couleur'}}) export class ThemePicker {}`,
  });
  try {
    const inv = scan(p.root);
    assert.deepEqual(searchComponents(inv, 'product card').map((r) => r.component.className), ['ProductCard', 'Teaser']);
    assert.ok(searchComponents(inv, 'product card')[1].reasons.some((r) => r.includes('Description')));
    assert.deepEqual(searchComponents(inv, 'choisir couleur').map((r) => r.component.className), ['ThemePicker']);
    assert.ok(searchComponents(inv, 'choisir couleur')[0].reasons.some((r) => r.includes('template')));
  } finally { p.close(); }
});

test('computed metadata remains unknown and module declarations do not overwrite standalone metadata', () => {
  const p = project({
    'package.json': JSON.stringify({dependencies:{'@angular/core':'^22.0.0'}}),
    'a.ts': '@Component(metadata) export class Dynamic {}',
    'b.ts': '@Component({...metadata}) export class Spread {}',
    'c.ts': '@Component({standalone:true}) export class Explicit {}',
    'module.ts': "import {Explicit} from './c'; @NgModule({declarations:[Explicit]}) export class InvalidModule {}",
  });
  try {
    const components = scan(p.root).components;
    assert.equal(components.find((c) => c.className === 'Dynamic')!.standalone, null);
    assert.equal(components.find((c) => c.className === 'Spread')!.standalone, null);
    assert.equal(components.find((c) => c.className === 'Explicit')!.standalone, true);
  } finally { p.close(); }
});
