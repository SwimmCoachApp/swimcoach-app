-- Journal des e-mails d'invitation (migration invite_emails) : réservé à la clé serveur.
-- Chaque assertion pgTAP commence en début de ligne par « select » (voir docs/db-tests.md).
begin;
create extension if not exists pgtap with schema extensions;
-- helpers:include
select plan(6);

create temp table ids (k text primary key, v uuid);
grant select on ids to public;
create function pg_temp.id(p_k text) returns uuid
  language sql stable as $fn$ select v from pg_temp.ids where k = p_k $fn$;

insert into ids values ('a', tests.create_coach('coach.a@club.fr', true));
insert into ids values ('ta', tests.create_team('TA', array[pg_temp.id('a')]));
insert into public.invite_emails (team_id, email) values (pg_temp.id('ta'), 'n@club.fr');

select ok((select relrowsecurity from pg_class where oid = 'public.invite_emails'::regclass), 'RLS activée sur invite_emails');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'invite_emails'
           and grantee in ('anon', 'authenticated', 'PUBLIC'))::int, 0, 'aucun droit client sur invite_emails');
select throws_ok($$insert into public.invite_emails (team_id, email) values (pg_temp.id('ta'), ' N@Club.fr')$$, '23514', null, 'adresse non normalisée refusée');

select tests.as_coach(pg_temp.id('a'));
select throws_ok($$select * from public.invite_emails$$, '42501', null, 'un membre ne lit pas le journal');
reset role;

delete from public.teams where id = pg_temp.id('ta');
select is((select count(*) from public.invite_emails)::int, 0, 'journal effacé avec le groupe (cascade)');
select has_pk('public', 'invite_emails', 'clé primaire (team_id, email)');

select * from finish();
rollback;
