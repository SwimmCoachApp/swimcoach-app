-- Stockage privé des photos (tâche 5) : bucket photos, chemins <team_id>/swimmers/<uuid>.jpg
-- et <team_id>/sessions/<uuid>.jpg, politiques sur storage.objects.
-- Noms stricts (migration storage_strict_names) : dépôt et remplacement exigent des UUID en
-- minuscules, un sous-dossier swimmers ou sessions et l'extension .jpg.
-- A, C activés, membres de TA ; E non activé mais inscrit dans TA ; B activé, seul dans TB.
-- On insère directement dans storage.objects (bucket_id, name, owner), comme le ferait
-- l'API Storage avec le jeton de l'utilisateur.
-- Suppression : storage.objects a un déclencheur (protect_objects_delete) qui refuse toute
-- requête DELETE directe sauf si storage.allow_delete_query = 'true'. Ce réglage n'est
-- qu'un garde-fou contre les fausses manœuvres (n'importe quel rôle peut le poser) : on le
-- pose dans la transaction pour que la politique DELETE soit réellement évaluée.
-- Chaque assertion pgTAP commence en début de ligne par « select » (voir docs/db-tests.md).
begin;
create extension if not exists pgtap with schema extensions;
-- helpers:include
select plan(41);

create temp table ids (k text primary key, v uuid not null);
grant select on ids to public;
create function pg_temp.id(p_k text) returns uuid
  language sql stable as $fn$ select v from pg_temp.ids where k = p_k $fn$;
create function pg_temp.p(p_k text, p_rest text) returns text
  language sql stable as $fn$ select pg_temp.id(p_k)::text || p_rest $fn$;
-- Nom conforme : <espace>/<sous-dossier>/<uuid du fichier>.jpg
create function pg_temp.ph(p_team text, p_sub text, p_file text) returns text
  language sql stable as $fn$ select pg_temp.id(p_team)::text || '/' || p_sub || '/' || pg_temp.id(p_file)::text || '.jpg' $fn$;

-- ---------------------------------------------------------------- mise en place (postgres)
insert into ids values
  ('a', tests.create_coach('coach.a@club.fr', true)),
  ('b', tests.create_coach('coach.b@club.fr', true)),
  ('c', tests.create_coach('coach.c@club.fr', true)),
  ('e', tests.create_coach('coach.e@club.fr', false));
insert into ids values
  ('ta', tests.create_team('TA', array[pg_temp.id('a'), pg_temp.id('c'), pg_temp.id('e')])),
  ('tb', tests.create_team('TB', array[pg_temp.id('b')]));
insert into ids select k, gen_random_uuid() from unnest(array['fx','fs','fb','fp','fe','fa','fc','f1']) k;
set local storage.allow_delete_query = 'true';

-- ---------------------------------------------------------------- structure (8)
select is((select public from storage.buckets where id = 'photos'), false, 'bucket photos privé');
select is((select file_size_limit from storage.buckets where id = 'photos'), 2097152::bigint, 'taille maximale 2 Mo');
select is((select allowed_mime_types from storage.buckets where id = 'photos'), '{image/jpeg}'::text[], 'type accepté : jpeg seulement (noms en .jpg)');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'photos\_%' and roles = '{authenticated}')::int, 4, '4 politiques photos, pour authenticated seulement');
select is(private.team_from_path(pg_temp.ph('ta', 'swimmers', 'fx')), pg_temp.id('ta'), 'team_from_path : premier dossier = espace');
select is(private.team_from_path('pasunuuid/x.jpg'), null, 'team_from_path : dossier non UUID → null, sans erreur');
select is(private.team_from_path('x.jpg'), null, 'team_from_path : pas de dossier → null');
select ok(not has_function_privilege('anon', 'private.team_from_path(text)', 'execute')
          and has_function_privilege('authenticated', 'private.team_from_path(text)', 'execute'), 'team_from_path : authenticated seulement');

-- ---------------------------------------------------------------- A dépose dans TA (2)
select tests.as_coach(pg_temp.id('a'));
select lives_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('ta', 'swimmers', 'fx'), pg_temp.id('a'))$$, 'A dépose TA/swimmers/<uuid>.jpg (nom valide accepté)');
select lives_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('ta', 'sessions', 'fs'), pg_temp.id('a'))$$, 'A dépose TA/sessions/<uuid>.jpg (nom valide accepté)');

-- ---------------------------------------------------------------- noms invalides (3)
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', 'pasunuuid/x.jpg', pg_temp.id('a'))$$, '42501', null, 'nom pasunuuid/x.jpg refusé par la politique (pas d’erreur de conversion)');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', 'x.jpg', pg_temp.id('a'))$$, '42501', null, 'fichier hors dossier d’espace refusé');

-- ---------------------------------------------------------------- noms stricts (9)
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', upper(pg_temp.id('ta')::text) || '/swimmers/' || pg_temp.id('f1') || '.jpg', pg_temp.id('a'))$$, '42501', null, 'dossier d’espace en majuscules refusé');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.id('ta') || '/swimmers/' || upper(pg_temp.id('f1')::text) || '.jpg', pg_temp.id('a'))$$, '42501', null, 'nom de fichier en majuscules refusé');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.p('ta', '/../x.jpg'), pg_temp.id('a'))$$, '42501', null, '<TA>/../x.jpg refusé');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('ta', 'other', 'f1'), pg_temp.id('a'))$$, '42501', null, '<TA>/other/<uuid>.jpg refusé');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.p('ta', '/swimmers/') || pg_temp.id('f1') || '.webp', pg_temp.id('a'))$$, '42501', null, 'extension .webp refusée');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.p('ta', '/sessions/') || pg_temp.id('f1') || '.png', pg_temp.id('a'))$$, '42501', null, 'extension .png refusée');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.p('ta', '/swimmers/x.jpg'), pg_temp.id('a'))$$, '42501', null, 'fichier non UUID (<TA>/swimmers/x.jpg) refusé');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('ta', 'swimmers', 'f1') || E'\n', pg_temp.id('a'))$$, '42501', null, 'nom valide suivi d’un saut de ligne refusé');
select throws_ok($$update storage.objects set name = pg_temp.p('ta', '/swimmers/x.jpg') where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx')$$, '42501', null, 'UPDATE vers un nom non conforme refusé');
reset role;
insert into ids select 'ox', id from storage.objects where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx');
insert into storage.objects (bucket_id, name, owner) values ('photos', 'pasunuuid/y.jpg', pg_temp.id('a'));
select tests.as_coach(pg_temp.id('a'));
select is((select count(*) from storage.objects where bucket_id = 'photos' and name like 'pasunuuid/%')::int, 0, 'objet au nom invalide : invisible, sans erreur SQL');

-- ---------------------------------------------------------------- C, membre de TA (4)
select tests.as_coach(pg_temp.id('c'));
select is((select count(*) from storage.objects where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx'))::int, 1, 'C lit la photo de TA');
select isnt_empty($$update storage.objects set metadata = '{"size": 1}' where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx') returning 1$$, 'C remplace la photo de TA');
select throws_ok($$update storage.objects set name = pg_temp.ph('tb', 'swimmers', 'fx') where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx')$$, '42501', null, 'C ne déplace pas une photo vers TB');
select isnt_empty($$delete from storage.objects where bucket_id = 'photos' and name = pg_temp.ph('ta', 'sessions', 'fs') returning 1$$, 'C supprime une photo de TA');

-- ---------------------------------------------------------------- B, non-membre de TA (8)
select tests.as_coach(pg_temp.id('b'));
select is((select count(*) from storage.objects where bucket_id = 'photos')::int, 0, 'B ne voit aucune photo de TA');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('ta', 'swimmers', 'fb'), pg_temp.id('b'))$$, '42501', null, 'B ne dépose pas sous TA/');
select throws_ok($$insert into storage.objects (id, bucket_id, name, owner) values (pg_temp.id('ox'), 'photos', pg_temp.ph('tb', 'swimmers', 'fp'), pg_temp.id('b')) on conflict (id) do update set metadata = '{"pirate": true}'$$, '42501', null, 'B ne remplace pas la photo de TA par upsert (on conflict do update)');
select is_empty($$update storage.objects set name = pg_temp.ph('tb', 'swimmers', 'fx') where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx') returning 1$$, 'B ne renomme pas la photo de TA');
select is_empty($$delete from storage.objects where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx') returning 1$$, 'B ne supprime pas la photo de TA');
select lives_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('tb', 'swimmers', 'fb'), pg_temp.id('b'))$$, 'B dépose dans son espace TB');
select is((select count(*) from storage.objects where bucket_id = 'photos')::int, 1, 'B ne voit que la photo de TB');
reset role;
select is((select metadata from storage.objects where bucket_id = 'photos' and name = pg_temp.ph('ta', 'swimmers', 'fx')), '{"size": 1}'::jsonb, 'contrôle postgres : la photo de TA est intacte, à sa place');

-- ---------------------------------------------------------------- E non activé, anon (4)
select tests.as_coach(pg_temp.id('e'));
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('ta', 'swimmers', 'fe'), pg_temp.id('e'))$$, '42501', null, 'E non activé ne dépose pas sous TA/');
select is((select count(*) from storage.objects where bucket_id = 'photos')::int, 0, 'E non activé ne voit aucune photo');
reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from storage.objects where bucket_id = 'photos')::int, 0, 'anon ne voit aucune photo');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('photos', pg_temp.ph('ta', 'swimmers', 'fa'))$$, '42501', null, 'anon ne dépose rien');
reset role;

-- ---------------------------------------------------------------- C retiré de TA (3)
select tests.as_coach(pg_temp.id('a'));
select lives_ok($$select public.remove_team_member(pg_temp.id('ta'), pg_temp.id('c'))$$, 'A retire C de TA');
select tests.as_coach(pg_temp.id('c'));
select is((select count(*) from storage.objects where bucket_id = 'photos')::int, 0, 'C retiré ne lit plus la photo de TA');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('photos', pg_temp.ph('ta', 'swimmers', 'fc'), pg_temp.id('c'))$$, '42501', null, 'C retiré ne dépose plus sous TA/');
reset role;

select * from finish();
rollback;
