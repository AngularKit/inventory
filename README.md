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

Tout est automatique via [release-please](https://github.com/googleapis/release-please) et les
[Conventional Commits](https://www.conventionalcommits.org/fr/) :

1. Les commits sur `main` suivent la convention : `feat: …` (version mineure), `fix: …` (patch),
   `feat!: …` ou footer `BREAKING CHANGE:` (majeure). Les `chore:`, `docs:`, `refactor:` n'ouvrent pas de release.
2. release-please ouvre et maintient une PR « chore(main): release X.Y.Z » qui met à jour
   `package.json` et `CHANGELOG.md`.
3. Merger cette PR crée le tag `vX.Y.Z`, la GitHub Release, puis publie sur npm avec provenance
   (`.github/workflows/release.yml`).

Pour forcer un numéro précis, ajouter un footer `Release-As: 1.2.3` à un commit.

Mise en place, une seule fois :

- **GitHub, au choix** :
  - **Token dédié (recommandé)** : créer un PAT *fine-grained* limité à ce repo avec *Contents* et
    *Pull requests* en lecture/écriture, et le poser en secret `RELEASE_PLEASE_TOKEN`. Avantage : la PR de
    release déclenche la CI, ce qu'une PR ouverte avec `GITHUB_TOKEN` ne fait jamais.
  - **Sans token** : activer *Allow GitHub Actions to create and approve pull requests* dans
    Settings → Actions → General, d'abord au niveau de l'organisation (sinon la case est grisée dans le repo),
    puis dans le repo.
- **npm, au choix** :
  - Secret `NPM_TOKEN` (automation token, bypass 2FA) dans le repo. Indispensable pour la toute première publication.
  - Ensuite, **Trusted Publishing (recommandé, sans token)** : sur npmjs.com → package → *Settings* →
    *Trusted Publisher* : repo `AngularKit/inventory`, workflow `release.yml`, environnement `npm`.
    Le secret peut alors être supprimé.
