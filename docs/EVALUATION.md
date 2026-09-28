# Évaluer Inventory sur une tâche réelle

La réussite attendue est de permettre à un développeur ou à un agent de trouver et de réutiliser un composant adapté avant d'en créer un nouveau. Un nombre élevé de résultats ou une compilation réussie ne suffit pas à démontrer ce bénéfice.

## Décrire le besoin avant la recherche

Pour chaque cas, conserver la tâche, la requête, les contraintes obligatoires, les composants acceptables et les sources qui justifient cette appréciation. Distinguer une exploration (« vidéo ») d'une demande précise (« intégrer un lecteur vidéo avec commandes »). Si l'intention est ambiguë, ne pas présenter une interprétation particulière comme une erreur objective de l'outil.

Les attentes sont fixées avant d'observer les résultats. Garder séparément les cas utilisés pour améliorer le moteur et un jeu de tâches inédites pour le valider.

## Qualifier les candidats

- **Réponse directe** : le composant répond aux contraintes du besoin. Vérifier encore son contrat et son intégration dans le contexte cible.
- **Piste utile à adapter** : préciser la partie réutilisable et l'adaptation nécessaire. Une simple ressemblance de nom ne suffit pas.
- **Hors sujet** : le candidat n'aide pas à accomplir la tâche décrite.
- **À clarifier** : l'intention ou les preuves disponibles ne permettent pas encore de trancher. Ce statut concerne l'évaluation, pas un classement du moteur.

Ces catégories sont des annotations d'évaluation, pas des sorties automatiques d'Inventory. Un évaluateur connaissant le projet devrait relire les cas ambigus ; idéalement, il n'a pas réglé le moteur sur ces cas.

## Mesurer séparément

| Mesure | Calcul ou observation |
|---|---|
| Réponse directe parmi les trois premiers résultats | Part des tâches dont une réponse directe figure dans les trois premiers candidats. |
| Piste exploitable parmi les trois premiers résultats | Part des tâches où apparaît une réponse directe ou une piste utile, présentée séparément du premier indicateur. |
| Propositions hors sujet | Nombre et part des candidats jugés hors sujet parmi les résultats examinés. |
| Absence correctement reconnue | Sur les tâches annotées sans candidat exploitable dans le périmètre, nombre de recherches sans proposition trompeuse. Un résultat vide sur une tâche réalisable reste un échec de couverture. |
| Intégration validée | Import et bindings compilent dans un contexte réel ; noter séparément les validations de rendu et de fonctionnement. |
| Temps jusqu'à une réutilisation fonctionnelle | Temps de recherche, lecture, adaptation et validation, mesuré pendant la tâche. |

Toujours donner les dénominateurs. Conserver les cas à clarifier à part et publier leur nombre. Une piste utile ne doit pas être comptée comme une réponse directe, ni une compilation comme une réussite fonctionnelle.

## Lecture des premiers benchmarks

Les premiers essais utilisent 66 cas locaux, dont 49 besoins annotés avec un composant attendu et 17 besoins considérés absents. Ils emploient une notation binaire stricte par rapport à ces attentes. Certains mots courts recouvrent pourtant plusieurs intentions possibles.

Les résultats historiques restent valables selon cette convention, mais ne constituent pas un verdict universel sur l'utilité d'une icône, d'un autre timer ou d'une table des matières. Le retour utilisateur motive une nouvelle grille qualitative ; il ne modifie pas rétroactivement les chiffres. Toute réannotation doit être versionnée, justifiée et publiée séparément.

Ces cas ont guidé le développement : leurs gains mesurent une progression sur un jeu de régression. Ils ne démontrent ni une généralisation à tous les projets Angular, ni un gain de temps humain, ni une supériorité face à Compodoc.

## Comparaison future avec Compodoc

Utiliser les mêmes instantanés de projets, fixer les versions et configurations des outils, puis réaliser les mêmes tâches avec les parcours réellement proposés par chacun. Pour les mesures de temps, distinguer la préparation de la documentation de la recherche et de la réutilisation ; alterner l'ordre des outils pour limiter l'effet d'apprentissage.

Évaluer les résultats avec les critères ci-dessus et noter les échecs d'installation, d'analyse et d'intégration. Une comparaison à un filtre littéral sur les noms ne remplace pas cet essai avec Compodoc. Aucun résultat de ce type n'est encore revendiqué.
