# @angularkit/inventory

**Français** | [English](https://github.com/AngularKit/inventory/blob/main/README.en.md)

Retrouve les composants Angular existants, avec les informations nécessaires pour les réutiliser.

Inventory analyse tes sources et propose des composants avec leur import, leurs entrées requises et des exemples déjà présents dans le projet. Tu peux lire le résultat dans le terminal ou le partager avec un agent de développement.

## Démarrer

Avec Node.js 18 ou plus récent, ouvre un terminal à la racine de ton projet Angular, puis lance :

```bash
npx @angularkit/inventory . --search "carte" --limit 3
```

Chaque résultat regroupe le composant, son import, ses entrées requises, une référence d’usage et la raison de la correspondance. Ajoute `--details` pour lire les extraits d’usage et les informations d’intégration complètes. `--help` (ou `-h`) présente les options et des exemples.

Extrait réel du projet de démonstration de ce dépôt, obtenu avec `node dist/cli.js fixture --search "card" --limit 1` après `npm ci && npm run build` :

```text
1. UiCard — ui-card
   Source : libs/ui/src/lib/card/card.ts
   Import : import { UiCard } from "./libs/ui/src/index";
   Chemin relatif à la racine analysée ; à adapter au fichier appelant.
   Intégration : standalone/NgModule à vérifier
   Entrées requises : title
   Usage : apps/web/src/app/dashboard/dashboard-page.html:1
   Pourquoi : Nom ou sélecteur : card
```

Tu peux remplacer `.` par le chemin d’un autre projet. Sans `--search`, la commande affiche un résumé du scan et les actions suivantes. Aucun fichier source n’est modifié.

## Pourquoi l’utiliser en complément de l’éditeur ?

Si tu connais le nom du composant, la recherche de ton éditeur peut suffire. Inventory rassemble en une seule sortie les informations pour passer à la réutilisation : l’import résolu, les entrées requises déclarées et des usages existants avec fichier et ligne. Tu peux aussi fournir ce contexte à un agent de développement.

La recherche reste lexicale, avec quelques synonymes d’interface : elle ne comprend pas automatiquement tous les besoins métier et ne garantit pas qu’un candidat convient. Les usages existants permettent de le vérifier.

## Trouver un composant à réutiliser

Décris le besoin avec quelques mots :

```bash
npx @angularkit/inventory . --search "carte" --limit 3
npx @angularkit/inventory . --search "profile card" --limit 3
```

Chaque candidat affiche les informations essentielles. Pour consulter les fiches complètes avec les extraits d’usages et les NgModules détectés :

```bash
npx @angularkit/inventory . --search "profile card" --limit 3 --details
```

1. Vérifie que le composant répond au besoin en consultant ses usages existants.
2. Reprends l’import proposé. S’il est relatif, adapte son chemin au fichier où tu l’utilises : il part de la racine analysée.
3. Renseigne les entrées requises et vérifie les dépendances Angular. Un extrait existant peut utiliser des variables propres à son contexte.

La recherche reconnaît certains termes d’interface en français et en anglais : `carte` / `card`, `bouton` / `button`, `formulaire` / `form`. Elle utilise aussi les noms, descriptions, entrées/sorties et textes des templates. Ce n’est pas une traduction générale : les termes métier dépendent du vocabulaire présent dans tes sources.

Si aucun résultat ne convient, essaie le nom ou le sélecteur du composant, reformule, ou consulte le catalogue complet. Une recherche vide ne prouve pas que le composant n’existe pas.

## Enregistrer et partager les résultats

```bash
# Catalogue complet, une ligne par composant
npx @angularkit/inventory . --md COMPONENTS.md

# Catalogue complet avec une fiche de réutilisation par composant
npx @angularkit/inventory . --md COMPONENTS.md --details

# Inventaire exploitable par un script
npx @angularkit/inventory . --json components.json

# Résultats d’une recherche en Markdown et en JSON
npx @angularkit/inventory . --search "card" --md candidates.md --json candidates.json
```

Le terminal affiche un résumé ou des candidats compacts, même quand tu exportes un fichier. `--details` affiche le rapport complet dans le terminal et ajoute les fiches de réutilisation au catalogue Markdown. Un export Markdown de recherche contient toujours les fiches complètes ; le JSON conserve toutes les données.

Ouvre `COMPONENTS.md` pour consulter le catalogue. Les fichiers de sortie sont créés ou remplacés, relativement au dossier depuis lequel tu lances la commande. Ajoute `--quiet` pour masquer stdout tout en enregistrant les fichiers ; les avertissements et confirmations d’écriture restent sur stderr. Les titres des rapports et l’aide du terminal sont actuellement en français.

Si tu redirigeais auparavant stdout vers un fichier Markdown, utilise désormais `--md fichier.md --quiet`. Une redirection conserve le nouvel affichage compact ; `--details` permet d’obtenir le rapport détaillé sur stdout.

Pour un agent, génère le catalogue compact sans `--details`, puis ajoute cette consigne dans ton `AGENTS.md` ou `CLAUDE.md` :

> Avant de créer un composant UI, consulte `COMPONENTS.md` ou lance `npx @angularkit/inventory . --search "<besoin>"`. Examine les candidats, leurs imports, leurs entrées requises et leurs usages existants, puis indique si tu réutilises, adaptes, ou si rien ne convient.

## Comprendre les résultats

- **Usages détectés** : références dans les templates et certaines routes Angular. « Sans usage confirmé » ne signifie pas « code mort » ; les usages dynamiques peuvent échapper à l’analyse.
- **Imports et entrées** : informations résolues depuis les sources et la configuration TypeScript. Certaines métadonnées calculées et les entrées héritées ne sont pas résolues. Vérifie l’intégration dans ton application.
- **Groupes de composants et répétitions CSS** : pistes à examiner pour repérer des ressemblances. Ils ne prouvent pas que deux composants sont interchangeables ou doivent être fusionnés.

Dans un dépôt Git, le scan lit les fichiers suivis et les nouveaux fichiers non ignorés, avec tes modifications locales. Il exclut notamment les dépendances, les sorties de compilation, les tests, les stories et les copies temporaires de Stryker. Un fichier déjà suivi reste inclus même s’il correspond à une règle `.gitignore`.

Hors dépôt Git ou sans Git disponible, les exclusions intégrées restent actives, mais les règles `.gitignore` ne sont pas appliquées ; un avertissement le signale. Une autre erreur Git arrête le scan.

L’analyse est locale, sans télémétrie ni envoi de tes sources, et ne nécessite pas de compiler ton projet. `npx` peut télécharger l’outil lors de son lancement.

## Avec Compodoc

[Compodoc](https://github.com/compodoc/compodoc#features) fournit une documentation navigable du projet Angular : composants, services, routes et graphes. Inventory se concentre sur une décision pendant le développement : « quel composant puis-je réutiliser, et comment ? », avec une recherche expliquée et des informations directement lisibles dans le terminal ou par un agent. Les deux peuvent se compléter.

## Aller plus loin

- [Signaler un problème](https://github.com/AngularKit/inventory/issues)
- [Référence technique (français)](https://github.com/AngularKit/inventory/blob/main/docs/REFERENCE.md)
- [Méthode d’évaluation (français)](https://github.com/AngularKit/inventory/blob/main/docs/EVALUATION.md)
- [Contribuer (français)](https://github.com/AngularKit/inventory/blob/main/CONTRIBUTING.md)
