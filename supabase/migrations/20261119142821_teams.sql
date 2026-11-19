-- Espaces d'équipe, membres et invitations en attente (tâche 4 bis).
-- Toutes les écritures sur teams (création, suppression), team_members et team_invites
-- passent par ces fonctions. Chaque RPC : security definer, search_path vide, exécutable
-- par authenticated seulement ; erreurs en SQLSTATE P0001 avec un message court
-- (not_allowed, invalid_name, invalid_email, too_many_invites, last_member).
-- Les groupes par défaut d'un nouvel espace sont créés par l'app (tâche front), pas ici.

-- ============================================================ journal des invitations
-- Sert à limiter add_team_member à 20 appels par heure et par appelant.
create table private.invite_log (
  id bigint generated always as identity primary key,
  coach_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index invite_log_coach_at_idx on private.invite_log (coach_id, at);
alter table private.invite_log enable row level security;
revoke all on table private.invite_log from public, anon, authenticated;

-- ============================================================ fonctions internes
-- L'appelant doit être membre activé de l'espace.
create function private.require_member(t uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if t is null or not private.is_team_member(t) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
end;
$$;

-- Nom d'espace sans espaces autour, 1 à 60 caractères (même règle que la contrainte).
create function private.clean_team_name(n text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(n);
begin
  if v is null or length(v) < 1 or length(v) > 60 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Transforme les invitations de l'appelant en adhésions. Seulement pour un compte
-- activé dont l'adresse est confirmée : une adresse non confirmée n'est jamais rattachée.
-- Renvoie le nombre d'espaces rejoints.
create or replace function private.claim_invites()
returns int
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text;
  n int;
begin
  if uid is null then
    return 0;
  end if;
  select lower(u.email) into v_email
  from auth.users u
  join public.coaches c on c.id = u.id
  where u.id = uid and u.email_confirmed_at is not null and c.activated_at is not null;
  if v_email is null or v_email = '' then
    return 0;
  end if;
  with claimed as (
    delete from public.team_invites i
    where i.email = v_email
    returning i.team_id, i.invited_by
  ), joined as (
    insert into public.team_members (team_id, coach_id, added_by)
    select cl.team_id, uid, cl.invited_by from claimed cl
    on conflict do nothing
    returning 1
  )
  select count(*)::int into n from joined;
  return n;
end;
$$;

revoke all on function private.require_member(uuid) from public, anon, authenticated;
revoke all on function private.clean_team_name(text) from public, anon, authenticated;
revoke all on function private.claim_invites() from public, anon, authenticated;

-- ============================================================ RPC
create function public.create_team(name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_name text;
  tid uuid;
begin
  if not private.is_active_coach() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  v_name := private.clean_team_name(create_team.name);
  insert into public.teams (name, created_by) values (v_name, uid) returning id into tid;
  insert into public.team_members (team_id, coach_id, added_by) values (tid, uid, uid);
  return tid;
end;
$$;

create function public.rename_team(team uuid, name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(rename_team.team);
  update public.teams t
  set name = private.clean_team_name(rename_team.name)
  where t.id = rename_team.team;
end;
$$;

-- 'added' : compte confirmé existant, ajouté ; 'already_member' ; 'invited' : invitation
-- créée ou gardée (pas de compte, ou adresse pas encore confirmée).
create function public.add_team_member(team uuid, email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text := lower(btrim(add_team_member.email));
  target uuid;
begin
  perform private.require_member(add_team_member.team);

  -- Verrou sur la ligne coaches de l'appelant : la limite tient aussi en cas d'appels
  -- simultanés. Un appel refusé (adresse invalide) est annulé avec son entrée du journal.
  perform 1 from public.coaches c where c.id = uid for update;
  if (select count(*) from private.invite_log l
      where l.coach_id = uid and l.at > now() - interval '1 hour') >= 20 then
    raise exception 'too_many_invites' using errcode = 'P0001';
  end if;
  insert into private.invite_log (coach_id) values (uid);

  if v_email is null or length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  select u.id into target
  from auth.users u
  where lower(u.email) = v_email and u.email_confirmed_at is not null
  order by u.created_at
  limit 1;

  if target is not null then
    if exists (select 1 from public.team_members m
               where m.team_id = add_team_member.team and m.coach_id = target) then
      return 'already_member';
    end if;
    insert into public.team_members (team_id, coach_id, added_by)
    values (add_team_member.team, target, uid)
    on conflict do nothing;
    delete from public.team_invites i
    where i.team_id = add_team_member.team and i.email = v_email;
    return 'added';
  end if;

  insert into public.team_invites (team_id, email, invited_by)
  values (add_team_member.team, v_email, uid)
  on conflict do nothing;
  return 'invited';
end;
$$;

create function public.cancel_invite(team uuid, email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(cancel_invite.team);
  delete from public.team_invites i
  where i.team_id = cancel_invite.team and i.email = lower(btrim(cancel_invite.email));
end;
$$;

-- N'importe quel membre retire n'importe quel membre, lui-même compris (départ).
-- Le dernier membre ne peut pas partir : il supprime l'espace (delete_team).
create function public.remove_team_member(team uuid, coach uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(remove_team_member.team);
  -- Verrou sur l'espace : deux départs simultanés ne laissent pas un espace vide.
  perform 1 from public.teams t where t.id = remove_team_member.team for update;
  if not exists (select 1 from public.team_members m
                 where m.team_id = remove_team_member.team and m.coach_id = remove_team_member.coach) then
    return;
  end if;
  if (select count(*) from public.team_members m where m.team_id = remove_team_member.team) <= 1 then
    raise exception 'last_member' using errcode = 'P0001';
  end if;
  delete from public.team_members m
  where m.team_id = remove_team_member.team and m.coach_id = remove_team_member.coach;
end;
$$;

-- Supprime l'espace et, en cascade, toutes ses données. Les photos (stockage
-- photos/<team>/) sont supprimées par l'app juste avant l'appel.
create function public.delete_team(team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(delete_team.team);
  delete from public.teams t where t.id = delete_team.team;
end;
$$;

-- Appelée par l'app à chaque connexion.
create function public.claim_my_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return private.claim_invites();
end;
$$;

revoke all on function public.create_team(text), public.rename_team(uuid, text),
  public.add_team_member(uuid, text), public.cancel_invite(uuid, text),
  public.remove_team_member(uuid, uuid), public.delete_team(uuid), public.claim_my_invites()
  from public, anon;
grant execute on function public.create_team(text), public.rename_team(uuid, text),
  public.add_team_member(uuid, text), public.cancel_invite(uuid, text),
  public.remove_team_member(uuid, uuid), public.delete_team(uuid), public.claim_my_invites()
  to authenticated;
