-- Journal des e-mails d'invitation (fonction invite-email) : au plus un e-mail par jour
-- pour un même groupe et une même adresse. Écrit et lu seulement avec la clé serveur :
-- RLS active sans politique, aucun droit pour anon ni authenticated.
create table public.invite_emails (
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  sent_at timestamptz not null default now(),
  primary key (team_id, email)
);
alter table public.invite_emails enable row level security;
revoke all on table public.invite_emails from anon, authenticated;
