// Rejoue un jeu d'évaluation figé : node docs/eval/run.mjs <corpus> [cas.json]
// Prérequis : npm run build. Réussite = un composant attendu parmi les 3 premiers ;
// pour les besoins absents, réussite = aucun résultat.
import fs from 'node:fs';
import { scan, searchComponents } from '../../dist/inventory.js';

const [corpus, casesFile = new URL('./angular-components.json', import.meta.url)] = process.argv.slice(2);
if (!corpus) { console.error('Usage : node docs/eval/run.mjs <corpus> [cas.json]'); process.exit(1); }
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const inv = scan(corpus);
let top3 = 0, top1 = 0, absentOk = 0;
for (const c of cases.present) {
  const top = searchComponents(inv, c.q, 3).map((r) => r.component.className);
  if (top.some((n) => c.ok.includes(n))) top3++; else console.log(`✗ ${c.q} → ${top.join(', ') || '(aucun)'}`);
  if (c.ok.includes(top[0])) top1++;
}
for (const q of cases.absent) {
  const top = searchComponents(inv, q, 3).map((r) => r.component.className);
  if (!top.length) absentOk++; else console.log(`✗ absent « ${q} » → ${top.join(', ')}`);
}
console.log(`Trois premiers : ${top3}/${cases.present.length} · premier : ${top1}/${cases.present.length} · absents reconnus : ${absentOk}/${cases.absent.length}`);
