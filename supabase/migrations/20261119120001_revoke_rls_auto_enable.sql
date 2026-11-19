-- public.rls_auto_enable() est créée par la plateforme (option « RLS automatique » du projet
-- hébergé) et sert de fonction de déclencheur d'événement (ensure_rls). Elle est
-- security definer et exécutable par anon/authenticated : le conseiller de sécurité le
-- signale. Un déclencheur d'événement n'a pas besoin du droit EXECUTE pour se lancer :
-- on retire ce droit. La fonction n'existe pas dans la base locale de la CI, d'où le test.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
