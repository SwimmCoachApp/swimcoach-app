-- Stockage privé des photos (tâche 5).
-- Bucket photos, privé : jpeg ou webp, 2 Mo au plus.
-- Chemins : <team_id>/swimmers/<swimmer_id>.jpg et <team_id>/sessions/<session_id>.jpg.
-- Un membre activé d'un espace lit, dépose, remplace et supprime les fichiers rangés sous
-- le dossier de cet espace ; personne d'autre (ni anon, ni un autre entraîneur).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, '{image/jpeg,image/webp}')
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Espace d'un chemin : le premier dossier, s'il a la forme d'un UUID ; sinon null.
-- Garde : un nom comme « pasunuuid/x.jpg » donne null (politique fausse) et jamais une
-- erreur de conversion. Pas security definer : les politiques s'exécutent avec les
-- droits de l'appelant, d'où le droit d'exécution pour authenticated.
create or replace function private.team_from_path(name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(team_from_path.name))[1]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(team_from_path.name))[1])::uuid
  end;
$$;

revoke all on function private.team_from_path(text) from public, anon;
grant execute on function private.team_from_path(text) to authenticated;

create policy photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (select private.is_team_member(private.team_from_path(name))));

create policy photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (select private.is_team_member(private.team_from_path(name))));

create policy photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (select private.is_team_member(private.team_from_path(name))))
  with check (bucket_id = 'photos' and (select private.is_team_member(private.team_from_path(name))));

create policy photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (select private.is_team_member(private.team_from_path(name))));
