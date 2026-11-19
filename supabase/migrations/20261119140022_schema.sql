-- Schéma par espace d'équipe : comptes, espaces, tables métier, RLS, temps réel.
-- Règle centrale : une ligne métier appartient à un espace (team_id) ; seuls les membres
-- activés de cet espace la lisent ou l'écrivent. Les écritures sur teams / team_members /
-- team_invites passent par les fonctions serveur (tâches 4 et 4 bis), jamais en direct.

-- ============================================================ schéma private (non exposé)
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ============================================================ comptes et espaces
create table public.coaches (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index teams_created_by_idx on public.teams (created_by);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  coach_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (team_id, coach_id)
);
create index team_members_coach_id_idx on public.team_members (coach_id);

create table public.team_invites (
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, email)
);
create index team_invites_invited_by_idx on public.team_invites (invited_by);
create index team_invites_email_idx on public.team_invites (email);

-- ============================================================ tables métier
-- team_id est indexé partout : par l'index unique (team_id, id) / la clé primaire qui
-- commence par team_id, ou par un index dédié quand aucun index ne commence par team_id.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (team_id, id),
  unique (team_id, name)
);

create table public.swimmers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  firstname text not null,
  lastname text not null default '',
  dob date,
  group_id uuid,
  phone text,
  email text,
  photo_path text,
  joined_season int not null,
  left_season int,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (team_id, id),
  foreign key (team_id, group_id) references public.groups (team_id, id) on delete set null (group_id)
);
create index swimmers_team_group_idx on public.swimmers (team_id, group_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  date date not null,
  title text not null default '',
  type text not null check (type in ('nat', 'musc', 'comp', 'other')),
  time text,
  content text,
  km numeric,
  photo_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (team_id, id)
);

create table public.presence (
  team_id uuid not null references public.teams (id) on delete cascade,
  session_id uuid not null,
  swimmer_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (session_id, swimmer_id),
  foreign key (team_id, session_id) references public.sessions (team_id, id) on delete cascade,
  foreign key (team_id, swimmer_id) references public.swimmers (team_id, id) on delete cascade
);
create index presence_team_session_idx on public.presence (team_id, session_id);
create index presence_team_swimmer_idx on public.presence (team_id, swimmer_id);

create table public.plan_weeks (
  team_id uuid not null references public.teams (id) on delete cascade,
  week_key text not null check (week_key ~ '^\d{4}-W\d{2}$'),
  season_start int not null,
  content text not null default '',
  km_target numeric not null default 0,
  zone text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (team_id, week_key)
);

create table public.plan_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  month_key text not null,
  type text not null check (type in ('comp', 'stage', 'nat', 'obj', 'note')),
  title text not null default '',
  description text not null default '',
  start_date date,
  end_date date,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index plan_events_team_id_idx on public.plan_events (team_id);

create table public.performances (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  swimmer_id uuid not null,
  competition_id text not null,
  competition_name text,
  competition_date date,
  pool text,
  event_code text not null,
  event_label text,
  distance int,
  stroke text,
  phase text not null default '',
  time_ms int,
  time_display text,
  rank int,
  points int,
  status text,
  splits jsonb,
  source text not null default 'liveffn',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (team_id, swimmer_id, competition_id, event_code, phase),
  foreign key (team_id, swimmer_id) references public.swimmers (team_id, id) on delete cascade
);

-- ============================================================ fonctions d'appartenance
create function private.is_active_coach()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coaches
    where id = (select auth.uid()) and activated_at is not null
  );
$$;

create function private.is_team_member(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_coach()
     and exists (
       select 1 from public.team_members
       where team_id = t and coach_id = (select auth.uid())
     );
$$;

revoke all on function private.is_active_coach() from public, anon;
revoke all on function private.is_team_member(uuid) from public, anon;
grant execute on function private.is_active_coach() to authenticated;
grant execute on function private.is_team_member(uuid) to authenticated;

-- ============================================================ triggers
-- Nouveau compte auth -> ligne coaches (inactive) ; e-mail en minuscules.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.coaches (id, email) values (new.id, lower(coalesce(new.email, '')));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- updated_at n'avance que vers l'avant ; updated_by = membre qui a écrit en dernier.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(new.updated_at, now());
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Une ligne ne change jamais d'espace (en plus du with check des politiques).
create function private.forbid_team_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_id is distinct from old.team_id then
    raise exception 'team_id ne peut pas changer' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- teams : pas de colonne updated_by, seulement updated_at.
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(new.updated_at, now());
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.forbid_team_change() from public, anon, authenticated;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger set_updated_at
  before update on public.teams
  for each row execute function private.touch_updated_at();

-- ============================================================ droits et RLS
alter table public.coaches enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

revoke all on table public.coaches, public.teams, public.team_members, public.team_invites
  from anon, authenticated;
grant select on table public.coaches, public.teams, public.team_members, public.team_invites
  to authenticated;
grant update (display_name) on table public.coaches to authenticated;
grant update (name) on table public.teams to authenticated;

-- coaches : sa propre ligne (même non activée), et les comptes activés qui partagent
-- un de ses espaces (la RLS de team_members s'applique aussi dans la sous-requête).
create policy coaches_select on public.coaches
  for select to authenticated
  using (
    id = (select auth.uid())
    or (
      activated_at is not null
      and (select private.is_active_coach())
      and exists (
        select 1
        from public.team_members mine
        join public.team_members theirs on theirs.team_id = mine.team_id
        where mine.coach_id = (select auth.uid()) and theirs.coach_id = coaches.id
      )
    )
  );
create policy coaches_update on public.coaches
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy teams_select on public.teams
  for select to authenticated
  using ((select private.is_team_member(id)));
create policy teams_update on public.teams
  for update to authenticated
  using ((select private.is_team_member(id)))
  with check ((select private.is_team_member(id)));

create policy team_members_select on public.team_members
  for select to authenticated
  using ((select private.is_team_member(team_id)));

create policy team_invites_select on public.team_invites
  for select to authenticated
  using ((select private.is_team_member(team_id)));

-- Tables métier : mêmes droits, mêmes 4 politiques, mêmes triggers.
do $$
declare
  t text;
begin
  foreach t in array array['groups', 'swimmers', 'sessions', 'presence',
                           'plan_weeks', 'plan_events', 'performances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated '
                   'using ((select private.is_team_member(team_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated '
                   'with check ((select private.is_team_member(team_id)))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated '
                   'using ((select private.is_team_member(team_id))) '
                   'with check ((select private.is_team_member(team_id)))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated '
                   'using ((select private.is_team_member(team_id)))', t || '_delete', t);
    execute format('create trigger forbid_team_change before update on public.%I '
                   'for each row execute function private.forbid_team_change()', t);
    execute format('create trigger set_updated_at before insert or update on public.%I '
                   'for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;

-- ============================================================ temps réel
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
alter publication supabase_realtime add table
  public.swimmers, public.sessions, public.presence, public.plan_weeks,
  public.plan_events, public.groups, public.performances, public.team_members;
