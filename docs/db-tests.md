# Tests de la base (pgTAP)

Fichiers : `supabase/tests/database/`

- `00_helpers.sql` : crée le schéma `tests` et trois fonctions de test
  (`tests.create_coach(email, activé)`, `tests.create_team(nom, membres)`,
  `tests.as_coach(id)`). C'est aussi un fichier pgTAP valide (3 assertions).
  La partie utile est entre les marqueurs `-- helpers:start` et `-- helpers:end`.
- `isolation.test.sql` : isolation entre espaces d'équipe (146 assertions). Il
  commence par `begin;` et finit par `rollback;` : rien ne reste en base.
- `invite_code.test.sql` : activation par le code du club (27 assertions).

Règle d'écriture : chaque assertion pgTAP commence **en début de ligne** par
`select` (`select is(`, `select throws_ok(`, `select * from finish()`...). Le script
de regroupement s'appuie dessus. Les UUID sont rangés dans la table temporaire `ids`
et lus avec `pg_temp.id('clé')`.

## En CI (job `db-tests`)

```
supabase start
supabase db reset      # applique supabase/migrations/
supabase test db       # pg_prove sur supabase/tests/, par ordre alphabétique
```

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
complète (`1..146`, puis `ok 1 - ...`). Si une instruction hors assertion échoue
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
  publication temps réel, RLS sur toutes les tables, 34 politiques, aucun droit pour
  `anon`, pas de `TRUNCATE` pour `authenticated`, droits des fonctions `private`
  (aucune exécutable par PUBLIC ou `anon` ; par `authenticated`, seulement les deux
  fonctions d'appartenance).
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
