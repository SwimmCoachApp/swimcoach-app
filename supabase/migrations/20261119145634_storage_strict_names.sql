-- Noms stricts des photos (revue de la tâche 5).
-- Dépôt et remplacement : le nom doit être exactement
-- <uuid espace>/(swimmers|sessions)/<uuid>.jpg, UUID en minuscules.
-- Refuse les majuscules, « .. », les autres sous-dossiers et extensions (.webp, .png...).
-- Lecture et suppression inchangées (un ancien nom reste lisible et supprimable).

alter policy photos_insert on storage.objects
  with check (
    bucket_id = 'photos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(swimmers|sessions)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and (select private.is_team_member(private.team_from_path(name)))
  );

alter policy photos_update on storage.objects
  using (bucket_id = 'photos' and (select private.is_team_member(private.team_from_path(name))))
  with check (
    bucket_id = 'photos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(swimmers|sessions)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and (select private.is_team_member(private.team_from_path(name)))
  );
