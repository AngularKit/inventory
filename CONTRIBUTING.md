# Contribuer à Inventory

La documentation utilisateur est disponible en [français](README.md) et en [anglais](README.en.md). Mets à jour les deux guides quand une fonctionnalité ou une commande change.

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
