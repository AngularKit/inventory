#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scan, toMarkdown, searchComponents, searchToMarkdown } from './inventory.js';
import { inventoryToTerminal, searchToTerminal } from './terminal.js';

const args = process.argv.slice(2);
const usage = `Usage: angular-inventory [dir] [--search <termes>] [--limit <nombre>] [--json <file>] [--md <file>] [--details] [--quiet]

Retrouve les composants Angular existants et les informations pour les réutiliser.
Par défaut : résumé du scan ou candidats compacts, avec import, entrées et usage.

  dir             racine à scanner (défaut : .)
  --search <texte> recherche lexicale avec synonymes UI limités (FR/EN)
  --limit <n>      nombre maximal de candidats (défaut : 5, avec --search)
  --json <file>   écrit le catalogue ou les résultats de recherche en JSON
  --md <file>     écrit le catalogue ou les fiches de recherche en Markdown
  --details       affiche le rapport complet ; ajoute les fiches au catalogue Markdown
  --quiet         masque stdout, conserve les exports et les avertissements
  --help, -h      affiche cette aide

Exemples :
  angular-inventory .
  angular-inventory . --search "carte" --limit 3
  angular-inventory . --search "card" --details
  angular-inventory . --md COMPONENTS.md --quiet
  angular-inventory . --json components.json --quiet

Les exports conservent leur contenu, même avec un affichage terminal compact.
Dans un dépôt Git, respecte les fichiers ignorés. Exclut les tests et les copies Stryker.
Les imports relatifs du rapport partent de la racine analysée et doivent être adaptés.`;

if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }

try {
  let dir: string | undefined;
  let quiet = false;
  let details = false;
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--quiet') { quiet = true; continue; }
    if (arg === '--details') { details = true; continue; }
    if (['--json', '--md', '--search', '--limit'].includes(arg)) {
      const value = args[++i];
      if (!value?.trim() || value.startsWith('--')) throw new Error(`Valeur manquante pour ${arg}.`);
      opts.set(arg, value);
    } else if (arg.startsWith('-')) throw new Error(`Option inconnue : ${arg}.`);
    else if (dir !== undefined) throw new Error('Un seul dossier peut être analysé.');
    else dir = arg;
  }
  const limit = Number(opts.get('--limit') ?? 5);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit doit être un entier positif.');
  if (opts.has('--limit') && !opts.has('--search')) throw new Error('--limit nécessite --search.');
  const inv = scan(dir ?? '.');
  const query = opts.get('--search');
  const results = query ? searchComponents(inv, query, limit) : undefined;
  const data = results ? { root: inv.root, scannedAt: inv.scannedAt, scope: inv.scope, query, results } : inv;
  for (const warning of inv.scope.warnings) console.error(`Attention : ${warning}`);
  const jsonOut = opts.get('--json');
  const mdOut = opts.get('--md');
  const md = mdOut || (details && !quiet)
    ? (results ? searchToMarkdown(results, query!) : toMarkdown(inv, { details })) : undefined;
  if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(data, null, 2));
  if (mdOut) fs.writeFileSync(path.resolve(mdOut), md!);
  if (!quiet) console.log(details ? md : results ? searchToTerminal(results, query!) : inventoryToTerminal(inv));
  if (jsonOut || mdOut) console.error(`\nÉcrit : ${[jsonOut, mdOut].filter(Boolean).join(', ')}`);
} catch (error) {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  console.error('Aide et exemples : angular-inventory --help');
  process.exitCode = 1;
}
