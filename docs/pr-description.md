# SwimCoach multi-entraîneurs : comptes, espaces d'équipe partagés, Supabase

## Résumé

Nouvelle version de SwimCoach App (branche `feat/multi-coach`) :

- comptes entraîneurs (Supabase Auth) activés par le code du club ;
- données rangées par **espace d'équipe**, partagé entre plusieurs entraîneurs (ajout par e-mail, invitations, retrait, suppression) ;
- sécurité par RLS : un entraîneur ne voit que les espaces dont il est membre ; photos dans un bucket privé ;
- reprise des fonctions de `club4` : calendrier, contacts et import, présences, stats (PDF), planning (PDF), performances liveffn et bilan PDF ;
- hors ligne (service worker, file d'envoi), déconnexion sûre sur un appareil partagé, suppression du compte ;
- temps réel en INSERT / UPDATE seulement (la publication ne diffuse plus les DELETE, qui ne respectent pas la RLS) ;
- effacement sur l'appareil des espaces perdus (même non ouverts) et des données laissées par un autre entraîneur ;
- mise en ligne GitHub Pages dans `ci.yml`, seulement si toute la CI est verte ;
- fonctions Edge `liveffn-proxy` et `delete-account` ;
- préparation des stores, page de confidentialité ;
- README, notes de sécurité (`docs/security-notes.md`), procédure des tests de base (`docs/db-tests.md`).

## Preuves de test (20/11/2026)

- Base de développement `zuguceilohochmpnbzaz`, pgTAP en `begin … rollback` : `00_helpers` 3/3, `invite_code` 27/27, `teams` 80/80, `storage` 41/41, `isolation` 148/148 (dont 3 assertions sur la publication temps réel). Rien ne reste après les passages (0 compte, schéma `tests` absent).
- Les 11 migrations du dépôt sont identiques à celles du projet hébergé (même version et même nom ; la 11e, `20261120053604_realtime_no_delete`, vient de la revue finale). Les 2 fonctions Edge sont déployées en version 2.
- Conseillers Supabase : sécurité 8 WARN + 3 INFO, tous justifiés ; performance 2 INFO. Détail dans `docs/security-notes.md`.
- Chaîne locale après la revue finale : `npm ci`, `npm run guards` (89 fichiers), `npm test` (332 tests, 28 fichiers), `npm run build`, `check-guards dist` (10 fichiers), Playwright 86/86. Avant la revue : 258/258 avec `--repeat-each=3` (aucun test instable).
- CI : le job `db-tests` (CLI Supabase 3.2.0, `supabase start` puis `supabase test db`) n'a pas encore tourné sur GitHub : un passage vert sur cette PR est exigé avant la fusion.
- Correspondance critères de la spec et tests : tableau du `README.md`.

## À faire par Damien avant la fusion et la première mise en ligne

0. Vérifier sur cette PR que les jobs `test` et `db-tests` sont verts (le job `deploy` ne tourne que sur `main`).
1. GitHub, Settings, Pages : Source = **GitHub Actions** (environnement `github-pages` ; le déploiement est le job `deploy` de `ci.yml`).
2. Définir le code du club dans l'éditeur SQL Supabase : `select private.set_invite_code('…');` (jamais dans le dépôt).
3. Configurer le **SMTP** de Supabase Auth.
4. Authentication, URL Configuration : ajouter l'adresse GitHub Pages dans Site URL et Redirect URLs.
5. Vérifier « Confirm email » et « Secure email change » (activés), `db-tx-end=commit-allow-override` (jamais activé).
6. Vérifier que l'origine de mise en ligne figure dans `supabase/functions/_shared/cors.js` (redéployer les fonctions sinon).
7. Faire les contrôles manuels du README sous l'adresse Pages : vraie page liveffn, vrai e-mail de confirmation et lien de réinitialisation, fonctions Edge déployées (401 sans jeton, préflight CORS `OPTIONS`), service worker et hors ligne sur appareil.
8. Valider la page de confidentialité (`public/privacy.html`, version provisoire) avec le club.

## Risques acceptés (voir `docs/security-notes.md`)

- Course « dernier membre » dans `delete-account` (invitation rattachée pendant la suppression) : impact faible.
- Course inverse dans `delete-account` (un collègue quitte l'espace pendant la suppression du compte) : un espace peut rester sans membre ; détecté par la requête d'administration.
- Photos orphelines si l'application s'arrête entre la suppression d'une photo et celle de la ligne, et course à la suppression d'un espace : nettoyage d'administration (requête en lecture seule dans `docs/security-notes.md`), correction côté serveur à prévoir.
- Temps réel sans DELETE : une suppression faite par un collègue apparaît à la relecture suivante (retour au premier plan, réseau, ou prochaine modification de la table) ; un retrait de l'espace est détecté à la resynchro ou au premier envoi refusé.

## Revue finale : corrections

- Mise en ligne conditionnée à la CI (`deploy` avec `needs: [test, db-tests]`, `dist` contrôlé par `check-guards`), `deploy.yml` supprimé ; `permissions: contents: read` et `concurrency` sur la CI ; CLI Supabase figée (3.2.0), `db reset` redondant retiré.
- Migration `realtime_no_delete` : publication `insert, update`, sans `team_members` ; client sans abonnement DELETE ni `team_members` ; `realtime.js` n'importe plus `sync.js`.
- Caches des espaces perdus effacés à chaque lecture réussie de la liste ; données des autres entraîneurs effacées à la connexion (sauf écritures en attente ou refusées).
- Import liveffn : résultats regroupés par clé d'unicité (meilleur temps valide), signalés dans l'aperçu.
- Code mort retiré (`onTeamChange`, `closeConfirm`, `currentSeasonPeriod`) ; `appStore.clear` lève une erreur.
