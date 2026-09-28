import type { Inventory, SearchResult } from './inventory.js';

const GROUPS = [
  ['card', 'tile', 'carte', 'vignette'], ['dialog', 'modal', 'dialogue'],
  ['button', 'btn', 'bouton'], ['input', 'field', 'champ'],
  ['select', 'selector', 'picker', 'selection', 'selectionner', 'choisir'],
  ['list', 'liste'], ['table', 'tableau', 'datagrid'],
  ['notification', 'toast', 'snackbar'], ['progress', 'progression'],
  ['badge', 'chip'], ['tag', 'etiquette'], ['tab', 'onglet'],
  ['avatar'], ['icon', 'icone'], ['image'], ['form', 'formulaire'],
  ['search', 'chercher', 'rechercher', 'recherche'], ['color', 'colour', 'couleur'],
  ['theme'], ['dark', 'sombre'], ['light', 'clair'],
  ['reading', 'lecture'], ['article', 'post'], ['testimonial', 'temoignage'],
  ['consent', 'consentement'], ['logout', 'deconnexion', 'deconnecter'],
  ['next', 'suivant', 'suivante'], ['previous', 'precedent', 'precedente'],
  ['lesson', 'lecon'], ['navigation', 'nav'], ['video'],
  ['equipment', 'materiel', 'equipement'], ['workout', 'entrainement'],
  ['history', 'historique'], ['summary', 'bilan'], ['completed', 'termine'],
  ['edit', 'editor', 'editeur'], ['online', 'ligne'],
];
const STOP = new Set(['a', 'au', 'aux', 'de', 'du', 'des', 'd', 'le', 'la', 'les', 'l', 'un', 'une', 'en', 'et', 'pour', 'avec', 'the', 'an', 'of', 'for', 'with', 'and']);
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const singular = (word: string) => word.length > 3 && !/(?:ss|us)$/.test(word) ? word.replace(/s$/, '') : word;
const wordsOf = (text: string) => normalize(text.replace(/([a-z\d])([A-Z])/g, '$1 $2')).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(singular);
const concepts = new Map(GROUPS.flatMap((group) => group.map((word) => [word, group[0]] as const)));
const concept = (word: string) => concepts.get(word) ?? word;

/** All query terms require traceable lexical evidence. No semantic confidence is implied. */
export function search(inv: Inventory, query: string, limit: number): SearchResult[] {
  const words = [...new Set(wordsOf(query).filter((word) => !STOP.has(word)))];
  if (!words.length) return [];
  const exact = normalize(query.trim());
  const results: (SearchResult & { nameOnly: boolean })[] = [];
  for (const component of inv.components) {
    const fields: { label: string; tokens: string[]; weight: number }[] = [
      { label: 'Nom ou sélecteur', tokens: wordsOf([component.className, ...component.selectors].join(' ')), weight: 8 },
      { label: 'Entrée ou sortie', tokens: wordsOf([...component.inputs, ...component.outputs, ...component.inputDetails.map((i) => i.binding)].join(' ')), weight: 5 },
      { label: 'Description', tokens: wordsOf(component.description ?? ''), weight: 4 },
      { label: 'Texte du template', tokens: wordsOf(component.templateText ?? ''), weight: 2 },
    ];
    // File paths are searchable explicitly, but a parent directory alone must not make
    // every child component a candidate for a product concept (e.g. products/*).
    if (query.includes('/')) fields.push({ label: 'Chemin', tokens: wordsOf(component.file), weight: 1 });
    let score = 0;
    const reasons: string[] = [];
    for (const word of words) {
      let best: { points: number; reason: string } | undefined;
      for (const field of fields) {
        const literal = field.tokens.includes(word);
        const synonym = !literal && field.tokens.some((token) => concept(token) === concept(word));
        if (!literal && !synonym) continue;
        const points = field.weight * (literal ? 2 : 1);
        if (!best || points > best.points) best = { points, reason: `${synonym ? 'Synonyme — ' : ''}${field.label} : ${word}` };
      }
      if (!best) { score = 0; break; }
      score += best.points;
      reasons.push(best.reason);
    }
    if (normalize(component.className) === exact) { score += 100; reasons.unshift(`Nom exact : ${query.trim()}`); }
    else if (component.selectors.some((s) => normalize(s) === exact)) { score += 100; reasons.unshift(`Sélecteur exact : ${query.trim()}`); }
    if (score) results.push({ component, score, reasons, nameOnly: words.every((word) => fields[0].tokens.some((token) => concept(token) === concept(word))) || normalize(component.className) === exact });
  }
  // Prefer candidates whose names cover the whole request over incidental mentions
  // in a parent page, input or description. Keep weaker evidence when no such candidate exists.
  const candidates = results.some((r) => r.nameOnly) ? results.filter((r) => r.nameOnly) : results;
  return candidates.sort((a, b) => b.score - a.score || a.component.file.localeCompare(b.component.file) || a.component.className.localeCompare(b.component.className)).slice(0, Math.max(0, limit)).map(({ nameOnly: _nameOnly, ...result }) => result);
}
