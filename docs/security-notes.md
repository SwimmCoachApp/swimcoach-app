# Notes de sécurité (base de données)

Contrôles Supabase lancés après les migrations `20261119140022_schema.sql`,
`20261119140225_revoke_rls_auto_enable.sql`, `20261119140518_coaches_members_email_sync.sql`,
`20261119141537_invite_code.sql`, `20261119141814_code_attempts_pk.sql`,
`20261119142821_teams.sql`, `20261119144207_storage.sql` et
`20261119144500_teams_hardening.sql`, `20261119145634_storage_strict_names.sql` et
`20261119150749_photos_jpeg_only.sql`
(projet de développement, 19/11/2026 ; dernier contrôle complet : 20/11/2026, voir la section finale). Les noms de fichiers reprennent la version
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

## Sécurité, tâche 4 bis : alertes attendues, gardées

- WARN `authenticated_security_definer_function_executable` sur les 7 RPC d'espace :
  `create_team`, `rename_team`, `add_team_member`, `cancel_invite`,
  `remove_team_member`, `delete_team`, `claim_my_invites`. C'est voulu : ce sont les seules
  portes d'écriture sur `teams` (création, suppression), `team_members` et
  `team_invites`. Les clients n'ont aucun droit d'écriture direct sur ces tables.
  Chaque RPC (sauf `create_team` et `claim_my_invites`) commence par vérifier que
  l'appelant est membre activé de l'espace visé (`not_allowed`). `create_team` exige un
  compte activé. `claim_my_invites` n'agit que sur les invitations de l'adresse
  confirmée de l'appelant. Toutes ont `search_path = ''` et aucun droit pour `anon` ni
  PUBLIC.
- INFO `rls_enabled_no_policy` sur `private.invite_log` : voulu (même règle que pour
  `club_invite` et `code_attempts`).

## Tâche 5 (stockage des photos) et durcissement des RPC d'espace

Aucune nouvelle alerte, ni sécurité ni performance. Les WARN sur les RPC d'espace et
les INFO `rls_enabled_no_policy` restent ceux décrits plus haut (voulus).

- Bucket `photos` privé (`public = false`), 2 Mo au plus (`file_size_limit = 2097152`),
  `image/jpeg` seulement (migration `photos_jpeg_only` ; webp retiré). Chemins
  `<team_id>/swimmers/<uuid>.jpg` et `<team_id>/sessions/<uuid>.jpg`, imposés au dépôt et
  au remplacement par `storage_strict_names` (UUID en minuscules, extension `.jpg`).
- 4 politiques sur `storage.objects` (`photos_select`, `photos_insert`, `photos_update`,
  `photos_delete`), pour `authenticated` seulement :
  `bucket_id = 'photos' and (select private.is_team_member(private.team_from_path(name)))`
  (update : même règle en `using` et en `with check`, donc pas de déplacement vers un
  autre espace). `anon` n'a aucune politique : il ne voit ni ne dépose rien.
- `private.team_from_path(name)` : premier dossier du chemin converti en UUID s'il en a
  la forme (regex), sinon `null`. Un nom comme `pasunuuid/x.jpg` rend la politique
  fausse, jamais une erreur de conversion. Fonction `immutable`, pas `security definer`
  (les politiques s'exécutent avec les droits de l'appelant), exécutable par
  `authenticated` seulement.
- Les politiques ne contrôlent pas le sous-dossier (`swimmers/`, `sessions/`) : un
  membre peut déposer n'importe quel nom sous le dossier de son espace. Choix assumé :
  la frontière de sécurité est l'espace.
- Le déclencheur `protect_objects_delete` de Supabase refuse les `DELETE` SQL directs
  sur `storage.objects` sauf si `storage.allow_delete_query = 'true'`. Ce réglage est
  posable par n'importe quel rôle : c'est un garde-fou contre les fausses manœuvres,
  pas une sécurité. La vraie protection est la politique `photos_delete`.
- Durcissement (`teams_hardening`) : `rename_team`, `add_team_member`,
  `remove_team_member` et `delete_team` prennent d'abord le verrou `for update` sur la
  ligne `teams`, puis vérifient l'appartenance. Un membre en cours de retrait attend la
  fin du retrait et la vérification qui suit le refuse (`not_allowed`).
  `add_team_member` n'ajoute directement qu'un compte confirmé, ni supprimé
  (`deleted_at is null`) ni SSO (`not is_sso_user`) ; sinon il crée une invitation.

## Réglages obligatoires Supabase Auth

À vérifier dans le tableau de bord (Authentication → Sign In / Providers → Email) sur
chaque projet, avant toute mise en service :

- **« Confirm email » activé** : obligatoire. La protection des invitations repose sur
  `email_confirmed_at` (ajout direct et rattachement d'une invitation seulement pour une
  adresse confirmée). Sans confirmation, n'importe qui pourrait s'inscrire avec
  l'adresse d'un invité et prendre sa place.
- **« Secure email change » activé** : le changement d'adresse doit être confirmé sur
  l'ancienne et la nouvelle adresse.
- **Ne jamais activer `db-tx-end=commit-allow-override`** (en-tête / réglage PostgREST) :
  il permettrait à un client d'annuler sa transaction (rollback) après l'appel, donc
  d'effacer les entrées de `invite_log` et `code_attempts` et de contourner les limites
  d'essais.
- Risque accepté : la réponse `added` ou `invited` de `add_team_member` révèle si une
  adresse a un compte confirmé. Limité aux entraîneurs activés, membres d'un espace,
  20 appels par heure.

Performance, tâche 4 bis : aucune nouvelle alerte. `team_invites_email_idx` n'est plus
signalé comme inutilisé : `claim_invites` s'en sert.

Performance, tâche 4 : INFO « pas de clé primaire » sur `private.code_attempts`,
corrigé par `20261119141814_code_attempts_pk.sql` (identifiant technique).

## Performance : alertes INFO « index inutilisé », gardées

- `teams_created_by_idx`, `team_invites_invited_by_idx` : index sur des clés étrangères
  vers `auth.users` (`on delete set null`). Sans eux, la suppression d'un compte
  parcourt toute la table. Le conseiller les signalerait sinon comme « clé étrangère
  sans index ».
- `team_invites_email_idx` : sert à retrouver les invitations d'un e-mail à l'activation
  du compte (tâche 4 / 4 bis).

« Inutilisé » vient seulement de ce que la base est vide. À revoir quand l'app tourne.

## Choix à connaître

- Schéma `private` non exposé par l'API (`config.toml` : `public`, `graphql_public`).
  `authenticated` y a `usage` et le droit d'exécuter seulement `is_active_coach()`,
  `is_team_member(uuid)` et `team_from_path(text)` (les politiques s'exécutent avec les
  droits de l'appelant).
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
- Espaces et invitations (tâche 4 bis) :
  - `add_team_member` est limité à 20 appels par heure et par appelant
    (`private.invite_log`, verrou sur la ligne `coaches` de l'appelant). Un appel refusé
    pour adresse invalide est annulé avec son entrée du journal.
  - Un compte existant n'est ajouté directement que si
    `lower(auth.users.email)` = l'adresse normalisée et que l'adresse est confirmée.
    Sinon, une invitation est créée.
  - Une invitation n'est rattachée (`claim_invites`, appelée par
    `redeem_invite_code` et `claim_my_invites`) que pour un compte activé dont l'adresse
    est confirmée : on ne peut pas prendre l'invitation d'une autre personne en
    s'inscrivant avec son adresse sans la confirmer.
  - N'importe quel membre peut retirer n'importe quel membre, lui-même compris.
    Le dernier membre ne peut pas partir (`last_member`, verrou sur la ligne `teams`) :
    il supprime l'espace, et `delete_team` efface toutes ses données en cascade.
  - Le nom d'un espace est nettoyé (`btrim`) et doit faire de 1 à 60 caractères, sinon
    `invalid_name`. Ce contrôle est fait par la RPC plutôt que de laisser la contrainte
    CHECK lever 23514, pour donner à l'app un message propre.
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
  `anon`, et par `authenticated` seulement `is_active_coach`, `is_team_member` et
  `team_from_path`.

## Contrôle final (tâche 19, 20/11/2026)

Dernier passage sur le projet de développement `zuguceilohochmpnbzaz`, après toutes les
migrations (10) et le déploiement des 2 fonctions Edge.

### Alertes sécurité : 3 INFO et 8 WARN, toutes voulues

- 8 WARN `authenticated_security_definer_function_executable` : `redeem_invite_code` et
  les 7 RPC d'espace (`create_team`, `rename_team`, `add_team_member`, `cancel_invite`,
  `remove_team_member`, `delete_team`, `claim_my_invites`). Ce sont les seules portes
  d'écriture sur l'activation du compte, `teams`, `team_members` et `team_invites` ;
  les clients n'ont aucun droit d'écriture direct sur ces tables. Chaque fonction
  vérifie l'appelant (compte activé, membre de l'espace visé), a `search_path = ''`, et
  n'est exécutable ni par `anon` ni par PUBLIC (testé dans `invite_code.test.sql` et
  `teams.test.sql`).
- 3 INFO `rls_enabled_no_policy` sur `private.club_invite`, `private.code_attempts`,
  `private.invite_log` : voulu. Aucun client n'y a de droit et le schéma n'est pas exposé ;
  RLS sans politique = tout refusé, seules les fonctions serveur y accèdent.

### Alertes performance : 2 INFO « index inutilisé », gardées

`teams_created_by_idx` et `team_invites_invited_by_idx` couvrent des clés étrangères
vers `auth.users` (`on delete set null`) : sans eux, la suppression d'un compte
parcourt toute la table. « Inutilisé » vient de ce que la base de développement est
vide. À revoir avec de vraies données.

### Risques connus et acceptés

- **Course « dernier membre » dans `delete-account`** (parquée, tâche 6). La fonction
  calcule d'abord les espaces dont l'utilisateur est le seul membre, puis efface leurs
  photos et l'espace. Si, dans cette fenêtre, un invité rattache son invitation à l'un
  de ces espaces, il en perd l'accès avec la suppression. Impact faible : l'espace et
  ses données appartenaient à l'utilisateur qui supprime son compte, et l'invité n'y
  avait pas encore accès. Une suppression conditionnelle atomique (RPC) demanderait une
  migration avec `DELETE` : à reprendre si le besoin apparaît.
- **Photos orphelines** (tâche 5, tâche 17).
  - Les clients effacent d'abord les photos, puis la ligne (nageur, séance, espace). Si
    l'application s'arrête entre les deux, des photos restent dans le bucket sans ligne.
  - Course à la suppression d'un espace : un collègue peut déposer une photo après la
    dernière liste vide et avant `delete_team`. Le client relance la liste jusqu'à ce que le
    dossier soit vide, mais la fermeture complète serait côté serveur (purge ou refus
    dans `delete_team`, ou déclencheur sur le stockage). À traiter avec la conformité RGPD
    (photos de mineurs) : nettoyage d'administration en attendant, par exemple en listant
    les dossiers `photos/<uuid>` dont l'espace n'existe plus.
  - Les URL signées restent valides jusqu'à leur expiration après suppression du fichier :
    durée de vie de 1 h au plus côté application.
- Gateway Supabase : un 401 refusé par `verify_jwt` n'a pas d'en-têtes CORS. Le client
  traite un échec d'appel sans statut comme « connexion nécessaire ».

### Garde-fous du dépôt et règle R1 (dist)

`scripts/check-guards.mjs` (`npm run guards` sur les sources, `node scripts/check-guards.mjs dist`
sur le build, lancés en CI) :

- Sources : projets Supabase interdits (`aijgczmszymfjkeegbjz`, `vijexmmydvgfpkyzkgls`),
  `service_role` et `sb_secret_`, `localStorage` brut (hors `src/core/storage.js`),
  attributs d'événement en ligne (`onclick=`...), anciennes clés (`swimcoach_v2`, etc.).
- **Règle R1 sur `dist/`** : seuls « projet interdit » et « vraie clé secrète »
  (`sb_secret_` suivi d'au moins 20 caractères) y sont contrôlés. `supabase-js` embarqué
  contient légitimement `localStorage` et la chaîne nue `sb_secret_` (contrôle de format
  qui refuse une clé secrète dans un navigateur) ; `service_role` n'apparaît pas dans le
  build. Les mots `service_role` et `SUPABASE_SERVICE_ROLE_KEY` ne figurent dans le dépôt
  que dans le script des garde-fous et son test, dans les noms de variables
  d'environnement lus par les fonctions Edge (repli) et dans les documents de conception.
- Aucune clé secrète dans le dépôt : les fonctions lisent `SUPABASE_SECRET_KEYS` /
  `SUPABASE_PUBLISHABLE_KEYS` dans l'environnement fourni par Supabase.

### Réglages Auth à vérifier avant la première mise en ligne

Liste détaillée dans « Réglages obligatoires Supabase Auth » plus haut. Pour la mise en
ligne, il faut en plus :

- **SMTP personnalisé** configuré (le service d'e-mail intégré est limité en volume et
  réservé aux tests) : sans lui, les e-mails de confirmation et de réinitialisation
  n'arrivent pas.
- **URL Configuration** : Site URL et Redirect URLs = l'adresse GitHub Pages de l'app
  (`https://swimmcoachapp.github.io/swimcoach-app/`, à confirmer), en plus de
  `http://localhost:5173` pour le développement.
- « Confirm email » et « Secure email change » activés ; `db-tx-end=commit-allow-override`
  jamais activé.
- Les origines autorisées des fonctions Edge (`supabase/functions/_shared/cors.js`)
  doivent contenir l'origine de la mise en ligne (`https://swimmcoachapp.github.io`).
