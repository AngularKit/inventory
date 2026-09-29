# Référence technique

Pour démarrer, consulte le guide utilisateur en [français](../README.md) ou en [anglais](../README.en.md). Cette référence décrit les règles de l’analyse statique et les données exportées.

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

Une erreur Git dans un dépôt existant (configuration invalide, accès refusé, etc.) arrête l'analyse. Elle ne déclenche pas un scan qui contournerait les exclusions Git.

## Retrouver et réutiliser

```bash
npx @angularkit/inventory . --search "carte" --limit 3
npx @angularkit/inventory . --search "profile card" --json candidates.json --md candidates.md
```

Chaque résultat indique pourquoi il correspond, comment l’importer si un export est confirmé, les entrées requises déclarées et jusqu’à trois exemples de balises existantes. Un nom ou sélecteur exact est favorisé, et les composants dont le nom couvre tous les termes passent en premier. Dans ce cas, les candidats trouvés seulement grâce au texte d'un template (une page qui *mentionne* « product card ») sont écartés ; ceux trouvés via leur description ou leurs entrées restent proposés. Les synonymes se limitent au vocabulaire UI générique (card/tile/carte, dialog/modal, table/tableau…) : une liste n’est pas un tableau, une icône n’est pas un avatar. La recherche reste lexicale.

Un résultat vide signifie qu'aucune correspondance n'a été détectée, pas qu'aucun composant adapté n'existe : reformule avec un terme présent dans le projet ou consulte le catalogue.

Le vocabulaire bilingue couvre aussi des concepts d'interface comme `consentement` / `consent`, `déconnexion` / `logout` et `historique` / `history`. Les termes métier sont recherchés dans les noms, descriptions et textes du projet ; ils ne sont pas traduits automatiquement par un dictionnaire propre aux projets de test.

Sans `--search`, le JSON contient l'inventaire complet. Avec `--search`, il contient `query` et `results` (`component`, `score`, `reasons`) ; le score est un classement lexical, pas une probabilité.

Chaque composant expose `description`, `templateText`, `standalone` (`true`, `false` ou `null`), `ngModules`, `inputDetails`, `imports`, `examples`, `routeReferences` et `usageStatus`. `stats.unused` garde son sens historique (aucun usage dans les templates) ; `stats.unconfirmed` compte les composants sans référence ni dans les templates ni dans les routes.

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

