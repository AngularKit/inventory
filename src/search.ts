import type { ComponentInfo, Inventory, SearchResult } from './inventory.js';

// Generic UI vocabulary only: project-specific terms belong in the project's own names and docs.
// A list is not a table and an icon is not an avatar, so those stay in separate groups.
const GROUPS = [
  ['card', 'tile', 'carte', 'vignette'], ['dialog', 'modal', 'dialogue'],
  ['button', 'btn', 'bouton'], ['input', 'field', 'champ'],
  ['select', 'selector', 'picker', 'selection', 'selectionner', 'choisir'],
  ['list', 'liste'], ['table', 'tableau', 'datagrid'],
  ['notification', 'toast', 'snackbar'], ['progress', 'progression'],
  ['badge', 'chip'], ['tag', 'etiquette'], ['tab', 'onglet'],
  ['icon', 'icone'], ['form', 'formulaire'],
  ['search', 'chercher', 'rechercher', 'recherche'], ['color', 'colour', 'couleur'],
  ['dark', 'sombre'], ['light', 'clair'],
  ['next', 'suivant', 'suivante'], ['previous', 'precedent', 'precedente'],
  ['navigation', 'nav'], ['edit', 'editor', 'editeur'],
];
const STOP = new Set(['a', 'au', 'aux', 'de', 'du', 'des', 'd', 'le', 'la', 'les', 'l', 'un', 'une', 'en', 'et', 'pour', 'avec', 'the', 'an', 'of', 'for', 'with', 'and']);
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const singular = (word: string) => word.length > 3 && !/(?:ss|us)$/.test(word) ? word.replace(/s$/, '') : word;
const wordsOf = (text: string) => normalize(text.replace(/([a-z\d])([A-Z])/g, '$1 $2')).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(singular);
const concepts = new Map(GROUPS.flatMap((group) => group.map((word) => [word, group[0]] as const)));
const concept = (word: string) => concepts.get(word) ?? word;

interface Field { label: string; tokens: string[]; weight: number; incidental?: boolean }
interface Evidence { points: number; reason: string; incidental: boolean }

const matchesConcept = (tokens: string[], word: string) => tokens.some((token) => concept(token) === concept(word));

function fieldsOf(component: ComponentInfo, withPath: boolean): Field[] {
  const fields: Field[] = [
    { label: 'Nom ou sélecteur', tokens: wordsOf([component.className, ...component.selectors].join(' ')), weight: 8 },
    { label: 'Entrée ou sortie', tokens: wordsOf([...component.inputs, ...component.outputs, ...component.inputDetails.map((i) => i.binding)].join(' ')), weight: 5 },
    { label: 'Description', tokens: wordsOf(component.description), weight: 4 },
    // Template text is written for end users, not to describe the component: it may be an incidental mention.
    { label: 'Texte du template', tokens: wordsOf(component.templateText), weight: 2, incidental: true },
  ];
  // File paths are searchable explicitly, but a parent directory alone must not make
  // every child component a candidate for a product concept (e.g. products/*).
  if (withPath) fields.push({ label: 'Chemin', tokens: wordsOf(component.file), weight: 1 });
  return fields;
}

/** Strongest evidence for one query word; a literal match counts double a synonym. */
function bestEvidence(fields: Field[], word: string): Evidence | undefined {
  let best: Evidence | undefined;
  for (const field of fields) {
    const literal = field.tokens.includes(word);
    if (!literal && !matchesConcept(field.tokens, word)) continue;
    const points = field.weight * (literal ? 2 : 1);
    if (!best || points > best.points) {
      best = { points, reason: `${literal ? '' : 'Synonyme — '}${field.label} : ${word}`, incidental: !!field.incidental };
    }
  }
  return best;
}

interface Scored extends SearchResult { nameCovers: boolean; incidental: boolean }

const rank = (a: Scored, b: Scored) => Number(b.nameCovers) - Number(a.nameCovers)
  || b.score - a.score
  || a.component.file.localeCompare(b.component.file)
  || a.component.className.localeCompare(b.component.className);

/** All query terms require traceable lexical evidence. No semantic confidence is implied. */
export function search(inv: Inventory, query: string, limit: number): SearchResult[] {
  const words = [...new Set(wordsOf(query).filter((word) => !STOP.has(word)))];
  if (!words.length) return [];
  const exact = normalize(query.trim());
  const results: Scored[] = [];
  for (const component of inv.components) {
    const fields = fieldsOf(component, query.includes('/'));
    let score = 0;
    let incidental = false;
    const reasons: string[] = [];
    for (const word of words) {
      const evidence = bestEvidence(fields, word);
      if (!evidence) { score = 0; break; }
      score += evidence.points;
      incidental ||= evidence.incidental;
      reasons.push(evidence.reason);
    }
    const exactName = normalize(component.className) === exact;
    if (exactName) { score += 100; reasons.unshift(`Nom exact : ${query.trim()}`); }
    else if (component.selectors.some((s) => normalize(s) === exact)) { score += 100; reasons.unshift(`Sélecteur exact : ${query.trim()}`); }
    if (!score) continue;
    const nameCovers = exactName || words.every((word) => matchesConcept(fields[0].tokens, word));
    results.push({ component, score, reasons, nameCovers, incidental });
  }
  // When a name covers the whole request, drop candidates relying on template text:
  // a parent page mentioning "product card" is not a product card. Candidates found
  // through a description or an input stay, ranked after the name matches.
  const hasNameMatch = results.some((r) => r.nameCovers);
  return results
    .filter((r) => !hasNameMatch || r.nameCovers || !r.incidental)
    .sort(rank)
    .slice(0, Math.max(0, limit))
    .map(({ component, score, reasons }) => ({ component, score, reasons }));
}
