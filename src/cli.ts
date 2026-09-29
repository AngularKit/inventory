#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scan, toMarkdown } from './inventory.js';

const args = process.argv.slice(2);
const usage = `Usage: angular-inventory [dir] [--json <file>] [--md <file>] [--quiet]

Scanne un projet Angular et produit l'inventaire des composants :
sélecteurs, inputs/outputs, visibilité (API publique), usages, doublons de concept, quasi-composants.

  dir             racine à scanner (défaut : .)
  --json <file>   écrit le catalogue en JSON
  --md <file>     écrit le rapport Markdown
  --quiet         masque le rapport sur stdout
  --help, -h      affiche cette aide

Dans un dépôt Git, respecte les fichiers ignorés. Exclut les tests et les copies Stryker.`;

if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }

try {
  let dir: string | undefined;
  let quiet = false;
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--quiet') { quiet = true; continue; }
    if (['--json', '--md'].includes(arg)) {
      const value = args[++i];
      if (!value?.trim() || value.startsWith('--')) throw new Error(`Valeur manquante pour ${arg}.`);
      opts.set(arg, value);
    } else if (arg.startsWith('-')) throw new Error(`Option inconnue : ${arg}.`);
    else if (dir !== undefined) throw new Error('Un seul dossier peut être analysé.');
    else dir = arg;
  }
  const inv = scan(dir ?? '.');
  const md = toMarkdown(inv);
  for (const warning of inv.scope.warnings) console.error(`Attention : ${warning}`);
  const jsonOut = opts.get('--json');
  const mdOut = opts.get('--md');
  if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(inv, null, 2));
  if (mdOut) fs.writeFileSync(path.resolve(mdOut), md);
  if (!quiet) console.log(md);
  if (jsonOut || mdOut) console.error(`\nÉcrit : ${[jsonOut, mdOut].filter(Boolean).join(', ')}`);
} catch (error) {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
