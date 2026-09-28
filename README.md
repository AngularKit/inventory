# @angularkit/inventory

Avant de créer un composant Angular, trouve celui que ton projet possède déjà et vois comment le réutiliser.

```bash
npx @angularkit/inventory .                      # rapport sur stdout
npx @angularkit/inventory . --md COMPONENTS.md   # catalogue à committer / donner à l'agent
npx @angularkit/inventory . --json components.json
npx @angularkit/inventory . --search "card" --limit 3 # candidats avec explications
```

## Ce que ça sort

- **Réutilisation** : imports vérifiés à partir des exports et des alias TypeScript du projet, entrées requises déclarées (types et noms de binding), extraits d’usages existants avec fichier et ligne. Les imports relatifs partent de la racine analysée : adapte-les au fichier appelant.
- **Recherche** : nom, sélecteur, synonymes ou chemin ; chaque terme doit correspondre. Les candidats sont classés avec une explication, sans appel à un modèle ni réseau.
- **Catalogue** : chaque `@Component`, son sélecteur, ses inputs/outputs (décorateurs et API signal), s'il est exporté par un `index.ts`/`public-api.ts`, combien de fois et où il est utilisé.
- **Concepts en doublon** : `ProfileCardComponent`, `StatTile`, `OrderPanel` et `UiCard` sont regroupés sous *card* (synonymes : card/tile/panel/box, modal/dialog/popup, …).
- **Quasi-composants** : mêmes signatures de classes CSS (≥ 4 classes) copiées-collées dans plusieurs templates — le composant qui n'a jamais été extrait.
- **Usages** : références dans les templates et dans les formes courantes de routes Angular. « Sans usage confirmé » ne signifie pas « code mort ».

## Comment ça marche

Analyse statique via l'API du compilateur TypeScript (pas besoin de compiler le projet, pas besoin d'Angular installé). Zéro réseau, zéro télémétrie : rien ne sort du poste.

Dans un dépôt Git, analyse le contenu local actuel des fichiers suivis et des fichiers non ignorés, y compris les nouveaux fichiers non commités. Respecte les règles Git imbriquées ; un fichier déjà suivi reste analysé même s’il correspond à une règle d’exclusion Git.

Ignore notamment `node_modules`, `dist`, `.nx`, `.angular`, `coverage`, `.stryker-tmp`, `__tests__`, `__mocks__`, `*.spec.ts`, `*.test.ts`, `*.stories.ts`, `*.d.ts`, `test-setup.ts` et `setup-tests.ts`. Ne suit pas les liens symboliques.

Hors dépôt Git ou sans Git disponible, applique les exclusions intégrées et signale que les règles `.gitignore` ne sont pas appliquées.

## Retrouver et réutiliser

```bash
npx @angularkit/inventory . --search "carte" --limit 3
npx @angularkit/inventory . --search "profile card" --json candidates.json --md candidates.md
```

Chaque résultat indique pourquoi il correspond, comment l’importer si un export est confirmé, les entrées requises déclarées et jusqu’à trois exemples de balises existantes. Un nom ou sélecteur exact passe avant une correspondance partielle, un synonyme ou un chemin.

Sans `--search`, les fichiers contiennent l’inventaire complet. Avec `--search`, le JSON contient `query` et `results` ; chaque résultat comporte `component`, `score` et `reasons`. Le score est un classement lexical, pas une probabilité de pertinence.

Les fiches ajoutent `inputDetails`, `imports`, `examples`, `routeReferences` et `usageStatus`. `stats.unused` reste disponible pour compatibilité et compte uniquement l’absence d’usage dans les templates ; utilise `stats.unconfirmed` pour les composants sans référence détectée dans les templates **ni** les routes.

## Limites connues

- Les usages sont comptés par regex sur les templates : `<app-card` et `[appHighlight]`. Les sélecteurs de classe ou complexes sont ignorés.
- Les groupes par concept sont lexicaux (nom + synonymes), pas sémantiques. Ils peuvent rapprocher des composants distincts. Les répétitions CSS sont des pistes à examiner, pas des recommandations automatiques d’extraction.
- Les imports sont résolus dans les sources analysées et avec la configuration TypeScript à la racine. Les exports nommés, alias et réexports de valeurs sont suivis ; les exports de types sont exclus. Les imports relatifs doivent être adaptés au contexte d’utilisation et les contraintes de dépendances Nx restent à vérifier.
- Les entrées requises prises en charge sont celles déclarées directement avec `@Input`, `input.required` ou `model.required`. Les entrées héritées, les alias des fonctions Angular importées et les métadonnées dynamiques ne sont pas résolus.
- Les routes prises en charge sont les objets avec `path` ou `matcher`, une propriété `component` référant à une classe locale/importée, ou `loadComponent: () => import(...).then(m => m.Classe)` (et un import direct pour un export par défaut). Les autres formes et créations dynamiques restent non confirmées.
- Un extrait de balise montre le code existant ; ce n’est pas un exemple autonome avec toutes ses variables et dépendances.
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
  - Secret `NPM_TOKEN` (token granulaire autorisé à publier sur le scope, bypass 2FA) dans le repo. Indispensable pour la toute première publication.
  - Ensuite, **Trusted Publishing (recommandé, sans token)** : sur npmjs.com → package → *Settings* →
    *Trusted Publisher* : repo `AngularKit/inventory`, workflow `release.yml`, environnement `npm`.
    Le secret peut alors être supprimé.
