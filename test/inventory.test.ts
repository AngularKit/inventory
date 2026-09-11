import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, toMarkdown } from '../src/inventory.js';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixture');
const inv = scan(fixture);
const byName = Object.fromEntries(inv.components.map((c) => [c.className, c]));

test('trouve tous les composants du fixture', () => {
  assert.equal(inv.stats.total, 6);
  assert.deepEqual(
    inv.components.map((c) => c.className).sort(),
    ['DashboardPage', 'OrderPanel', 'ProfileCardComponent', 'StatTile', 'UiButton', 'UiCard'],
  );
});

test('extrait sélecteurs, inputs et outputs (décorateurs et API signal)', () => {
  assert.deepEqual(byName.StatTile.selectors, ['app-stat-tile']);
  assert.deepEqual(byName.StatTile.inputs, ['value']);
  assert.ok(byName.UiCard.inputs.length > 0, 'UiCard doit exposer au moins un input');
});

test('détecte l’API publique via index.ts', () => {
  assert.equal(byName.UiCard.public, true);
  assert.equal(byName.UiButton.public, true);
  assert.equal(byName.DashboardPage.public, false);
  assert.equal(inv.stats.public, 2);
});

test('compte les usages dans les templates', () => {
  assert.ok(byName.StatTile.usages > 0);
  assert.ok(byName.StatTile.usedIn.some((f) => f.endsWith('dashboard-page.html')));
  assert.equal(byName.DashboardPage.usages, 0, 'une page routée n’est référencée nulle part');
});

test('regroupe les concepts synonymes (card / tile / panel)', () => {
  assert.equal(inv.clusters[0].concept, 'card');
  for (const name of ['ProfileCardComponent', 'StatTile', 'OrderPanel', 'UiCard']) {
    assert.ok(inv.clusters[0].components.includes(name), `${name} devrait être dans le cluster card`);
  }
});

test('produit un rapport Markdown cohérent', () => {
  const md = toMarkdown(inv);
  assert.match(md, /^# Inventaire des composants Angular/);
  assert.match(md, /\*\*6 composants\*\*/);
  assert.match(md, /## Concepts en doublon potentiel/);
  assert.match(md, /## Catalogue/);
  assert.match(md, /\| StatTile \| `app-stat-tile` \|/);
});
