# SwimCoach multi-entraîneurs : comptes, espaces d'équipe partagés, Supabase

## Résumé

Nouvelle version de SwimCoach App (branche `feat/multi-coach`) :

- comptes entraîneurs (Supabase Auth) activés par le code du club ;
- données rangées par **espace d'équipe**, partagé entre plusieurs entraîneurs (ajout par e-mail, invitations, retrait, suppression) ;
- sécurité par RLS : un entraîneur ne voit que les espaces dont il est membre ; photos dans un bucket privé ;
- reprise des fonctions de `club4` : calendrier, contacts et import, présences, stats (PDF), planning (PDF), performances liveffn et bilan PDF ;
- hors ligne (service worker, file d'envoi), déconnexion sûre sur un appareil partagé, suppression du compte ;
- fonctions Edge `liveffn-proxy` et `delete-account` ;
- préparation des stores, page de confidentialité ;
- README, notes de sécurité (`docs/security-notes.md`), procédure des tests de base (`docs/db-tests.md`).

## Preuves de test (20/11/2026)

- Base de développement `zuguceilohochmpnbzaz`, pgTAP en `begin … rollback` : `00_helpers` 3/3, `invite_code` 27/27, `teams` 80/80, `storage` 41/41, `isolation` 146/146. Rien ne reste après les passages (0 compte, schéma `tests` absent).
- Les 10 migrations du dépôt sont identiques à celles du projet hébergé (même version et même nom). Les 2 fonctions Edge sont déployées en version 2.
- Conseillers Supabase : sécurité 8 WARN + 3 INFO, tous justifiés ; performance 2 INFO. Détail dans `docs/security-notes.md`.
- Chaîne locale : `npm ci`, `npm run guards` (88 fichiers), `npm test` (321 tests, 27 fichiers), `npm run build`, `check-guards dist` (10 fichiers), Playwright 86/86, puis 258/258 avec `--repeat-each=3` (aucun test instable).
- Correspondance critères de la spec et tests : tableau du `README.md`.

## À faire par Damien avant la fusion et la première mise en ligne

1. GitHub, Settings, Pages : Source = **GitHub Actions**.
2. Définir le code du club dans l'éditeur SQL Supabase : `select private.set_invite_code('…');` (jamais dans le dépôt).
3. Configurer le **SMTP** de Supabase Auth.
4. Authentication, URL Configuration : ajouter l'adresse GitHub Pages dans Site URL et Redirect URLs.
5. Vérifier « Confirm email » et « Secure email change » (activés), `db-tx-end=commit-allow-override` (jamais activé).
6. Vérifier que l'origine de mise en ligne figure dans `supabase/functions/_shared/cors.js` (redéployer les fonctions sinon).
7. Faire les contrôles manuels du README : vraie page liveffn, vrai e-mail de confirmation, fonctions Edge déployées (401 sans jeton), hors ligne sur appareil.
8. Valider la page de confidentialité (`public/privacy.html`, version provisoire) avec le club.

## Risques acceptés (voir `docs/security-notes.md`)

- Course « dernier membre » dans `delete-account` (invitation rattachée pendant la suppression) : impact faible.
- Photos orphelines si l'application s'arrête entre la suppression d'une photo et celle de la ligne, et course à la suppression d'un espace : nettoyage d'administration, correction côté serveur à prévoir.
