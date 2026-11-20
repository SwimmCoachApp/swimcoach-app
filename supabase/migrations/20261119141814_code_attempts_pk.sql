-- Conseiller de performance : private.code_attempts sans clé primaire. On ajoute un
-- identifiant technique ; l'index (coach_id, attempted_at) reste celui des recherches.
alter table private.code_attempts
  add column id bigint generated always as identity primary key;
