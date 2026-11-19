# Notes de sécurité (base de données)

Contrôles Supabase lancés après les migrations `20261119140022_schema.sql`,
`20261119140225_revoke_rls_auto_enable.sql` et `20261119140518_coaches_members_email_sync.sql`
(projet de développement, 19/11/2026). Les noms de fichiers reprennent la version
enregistrée par le projet hébergé (`list_migrations`).

## Sécurité : aucune alerte

Premier passage : 2 alertes WARN sur `public.rls_auto_enable()` (exécutable par `anon`
et `authenticated`, `security definer`). Cette fonction n'est pas à nous : la plateforme
la crée pour l'option « RLS automatique » ; c'est la fonction du déclencheur
d'événement `ensure_rls`. Corrigé par la migration `20261119140225` (retrait du droit
EXECUTE ; le déclencheur d'événement fonctionne toujours, vérifié : une table créée
dans `public` reçoit bien la RLS). Second passage : aucune alerte.

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
