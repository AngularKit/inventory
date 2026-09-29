# @angularkit/inventory

Avant de créer un composant Angular, trouve celui que ton projet possède déjà et vois comment le réutiliser.

Pars d'un besoin, examine quelques composants candidats, puis vérifie leur import, leurs entrées et leurs usages existants. Un résultat peut être une réponse directe ou une piste à adapter : la recherche aide à décider, elle ne garantit pas l'adéquation fonctionnelle.

```bash
npx @angularkit/inventory .                      # rapport sur stdout
npx @angularkit/inventory . --md COMPONENTS.md   # catalogue à committer / donner à l'agent
npx @angularkit/inventory . --json components.json
npx @angularkit/inventory . --search "card" --limit 3 # candidats avec explications
```

## À côté de Compodoc

[Compodoc](https://github.com/compodoc/compodoc#features) documente largement un projet Angular : composants, services, directives, interfaces, routes, graphes et couverture documentaire. Sa documentation officielle décrit aussi une recherche, des exports JSON et du Markdown destiné aux LLM. Le fonctionnement local, la recherche et les formats pour agents sont donc des points communs.

Inventory se spécialise dans la décision de réutilisation pendant une tâche de développement. Sa valeur tient aux informations réunies autour de chaque candidat :

- **Le retrouver à partir du besoin** : une commande renvoie une sélection limitée, avec la raison lexicale de chaque correspondance.
- **Préparer son intégration** : import résolu à partir des exports et alias du projet, entrées obligatoires déclarées, statut standalone et déclarations/exports directs de NgModules.
- **Voir comment le projet l'utilise** : extraits de balises retrouvés dans les sources, avec fichier et ligne, et références de routes détectées.
- **Repérer l'existant avant d'ajouter du code** : catalogue du contenu local, rapprochements de composants et motifs CSS répétés à examiner.

| Besoin | Usage proposé |
|---|---|
| Publier une documentation navigable du projet et de son architecture | Compodoc correspond à cet objectif. |
| Chercher quelques candidats et leurs informations de réutilisation depuis le terminal | Inventory propose ce parcours ciblé. |
| Documenter le projet et aider un développeur ou un agent à réutiliser ses composants | Les deux outils peuvent être utilisés ensemble. |

Cette spécialisation est notre positionnement, pas une preuve d'exclusivité de chaque fonctionnalité. Nous n'avons pas réalisé de comparaison expérimentale de pertinence, de rapidité ou de temps gagné face à Compodoc. Les essais d'Inventory comparent ses propres versions et un filtre littéral de référence.

Sources consultées le 28 septembre 2026 : [fonctionnalités annoncées dans le dépôt officiel de Compodoc](https://github.com/compodoc/compodoc#features), [guide officiel](https://compodoc.app/guides/features.html). Les versions comparées devront être fixées pour un futur essai face à face.

## Ce que ça sort

- **Réutilisation** : imports vérifiés à partir des exports et des alias TypeScript du projet, entrées requises déclarées (types et noms de binding), extraits d’usages existants avec fichier et ligne. Les imports relatifs partent de la racine analysée : adapte-les au fichier appelant.
- **Recherche en français et en anglais** : `carte` / `card`, `bouton` / `button`, `formulaire` / `form`. Recherche dans les noms, sélecteurs, entrées/sorties, descriptions JSDoc et textes littéraux des templates (dont labels accessibles). Normalise les accents et quelques équivalences françaises/anglaises ; chaque terme significatif doit correspondre. Ce vocabulaire limité ne traduit pas toutes les demandes : les résultats dépendent aussi des mots présents dans le projet. Les raisons indiquent la source de chaque correspondance. Les chemins se recherchent explicitement avec `/`. Aucun modèle ni réseau.
- **Intégration** : statut standalone explicite ou déduit de la version Angular, NgModules déclarant/exportant directement le composant. Le statut reste inconnu si les métadonnées ne permettent pas de conclure.
- **Catalogue** : chaque `@Component`, son sélecteur, ses inputs/outputs (décorateurs et API signal), s'il est exporté par un `index.ts`/`public-api.ts`, combien de fois et où il est utilisé.
- **Concepts en doublon** : `ProfileCardComponent`, `StatTile`, `OrderPanel` et `UiCard` sont regroupés sous *card* (synonymes : card/tile/panel/box, modal/dialog/popup, …).
- **Quasi-composants** : mêmes signatures de classes CSS (≥ 4 classes) copiées-collées dans plusieurs templates — le composant qui n'a jamais été extrait.
- **Usages** : références dans les templates et dans les formes courantes de routes Angular. « Sans usage confirmé » ne signifie pas « code mort ».

## Comment ça marche

Analyse statique via l'API du compilateur TypeScript (pas besoin de compiler le projet, pas besoin d'Angular installé). Zéro réseau, zéro télémétrie : rien ne sort du poste.

Dans un dépôt Git, analyse le contenu local actuel des fichiers suivis et des fichiers non ignorés, y compris les nouveaux fichiers non commités. Respecte les règles Git imbriquées ; un fichier déjà suivi reste analysé même s’il correspond à une règle d’exclusion Git.

Ignore notamment `node_modules`, `dist`, `.nx`, `.angular`, `coverage`, `.stryker-tmp`, `__tests__`, `__mocks__`, `test-utils`, `test-helpers`, `*.spec.ts`, `*.test.ts`, `*.stories.ts`, `*.d.ts`, `test-setup.ts` et `setup-tests.ts`. Ne suit pas les liens symboliques.

Hors dépôt Git ou sans Git disponible, applique les exclusions intégrées et signale que les règles `.gitignore` ne sont pas appliquées.

## Retrouver et réutiliser

```bash
npx @angularkit/inventory . --search "carte" --limit 3
npx @angularkit/inventory . --search "profile card" --json candidates.json --md candidates.md
```

Chaque résultat indique pourquoi il correspond, comment l’importer si un export est confirmé, les entrées requises déclarées et jusqu’à trois exemples de balises existantes. Un nom ou sélecteur exact est favorisé. Lorsqu’un nom ou sélecteur couvre tous les termes, les candidats reposant sur des mentions secondaires sont écartés. Les noms pèsent davantage que les entrées/sorties, les descriptions et les textes. Les synonymes de recherche sont plus stricts que les groupes de concepts : une liste n’est pas un tableau, une icône n’est pas un avatar. Cette recherche reste lexicale, elle ne prouve pas que le composant remplit toutes les fonctions demandées.

### Interpréter une proposition

Évalue le résultat par rapport à la tâche et à ses contraintes :

| Appréciation | Sens |
|---|---|
| Réponse directe | Le composant répond au besoin ; son contrat et son intégration restent à vérifier dans le contexte appelant. |
| Piste utile à adapter | Le composant apporte une partie de la solution ou un exemple pertinent, avec une adaptation identifiable. |
| Hors sujet | Le rapprochement lexical n'aide pas à accomplir la tâche demandée. |

Ces appréciations sont une grille de lecture humaine. Le moteur ne les attribue pas automatiquement et elles ne sont pas des champs du JSON actuel.

Une requête courte comme « vidéo » ou « table » est exploratoire. Une icône vidéo ou une table des matières peut être utile selon l'intention. Pour demander un lecteur avec commandes ou un tableau triable, précise ces contraintes lors de l'évaluation : ces mêmes résultats ne constituent alors pas une réponse directe. Une requête plus précise peut aussi ne produire aucun résultat, car le moteur ne comprend pas toutes les formulations métier.

Un résultat vide indique l'absence de correspondance détectée, pas la preuve qu'aucun composant adapté n'existe. Consulte aussi le catalogue ou reformule avec un terme présent dans le projet.

Sans `--search`, les fichiers contiennent l’inventaire complet. Avec `--search`, le JSON contient `query` et `results` ; chaque résultat comporte `component`, `score` et `reasons`. Le score est un classement lexical, pas une probabilité de pertinence.

Les fiches ajoutent `description`, `templateText`, `standalone` (`true`, `false` ou `null`), `ngModules`, `inputDetails`, `imports`, `examples`, `routeReferences` et `usageStatus`. `stats.unused` reste disponible pour compatibilité et compte uniquement l’absence d’usage dans les templates ; utilise `stats.unconfirmed` pour les composants sans référence détectée dans les templates **ni** les routes.

## Limites connues

- Les usages sont comptés sur les balises des templates : éléments, attributs, et combinaisons comme `button[kb-button]` ou `[first][second]`. Les commentaires et le contenu des scripts/styles sont ignorés ; une balise n’est comptée qu’une fois par composant. Les sélecteurs de classe, valeurs d’attributs et pseudo-classes ne sont pas pris en charge. Ce lecteur statique ne remplace pas le parseur Angular.
- Les groupes par concept sont lexicaux (nom + synonymes), pas sémantiques. Ils peuvent rapprocher des composants distincts. Les répétitions CSS sont des pistes à examiner, pas des recommandations automatiques d’extraction.
- Les imports sont résolus dans les sources analysées et avec la configuration TypeScript à la racine. Les exports nommés, alias et réexports de valeurs sont suivis ; les exports de types sont exclus. Les imports relatifs doivent être adaptés au contexte d’utilisation et les contraintes de dépendances Nx restent à vérifier.
- Les entrées requises prises en charge sont celles déclarées directement avec `@Input`, `input.required` ou `model.required`. Les entrées héritées, les alias des fonctions Angular importées et les métadonnées dynamiques ne sont pas résolus.
- Les routes prises en charge sont les objets avec `path` ou `matcher`, une propriété `component` référant à une classe locale/importée, ou `loadComponent: () => import(...).then(m => m.Classe)` (et un import direct pour un export par défaut). Les fonctions nommées et alias `const` dans le même fichier sont suivis, avec protection contre les cycles et les paramètres qui masquent un nom. Les fonctions importées, appels arbitraires et bindings mutables ne sont pas résolus. Les autres formes et créations dynamiques restent non confirmées.
- Le défaut standalone est déduit de la version Angular installée ou d’une version majeure explicite dans package.json (standalone par défaut depuis Angular 19). Les tableaux littéraux `declarations`/`exports` des NgModules sont analysés ; les réexports transitifs de modules et les métadonnées calculées ne sont pas suivis. Un import TypeScript valide ne garantit pas une intégration Angular valide.
- Les descriptions et textes enrichissent la recherche, mais les synonymes sont limités. Les expressions Angular, traductions calculées et textes chargés à l’exécution ne sont pas évalués. Une correspondance lexicale n’est pas une garantie fonctionnelle.
- Un extrait de balise montre le code existant ; ce n’est pas un exemple autonome avec toutes ses variables et dépendances.
- Un composant `templateUrl` pointant hors du projet n'est pas résolu.
- Outil fourni « as is ».

## Utilisation avec un agent

Génère `COMPONENTS.md` et référence-le depuis ton `CLAUDE.md` / `AGENTS.md` :

> Avant de créer un composant UI, consulte `COMPONENTS.md`. Examine les candidats, leurs imports, leurs contraintes d'intégration et leurs usages existants. Explique si tu peux réutiliser directement un composant, adapter une piste utile ou si aucun candidat ne répond au besoin. Vérifie l'intégration avant de conclure.

## Évaluer l'utilité

Les [critères d'évaluation](docs/EVALUATION.md) distinguent une réponse directe, une piste utile et un résultat hors sujet. Ils séparent aussi la pertinence de recherche, la validité de l'intégration et le temps réellement gagné pendant une tâche.

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
