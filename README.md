# @angularkit/inventory

Répond à la question « est-ce que ce composant existe déjà dans ma codebase ? » sans grep ni Slack.

```bash
npx @angularkit/inventory .                      # rapport sur stdout
npx @angularkit/inventory . --md COMPONENTS.md   # catalogue à committer / donner à l'agent
npx @angularkit/inventory . --json components.json
```

## Ce que ça sort

- **Catalogue** : chaque `@Component`, son sélecteur, ses inputs/outputs (décorateurs et API signal), s'il est exporté par un `index.ts`/`public-api.ts`, combien de fois et où il est utilisé.
- **Concepts en doublon** : `ProfileCardComponent`, `StatTile`, `OrderPanel` et `UiCard` sont regroupés sous *card* (synonymes : card/tile/panel/box, modal/dialog/popup, …).
- **Quasi-composants** : mêmes signatures de classes CSS (≥ 4 classes) copiées-collées dans plusieurs templates — le composant qui n'a jamais été extrait.
- **Jamais utilisés** : composants qu'aucun template ne référence (pages routées, ou code mort).

## Comment ça marche

Analyse statique via l'API du compilateur TypeScript (pas besoin de compiler le projet, pas besoin d'Angular installé). Zéro réseau, zéro télémétrie : rien ne sort du poste.

Ignore `node_modules`, `dist`, `.nx`, `.angular`, `coverage`, `*.spec.ts`, `*.stories.ts`.

## Limites connues (v0.1)

- Les usages sont comptés par regex sur les templates : `<app-card` et `[appHighlight]`. Les sélecteurs de classe ou complexes sont ignorés.
- Le clustering est lexical (nom + synonymes), pas sémantique. Il produit des faux positifs assumés : mieux vaut trop signaler que rater un doublon.
- Un composant `templateUrl` pointant hors du projet n'est pas résolu.
- Outil fourni « as is ».

## Utilisation avec un agent

Génère `COMPONENTS.md` et référence-le depuis ton `CLAUDE.md` / `AGENTS.md` :

> Avant de créer un composant UI, lis `COMPONENTS.md` et réutilise l'existant.

## Développement

```bash
npm ci
npm test            # tests node:test sur le fixture
npm run dev -- fixture
npm run build
```

## Publier une version

La release est pilotée par un tag `vX.Y.Z` :

```bash
npm version patch   # ou minor / major : met à jour package.json et crée le tag
git push --follow-tags
```

Le workflow `.github/workflows/release.yml` vérifie que le tag correspond à `package.json`, lance les tests,
publie sur npm avec provenance, puis crée la GitHub Release avec les notes générées automatiquement.

Authentification npm, au choix :

- **Trusted Publishing (recommandé, sans token)** : sur npmjs.com → package → *Settings* → *Trusted Publisher*,
  déclarer le repo `AngularKit/inventory` et le workflow `release.yml`.
- **Token** : secret `NPM_TOKEN` (automation token) dans les réglages du repo.
