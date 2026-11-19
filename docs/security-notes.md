# Notes de sécurité (base de données)

Contrôles Supabase lancés après les migrations `20261119140022_schema.sql`,
`20261119140225_revoke_rls_auto_enable.sql`, `20261119140518_coaches_members_email_sync.sql`,
`20261119141537_invite_code.sql` et `20261119141814_code_attempts_pk.sql`
(projet de développement, 19/11/2026). Les noms de fichiers reprennent la version
enregistrée par le projet hébergé (`list_migrations`).

## Sécurité : aucune alerte

Premier passage : 2 alertes WARN sur `public.rls_auto_enable()` (exécutable par `anon`
et `authenticated`, `security definer`). Cette fonction n'est pas à nous : la plateforme
la crée pour l'option « RLS automatique » ; c'est la fonction du déclencheur
d'événement `ensure_rls`. Corrigé par la migration `20261119140225` (retrait du droit
EXECUTE ; le déclencheur d'événement fonctionne toujours, vérifié : une table créée
dans `public` reçoit bien la RLS). Second passage : aucune alerte.

## Sécurité, tâche 4 : alertes attendues, gardées

- WARN `authenticated_security_definer_function_executable` sur
  `public.redeem_invite_code(text)` : voulu. C'est la RPC que l'app appelle pour activer
  le compte ; elle doit lire le code haché et poser `activated_at`, ce que l'appelant ne
  peut pas faire lui-même. `search_path = ''`, `anon` et `PUBLIC` n'ont pas le droit
  d'exécution, limite de 5 essais par heure et par compte.
- INFO `rls_enabled_no_policy` sur `private.club_invite` et `private.code_attempts` :
  voulu. Aucun client n'y accède (aucun droit, schéma non exposé) ; seules les
  fonctions serveur les lisent. RLS activée sans politique = tout refusé par défaut.

Performance, tâche 4 : INFO « pas de clé primaire » sur `private.code_attempts`,
corrigé par `20261119141814_code_attempts_pk.sql` (identifiant technique).

## Performance : 3 alertes INFO « index inutilisé », gardées

- `teams_created_by_idx`, `team_invites_invited_by_idx` : index sur des clés étrangères
  vers `auth.users` (`on delete set null`). Sans eux, la suppression d'un compte
  parcourt toute la table. Le conseiller les signalerait sinon comme « clé étrangère
  sans index ».
- `team_invites_email_idx` : sert à retrouver les invitations d'un e-mail à l'activation
  du compte (tâche 4 / 4 bis).

« Inutilisé » vient seulement de ce que la base est vide. À revoir quand l'app tourne.

## Choix à connaître

- Schéma `private` non exposé par l'API (`config.toml` : `public`, `graphql_public`).
  `authenticated` y a `usage` et le droit d'exécuter seulement `is_active_coach()` et
  `is_team_member(uuid)` (les politiques s'exécutent avec les droits de l'appelant).
  `anon` n'a aucun droit sur ce schéma.
- Fonctions `security definer` : `private.is_active_coach`, `private.is_team_member`,
  `private.handle_new_user` et `private.handle_user_email_change` (triggers sur `auth.users`). Toutes avec `search_path = ''`. Les fonctions
  de trigger ne sont exécutables par aucun client.
- `anon` : aucun droit sur les tables de `public` (`revoke all`).
- `authenticated` : sur les tables métier, seulement `select, insert, update, delete`.
  `TRUNCATE` est retiré exprès : il contourne la RLS.
- `coaches` : lecture de sa ligne (même non activée) et, pour un entraîneur activé, de
  tous les membres (activés ou non) qui partagent un de ses espaces ; `email` suit
  l'e-mail du compte auth (trigger `on_auth_user_email_updated`, en minuscules) ; seule la colonne `display_name` est modifiable.
  `activated_at` n'est posé que par les fonctions serveur (tâche 4).
- `teams` : lecture et renommage (`name` seul) par les membres ; création, suppression
  et toute écriture sur `team_members` / `team_invites` passent par les fonctions
  serveur (tâche 4 bis).
- Un compte non activé ne voit rien, même inscrit dans `team_members`.
- Code du club : haché avec bcrypt (`extensions.crypt`, `gen_salt('bf')`), jamais en
  clair, dans `private.club_invite` (une seule ligne). Damien le pose ou le change dans
  l'éditeur SQL : `select private.set_invite_code('LE-CODE');` (non exécutable par les
  clients). Comparaison sur `upper(btrim(code))`.
- `redeem_invite_code` : 5 essais au plus par heure glissante et par compte (vérifié
  avant d'enregistrer l'essai ; le refus `too_many_attempts` n'est pas compté). Un
  compte déjà activé reçoit `true` sans essai. Verrou sur la ligne `coaches` de
  l'appelant : deux appels simultanés ne dépassent pas la limite.
- `updated_at` est toujours l'heure du serveur (`now()`) sur les tables métier et sur
  `teams` : l'horloge d'un client ne peut ni reculer ni avancer la date.
- Droits par défaut du schéma `private` : la migration de la tâche 4 contient
  `alter default privileges for role postgres in schema private revoke execute on
  functions from public;`, mais PostgreSQL ne retire pas schéma par schéma un droit
  accordé globalement (EXECUTE à PUBLIC) : vérifié sur le projet, une fonction créée
  ensuite dans `private` reste exécutable par PUBLIC. Le retrait global
  (`alter default privileges for role postgres revoke execute on functions from public`)
  n'est pas retenu : il toucherait aussi les fonctions des extensions créées par
  postgres (pgTAP dans les tests, par exemple). La garantie vient donc de chaque
  migration (`revoke all ... from public, anon` sur chaque fonction) et du test
  d'isolation qui liste les fonctions de `private` exécutables : aucune par PUBLIC ou
  `anon`, et par `authenticated` seulement `is_active_coach` et `is_team_member`.
