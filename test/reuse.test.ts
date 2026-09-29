import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, toMarkdown } from '../src/inventory.js';

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

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test('CLI rejects missing option values and never scans an accidental positional value', () => {
  for (const args of [['--search'], ['--md'], ['--limit','0'], ['--limit','2'], ['--unknown']]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {encoding:'utf8'});
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /Erreur/);
  }
});

test('compound attribute selectors count real tags once', () => {
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
    assert.deepEqual(button.usedIn, ['page.html']);
  } finally { p.close(); }
});

test('test utility directories are excluded with and without Git', () => {
  for (const git of [false, true]) {
    const p = project({ 'src/test-utils/render.ts': component('Test'), 'src/test-helpers/host.ts': component('Host'), 'src/real.ts': component('Real') }, git);
    try { assert.deepEqual(scan(p.root).components.map((c) => c.className), ['Real']); }
    finally { p.close(); }
  }
});

test('a broken Git repository fails instead of including ignored files', () => {
  const p = project({
    '.gitignore': 'ignored/\n',
    'ignored/copy.ts': component('IgnoredCopy'),
    'real.ts': component('Real'),
  }, true);
  try {
    fs.writeFileSync(path.join(p.root, '.git/config'), '[broken config\n');
    assert.throws(() => scan(p.root), /Échec de git ls-files[\s\S]*bad config/);
  } finally { p.close(); }
});

test('Git fallback distinguishes absent Git, outside repositories and other fatal errors', () => {
  const p = project({ 'real.ts': component('Real') });
  const bin = path.join(p.root, 'bin');
  fs.mkdirSync(bin);
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', cli, p.root], {
    encoding: 'utf8', env: { ...process.env, PATH: bin, LANG: 'fr_FR.UTF-8' },
  });
  try {
    const missing = run();
    assert.equal(missing.status, 0, missing.stderr);
    assert.match(missing.stderr, /Git indisponible ou dossier hors dépôt/);
    const fakeGit = (diagnostic: string) => fs.writeFileSync(path.join(bin, 'git'),
      `#!/bin/sh\nprintf '%s\\n' '${diagnostic}' >&2\nexit 128\n`, { mode: 0o755 });
    for (const diagnostic of [
      'fatal: not a git repository (or any of the parent directories): .git',
      'fatal: not a git repository (or any parent up to mount point /)',
    ]) {
      fakeGit(diagnostic);
      const outside = run();
      assert.equal(outside.status, 0, outside.stderr);
    }
    for (const diagnostic of [
      'fatal: detected dubious ownership in repository',
      'fatal: bad config line 1 in file .git/config',
      'fatal: not a git repository: /invalid-explicit-git-dir',
    ]) {
      fakeGit(diagnostic);
      const failure = run();
      assert.equal(failure.status, 1, diagnostic);
      assert.match(failure.stderr, /Échec de git ls-files/);
      assert.doesNotMatch(failure.stdout, /Inventaire des composants/);
    }
  } finally { p.close(); }
});
