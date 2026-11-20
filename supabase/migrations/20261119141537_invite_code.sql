-- Activation des comptes par le code du club (tâche 4).
-- Un compte qui vient de s'inscrire existe mais reste inactif (coaches.activated_at null)
-- tant qu'il n'a pas donné le code du club. Le code est stocké haché (bcrypt) ; Damien le
-- pose dans l'éditeur SQL : select private.set_invite_code('LE-CODE');
-- Le « Before User Created hook » n'est pas retenu : il bloquerait la création du compte.

-- ============================================================ droits par défaut (schéma private)
-- Intention : aucune nouvelle fonction de private exécutable par PUBLIC. Attention : un
-- droit par défaut accordé globalement (EXECUTE à PUBLIC pour les fonctions) ne peut pas
-- être retiré schéma par schéma ; cette ligne ne change donc rien à elle seule. La vraie
-- garantie : chaque fonction de private fait son propre « revoke ... from public », et
-- isolation.test.sql vérifie qu'aucune fonction de private n'est exécutable par PUBLIC
-- ou anon (et par authenticated, seulement les deux fonctions d'appartenance).
alter default privileges for role postgres in schema private revoke execute on functions from public;

-- ============================================================ heure du serveur pour updated_at
-- updated_at = now() toujours : l'horloge d'un client ne peut ni reculer ni avancer la date.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================ code du club et essais
create table private.club_invite (
  id int primary key check (id = 1),
  code_hash text not null,
  updated_at timestamptz not null default now()
);

create table private.code_attempts (
  coach_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index code_attempts_coach_at_idx on private.code_attempts (coach_id, attempted_at);

alter table private.club_invite enable row level security;
alter table private.code_attempts enable row level security;
revoke all on table private.club_invite, private.code_attempts from public, anon, authenticated;

-- Pose (ou remplace) le code du club. Réservée à postgres (éditeur SQL).
create function private.set_invite_code(code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if code is null or btrim(code) = '' then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  insert into private.club_invite (id, code_hash, updated_at)
  values (1, extensions.crypt(upper(btrim(code)), extensions.gen_salt('bf')), now())
  on conflict (id) do update set code_hash = excluded.code_hash, updated_at = excluded.updated_at;
end;
$$;

-- Rattache les invitations en attente de l'appelant (tâche 4 bis). Ici : rien, renvoie 0.
create function private.claim_invites()
returns int
language plpgsql
set search_path = ''
as $$
begin
  return 0;
end;
$$;

revoke all on function private.set_invite_code(text) from public, anon, authenticated;
revoke all on function private.claim_invites() from public, anon, authenticated;

-- Active le compte de l'appelant si le code est bon. 5 essais par heure au plus
-- (vérifié avant d'enregistrer l'essai). Un compte déjà activé reçoit true sans essai.
create function public.redeem_invite_code(code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  is_active boolean;
  stored text;
begin
  -- Verrou sur la ligne coaches de l'appelant : deux appels simultanés ne dépassent
  -- pas la limite d'essais.
  select c.activated_at is not null into is_active
  from public.coaches c where c.id = uid
  for update;
  if not found then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if is_active then
    return true;
  end if;

  if (select count(*) from private.code_attempts
      where coach_id = uid and attempted_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;
  insert into private.code_attempts (coach_id) values (uid);

  select code_hash into stored from private.club_invite where id = 1;
  if stored is null or code is null
     or extensions.crypt(upper(btrim(code)), stored) is distinct from stored then
    return false;
  end if;

  update public.coaches set activated_at = now() where id = uid;
  perform private.claim_invites();
  return true;
end;
$$;

revoke all on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;
