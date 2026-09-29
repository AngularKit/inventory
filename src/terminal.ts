import type { Inventory, SearchResult } from './inventory.js';

const help = 'Aide : --help (ou -h)';

/** Keep the default scan independent of the size of the catalogue. */
export function inventoryToTerminal(inv: Inventory): string {
  return [
    'Inventory — composants Angular à réutiliser',
    `Racine : ${inv.root}`,
    inv.stats.total ? `${inv.stats.total} composant${inv.stats.total > 1 ? 's' : ''} détecté${inv.stats.total > 1 ? 's' : ''} · ${inv.stats.public} exporté${inv.stats.public > 1 ? 's' : ''} via une API publique`
      : 'Aucun composant Angular détecté. Vérifie le dossier analysé et les exclusions.',
    '',
    'Rechercher : ajoute --search "carte" --limit 3',
    'Catalogue complet : ajoute --md COMPONENTS.md',
    'Rapport détaillé dans le terminal : ajoute --details',
    help,
  ].join('\n');
}

/** Show enough context to choose a candidate; snippets remain in the detailed report. */
export function searchToTerminal(results: SearchResult[], query: string): string {
  const plural = results.length > 1 ? 's' : '';
  const lines = [`Recherche : ${query}`, `${results.length} candidat${plural} affiché${plural} — correspondances lexicales`, ''];
  for (const [index, { component: c, reasons }] of results.entries()) {
    const suggestion = c.imports[0];
    const required = c.inputDetails.filter((input) => input.required);
    const example = c.examples[0];
    const route = c.routeReferences[0];
    lines.push(
      `${index + 1}. ${c.className} — ${c.selectors.join(', ') || 'sans sélecteur'}`,
      `   Source : ${c.file}`,
      `   Import : ${suggestion ? suggestion.statement : 'aucun export confirmé'}`,
    );
    if (suggestion && suggestion.kind !== 'alias') lines.push('   Chemin relatif à la racine analysée ; à adapter au fichier appelant.');
    lines.push(
      `   Intégration : ${c.standalone === true ? 'standalone, à ajouter aux imports du composant appelant'
        : c.standalone === false ? 'via un NgModule (voir --details)' : 'standalone/NgModule à vérifier'}`,
      `   Entrées requises : ${required.length ? required.map((input) => input.binding).join(', ') : 'aucune détectée (hors héritage)'}`,
      example ? `   Usage : ${example.file}:${example.line}`
        : route ? `   Route : ${route.file}:${route.line}` : '   Usage : aucun exemple confirmé',
      `   Pourquoi : ${reasons.join(' ; ')}`,
      '',
    );
  }
  if (!results.length) lines.push(
    'Aucun candidat trouvé. Essaie un nom, un sélecteur ou un terme plus court.',
    'Un résultat vide ne prouve pas qu’aucun composant adapté n’existe.',
    'Catalogue complet : ajoute --md COMPONENTS.md',
    '',
  );
  else lines.push('Extraits d’usage et fiches complètes : ajoute --details ou --md candidates.md');
  lines.push(help);
  return lines.join('\n');
}
