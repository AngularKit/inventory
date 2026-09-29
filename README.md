# @angularkit/inventory

**Français** | [English](https://github.com/AngularKit/inventory/blob/main/README.en.md)

Avant de créer un composant Angular, trouve celui que ton projet possède déjà et vois comment le réutiliser.

Inventory analyse tes sources et propose des composants avec leur import, leurs entrées requises et des exemples déjà présents dans le projet. Tu peux lire le résultat dans le terminal ou le partager avec un agent de développement.

## Démarrer

Avec Node.js 18 ou plus récent, ouvre un terminal à la racine de ton projet Angular, puis lance :

```bash
npx @angularkit/inventory . --md COMPONENTS.md
```

Ouvre `COMPONENTS.md` : le catalogue contient une ligne par composant, avec son sélecteur, ses entrées/sorties, ses usages détectés et son import lorsqu’il est résolu. Aucun fichier source n’est modifié ; le fichier de sortie choisi est créé ou remplacé.

Tu peux remplacer `.` par le chemin d’un autre projet. Le rapport est enregistré dans le dossier depuis lequel tu lances la commande.

## Trouver un composant à réutiliser

Décris le besoin avec quelques mots :

```bash
npx @angularkit/inventory . --search "carte" --limit 3
npx @angularkit/inventory . --search "profile card" --limit 3
```

Chaque candidat explique pourquoi il correspond et fournit les informations disponibles pour le réutiliser : import, entrées requises, intégration standalone ou NgModule, et extraits d’usages avec fichier et ligne.

1. Vérifie que le composant répond au besoin en consultant ses usages existants.
2. Reprends l’import proposé. S’il est relatif, adapte son chemin au fichier où tu l’utilises : il part de la racine analysée.
3. Renseigne les entrées requises et vérifie les dépendances Angular. Un extrait existant peut utiliser des variables propres à son contexte.

La recherche reconnaît certains termes d’interface en français et en anglais : `carte` / `card`, `bouton` / `button`, `formulaire` / `form`. Elle utilise aussi les noms, descriptions, entrées/sorties et textes des templates. Ce n’est pas une traduction générale : les termes métier dépendent du vocabulaire présent dans tes sources.

Si aucun résultat ne convient, essaie le nom ou le sélecteur du composant, reformule, ou consulte le catalogue complet. Une recherche vide ne prouve pas que le composant n’existe pas.

## Enregistrer et partager les résultats

```bash
# Catalogue complet avec une fiche de réutilisation par composant
npx @angularkit/inventory . --md COMPONENTS.md --details

# Inventaire exploitable par un script
npx @angularkit/inventory . --json components.json

# Résultats d’une recherche en Markdown et en JSON
npx @angularkit/inventory . --search "card" --md candidates.md --json candidates.json
```

Sans option de sortie, le rapport s’affiche dans le terminal. Ajoute `--quiet` pour masquer ce rapport tout en enregistrant les fichiers. `--help` affiche les options disponibles. Les titres des rapports et l’aide du terminal sont actuellement en français.

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
