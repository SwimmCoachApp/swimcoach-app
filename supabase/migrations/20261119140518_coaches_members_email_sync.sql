-- coaches : un entraîneur activé voit tous les membres de ses espaces, activés ou non
-- (écran des membres : nom + e-mail). Sa propre ligne reste visible même s'il n'est pas
-- activé (l'app doit connaître son état).
-- L'e-mail de coaches suit celui du compte auth (les invitations se comparent en minuscules).
alter policy coaches_select on public.coaches
  using (
    id = (select auth.uid())
    or (
      (select private.is_active_coach())
      and exists (
        select 1
        from public.team_members mine
        join public.team_members theirs on theirs.team_id = mine.team_id
        where mine.coach_id = (select auth.uid()) and theirs.coach_id = coaches.id
      )
    )
  );

create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coaches set email = lower(coalesce(new.email, '')) where id = new.id;
  return new;
end;
$$;

revoke all on function private.handle_user_email_change() from public, anon, authenticated;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();
