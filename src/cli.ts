#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scan, toMarkdown } from './inventory.js';

const args = process.argv.slice(2);
const usage = `Usage: angular-inventory [dir] [--json <file>] [--md <file>] [--quiet]

Scanne un projet Angular et produit l'inventaire des composants :
sélecteurs, inputs/outputs, visibilité (API publique), usages, doublons de concept, quasi-composants.

  dir            racine à scanner (défaut : .)
  --json <file>  écrit l'inventaire JSON (ex. components.json)
  --md <file>    écrit le rapport Markdown (ex. COMPONENTS.md)
  --quiet        n'affiche pas le rapport sur stdout`;

if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }

const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--json' && args[i - 1] !== '--md') ?? '.';

const inv = scan(dir);
const md = toMarkdown(inv);
const jsonOut = opt('--json');
const mdOut = opt('--md');
if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(inv, null, 2));
if (mdOut) fs.writeFileSync(path.resolve(mdOut), md);
if (!args.includes('--quiet')) console.log(md);
if (jsonOut || mdOut) console.error(`\nÉcrit : ${[jsonOut, mdOut].filter(Boolean).join(', ')}`);
