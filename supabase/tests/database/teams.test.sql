-- Espaces d'équipe, membres et invitations (tâche 4 bis).
-- A, B, C activés ; E non activé ; U : compte existant mais adresse non confirmée.
-- B est seul dans TB. A crée TA par la RPC. D, F, G arrivent plus tard.
-- Chaque assertion pgTAP commence en début de ligne par « select » (voir docs/db-tests.md).
begin;
create extension if not exists pgtap with schema extensions;
-- helpers:include
select plan(70);

create temp table ids (k text primary key, v uuid not null);
grant select, insert on ids to public;
create function pg_temp.id(p_k text) returns uuid
  language sql stable as $fn$ select v from pg_temp.ids where k = p_k $fn$;

-- ---------------------------------------------------------------- mise en place (postgres)
insert into ids values
  ('a', tests.create_coach('coach.a@club.fr', true)),
  ('b', tests.create_coach('coach.b@club.fr', true)),
  ('c', tests.create_coach('C@club.fr', true)),
  ('e', tests.create_coach('coach.e@club.fr', false)),
  ('u', tests.create_coach('u@club.fr', true));
update auth.users set email_confirmed_at = null where id = pg_temp.id('u');
insert into ids values ('tb', tests.create_team('TB', array[pg_temp.id('b')]));

-- ---------------------------------------------------------------- structure (6)
create temp table rpcs (f regprocedure);
grant select on rpcs to public;
insert into rpcs values
  ('public.create_team(text)'), ('public.rename_team(uuid, text)'), ('public.add_team_member(uuid, text)'),
  ('public.cancel_invite(uuid, text)'), ('public.remove_team_member(uuid, uuid)'), ('public.delete_team(uuid)'),
  ('public.claim_my_invites()');
select is((select count(*) from rpcs where has_function_privilege('authenticated', f, 'execute'))::int, 7, 'authenticated appelle les 7 RPC');
select is((select count(*) from rpcs where has_function_privilege('anon', f, 'execute'))::int, 0, 'anon n’appelle aucune des 7 RPC');
select is((select count(*) from rpcs r join pg_proc p on p.oid = r.f, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)::int, 0, 'aucun droit PUBLIC sur les 7 RPC');
select is((select count(*) from rpcs r join pg_proc p on p.oid = r.f where p.prosecdef and p.proconfig @> array['search_path=""'])::int, 7, 'les 7 RPC : security definer, search_path vide');
select ok((select relrowsecurity from pg_class where oid = 'private.invite_log'::regclass), 'RLS activée sur invite_log');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'private' and table_name = 'invite_log'
           and grantee in ('anon', 'authenticated', 'PUBLIC'))::int, 0, 'aucun droit client sur invite_log');

-- ---------------------------------------------------------------- A crée et gère TA (22)
select tests.as_coach(pg_temp.id('a'));
insert into ids values ('ta', public.create_team('  Pôle Formation 1  '));
select isnt(pg_temp.id('ta'), null, 'A crée TA');
select is((select name from public.teams where id = pg_temp.id('ta')), 'Pôle Formation 1', 'nom enregistré sans espaces autour');
select is((select count(*) from public.team_members where team_id = pg_temp.id('ta') and coach_id = pg_temp.id('a'))::int, 1, 'A est inscrit dans TA');
select is((select created_by from public.teams where id = pg_temp.id('ta')), pg_temp.id('a'), 'created_by = A');
select throws_ok($$select public.create_team('   ')$$, 'P0001', 'invalid_name', 'nom vide refusé');
select throws_ok($$select public.create_team(repeat('x', 61))$$, 'P0001', 'invalid_name', 'nom de plus de 60 caractères refusé');
select lives_ok($$select public.rename_team(pg_temp.id('ta'), ' PF1 ')$$, 'A renomme TA');
select is((select name from public.teams where id = pg_temp.id('ta')), 'PF1', 'nouveau nom enregistré');
select throws_ok($$select public.rename_team(pg_temp.id('ta'), '')$$, 'P0001', 'invalid_name', 'renommage vide refusé');
select is(public.add_team_member(pg_temp.id('ta'), ' C@Club.fr '), 'added', 'C existant et confirmé : ajouté');
select is(public.add_team_member(pg_temp.id('ta'), 'c@club.fr'), 'already_member', 'déjà membre');
select is(public.add_team_member(pg_temp.id('ta'), 'd@club.fr'), 'invited', 'D sans compte : invitation en attente');
select is(public.add_team_member(pg_temp.id('ta'), 'D@Club.fr '), 'invited', 'D invité une 2e fois : invitation gardée');
select is((select count(*) from public.team_invites where team_id = pg_temp.id('ta') and email = 'd@club.fr')::int, 1, 'une seule invitation pour D');
select is(public.add_team_member(pg_temp.id('ta'), 'u@club.fr'), 'invited', 'U a un compte mais adresse non confirmée : invitation, pas d’ajout');
select is((select count(*) from public.team_members where coach_id = pg_temp.id('u'))::int, 0, 'U n’est pas membre');
select throws_ok($$select public.add_team_member(pg_temp.id('ta'), 'pas-une-adresse')$$, 'P0001', 'invalid_email', 'adresse invalide');
select throws_ok($$select public.add_team_member(pg_temp.id('ta'), null)$$, 'P0001', 'invalid_email', 'adresse absente');
select lives_ok($$select public.cancel_invite(pg_temp.id('ta'), ' U@club.fr')$$, 'A annule l’invitation de U');
select is((select count(*) from public.team_invites where email = 'u@club.fr')::int, 0, 'invitation de U supprimée');
select is((select count(*) from public.team_members where team_id = pg_temp.id('ta'))::int, 2, 'TA : A et C');
select is((select added_by from public.team_members where team_id = pg_temp.id('ta') and coach_id = pg_temp.id('c')), pg_temp.id('a'), 'C ajouté par A');

-- ---------------------------------------------------------------- B, non-membre de TA (7)
select tests.as_coach(pg_temp.id('b'));
select throws_ok($$select public.add_team_member(pg_temp.id('ta'), 'b2@club.fr')$$, 'P0001', 'not_allowed', 'B non membre ne peut pas inviter dans TA');
select throws_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('c'))$$, 'P0001', 'not_allowed', 'B ne retire personne de TA');
select throws_ok($$select public.rename_team(pg_temp.id('ta'), 'pirate')$$, 'P0001', 'not_allowed', 'B ne renomme pas TA');
select throws_ok($$select public.cancel_invite(pg_temp.id('ta'), 'd@club.fr')$$, 'P0001', 'not_allowed', 'B n’annule pas les invitations de TA');
select throws_ok($$select public.delete_team(pg_temp.id('ta'))$$, 'P0001', 'not_allowed', 'B ne supprime pas TA');
select throws_ok($$select public.add_team_member(null, 'b2@club.fr')$$, 'P0001', 'not_allowed', 'espace absent : refusé');
select is(public.claim_my_invites(), 0, 'B n’a aucune invitation');

-- ---------------------------------------------------------------- E non activé, anon (4)
select tests.as_coach(pg_temp.id('e'));
select throws_ok($$select public.create_team('Espace de E')$$, 'P0001', 'not_allowed', 'compte non activé : pas de création d’espace');
reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.claim_my_invites()$$, 'P0001', 'not_allowed', 'sans identifiant de compte : refusé');
reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.create_team('pirate')$$, '42501', null, 'anon ne crée pas d’espace');
select throws_ok($$select public.claim_my_invites()$$, '42501', null, 'anon n’appelle pas claim_my_invites');
reset role;

-- ---------------------------------------------------------------- D : invitation rattachée après confirmation (6)
insert into ids values ('d', tests.create_coach('d@club.fr', true));
update auth.users set email_confirmed_at = null where id = pg_temp.id('d');
select tests.as_coach(pg_temp.id('d'));
select is(public.claim_my_invites(), 0, 'D activé mais adresse non confirmée : 0');
select is((select count(*) from public.teams)::int, 0, 'D ne voit aucun espace');
reset role;
update auth.users set email_confirmed_at = now() where id = pg_temp.id('d');
select tests.as_coach(pg_temp.id('d'));
select is(public.claim_my_invites(), 1, 'adresse confirmée : 1 espace rejoint');
select is((select count(*) from public.teams where id = pg_temp.id('ta'))::int, 1, 'D lit TA');
select is((select count(*) from public.team_invites where email = 'd@club.fr')::int, 0, 'invitation de D supprimée');
select is(public.claim_my_invites(), 0, 'second appel : 0');

-- ---------------------------------------------------------------- F : invitation rattachée à l'activation par code (4)
select tests.as_coach(pg_temp.id('a'));
select is(public.add_team_member(pg_temp.id('ta'), 'f@club.fr'), 'invited', 'F invité avant d’avoir un compte');
reset role;
insert into ids values ('f', tests.create_coach('f@club.fr', false));
select private.set_invite_code('TOAC2026');
select tests.as_coach(pg_temp.id('f'));
select is(public.claim_my_invites(), 0, 'F confirmé mais non activé : 0');
select is(public.redeem_invite_code('toac2026'), true, 'F active son compte');
select is((select count(*) from public.team_members where team_id = pg_temp.id('ta') and coach_id = pg_temp.id('f'))::int, 1, 'F rejoint TA à l’activation');

-- ---------------------------------------------------------------- G : invitation puis compte, ajout direct (3)
select tests.as_coach(pg_temp.id('a'));
select is(public.add_team_member(pg_temp.id('ta'), 'g@club.fr'), 'invited', 'G invité avant d’avoir un compte');
reset role;
insert into ids values ('g', tests.create_coach('G@Club.fr', true));
select tests.as_coach(pg_temp.id('a'));
select is(public.add_team_member(pg_temp.id('ta'), 'g@club.fr'), 'added', 'G a maintenant un compte confirmé : ajouté');
select is((select count(*) from public.team_invites where email = 'g@club.fr')::int, 0, 'l’invitation de G est remplacée par l’adhésion');

-- ---------------------------------------------------------------- limite : 20 appels par heure (3)
reset role;
update private.invite_log set at = now() - interval '2 hours' where coach_id = pg_temp.id('a');
select tests.as_coach(pg_temp.id('a'));
select is((select count(*) from generate_series(1, 20) g where public.add_team_member(pg_temp.id('ta'), 'r' || g || '@club.fr') = 'invited')::int, 20, '20 appels dans l’heure acceptés');
select throws_ok($$select public.add_team_member(pg_temp.id('ta'), 'r21@club.fr')$$, 'P0001', 'too_many_invites', '21e appel dans l’heure refusé');
reset role;
update private.invite_log set at = now() - interval '61 minutes' where coach_id = pg_temp.id('a');
select tests.as_coach(pg_temp.id('a'));
select is(public.add_team_member(pg_temp.id('ta'), 'r21@club.fr'), 'invited', 'une heure plus tard, A peut de nouveau inviter');

-- ---------------------------------------------------------------- départs, dernier membre, suppression (15)
reset role;
insert into public.swimmers (team_id, firstname, joined_season) values (pg_temp.id('ta'), 'Léa', 2026);
insert into public.sessions (team_id, date, type) values (pg_temp.id('ta'), '2026-11-19', 'nat');
select tests.as_coach(pg_temp.id('c'));
select lives_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('a'))$$, 'C (simple membre) peut retirer A');
select tests.as_coach(pg_temp.id('a'));
select is((select count(*) from public.swimmers)::int, 0, 'A retiré ne voit plus rien de TA');
select throws_ok($$select public.add_team_member(pg_temp.id('ta'), 'x@club.fr')$$, 'P0001', 'not_allowed', 'A retiré ne peut plus inviter');
select tests.as_coach(pg_temp.id('f'));
select lives_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('f'))$$, 'F quitte TA de lui-même');
select is((select count(*) from public.teams)::int, 0, 'F ne voit plus TA');
select tests.as_coach(pg_temp.id('c'));
select lives_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('d'))$$, 'C retire D');
select lives_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('g'))$$, 'C retire G');
select lives_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('b'))$$, 'retirer un non-membre : sans effet');
select is((select count(*) from public.team_members where team_id = pg_temp.id('ta'))::int, 1, 'C est seul dans TA');
select throws_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('c'))$$, 'P0001', 'last_member', 'le dernier membre ne peut pas partir');
select is((select count(*) from public.sessions where team_id = pg_temp.id('ta'))::int, 1, 'C voit toujours la séance de TA');
select lives_ok($$select public.delete_team(pg_temp.id('ta'))$$, 'le dernier membre supprime l’espace');
reset role;
select is((select count(*) from public.sessions where team_id = pg_temp.id('ta'))::int, 0, 'données de TA supprimées en cascade');
select is((select (select count(*) from public.teams where id = pg_temp.id('ta'))
                + (select count(*) from public.swimmers where team_id = pg_temp.id('ta'))
                + (select count(*) from public.team_members where team_id = pg_temp.id('ta'))
                + (select count(*) from public.team_invites where team_id = pg_temp.id('ta')))::int,
          0, 'espace, nageurs, membres et invitations de TA supprimés');
select is((select count(*) from public.teams where id = pg_temp.id('tb'))::int, 1, 'TB intacte');

select * from finish();
rollback;
