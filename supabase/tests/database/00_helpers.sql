-- Fonctions de test (schéma tests).
-- En CI (`supabase test db`), ce fichier passe en premier (ordre alphabétique) et
-- valide (commit) les fonctions dans la base locale jetable, pour les fichiers suivants.
-- Sur le projet hébergé, scripts/db-test-bundle.mjs n'en garde que la section
-- « helpers:start / helpers:end » et l'injecte dans la transaction du test, annulée
-- par le rollback final : rien ne reste.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- helpers:start
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Crée un compte auth (e-mail confirmé) ; le trigger on_auth_user_created crée la ligne coaches.
create or replace function tests.create_coach(p_email text, p_activated boolean)
returns uuid
language plpgsql
set search_path = ''
as $fn$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '', now(), '{}', '{}', now(), now());
  if p_activated then
    update public.coaches set activated_at = now() where id = uid;
  end if;
  return uid;
end
$fn$;

-- Crée un espace et ses membres, en insertion directe (rôle postgres).
create or replace function tests.create_team(p_name text, p_members uuid[])
returns uuid
language plpgsql
set search_path = ''
as $fn$
declare
  tid uuid;
begin
  insert into public.teams (name, created_by) values (p_name, p_members[1]) returning id into tid;
  insert into public.team_members (team_id, coach_id, added_by)
  select tid, m, p_members[1] from unnest(p_members) as m;
  return tid;
end
$fn$;

-- Joue la suite en tant qu'entraîneur connecté (rôle authenticated, claims JWT).
-- Pas de clause SET sur cette fonction : elle doit pouvoir changer de rôle.
create or replace function tests.as_coach(p_id uuid)
returns void
language plpgsql
as $fn$
begin
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end
$fn$;

revoke all on function tests.create_coach(text, boolean), tests.create_team(text, uuid[]) from public;
grant execute on function tests.as_coach(uuid) to anon, authenticated;
-- helpers:end

select has_function('tests', 'create_coach', array['text', 'boolean'], 'tests.create_coach existe');
select has_function('tests', 'create_team', array['text', 'uuid[]'], 'tests.create_team existe');
select has_function('tests', 'as_coach', array['uuid'], 'tests.as_coach existe');
select * from finish();
commit;
