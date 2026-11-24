# Tests de la base (pgTAP)

Fichiers : `supabase/tests/database/`

- `00_helpers.sql` : crée le schéma `tests` et trois fonctions de test
  (`tests.create_coach(email, activé)`, `tests.create_team(nom, membres)`,
  `tests.as_coach(id)`). C'est aussi un fichier pgTAP valide (3 assertions).
  La partie utile est entre les marqueurs `-- helpers:start` et `-- helpers:end`.
- `isolation.test.sql` : isolation entre espaces d'équipe (148 assertions). Il
  commence par `begin;` et finit par `rollback;` : rien ne reste en base.
- `invite_code.test.sql` : activation par le code du club (27 assertions).
- `teams.test.sql` : espaces, membres, invitations, propriétaire du groupe (95 assertions).
- `storage.test.sql` : stockage privé des photos, noms stricts (41 assertions).

Règle d'écriture : chaque assertion pgTAP commence **en début de ligne** par
`select` (`select is(`, `select throws_ok(`, `select * from finish()`...). Le script
de regroupement s'appuie dessus. Les UUID sont rangés dans la table temporaire `ids`
et lus avec `pg_temp.id('clé')`.

## En CI (job `db-tests`)

```
supabase start         # base neuve : applique supabase/migrations/ (pas besoin de db reset)
supabase test db       # pg_prove sur supabase/tests/, par ordre alphabétique
```

Version de la CLI figée dans `ci.yml` (`supabase/setup-cli`, `version: 3.2.0`). Tous les services
restent démarrés : `auth` et `storage` créent les schémas utilisés par les tests.

`00_helpers.sql` passe en premier et **valide** (`commit`) les fonctions de test dans
la base locale jetable ; `isolation.test.sql` les utilise ensuite.

## Noms des migrations

Après `apply_migration`, le fichier de `supabase/migrations/` est renommé avec la
version enregistrée par le projet hébergé (`list_migrations`), pour que l'historique
local et l'historique distant concordent.

## Sur le projet hébergé (sans Docker)

L'outil `execute_sql` ne renvoie que le **dernier** résultat d'une requête. On envoie
donc chaque fichier en une seule requête préparée par :

```
node scripts/db-test-bundle.mjs supabase/tests/database/isolation.test.sql > /tmp/iso.sql
node scripts/db-test-bundle.mjs supabase/tests/database/isolation.test.sql --count   # nombre d'assertions
```

Le script :
1. remplace `-- helpers:include` par la section helpers de `00_helpers.sql` (les
   fonctions sont créées **dans** la transaction, donc annulées au rollback) ;
2. crée la table temporaire `pg_temp.tap_out` (droits pour tous les rôles, car les
   assertions tournent aussi en `authenticated` et `anon`) ;
3. préfixe chaque ligne d'assertion par `insert into pg_temp.tap_out(line)` ;
4. ajoute, juste avant le `rollback;` final (ou à la place du `commit;` de
   `00_helpers.sql`), `select string_agg(line, E'\n' order by n) as tap from pg_temp.tap_out;`.

On envoie le contenu produit avec `execute_sql` : le résultat est la sortie TAP
complète (`1..148`, puis `ok 1 - ...`). Si une instruction hors assertion échoue
(table absente, par exemple), toute la requête échoue et la transaction est annulée.

Après un passage, vérifier qu'il ne reste rien :

```sql
select (select count(*) from auth.users) users,
       (select count(*) from pg_namespace where nspname = 'tests') tests_schema;
```

## Ce que couvre isolation.test.sql

Mise en place : A et C activés, membres de TA ; B activé, membre de TB ; E non activé
mais inscrit dans `team_members` de TA ; D (à la fin) activé, membre de TA et de TB.
Des lignes de TA dans chaque table métier.

- Structure : trigger `on_auth_user_created` (e-mail en minuscules, compte inactif),
  synchro de `coaches.email` quand l'e-mail du compte change,
  publication temps réel (7 tables métier, sans `team_members`, insert et update seulement), RLS sur toutes les tables, 34 politiques, aucun droit pour
  `anon`, pas de `TRUNCATE` pour `authenticated`, droits des fonctions `private`
  (aucune exécutable par PUBLIC ou `anon` ; par `authenticated`, seulement les deux
  fonctions d'appartenance et `team_from_path`).
- B (non-membre) : lecture, insertion, modification, suppression refusées sur les 7
  tables métier et sur `teams`, `team_members`, `team_invites`, `coaches` ; pas de
  `TRUNCATE` ; pas de déplacement vers TA ; pas de détournement par upsert
  (`on conflict (id) do update` sur un nageur de TA) ; clés composites (présence, perf,
  groupe).
  Contrôle en `postgres` ensuite : TA est intacte.
- E (membre non activé) : ne voit rien, n'écrit rien ; voit seulement sa ligne `coaches`.
- C (membre activé) : voit tous les membres de TA dans `coaches` (A, E et lui) ;
  lit, crée, modifie, supprime dans les 7 tables métier ;
  `updated_by`, `updated_at` = heure du serveur (date ancienne ou future envoyée par le
  client ignorée), renommage de l'espace (et nom vide
  refusé), `display_name` seul modifiable ; aucune écriture directe sur
  `teams`/`team_members`/`team_invites`.
- D (membre des deux espaces) : le trigger `forbid_team_change` refuse le changement
  de `team_id` même quand les deux espaces sont accessibles.
- anon : aucun accès (erreur `42501`).

## Ce que couvre invite_code.test.sql

C et D : comptes confirmés, non activés.

- Droits : `redeem_invite_code` pour `authenticated` seulement (ni `anon` ni PUBLIC) ;
  `set_invite_code` et `claim_invites` non exécutables par les clients ; RLS et aucun
  droit client sur `private.club_invite` et `private.code_attempts`.
- Code stocké haché (bcrypt), une seule ligne (le nouveau code remplace l'ancien).
- C : mauvais code → `false` ; bon code avec espaces et minuscules → `true`, compte
  activé ; compte déjà activé → `true` sans nouvel essai.
- D : 5 mauvais essais, le 6e (bon code) → `too_many_attempts`, non enregistré ; une
  heure plus tard, D peut réessayer et s'active.
- Sans identifiant de compte → `not_allowed` ; `anon` → `42501`.

## Ce que couvre teams.test.sql

A, B, C activés ; E non activé ; U a un compte dont l'adresse n'est pas confirmée.
B est seul dans TB.

- Droits : les 7 RPC sont exécutables par `authenticated`, ni par `anon` ni par PUBLIC,
  security definer avec `search_path` vide. `private.invite_log` : RLS activée, aucun
  droit client.
- A crée TA (nom nettoyé, A inscrit, `created_by`). Nom vide ou trop long →
  `invalid_name`. A renomme TA.
- **Propriétaire** (= `created_by`) : un invité ne supprime pas l'espace (`not_owner`) et ne retire pas
  le propriétaire ; le propriétaire supprime l'espace même avec d'autres membres, et peut le quitter.
  Sans propriétaire membre (parti, ou `created_by` nul après suppression de son compte), tout membre
  peut supprimer l'espace.
- `add_team_member` :
  - C (adresse en majuscules et espaces) → `added` ; une seconde fois → `already_member` ;
  - D sans compte → `invited`, une seule ligne même invité deux fois ;
  - U (compte non confirmé) → `invited` ;
  - adresse invalide ou nulle → `invalid_email`.
- `cancel_invite`.
- B (non membre) : `not_allowed` partout. E (non activé) ne crée pas d'espace. Sans
  `sub` → `not_allowed` ; `anon` → `42501`.
- D :
  - adresse non confirmée → `claim_my_invites()` = 0 ;
  - une fois confirmée → 1, D lit TA et l'invitation est supprimée ;
  - second appel → 0.
- F (invité, non activé) : 0, puis `redeem_invite_code` le fait entrer dans TA.
- G : invité, puis il crée son compte : `added`, et l'invitation est supprimée.
- Compte SSO ou supprimé (`deleted_at`) → `invited`, jamais ajouté directement.
- E (confirmé, non activé) → `added`, mais ne voit rien ; une fois activé, il lit TA.
- Limite : une adresse invalide (refusée) ne compte pas ; 20 appels acceptés, le 21e →
  `too_many_invites` ; à nouveau possible une heure plus tard.
- C retire A (A ne voit plus rien, ne peut plus inviter, renommer, supprimer l'espace ni
  retirer quelqu'un : `not_allowed`). F part de lui-même. Retirer
  un non-membre ne fait rien. Le dernier membre → `last_member`. `delete_team` efface
  tout en cascade ; TB est intacte.

Non testable en une transaction : la course « membre retiré pendant qu'il agit ». Les
RPC prennent le verrou sur la ligne `teams` avant de vérifier l'appartenance
(`20261119144500_teams_hardening.sql`).

## Ce que couvre storage.test.sql

A et C activés, membres de TA ; E non activé mais inscrit dans TA ; B activé, seul dans
TB. Les objets sont insérés directement dans `storage.objects` (`bucket_id, name, owner`).

- Structure : bucket `photos` privé, 2 Mo, jpeg seulement (`photos_jpeg_only`) ; 4 politiques `photos_*` pour
  `authenticated` seulement ; `private.team_from_path` (UUID, `pasunuuid/...` → null,
  pas de dossier → null ; exécutable par `authenticated`, pas par `anon`).
- A dépose sous TA. Noms `pasunuuid/x.jpg` et `x.jpg` refusés (42501, pas d'erreur de
  conversion) ; un objet au nom invalide (posé en `postgres`) est invisible, sans erreur.
- Noms stricts (`20261119145634_storage_strict_names.sql`) : dépôt et remplacement exigent
  `<uuid>/(swimmers|sessions)/<uuid>.jpg` en minuscules. Refusés (42501) : dossier ou
  fichier en majuscules, `<TA>/../x.jpg`, `<TA>/other/<uuid>.jpg`, `.webp`, `.png`,
  `<TA>/swimmers/x.jpg`, nom suivi d'un saut de ligne, renommage (UPDATE) vers un nom
  non conforme. Les noms valides restent acceptés.
- C lit, remplace, supprime sous TA ; ne déplace pas vers TB (42501).
- B : ne voit rien de TA, ne dépose pas sous TA, pas de remplacement par upsert
  (`on conflict (id) do update` sur l'identifiant de la photo de TA → 42501), ne renomme
  ni ne supprime (0 ligne) ; dépose sous TB et ne voit que cela. Contrôle `postgres` : la
  photo de TA est intacte.
- E non activé : ne dépose pas, ne voit rien. anon : ne voit rien, ne dépose rien.
- Après le retrait de C (RPC), C ne lit plus et ne dépose plus.

Suppression : `storage.objects` a un déclencheur (`protect_objects_delete`) qui refuse
tout `DELETE` SQL direct sauf si `storage.allow_delete_query = 'true'`. Le test pose ce
réglage (`set local`) pour que la politique `photos_delete` soit vraiment évaluée.

## Avant la mise en service (checklist Supabase Auth)

Détail et raisons : `docs/security-notes.md`, « Réglages obligatoires Supabase Auth ».

- [ ] « Confirm email » activé (les invitations reposent sur `email_confirmed_at`).
- [ ] « Secure email change » activé.
- [ ] `db-tx-end=commit-allow-override` jamais activé (contournement des limites par
      rollback).
- [ ] Risque accepté et connu : `added` / `invited` révèle qu'une adresse a un compte
      confirmé (entraîneurs activés seulement, 20 appels par heure).
