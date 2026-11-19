-- Tests d'isolation entre espaces d'équipe (RLS, droits, clés composites).
-- A et C activés, membres de TA ; B activé, membre de TB ; E non activé mais inscrit
-- dans team_members de TA ; D (à la fin) activé, membre de TA et de TB.
-- Les UUID sont rangés dans la table temporaire ids et lus avec pg_temp.id('clé').
-- Chaque assertion pgTAP commence en début de ligne par « select » (voir docs/db-tests.md).
begin;
create extension if not exists pgtap with schema extensions;
-- helpers:include
select plan(141);

create temp table ids (k text primary key, v uuid not null);
grant select on ids to public;
create function pg_temp.id(p_k text) returns uuid
  language sql stable as $fn$ select v from pg_temp.ids where k = p_k $fn$;

-- ---------------------------------------------------------------- mise en place (postgres)
insert into ids values
  ('a', tests.create_coach('coach.a@example.test', true)),
  ('b', tests.create_coach('coach.b@example.test', true)),
  ('c', tests.create_coach('Coach.C@Example.TEST', true)),
  ('e', tests.create_coach('coach.e@example.test', false));
insert into ids values
  ('ta', tests.create_team('TA', array[pg_temp.id('a'), pg_temp.id('c'), pg_temp.id('e')])),
  ('tb', tests.create_team('TB', array[pg_temp.id('b')]));
insert into ids
  select k, gen_random_uuid()
  from unnest(array['ga', 'gb', 'gc', 'sa1', 'sa2', 'sa3', 'sb1', 'sc1',
                    'sea', 'seb', 'sec', 'pea', 'pec', 'pfa', 'pfc']) as k;

insert into public.groups (id, team_id, name) values
  (pg_temp.id('ga'), pg_temp.id('ta'), 'Benjamins'),
  (pg_temp.id('gb'), pg_temp.id('tb'), 'Poussins');
insert into public.swimmers (id, team_id, firstname, lastname, group_id, joined_season) values
  (pg_temp.id('sa1'), pg_temp.id('ta'), 'Léa', 'Martin', pg_temp.id('ga'), 2025),
  (pg_temp.id('sa2'), pg_temp.id('ta'), 'Tom', 'Durand', pg_temp.id('ga'), 2026),
  (pg_temp.id('sa3'), pg_temp.id('ta'), 'Inès', 'Roux', null, 2026),
  (pg_temp.id('sb1'), pg_temp.id('tb'), 'Zoé', 'Petit', pg_temp.id('gb'), 2026);
insert into public.sessions (id, team_id, date, type) values
  (pg_temp.id('sea'), pg_temp.id('ta'), '2026-11-18', 'nat'),
  (pg_temp.id('seb'), pg_temp.id('tb'), '2026-11-18', 'nat');
insert into public.presence (team_id, session_id, swimmer_id) values
  (pg_temp.id('ta'), pg_temp.id('sea'), pg_temp.id('sa1')),
  (pg_temp.id('ta'), pg_temp.id('sea'), pg_temp.id('sa2'));
insert into public.plan_weeks (team_id, week_key, season_start) values
  (pg_temp.id('ta'), '2026-W47', 2026);
insert into public.plan_events (id, team_id, month_key, type) values
  (pg_temp.id('pea'), pg_temp.id('ta'), '2026-11', 'comp');
insert into public.performances (id, team_id, swimmer_id, competition_id, event_code, time_ms) values
  (pg_temp.id('pfa'), pg_temp.id('ta'), pg_temp.id('sa1'), '90001', '51', 35120);
insert into public.team_invites (team_id, email, invited_by) values
  (pg_temp.id('ta'), 'invite@example.test', pg_temp.id('a'));

-- ---------------------------------------------------------------- structure (12)
select is((select count(*) from public.coaches)::int, 4, 'le trigger crée une ligne coaches par compte');
select is((select email from public.coaches where id = pg_temp.id('c')), 'coach.c@example.test', 'e-mail recopié en minuscules');
select ok((select activated_at is null from public.coaches where id = pg_temp.id('e')), 'un nouveau compte est inactif');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
           and tablename in ('swimmers', 'sessions', 'presence', 'plan_weeks', 'plan_events', 'groups', 'performances', 'team_members'))::int,
          8, 'publication temps réel : 8 tables');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)::int, 0, 'RLS activée sur toutes les tables de public');
select is((select count(*) from pg_policies where schemaname = 'public')::int, 34, '34 politiques (7 x 4 + 6)');
select is((select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public')::int, 0, 'anon n’a aucun droit sur public');
select is((select count(*) from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public'
           and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))::int, 0, 'authenticated : ni TRUNCATE, ni REFERENCES, ni TRIGGER');
select ok(not has_function_privilege('anon', 'private.is_team_member(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.is_active_coach()', 'execute'), 'anon ne peut pas exécuter les fonctions private');
select ok(has_function_privilege('authenticated', 'private.is_team_member(uuid)', 'execute')
          and has_function_privilege('authenticated', 'private.is_active_coach()', 'execute'), 'authenticated exécute les deux fonctions d’appartenance');
select ok(not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute')
          and not has_function_privilege('authenticated', 'private.set_updated_at()', 'execute'), 'les fonctions de trigger ne sont pas exécutables par les clients');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon n’a pas accès au schéma private');

-- ---------------------------------------------------------------- B, non-membre de TA (51)
select tests.as_coach(pg_temp.id('b'));
select is(private.is_team_member(pg_temp.id('ta')), false, 'B n’est pas membre de TA');
select is((select count(*) from public.swimmers where team_id = pg_temp.id('tb'))::int, 1, 'B lit les nageurs de son espace TB');
-- lecture
select is((select count(*) from public.swimmers where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les nageurs de TA');
select is((select count(*) from public.groups where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les groupes de TA');
select is((select count(*) from public.sessions where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les séances de TA');
select is((select count(*) from public.presence where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les présences de TA');
select is((select count(*) from public.plan_weeks where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas le planning de TA');
select is((select count(*) from public.plan_events where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les événements de TA');
select is((select count(*) from public.performances where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les perfs de TA');
select is((select count(*) from public.teams where id = pg_temp.id('ta'))::int, 0, 'B ne lit pas l’espace TA');
select is((select count(*) from public.team_members where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les membres de TA');
select is((select count(*) from public.team_invites where team_id = pg_temp.id('ta'))::int, 0, 'B ne lit pas les invitations de TA');
select is((select count(*) from public.coaches)::int, 1, 'B ne voit que sa propre ligne coaches');
-- insertion
select throws_ok($$insert into public.swimmers(id,team_id,firstname,joined_season) values (gen_random_uuid(), pg_temp.id('ta'), 'x', 2026)$$, '42501', null, 'B ne peut pas écrire dans TA');
select throws_ok($$insert into public.groups(id,team_id,name) values (gen_random_uuid(), pg_temp.id('ta'), 'x')$$, '42501', null, 'B ne crée pas de groupe dans TA');
select throws_ok($$insert into public.sessions(id,team_id,date,type) values (gen_random_uuid(), pg_temp.id('ta'), '2026-11-19', 'nat')$$, '42501', null, 'B ne crée pas de séance dans TA');
select throws_ok($$insert into public.presence(team_id,session_id,swimmer_id) values (pg_temp.id('ta'), pg_temp.id('sea'), pg_temp.id('sa3'))$$, '42501', null, 'B ne pointe pas de présence dans TA');
select throws_ok($$insert into public.plan_weeks(team_id,week_key,season_start) values (pg_temp.id('ta'), '2026-W48', 2026)$$, '42501', null, 'B n’écrit pas le planning de TA');
select throws_ok($$insert into public.plan_events(id,team_id,month_key,type) values (gen_random_uuid(), pg_temp.id('ta'), '2026-12', 'stage')$$, '42501', null, 'B ne crée pas d’événement dans TA');
select throws_ok($$insert into public.performances(id,team_id,swimmer_id,competition_id,event_code) values (gen_random_uuid(), pg_temp.id('ta'), pg_temp.id('sa1'), '90002', '52')$$, '42501', null, 'B ne crée pas de perf dans TA');
select throws_ok($$insert into public.teams(name) values ('pirate')$$, '42501', null, 'B ne crée pas d’espace en direct');
select throws_ok($$insert into public.team_members(team_id, coach_id) values (pg_temp.id('ta'), pg_temp.id('b'))$$, '42501', null, 'B ne s’ajoute pas lui-même à TA');
select throws_ok($$insert into public.team_invites(team_id, email) values (pg_temp.id('ta'), 'pirate@example.test')$$, '42501', null, 'B n’invite personne dans TA');
select throws_ok($$insert into public.coaches(id, email) values (gen_random_uuid(), 'pirate@example.test')$$, '42501', null, 'pas d’insertion directe dans coaches');
-- modification
select is_empty($$update public.swimmers set firstname='pirate' where team_id=pg_temp.id('ta') returning 1$$, 'B ne modifie rien dans TA');
select is_empty($$update public.groups set name='pirate' where team_id=pg_temp.id('ta') returning 1$$, 'B ne modifie pas les groupes de TA');
select is_empty($$update public.sessions set title='pirate' where team_id=pg_temp.id('ta') returning 1$$, 'B ne modifie pas les séances de TA');
select is_empty($$update public.presence set updated_at=now() where team_id=pg_temp.id('ta') returning 1$$, 'B ne modifie pas les présences de TA');
select is_empty($$update public.plan_weeks set content='pirate' where team_id=pg_temp.id('ta') returning 1$$, 'B ne modifie pas le planning de TA');
select is_empty($$update public.plan_events set title='pirate' where team_id=pg_temp.id('ta') returning 1$$, 'B ne modifie pas les événements de TA');
select is_empty($$update public.performances set status='pirate' where team_id=pg_temp.id('ta') returning 1$$, 'B ne modifie pas les perfs de TA');
select is_empty($$update public.teams set name='pirate' where id=pg_temp.id('ta') returning 1$$, 'B ne renomme pas TA');
select is_empty($$update public.coaches set display_name='pirate' where id=pg_temp.id('a') returning 1$$, 'B ne renomme pas A');
select throws_ok($$update public.coaches set activated_at=now() where id=pg_temp.id('b')$$, '42501', null, 'activated_at non modifiable');
select throws_ok($$update public.team_members set added_by=pg_temp.id('b') where team_id=pg_temp.id('ta')$$, '42501', null, 'B ne modifie pas les membres de TA');
select throws_ok($$update public.swimmers set team_id=pg_temp.id('ta') where team_id=pg_temp.id('tb')$$, '42501', null, 'B ne déplace pas une ligne vers TA');
-- suppression
select is_empty($$delete from public.sessions where team_id=pg_temp.id('ta') returning 1$$, 'B ne supprime rien dans TA');
select is_empty($$delete from public.swimmers where team_id=pg_temp.id('ta') returning 1$$, 'B ne supprime pas les nageurs de TA');
select is_empty($$delete from public.groups where team_id=pg_temp.id('ta') returning 1$$, 'B ne supprime pas les groupes de TA');
select is_empty($$delete from public.presence where team_id=pg_temp.id('ta') returning 1$$, 'B ne supprime pas les présences de TA');
select is_empty($$delete from public.plan_weeks where team_id=pg_temp.id('ta') returning 1$$, 'B ne supprime pas le planning de TA');
select is_empty($$delete from public.plan_events where team_id=pg_temp.id('ta') returning 1$$, 'B ne supprime pas les événements de TA');
select is_empty($$delete from public.performances where team_id=pg_temp.id('ta') returning 1$$, 'B ne supprime pas les perfs de TA');
select throws_ok($$delete from public.teams where id=pg_temp.id('ta')$$, '42501', null, 'B ne supprime pas TA');
select throws_ok($$delete from public.team_members where team_id=pg_temp.id('ta')$$, '42501', null, 'B ne retire personne de TA');
select throws_ok($$delete from public.team_invites where team_id=pg_temp.id('ta')$$, '42501', null, 'B n’annule pas les invitations de TA');
select throws_ok($$delete from public.coaches where id=pg_temp.id('b')$$, '42501', null, 'pas de suppression directe dans coaches');
select throws_ok($$truncate public.swimmers$$, '42501', null, 'B ne vide pas une table (TRUNCATE contourne la RLS)');
-- clés composites : une ligne de TB ne peut pas viser une ligne de TA
select throws_ok($$insert into public.presence(team_id, session_id, swimmer_id) values (pg_temp.id('tb'), pg_temp.id('sea'), pg_temp.id('sb1'))$$, '23503', null, 'pas de présence de TB sur une séance de TA');
select throws_ok($$insert into public.performances(id,team_id,swimmer_id,competition_id,event_code) values (gen_random_uuid(),pg_temp.id('tb'),pg_temp.id('sa1'),'1','1')$$, '23503', null, 'pas de perf de TB sur un nageur de TA');
select throws_ok($$insert into public.swimmers(id,team_id,firstname,group_id,joined_season) values (gen_random_uuid(),pg_temp.id('tb'),'x',pg_temp.id('ga'),2026)$$, '23503', null, 'pas de nageur de TB dans un groupe de TA');

-- ---------------------------------------------------------------- contrôle : TA intacte (postgres) (2)
reset role;
select is((select (select count(*) from public.groups where team_id = pg_temp.id('ta'))
                + (select count(*) from public.swimmers where team_id = pg_temp.id('ta'))
                + (select count(*) from public.sessions where team_id = pg_temp.id('ta'))
                + (select count(*) from public.presence where team_id = pg_temp.id('ta'))
                + (select count(*) from public.plan_weeks where team_id = pg_temp.id('ta'))
                + (select count(*) from public.plan_events where team_id = pg_temp.id('ta'))
                + (select count(*) from public.performances where team_id = pg_temp.id('ta'))
                + (select count(*) from public.team_members where team_id = pg_temp.id('ta'))
                + (select count(*) from public.team_invites where team_id = pg_temp.id('ta')))::int,
          14, 'après B, TA a toujours ses 14 lignes');
select is((select (select count(*) from public.swimmers where firstname = 'pirate')
                + (select count(*) from public.teams where name = 'pirate')
                + (select count(*) from public.coaches where display_name = 'pirate')
                + (select count(*) from public.coaches where activated_at is not null))::int,
          3, 'après B, rien n’est renommé et seuls A, B, C sont activés');

-- ---------------------------------------------------------------- E, inscrit dans TA mais non activé (14)
select tests.as_coach(pg_temp.id('e'));
select is(private.is_active_coach(), false, 'E n’est pas activé');
select is((select count(*) from public.swimmers)::int, 0, 'E non activé ne voit rien, même membre');
select is((select count(*) from public.groups)::int, 0, 'E ne voit pas les groupes');
select is((select count(*) from public.sessions)::int, 0, 'E ne voit pas les séances');
select is((select count(*) from public.presence)::int, 0, 'E ne voit pas les présences');
select is((select count(*) from public.plan_weeks)::int, 0, 'E ne voit pas le planning');
select is((select count(*) from public.plan_events)::int, 0, 'E ne voit pas les événements');
select is((select count(*) from public.performances)::int, 0, 'E ne voit pas les perfs');
select is((select count(*) from public.teams)::int, 0, 'E ne voit pas son espace');
select is((select count(*) from public.team_members)::int, 0, 'E ne voit pas les membres');
select is((select count(*) from public.coaches)::int, 1, 'E voit sa propre ligne coaches (pour connaître son état)');
select throws_ok($$insert into public.swimmers(id,team_id,firstname,joined_season) values (gen_random_uuid(), pg_temp.id('ta'), 'x', 2026)$$, '42501', null, 'E n’écrit pas dans TA');
select is_empty($$update public.swimmers set firstname='pirate' where team_id=pg_temp.id('ta') returning 1$$, 'E ne modifie rien dans TA');
select is_empty($$delete from public.sessions where team_id=pg_temp.id('ta') returning 1$$, 'E ne supprime rien dans TA');

-- ---------------------------------------------------------------- C, membre activé de TA (54)
select tests.as_coach(pg_temp.id('c'));
select is(private.is_team_member(pg_temp.id('ta')), true, 'C est membre de TA');
-- lecture
select is((select count(*) from public.swimmers where team_id=pg_temp.id('ta'))::int, 3, 'C (membre de TA) lit les nageurs créés par A');
select is((select count(*) from public.groups where team_id=pg_temp.id('ta'))::int, 1, 'C lit les groupes de TA');
select is((select count(*) from public.sessions where team_id=pg_temp.id('ta'))::int, 1, 'C lit les séances de TA');
select is((select count(*) from public.presence where team_id=pg_temp.id('ta'))::int, 2, 'C lit les présences de TA');
select is((select count(*) from public.plan_weeks where team_id=pg_temp.id('ta'))::int, 1, 'C lit le planning de TA');
select is((select count(*) from public.plan_events where team_id=pg_temp.id('ta'))::int, 1, 'C lit les événements de TA');
select is((select count(*) from public.performances where team_id=pg_temp.id('ta'))::int, 1, 'C lit les perfs de TA');
select is((select count(*) from public.teams)::int, 1, 'C lit son espace TA, pas TB');
select is((select count(*) from public.team_members)::int, 3, 'C lit les membres de TA');
select is((select count(*) from public.team_invites)::int, 1, 'C lit les invitations de TA');
select is((select count(*) from public.coaches)::int, 2, 'C voit A et lui-même, pas B');
select is((select count(*) from public.swimmers where team_id=pg_temp.id('tb'))::int, 0, 'C ne lit pas les nageurs de TB');
-- insertion
select lives_ok($$insert into public.groups(id,team_id,name) values (pg_temp.id('gc'), pg_temp.id('ta'), 'Minimes')$$, 'C crée un groupe dans TA');
select lives_ok($$insert into public.swimmers(id,team_id,firstname,group_id,joined_season) values (pg_temp.id('sc1'), pg_temp.id('ta'), 'Noé', pg_temp.id('gc'), 2026)$$, 'C crée un nageur dans TA');
select lives_ok($$insert into public.sessions(id,team_id,date,type) values (pg_temp.id('sec'), pg_temp.id('ta'), '2026-11-20', 'musc')$$, 'C crée une séance dans TA');
select lives_ok($$insert into public.presence(team_id,session_id,swimmer_id) values (pg_temp.id('ta'), pg_temp.id('sea'), pg_temp.id('sa3'))$$, 'C pointe une présence dans TA');
select lives_ok($$insert into public.plan_weeks(team_id,week_key,season_start) values (pg_temp.id('ta'), '2026-W48', 2026)$$, 'C écrit le planning de TA');
select lives_ok($$insert into public.plan_events(id,team_id,month_key,type) values (pg_temp.id('pec'), pg_temp.id('ta'), '2026-12', 'stage')$$, 'C crée un événement dans TA');
select lives_ok($$insert into public.performances(id,team_id,swimmer_id,competition_id,event_code) values (pg_temp.id('pfc'), pg_temp.id('ta'), pg_temp.id('sc1'), '90002', '52')$$, 'C crée une perf dans TA');
select throws_ok($$insert into public.presence(team_id,session_id,swimmer_id) values (pg_temp.id('ta'), pg_temp.id('sea'), pg_temp.id('sb1'))$$, '23503', null, 'C ne pointe pas un nageur de TB sur une séance de TA');
select throws_ok($$insert into public.swimmers(id,team_id,firstname,group_id,joined_season) values (gen_random_uuid(), pg_temp.id('ta'), 'x', pg_temp.id('gb'), 2026)$$, '23503', null, 'C ne range pas un nageur de TA dans un groupe de TB');
select throws_ok($$insert into public.swimmers(id,team_id,firstname,joined_season) values (gen_random_uuid(), pg_temp.id('tb'), 'x', 2026)$$, '42501', null, 'C n’écrit pas dans TB');
select throws_ok($$insert into public.teams(name) values ('Nouvel espace')$$, '42501', null, 'C ne crée pas d’espace en direct');
select throws_ok($$insert into public.team_members(team_id, coach_id) values (pg_temp.id('tb'), pg_temp.id('c'))$$, '42501', null, 'C ne s’ajoute pas à TB');
select throws_ok($$insert into public.team_invites(team_id, email) values (pg_temp.id('ta'), 'nouveau@example.test')$$, '42501', null, 'pas d’invitation en direct (fonctions de la tâche 4 bis)');
-- modification
select lives_ok($$update public.swimmers set phone='0600000000' where team_id=pg_temp.id('ta')$$, 'C modifie les nageurs de TA');
select is((select count(*) from public.swimmers where team_id=pg_temp.id('ta') and phone='0600000000')::int, 4, 'les 4 nageurs de TA ont le nouveau téléphone');
select is((select updated_by from public.swimmers where id=pg_temp.id('sa1')), pg_temp.id('c'), 'updated_by = dernier membre qui a modifié');
select isnt_empty($$update public.swimmers set updated_at='2000-01-01' where id=pg_temp.id('sa2') returning 1$$, 'C envoie une date de modification ancienne');
select is((select updated_at from public.swimmers where id=pg_temp.id('sa2')), now(), 'updated_at ne recule jamais');
select isnt_empty($$update public.groups set name='Benjamins 1' where id=pg_temp.id('ga') returning 1$$, 'C modifie un groupe de TA');
select isnt_empty($$update public.sessions set title='Aérobie' where team_id=pg_temp.id('ta') returning 1$$, 'C modifie les séances de TA');
select isnt_empty($$update public.presence set updated_at=now() where team_id=pg_temp.id('ta') returning 1$$, 'C modifie les présences de TA');
select isnt_empty($$update public.plan_weeks set content='Fond', km_target=30 where team_id=pg_temp.id('ta') returning 1$$, 'C modifie le planning de TA');
select isnt_empty($$update public.plan_events set title='Interclubs' where team_id=pg_temp.id('ta') returning 1$$, 'C modifie les événements de TA');
select isnt_empty($$update public.performances set rank=1 where team_id=pg_temp.id('ta') returning 1$$, 'C modifie les perfs de TA');
select isnt_empty($$update public.teams set name='Pôle Formation 1' where id=pg_temp.id('ta') returning 1$$, 'C renomme TA');
select throws_ok($$update public.teams set name='  ' where id=pg_temp.id('ta')$$, '23514', null, 'nom d’espace vide refusé');
select throws_ok($$update public.teams set created_by=pg_temp.id('c') where id=pg_temp.id('ta')$$, '42501', null, 'seul le nom de l’espace est modifiable');
select throws_ok($$update public.swimmers set team_id=pg_temp.id('tb') where id=pg_temp.id('sa1')$$, '42501', null, 'C ne déplace pas un nageur vers TB');
select lives_ok($$update public.coaches set display_name='Coach C' where id=pg_temp.id('c')$$, 'C modifie son nom affiché');
select is((select display_name from public.coaches where id=pg_temp.id('c')), 'Coach C', 'le nom affiché de C est enregistré');
select is_empty($$update public.coaches set display_name='pirate' where id=pg_temp.id('a') returning 1$$, 'C ne renomme pas A');
select throws_ok($$update public.coaches set activated_at=null where id=pg_temp.id('c')$$, '42501', null, 'C ne touche pas à son activated_at');
-- suppression
select isnt_empty($$delete from public.performances where id=pg_temp.id('pfc') returning 1$$, 'C supprime une perf de TA');
select isnt_empty($$delete from public.presence where session_id=pg_temp.id('sea') and swimmer_id=pg_temp.id('sa3') returning 1$$, 'C supprime une présence de TA');
select isnt_empty($$delete from public.plan_events where id=pg_temp.id('pec') returning 1$$, 'C supprime un événement de TA');
select isnt_empty($$delete from public.plan_weeks where team_id=pg_temp.id('ta') and week_key='2026-W48' returning 1$$, 'C supprime une semaine de TA');
select isnt_empty($$delete from public.sessions where id=pg_temp.id('sec') returning 1$$, 'C supprime une séance de TA');
select isnt_empty($$delete from public.swimmers where id=pg_temp.id('sc1') returning 1$$, 'C supprime un nageur de TA');
select isnt_empty($$delete from public.groups where id=pg_temp.id('gc') returning 1$$, 'C supprime un groupe de TA');
select throws_ok($$delete from public.teams where id=pg_temp.id('ta')$$, '42501', null, 'C ne supprime pas TA en direct');
select throws_ok($$delete from public.team_members where team_id=pg_temp.id('ta') and coach_id=pg_temp.id('c')$$, '42501', null, 'C ne quitte pas TA en direct');
select throws_ok($$delete from public.team_invites where team_id=pg_temp.id('ta')$$, '42501', null, 'C n’annule pas une invitation en direct');
select is((select count(*) from public.swimmers where team_id=pg_temp.id('ta'))::int, 3, 'TA revient à 3 nageurs');

-- ---------------------------------------------------------------- D, membre de TA et de TB : trigger forbid_team_change (3)
reset role;
insert into ids values ('d', tests.create_coach('coach.d@example.test', true));
insert into public.team_members (team_id, coach_id) values (pg_temp.id('ta'), pg_temp.id('d')), (pg_temp.id('tb'), pg_temp.id('d'));
select tests.as_coach(pg_temp.id('d'));
select is((select count(*) from public.teams)::int, 2, 'D voit ses deux espaces');
select throws_ok($$update public.swimmers set team_id=pg_temp.id('tb') where id=pg_temp.id('sa1')$$, '42501', 'team_id ne peut pas changer', 'D ne déplace pas un nageur de TA vers TB');
select throws_ok($$update public.plan_weeks set team_id=pg_temp.id('tb') where team_id=pg_temp.id('ta')$$, '42501', 'team_id ne peut pas changer', 'D ne déplace pas une semaine de TA vers TB');

-- ---------------------------------------------------------------- anon (3)
reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select count(*) from public.sessions$$, '42501', null, 'anon ne voit rien');
select throws_ok($$select count(*) from public.coaches$$, '42501', null, 'anon ne lit pas les entraîneurs');
select throws_ok($$select private.is_team_member(pg_temp.id('ta'))$$, '42501', null, 'anon n’appelle pas les fonctions private');

select * from finish();
rollback;
