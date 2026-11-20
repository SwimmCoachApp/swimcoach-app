-- Temps réel : plus de DELETE ni de team_members dans la publication.
-- Supabase Realtime n'applique pas la RLS aux DELETE : la clé primaire de l'ancienne ligne partait
-- vers tout abonné ayant SELECT sur la table (tout compte connecté), quel que soit l'espace.
-- Le client relit la table au prochain INSERT / UPDATE, au retour au premier plan et au retour du réseau.
alter publication supabase_realtime set (publish = 'insert, update');
alter publication supabase_realtime drop table public.team_members;
