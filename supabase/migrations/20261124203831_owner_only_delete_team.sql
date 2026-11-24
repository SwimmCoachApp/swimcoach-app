-- Seul le propriétaire du groupe peut le supprimer (garde-fou pour les invités).
--
-- Propriétaire = teams.created_by : le créateur de l'espace. Un client ne peut pas le modifier
-- (seule la colonne `name` est modifiable, voir isolation.test.sql).
--
-- 1. delete_team : refusée (not_owner) à un membre qui n'est pas le propriétaire.
-- 2. remove_team_member : le propriétaire ne peut être retiré que par lui-même (départ). Sans cela,
--    un invité retirerait le propriétaire puis supprimerait l'espace.
-- 3. Sans propriétaire membre de l'espace (il est parti, ou son compte a été supprimé : created_by
--    passe à null), le garde-fou ne s'applique plus : tout membre peut supprimer l'espace, qui ne
--    reste donc jamais bloqué.
-- Signatures et droits inchangés (authenticated seulement). Les autres actions restent ouvertes à
-- tous les membres : renommer, ajouter, annuler une invitation, retirer un invité.

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
  -- Le propriétaire part de lui-même ; personne d'autre ne peut le retirer.
  if remove_team_member.coach is distinct from (select auth.uid())
     and exists (select 1 from public.teams t
                 where t.id = remove_team_member.team and t.created_by = remove_team_member.coach) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if (select count(*) from public.team_members m where m.team_id = remove_team_member.team) <= 1 then
    raise exception 'last_member' using errcode = 'P0001';
  end if;
  delete from public.team_members m
  where m.team_id = remove_team_member.team and m.coach_id = remove_team_member.coach;
end;
$$;

-- Supprime l'espace et, en cascade, toutes ses données. Les photos (stockage photos/<team>/) sont
-- supprimées par l'app juste avant l'appel.
create or replace function public.delete_team(team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.teams t where t.id = delete_team.team for update;
  perform private.require_member(delete_team.team);
  -- Un propriétaire encore membre, autre que l'appelant : refus. Propriétaire parti ou compte supprimé
  -- (created_by nul) : aucun propriétaire membre, la jointure ne trouve rien et tout membre peut supprimer.
  if exists (select 1 from public.teams t
             join public.team_members o on o.team_id = t.id and o.coach_id = t.created_by
             where t.id = delete_team.team and t.created_by is distinct from (select auth.uid())) then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  delete from public.teams t where t.id = delete_team.team;
end;
$$;

revoke all on function public.remove_team_member(uuid, uuid), public.delete_team(uuid) from public, anon;
grant execute on function public.remove_team_member(uuid, uuid), public.delete_team(uuid) to authenticated;
