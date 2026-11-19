-- Durcissement des RPC d'espace (revue de la tâche 4 bis).
-- 1. rename_team, add_team_member, remove_team_member, delete_team prennent d'abord le
--    verrou « for update » sur la ligne teams, puis vérifient l'appartenance : un membre
--    qu'on est en train de retirer attend la fin du retrait, et la vérification qui suit
--    voit alors qu'il n'est plus membre.
-- 2. add_team_member n'ajoute directement qu'un compte ni supprimé ni SSO.
-- Signatures, comportements et droits inchangés par ailleurs.

create or replace function public.rename_team(team uuid, name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.teams t where t.id = rename_team.team for update;
  perform private.require_member(rename_team.team);
  update public.teams t
  set name = private.clean_team_name(rename_team.name)
  where t.id = rename_team.team;
end;
$$;

-- 'added' : compte confirmé existant (ni supprimé ni SSO), ajouté ; 'already_member' ;
-- 'invited' : invitation créée ou gardée (pas de compte, ou adresse pas encore confirmée).
create or replace function public.add_team_member(team uuid, email text)
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
  perform 1 from public.teams t where t.id = add_team_member.team for update;
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
    and u.deleted_at is null and not u.is_sso_user
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

-- N'importe quel membre retire n'importe quel membre, lui-même compris (départ).
-- Le dernier membre ne peut pas partir : il supprime l'espace (delete_team).
create or replace function public.remove_team_member(team uuid, coach uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Verrou sur l'espace : deux départs simultanés ne laissent pas un espace vide.
  perform 1 from public.teams t where t.id = remove_team_member.team for update;
  perform private.require_member(remove_team_member.team);
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
create or replace function public.delete_team(team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.teams t where t.id = delete_team.team for update;
  perform private.require_member(delete_team.team);
  delete from public.teams t where t.id = delete_team.team;
end;
$$;

revoke all on function public.rename_team(uuid, text), public.add_team_member(uuid, text),
  public.remove_team_member(uuid, uuid), public.delete_team(uuid)
  from public, anon;
grant execute on function public.rename_team(uuid, text), public.add_team_member(uuid, text),
  public.remove_team_member(uuid, uuid), public.delete_team(uuid)
  to authenticated;
