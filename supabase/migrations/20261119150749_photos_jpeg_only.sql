-- Bucket photos : jpeg seulement, en accord avec les noms <uuid>/(swimmers|sessions)/<uuid>.jpg
-- imposés par storage_strict_names. Non destructif : les objets existants ne changent pas.
update storage.buckets set allowed_mime_types = '{image/jpeg}' where id = 'photos';
