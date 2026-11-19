-- Activation des comptes par le code du club (tâche 4).
-- C et D : comptes confirmés, non activés. Le code est posé par postgres (éditeur SQL).
-- Chaque assertion pgTAP commence en début de ligne par « select » (voir docs/db-tests.md).
begin;
create extension if not exists pgtap with schema extensions;
-- helpers:include
select plan(27);

create temp table ids (k text primary key, v uuid not null);
grant select on ids to public;
create function pg_temp.id(p_k text) returns uuid
  language sql stable as $fn$ select v from pg_temp.ids where k = p_k $fn$;

insert into ids values
  ('c', tests.create_coach('coach.c@example.test', false)),
  ('d', tests.create_coach('coach.d@example.test', false));

-- ---------------------------------------------------------------- structure (8)
select ok(has_function_privilege('authenticated', 'public.redeem_invite_code(text)', 'execute'), 'authenticated appelle redeem_invite_code');
select ok(not has_function_privilege('anon', 'public.redeem_invite_code(text)', 'execute'), 'anon n’a pas le droit d’exécuter redeem_invite_code');
select ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where p.oid = 'public.redeem_invite_code(text)'::regprocedure and a.grantee = 0), 'redeem_invite_code : aucun droit pour PUBLIC');
select ok(not has_function_privilege('authenticated', 'private.set_invite_code(text)', 'execute')
          and not has_function_privilege('anon', 'private.set_invite_code(text)', 'execute'), 'set_invite_code : ni anon ni authenticated');
select ok(not has_function_privilege('authenticated', 'private.claim_invites()', 'execute'), 'claim_invites n’est pas appelable directement');
select is((select count(*) from pg_class c where c.oid in ('private.club_invite'::regclass, 'private.code_attempts'::regclass) and c.relrowsecurity)::int, 2, 'RLS activée sur club_invite et code_attempts');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'private'
           and table_name in ('club_invite', 'code_attempts') and grantee in ('anon', 'authenticated', 'PUBLIC'))::int, 0, 'aucun droit client sur club_invite et code_attempts');
select is(private.claim_invites(), 0, 'claim_invites sans appelant : 0');

-- ---------------------------------------------------------------- pose du code (postgres) (2)
select private.set_invite_code('TOAC2026');
select ok((select code_hash <> 'TOAC2026' and code_hash like '$2%' from private.club_invite where id = 1), 'le code est stocké haché (bcrypt), jamais en clair');
select private.set_invite_code(' toac2026 ');
select is((select count(*) from private.club_invite)::int, 1, 'une seule ligne : le nouveau code remplace l’ancien');

-- ---------------------------------------------------------------- C active son compte (6)
select tests.as_coach(pg_temp.id('c'));
select is(public.redeem_invite_code('faux'), false, 'mauvais code');
select ok((select activated_at is null from public.coaches where id = pg_temp.id('c')), 'mauvais code : compte toujours inactif');
select is(public.redeem_invite_code('  toac2026 '), true, 'espaces et minuscules acceptés');
select ok((select activated_at is not null from public.coaches where id = pg_temp.id('c')), 'compte activé');
select is(public.redeem_invite_code('faux'), true, 'compte déjà activé : true sans nouvel essai');
select throws_ok($$select * from private.code_attempts$$, '42501', null, 'C ne lit pas les essais');

-- ---------------------------------------------------------------- D : limite de 5 essais par heure (8)
select tests.as_coach(pg_temp.id('d'));
select is((select count(*) from generate_series(1, 5) g where public.redeem_invite_code('faux' || g) = false)::int, 5, 'D : 5 mauvais essais');
select throws_ok($$select public.redeem_invite_code('TOAC2026')$$, 'P0001', 'too_many_attempts', '6e essai refusé même avec le bon code');
select ok((select activated_at is null from public.coaches where id = pg_temp.id('d')), 'D reste inactif après le refus');
reset role;
select is((select count(*) from private.code_attempts where coach_id = pg_temp.id('d'))::int, 5, 'l’essai refusé n’est pas enregistré');
select is((select count(*) from private.code_attempts where coach_id = pg_temp.id('c'))::int, 2, 'C : 2 essais enregistrés (le 3e appel, compte activé, ne compte pas)');
update private.code_attempts set attempted_at = now() - interval '61 minutes' where coach_id = pg_temp.id('d');
select tests.as_coach(pg_temp.id('d'));
select is(public.redeem_invite_code('TOAC2026'), true, 'une heure plus tard, D peut réessayer');
reset role;
select is((select count(*) from private.code_attempts where coach_id = pg_temp.id('d') and attempted_at = now())::int, 1, 'le nouvel essai est enregistré (les anciens ne comptent plus)');
select ok((select activated_at is not null from public.coaches where id = pg_temp.id('d')), 'D activé');

-- ---------------------------------------------------------------- droits des clients (3)
select tests.as_coach(pg_temp.id('c'));
select throws_ok($$select private.set_invite_code('X')$$, '42501', null, 'set_invite_code interdit au client');
reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.redeem_invite_code('TOAC2026')$$, 'P0001', 'not_allowed', 'sans identifiant de compte : refusé');
reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.redeem_invite_code('TOAC2026')$$, '42501', null, 'anon ne peut pas appeler');

select * from finish();
rollback;
