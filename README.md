# SwimCoach App

Application web (PWA) pour les entraîneurs du TOAC Natation : calendrier des séances,
nageurs, présences, statistiques, planning et performances (import liveffn). Les données
sont rangées par **espace d'équipe** : chaque entraîneur ne voit que les espaces dont il
est membre. Données et comptes : Supabase. Interface : JavaScript sans framework, Vite.

Conception : `docs/superpowers/specs/2026-11-19-swimcoach-multi-coach-design.md`.

## Démarrage

```
npm ci
npm run dev        # http://localhost:5173
```

Tests et contrôles :

```
npm run guards     # garde-fous du dépôt (projets interdits, secrets, localStorage brut...)
npm test           # tests unitaires (Vitest, fuseau Europe/Paris)
npm run build      # dossier dist/
node scripts/check-guards.mjs dist
npx playwright test   # tests de bout en bout (voir ci-dessous)
```

Les tests de bout en bout (`tests/e2e/`) construisent l'application, la servent avec
`vite preview` (port 4173) et remplacent Supabase par un faux serveur
(`tests/e2e/fake-supabase.js`) : aucun accès réseau. En local ils utilisent Chrome
(`channel: 'chrome'`) ; en CI, Chromium installé par `npx playwright install --with-deps chromium`.

## Déploiement (GitHub Pages)

`.github/workflows/ci.yml` lance, à chaque push et chaque PR : `npm ci`, `npm run guards`,
`npm test`, `npm run build`, `check-guards dist`, Playwright, puis un dernier build contrôlé
par `check-guards dist`, et le job `db-tests` (pgTAP sur une base locale, CLI Supabase 3.2.0).
Le job `deploy` du même fichier publie ce `dist/` contrôlé sur GitHub Pages, **seulement** sur un
push vers `main` et **seulement** si `test` et `db-tests` sont verts (`needs`). Il n'y a plus de
workflow de déploiement séparé.

Avant la première mise en ligne (à faire une fois, par Damien) :

1. Dépôt GitHub : Settings, Pages, Source = **GitHub Actions**.
2. Définir le code du club (section suivante).
3. Supabase, Authentication : configurer un **SMTP personnalisé**.
4. Supabase, Authentication, URL Configuration : mettre l'adresse GitHub Pages de l'app
   dans **Site URL** et **Redirect URLs**.
5. Contrôler les réglages Auth obligatoires : `docs/security-notes.md`, « Réglages obligatoires
   Supabase Auth » (confirmation d'e-mail, changement d'e-mail sécurisé).
6. Les fonctions Edge (`supabase/functions/`) n'autorisent que les origines listées dans
   `supabase/functions/_shared/cors.js` : y vérifier l'adresse de mise en ligne, puis
   redéployer les fonctions si elle change.

## Définir ou changer le code du club

Le code que les entraîneurs saisissent à l'inscription est stocké **haché** (bcrypt) dans
la base. Il ne figure **jamais dans le dépôt**. Dans l'éditeur SQL du projet Supabase :

```sql
select private.set_invite_code('LE-CODE-CHOISI');
```

Un nouvel appel remplace l'ancien code. La comparaison ignore la casse et les espaces
autour. Chaque compte a 5 essais par heure.

## Fonctions masquées

`src/core/features.js` liste les fonctions gardées dans le code mais masquées à l'écran.
`groups: false` : les groupes de nageurs de club4 (étiquette, « Mail groupe », colonne Groupe de l'import,
groupes par défaut) ne s'affichent pas. L'espace d'équipe, appelé « groupe » à l'écran, fait ce tri.
Le « Mail groupe » devient « Mail à tous ». Les tests e2e les réactivent avec `installFakeSupabase(page, { features: { groups: true } })`.

## Tests de la base (pgTAP)

Fichiers dans `supabase/tests/database/` ; procédure détaillée dans `docs/db-tests.md`.

- **En CI** : `supabase start` (applique les migrations), `supabase test db`.
- **Sur le projet hébergé** (sans Docker) : l'outil `execute_sql` ne renvoie que le dernier
  résultat, donc chaque fichier est envoyé en une seule requête préparée par
  `node scripts/db-test-bundle.mjs supabase/tests/database/<fichier>.test.sql`
  (ajouter `--count` pour le nombre d'assertions). Chaque requête commence par `begin;`
  et finit par `rollback;` : rien ne reste en base. Résultat attendu : `1..N` puis `ok 1`...
  `ok N`, sans `not ok`.
- Assertions : `00_helpers` 3, `invite_code` 27, `teams` 80, `storage` 41, `isolation` 146.

## Critères d'acceptation de la spec (section 10) et tests

| Point | Critère | Tests qui le couvrent |
|---|---|---|
| 10.1 | Isolation entre espaces (tables et fichiers) | `supabase/tests/database/isolation.test.sql` (tables, y compris clés composites et upsert détourné) ; `storage.test.sql` (photos) ; côté application : `tests/e2e/shell.spec.js` (changement d'espace sans données de l'autre) |
| 10.1 bis | Partage : ajout d'un collègue, retrait, invitation rattachée après confirmation, dernier membre | `teams.test.sql` ; `isolation.test.sql` (membre C, membre D des deux espaces) ; `tests/e2e/team-members.spec.js` ; `tests/e2e/auth.spec.js` (c), (c bis) ; `tests/e2e/presence.spec.js` (deux entraîneurs, même appel) |
| 10.2 | Compte non activé : rien de lisible, rien d'écrit | `isolation.test.sql` (E) ; `storage.test.sql` (E) ; `teams.test.sql` (E) ; `tests/unit/edge-functions.test.js` (proxy liveffn : compte non activé refusé) ; `tests/e2e/auth.spec.js` (b) |
| 10.3 | Inscription avec le code, limite d'essais | `invite_code.test.sql` (5 essais par heure, haché) ; `tests/e2e/auth.spec.js` (a), (a bis), (b), (d) |
| 10.4 | Même navigateur : A sort, B entre, aucune trace de A | `tests/e2e/same-device.spec.js` ; `tests/e2e/auth.spec.js` (f) ; `tests/e2e/settings.spec.js` (a) ; `tests/unit/signout-flush.test.js`, `tests/unit/session.test.js` |
| 10.5 | Clés de stockage `swimcoach2_` seulement ; jamais l'ancien projet Supabase | `npm run guards` et `node scripts/check-guards.mjs dist` (aussi en CI) ; `tests/unit/check-guards.test.js` ; `tests/unit/storage.test.js` (préfixe des clés) ; `tests/e2e/auth.spec.js` (f : l'ancienne app reste intacte) |
| 10.6 | Parité : un test par écran et par PDF | Calendrier `calendar.spec.js` ; contacts `contacts.spec.js`, `import.spec.js` ; présences `presence.spec.js` ; stats `stats.spec.js` (+ PDF) ; planning `planning.spec.js` (+ PDF) ; perfs `perfs.spec.js` (+ bilan PDF) ; coque `shell.spec.js` ; logique : `tests/unit/` |
| 10.7 | Suppression du compte : espaces à un seul membre effacés (lignes et fichiers), espaces partagés intacts | `tests/unit/edge-functions.test.js` (delete-account, `soleMemberTeams`, photos d'abord) ; `tests/e2e/settings.spec.js` (d), (d bis) ; `teams.test.sql` (`delete_team` en cascade, TB intacte). **Manuel** pour l'appel réel de la fonction déployée : voir ci-dessous |
| 10.8 | Hors ligne : lecture, puis synchronisation au retour du réseau | `tests/e2e/offline.spec.js` ; `contacts.spec.js` (photo hors ligne) ; `team-members.spec.js` (f) ; `tests/unit/outbox.test.js`, `tests/unit/sync.test.js` |
| 10.9 | `npm run build` produit un dossier déployable ; la CI passe avant la mise en ligne | `.github/workflows/ci.yml` : job `deploy` avec `needs: [test, db-tests]`, sur push vers `main` seulement ; il publie le `dist/` construit et contrôlé par `check-guards dist` dans le job `test` ; `tests/e2e/smoke.spec.js` (le build est servi et se charge). Le premier passage vert de `db-tests` en CI reste à constater sur la PR |
| 10.10 | Contrôles de sécurité Supabase : aucune alerte non justifiée | Outils `get_advisors` (sécurité et performance) ; alertes et justifications dans `docs/security-notes.md`, section « Contrôle final » |

### Contrôles manuels (non automatisables ici)

- **Page liveffn réelle** : l'import de performances s'appuie sur le HTML de
  `www.liveffn.com`. Les tests utilisent des pages enregistrées (`tests/fixtures/`).
  Procédure : se connecter, Performances, saisir le numéro d'une compétition récente du club,
  vérifier que l'aperçu liste les nageurs et les temps, importer, puis relancer l'import
  (aucun doublon).
- **Vrai e-mail de confirmation** : créer un compte avec une vraie adresse ; vérifier que
  l'e-mail arrive (SMTP), que le lien ouvre l'application déployée, puis que l'écran du code du club
  apparaît. Refaire avec « Mot de passe oublié ? » (lien vers « Nouveau mot de passe »).
- **Fonctions Edge déployées** (`delete-account`, `liveffn-proxy`, `invite-email`) : sans jeton, la réponse est 401 ;
  avec le jeton d'un compte de test, `liveffn-proxy` renvoie la page et `delete-account`
  efface un compte de test (et ses espaces à un seul membre). À faire depuis l'application déployée.
- **Hors ligne sur appareil réel, sous l'adresse Pages** (l'adresse de mise en ligne, sous-chemin compris) :
  installation du service worker, mode avion après un premier chargement, rechargement hors ligne,
  puis retour du réseau. Le test e2e hors ligne tourne à la racine `/` seulement.
- **Sous l'adresse Pages** : les liens des e-mails (confirmation du compte) et la redirection
  « Mot de passe oublié ? » ouvrent bien l'application déployée (URL de redirection autorisée
  dans Supabase Auth).
- **Fonctions Edge, CORS** : depuis l'adresse Pages, la requête préalable `OPTIONS` de
  `liveffn-proxy` et de `delete-account` répond avec les en-têtes CORS attendus (onglet Réseau).

## Structure

- `src/` : application (`core/` services, `app/` coque, un dossier par écran)
- `supabase/migrations/` : schéma, RLS, RPC, stockage (noms = versions du projet hébergé)
- `supabase/functions/` : `liveffn-proxy`, `delete-account` (JS pur dans `_shared/`, enveloppes Deno)
- `supabase/tests/database/` : tests pgTAP
- `docs/` : `db-tests.md`, `security-notes.md`, `store-readiness.md`, `demo-account.md`
