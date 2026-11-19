# SwimCoach App multi-entraîneurs — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** construire, dans `SwimmCoachApp/swimcoach-app`, une PWA modulaire (Vite) où chaque entraîneur a son compte et travaille dans un ou plusieurs **espaces d'équipe** partagés avec ses collègues (nageurs, séances, présences, planning, perfs). Il ne voit que les espaces dont il est membre. L'isolation entre espaces est garantie par la RLS Supabase, et l'app a la parité fonctionnelle avec `club4`.

**Architecture :** Vite et JavaScript ES (JSDoc), un dossier par fonctionnalité sous `src/features/`, une coque `src/app/` et un socle `src/core/` (client Supabase, cache local préfixé par entraîneur et par espace, file d'attente d'écritures, synchro). Côté serveur, des migrations SQL versionnées (schéma avec `team_id` sur chaque ligne métier, RLS par appartenance à l'espace, activation par code, espaces et invitations, stockage privé), deux Edge Functions (`liveffn-proxy`, `delete-account`) et des tests d'isolation pgTAP. Le code métier et l'interface de `club4` sont repris morceau par morceau : **le code de `club4` fait foi**.

**Tech Stack :** Node 22, Vite 8, Vitest, Playwright, `@supabase/supabase-js` v2 (npm), `vite-plugin-pwa`, Chart.js 4 (npm), `@fontsource/bricolage-grotesque` et `@fontsource/inter`, Supabase (Postgres 17, Auth, Storage, Edge Functions Deno), pgTAP, GitHub Actions, GitHub Pages.

**Spec :** `docs/superpowers/specs/2026-11-19-swimcoach-multi-coach-design.md`, validée par Damien le 19/11/2026.

**Référence `club4` :** `ssephiroth31/Swimcoachpro`, `index.html`, commit `8aaad5c` (`APP_VERSION = 'v2026-11-05-club4'`, 6650 lignes). Lecture seule : `git clone --depth 1 https://github.com/ssephiroth31/swimcoachpro`. Plages de lignes utiles :
CSS 17–1017 (thème Club 765–1017) · balisage HTML 4669–5000 environ et modales · config Supabase 1597–1681 · temps réel et rechargement 1682–2093 · cache et données 2094–2460 · photos de séance 2461–2730 · calendrier 2731–2874 · modale séance et présences 2875–3152 · contacts et archivage 3159–3643 · stats et cycle de vie des saisons 3644–4109 · planning 4110–4833 · navigation, modales, thème, toasts 4834–4905 · import Excel/CSV 4906–5277 · perfs liveffn 5278–6575 · init 6576–6641. Styles des PDF : 3979–4039, 4614–4669, 6345–6398.

## Global Constraints

- Projet Supabase de travail : **uniquement** `zuguceilohochmpnbzaz`. Interdits pour toute migration, requête ou test : `aijgczmszymfjkeegbjz` (ancienne app) et `vijexmmydvgfpkyzkgls` (École de natation). Les deux figurent sur la liste noire de la CI.
- Ne jamais modifier `ssephiroth31/Swimcoachpro`.
- Toutes les clés de stockage local commencent par `swimcoach2_`. L'app ne lit, n'écrit et ne supprime jamais `swimcoach_v2`, `swimcoach_theme` ni `__app_version__`. Interdit : `localStorage.clear()`.
- Cache : `swimcoach2_<coachId>_<nom>` (réglages de l'entraîneur) et `swimcoach2_<coachId>_<teamId>_<nom>` (données d'un espace). Tout est effacé à la déconnexion. Le cache d'un espace est effacé dès que l'entraîneur n'en est plus membre.
- Aucune clé `service_role` dans l'app ni dans le dépôt. Côté client : l'URL du projet et la clé publiable, rien d'autre.
- Chaque table métier a `team_id uuid not null references teams(id) on delete cascade`, la RLS activée, et des politiques limitées à `(select private.is_team_member(team_id))`, qui vérifie aussi que le compte est activé.
- Espaces : tous les membres ont les mêmes droits (données, renommage, ajout et retrait de membres, départ). Le dernier membre ne peut pas partir ; il supprime l'espace explicitement. Une invitation à une adresse sans compte reste en attente et n'est rattachée qu'une fois l'adresse **confirmée**. Pas d'e-mail d'invitation envoyé par l'app.
- Fonctions `security definer` : `set search_path = ''`, `revoke execute ... from public, anon`. Les contrôles de sécurité Supabase (`get_advisors`) passent après chaque migration.
- Mot de passe d'au moins 10 caractères. Confirmation de l'e-mail activée. Code d'inscription : environ 5 essais par heure et par compte.
- Pas de CDN à l'exécution : supabase-js, Chart.js et les polices sont embarqués par Vite. Lecture Excel chargée à la demande, sans le paquet npm `xlsx` (périmé, failles connues).
- Interface en français, nom « SwimCoach App », design Club inchangé, thèmes clair et sombre.
- Les PDF passent tous par `exportPdf(html, nom)` (module `pdf/`).
- `base: './'` dans Vite. Pas de dossiers `ios/` ni `android/`.
- Pas d'`onclick=` en ligne : délégation d'événements par `data-action`.
- Fiche nageur : mêmes champs que `club4` (prénom, nom, naissance, groupe, téléphone, e-mail, photo, saisons). `club4` n'a **pas** de champ « parent » : il n'est pas ajouté dans cette phase (la spec dit que `club4` fait foi).

## Review Focus

1. **Texte saisi rendu en HTML** : un nom de nageur, un titre de séance ou une ligne Excel contenant `<img src=x onerror=alert(1)>` doit s'afficher comme du texte. Le contenu riche des séances ne garde que `b, i, u, br, div, p, ul, ol, li, span`. Tests dans les tâches 9 et 12.
2. **Décalage de date au fuseau de Paris** : une séance créée à 00:30 heure de Paris tombe sur le bon jour (les clés de date ne passent jamais par `toISOString()`). Le 31 août appartient à la saison N-1, le 1er septembre à la saison N. Tests dans les tâches 10 et 12.
3. **Perte d'accès avec des modifications en attente** : (a) la session de A a expiré hors ligne et B se connecte sur le même appareil ; (b) A a été retiré de l'espace pendant qu'il était hors ligne. Dans les deux cas, les modifications en attente de A ne sont jamais envoyées avec le jeton de B ni vers un autre espace ; elles sont effacées avec le cache après un message clair. Tests dans les tâches 8 et 17.
4. **Code d'inscription mal saisi** : espaces autour ou minuscules (« toac2026 ») sont acceptés pour le code « TOAC2026 ». Le 6e essai dans l'heure est refusé, même si le code est bon. Test dans la tâche 4.
5. **Deux entraîneurs font l'appel du même groupe en même temps** : A coche 1 à 6, C coche 7 à 12 sur la même séance depuis deux appareils. Résultat : 12 présents des deux côtés, sans aucune coche perdue (ops nageur par nageur, jamais de remplacement de la liste complète). Test dans la tâche 13.
6. **Import Excel imparfait** : dates en nombre de série Excel ou au format `jj/mm/aaaa`, doublons avec des nageurs existants (même nom et prénom normalisés), lignes vides. Aucun doublon créé, dates correctes. Test dans la tâche 11.

---

## Structure des fichiers

```
index.html · package.json · vite.config.js · vitest.config.js · playwright.config.js · capacitor.config.json
public/        icons/, privacy.html
scripts/       check-guards.mjs
src/main.js
src/app/       shell.js (écrans, barre du haut), actions.js (délégation data-action), theme.js, toast.js, update.js, html.js (échappement)
src/core/      config.js, storage.js, supabase.js, session.js, teams.js, dates.js, season.js, outbox.js, sync.js, store.js, photos.js
src/features/  auth/ teams/ contacts/ calendar/ presence/ stats/ planning/ perfs/ pdf/ settings/   (chacun : index.js + view.js + logic.js selon besoin)
src/styles/    tokens.css, base.css, club.css, un fichier par fonctionnalité
supabase/      config.toml, migrations/, functions/liveffn-proxy/, functions/delete-account/, functions/_shared/, tests/database/
tests/unit/    *.test.js (Vitest) · tests/e2e/ *.spec.js + fake-supabase.js (Playwright)
docs/          store-readiness.md, demo-account.md
.github/workflows/  ci.yml, deploy.yml
```

---

### Task 1 : socle du dépôt, CI et garde-fous

**Files :**
- Create : `package.json`, `vite.config.js`, `vitest.config.js`, `playwright.config.js`, `index.html`, `src/main.js`, `scripts/check-guards.mjs`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.gitignore`
- Test : `tests/unit/check-guards.test.js`

**Interfaces :**
- Produces : scripts npm `dev`, `build`, `test` (Vitest), `test:e2e` (Playwright), `guards` (`node scripts/check-guards.mjs`). `checkGuards(files: {path:string, text:string}[]) -> {path:string, rule:string, line:number}[]`, exporté par `scripts/check-guards.mjs`.

- [ ] **Step 1 : écrire le test qui échoue**

```js
import { checkGuards } from '../../scripts/check-guards.mjs';
test('refuse les projets Supabase interdits', () => {
  const v = checkGuards([{ path: 'src/a.js', text: "const u='https://aijgczmszymfjkeegbjz.supabase.co'" },
                         { path: 'src/b.js', text: "x='vijexmmydvgfpkyzkgls'" }]);
  expect(v.map(x => x.rule)).toEqual(['forbidden-project', 'forbidden-project']);
});
test('refuse les clés locales non préfixées et localStorage.clear', () => {
  const v = checkGuards([{ path: 'src/c.js', text: "localStorage.setItem('swimcoach_v2','x')\nlocalStorage.clear()" }]);
  expect(v.map(x => x.rule)).toEqual(['raw-localstorage', 'raw-localstorage']);
});
test('refuse une clé service_role et un onclick en ligne', () => {
  const v = checkGuards([{ path: 'src/d.js', text: "k='sb_secret_abc'\n'<b onclick=\"x()\">'" }]);
  expect(v.map(x => x.rule)).toEqual(['secret-key', 'inline-handler']);
});
test('accepte core/storage.js, seul fichier autorisé à appeler localStorage', () => {
  expect(checkGuards([{ path: 'src/core/storage.js', text: "localStorage.getItem(k)" }])).toEqual([]);
});
```

- [ ] **Step 2 : lancer `npx vitest run tests/unit/check-guards.test.js`**. Attendu : échec, module introuvable.
- [ ] **Step 3 : implémenter.** Le projet est créé avec `npm create vite@latest` (template vanilla), puis on ajoute `vitest`, `@playwright/test`, `vite-plugin-pwa`. `checkGuards` applique des règles par ligne : `forbidden-project` (`aijgczmszymfjkeegbjz|vijexmmydvgfpkyzkgls`, partout sauf `docs/` et `scripts/check-guards.mjs`) ; `raw-localstorage` (`localStorage` hors de `src/core/storage.js`) ; `secret-key` (`service_role|sb_secret_`) ; `inline-handler` (`\son[a-z]+=` dans `src/`). En ligne de commande, il parcourt `src/ public/ supabase/ index.html` (et `dist/` si présent), affiche les violations et sort avec le code 1 s'il y en a. Dans `vite.config.js` : `base: './'`. `ci.yml` (sur push et PR) : `npm ci`, `npm run guards`, `npm test`, `npm run build`, `node scripts/check-guards.mjs dist`, puis Playwright (Chromium). `deploy.yml` (sur push vers `main`) : build, puis `actions/upload-pages-artifact` et `actions/deploy-pages`.
- [ ] **Step 4 : vérifier** : `npm test && npm run guards && npm run build`. Attendu : tout passe, `dist/index.html` existe.
- [ ] **Step 5 : commit** `chore: socle Vite, CI et garde-fous`

### Task 2 : stockage local préfixé par entraîneur

**Files :** Create `src/core/storage.js`, `src/core/config.js` · Test `tests/unit/storage.test.js`

**Interfaces :**
- Produces : `PREFIX = 'swimcoach2_'`. `appStore.get(name) / set(name, value) / remove(name)` (clés `swimcoach2_<name>`, valeurs en JSON). `coachStore(coachId) -> {get, set, remove, clear}` (clés `swimcoach2_<coachId>_<name>` ; `clear` efface aussi tous ses espaces). `teamStore(coachId, teamId) -> {get, set, remove, clear}` (clés `swimcoach2_<coachId>_<teamId>_<name>` ; `clear` n'efface que cet espace). `clearAllCoachData()` efface toutes les clés `swimcoach2_` sauf celles de `appStore` listées dans `APP_KEYS = ['theme']`. `config.js` exporte `SUPABASE_URL = 'https://zuguceilohochmpnbzaz.supabase.co'`, `SUPABASE_PUBLISHABLE_KEY` (lue avec `get_publishable_keys` sur le projet), `LIVEFFN_STRUCTURE_ID = 39`.

- [ ] **Step 1 : test qui échoue**

```js
beforeEach(() => { localStorage.clear(); localStorage.setItem('swimcoach_v2','OLD'); localStorage.setItem('swimcoach_theme','dark'); localStorage.setItem('__app_version__','v1'); });
test('coachStore isole deux entraîneurs', () => {
  coachStore('A').set('swimmers',[1]); coachStore('B').set('swimmers',[2]);
  expect(coachStore('A').get('swimmers')).toEqual([1]);
  coachStore('A').clear();
  expect(coachStore('A').get('swimmers')).toBeNull();
  expect(coachStore('B').get('swimmers')).toEqual([2]);
});
test("ne touche jamais aux clés de l'ancienne app", () => {
  coachStore('A').set('x',1); appStore.set('theme','light'); clearAllCoachData();
  expect(localStorage.getItem('swimcoach_v2')).toBe('OLD');
  expect(localStorage.getItem('swimcoach_theme')).toBe('dark');
  expect(localStorage.getItem('__app_version__')).toBe('v1');
  expect(appStore.get('theme')).toBe('light');
  expect(localStorage.getItem('swimcoach2_A_x')).toBeNull();
});
test("teamStore.clear n'efface qu'un espace", () => {
  teamStore('A','T1').set('s',1); teamStore('A','T2').set('s',2); coachStore('A').set('team',"T1");
  teamStore('A','T1').clear();
  expect(teamStore('A','T1').get('s')).toBeNull(); expect(teamStore('A','T2').get('s')).toBe(2); expect(coachStore('A').get('team')).toBe('T1');
  coachStore('A').clear(); expect(teamStore('A','T2').get('s')).toBeNull();
});
test('JSON corrompu → null, pas d’exception', () => { localStorage.setItem('swimcoach2_A_s','{'); expect(coachStore('A').get('s')).toBeNull(); });
```
(`vitest.config.js` : `environment: 'jsdom'`. Le `localStorage.clear()` du test est autorisé parce que les garde-fous ne visent que `src/`.)

- [ ] **Step 2 :** `npx vitest run tests/unit/storage.test.js`. Attendu : échec.
- [ ] **Step 3 : implémenter** `storage.js`. Chaque accès à `localStorage` est dans un try/catch. `clear` et `clearAllCoachData` parcourent les clés et ne suppriment que celles qui ont le bon préfixe.
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(core): stockage local préfixé swimcoach2_`

### Task 3 : schéma, espaces, RLS et tests d'isolation

**Files :** Create `supabase/config.toml` (`npx supabase init`), `supabase/migrations/20261119120000_schema.sql`, `supabase/tests/database/00_helpers.sql` (fonctions de test), `supabase/tests/database/isolation.test.sql`, `docs/db-tests.md` (procédure)

**Interfaces :**
- Produces (schéma exact) :
  - `private` (schéma non exposé) : `private.is_active_coach() returns boolean` (`stable`, `security definer`, `search_path=''`). Vrai si `public.coaches` contient une ligne avec `id = auth.uid()` et `activated_at is not null`. `private.is_team_member(t uuid) returns boolean` (mêmes attributs) : `is_active_coach()` **et** une ligne `team_members(team_id = t, coach_id = auth.uid())`. Seul `authenticated` peut les exécuter.
  - `coaches(id uuid pk references auth.users on delete cascade, email text not null, display_name text not null default '', activated_at timestamptz, created_at timestamptz default now())`. Ligne créée par le trigger `on_auth_user_created` (fonction `private.handle_new_user()`, qui recopie `lower(email)`). RLS : `select` sur sa propre ligne et sur celles des membres de ses espaces ; `update` limité à la colonne `display_name` de sa propre ligne (`revoke update on coaches from authenticated; grant update (display_name) on coaches to authenticated`) ; pas d'`insert` ni de `delete` côté client.
  - `teams(id uuid pk default gen_random_uuid(), name text not null check (length(btrim(name)) between 1 and 60), created_by uuid references auth.users on delete set null, created_at, updated_at)`. RLS : `select` et `update (name)` si `is_team_member(id)`. Pas d'`insert` ni de `delete` côté client (fonctions de la tâche 4 bis).
  - `team_members(team_id uuid references teams on delete cascade, coach_id uuid references auth.users on delete cascade, added_by uuid, created_at, primary key (team_id, coach_id))`. RLS : `select` si `is_team_member(team_id)`. Aucune écriture côté client.
  - `team_invites(team_id uuid references teams on delete cascade, email text not null check (email = lower(btrim(email))), invited_by uuid references auth.users on delete set null, created_at, primary key (team_id, email))`. RLS : `select` si `is_team_member(team_id)`. Aucune écriture côté client.
  - `groups(id uuid pk, team_id, name text not null, sort_order int not null default 0, updated_at timestamptz not null default now(), unique(team_id,id), unique(team_id,name))`
  - `swimmers(id uuid pk, team_id, firstname text not null, lastname text not null default '', dob date, group_id uuid, phone text, email text, photo_path text, joined_season int not null, left_season int, updated_at, unique(team_id,id), foreign key (team_id, group_id) references groups(team_id,id) on delete set null (group_id))`
  - `sessions(id uuid pk, team_id, date date not null, title text not null default '', type text not null check (type in ('nat','musc','comp','other')), time text, content text, km numeric, photo_path text, updated_at, unique(team_id,id))`
  - `presence(team_id, session_id uuid, swimmer_id uuid, updated_at, primary key(session_id, swimmer_id), fk (team_id,session_id) → sessions(team_id,id) on delete cascade, fk (team_id,swimmer_id) → swimmers(team_id,id) on delete cascade)`
  - `plan_weeks(team_id, week_key text not null check (week_key ~ '^\d{4}-W\d{2}$'), season_start int not null, content text not null default '', km_target numeric not null default 0, zone text not null default '', updated_at, primary key(team_id, week_key))`
  - `plan_events(id uuid pk, team_id, month_key text not null, type text not null check (type in ('comp','stage','nat','obj','note')), title text not null default '', description text not null default '', start_date date, end_date date, updated_at)`
  - `performances(id uuid pk, team_id, swimmer_id uuid not null, competition_id text not null, competition_name text, competition_date date, pool text, event_code text not null, event_label text, distance int, stroke text, phase text not null default '', time_ms int, time_display text, rank int, points int, status text, splits jsonb, source text not null default 'liveffn', updated_at, unique(team_id, swimmer_id, competition_id, event_code, phase), fk (team_id,swimmer_id) → swimmers(team_id,id) on delete cascade)`
  - Tables métier (`groups` à `performances`) : `team_id uuid not null references teams(id) on delete cascade`, plus `updated_by uuid default auth.uid()` (pour savoir quel membre a modifié en dernier), trigger `set_updated_at` qui ne fait qu'avancer `updated_at` (`greatest(new.updated_at, now())`) et pose `updated_by = auth.uid()`, index sur `team_id`, RLS activée. Pour chaque table : 4 politiques `to authenticated`, `using/with check ((select private.is_team_member(team_id)))`. Un `update` qui change `team_id` est refusé (le `with check` porte sur la nouvelle valeur, plus le trigger `forbid_team_change`). `revoke all ... from anon`.
  - Publication temps réel `supabase_realtime` : `swimmers, sessions, presence, plan_weeks, plan_events, groups, performances, team_members`.

- [ ] **Step 1 : écrire les tests pgTAP qui échouent.** `00_helpers.sql` crée, dans la transaction, `tests.create_coach(email text, activated bool) returns uuid` (insertion dans `auth.users` avec `email_confirmed_at = now()`, puis mise à jour de `activated_at`), `tests.create_team(name text, members uuid[]) returns uuid` (insertion directe en tant que `postgres`) et `tests.as_coach(uuid)` (`set local role authenticated; set local request.jwt.claims = json_build_object('sub', $1, 'role','authenticated')::text`). `isolation.test.sql` démarre par `begin; create extension if not exists pgtap with schema extensions; select plan(N);` et se termine par `select * from finish(); rollback;`. Mise en place : A et C activés, membres de l'espace TA ; B activé, membre de TB ; E non activé mais inscrit dans `team_members` de TA (pour prouver que l'activation compte). Des lignes de TA dans **chaque** table métier. Assertions :

```sql
select tests.as_coach(:b);
select is((select count(*) from public.swimmers)::int, 0, 'B ne lit pas les nageurs de TA');
-- idem pour groups, sessions, presence, plan_weeks, plan_events, performances, teams, team_members, team_invites
select is((select count(*) from public.coaches)::int, 1, 'B ne voit que sa propre ligne coaches');
select throws_ok($$insert into public.swimmers(id,team_id,firstname,joined_season) values (gen_random_uuid(), '<TA>', 'x', 2026)$$, '42501', null, 'B ne peut pas écrire dans TA');
select is_empty($$update public.swimmers set firstname='pirate' where team_id='<TA>' returning 1$$, 'B ne modifie rien dans TA');
select is_empty($$delete from public.sessions where team_id='<TA>' returning 1$$, 'B ne supprime rien dans TA');
select throws_ok($$update public.swimmers set team_id='<TA>' where team_id='<TB>'$$, '42501', null, 'B ne déplace pas une ligne vers TA');
select throws_ok($$insert into public.presence(team_id, session_id, swimmer_id) values ('<TB>', '<séance de TA>', '<nageur de TB>')$$, '23503', null, 'pas de présence de TB sur une séance de TA');
select throws_ok($$insert into public.performances(id,team_id,swimmer_id,competition_id,event_code) values (gen_random_uuid(),'<TB>','<nageur de TA>','1','1')$$, '23503', null, 'pas de perf de TB sur un nageur de TA');
select throws_ok($$insert into public.team_members(team_id, coach_id) values ('<TA>', '<B>')$$, '42501', null, 'B ne s’ajoute pas lui-même à TA');
select throws_ok($$update public.coaches set activated_at=now() where id='<B>'$$, '42501', null, 'activated_at non modifiable');
select tests.as_coach(:c);
select is((select count(*) from public.swimmers where team_id='<TA>')::int, <n>, 'C (membre de TA) lit les nageurs créés par A');
select lives_ok($$update public.swimmers set phone='0600000000' where team_id='<TA>'$$, 'C modifie les nageurs de TA');
select is((select count(*) from public.coaches)::int, 2, 'C voit A et lui-même, pas B');
select tests.as_coach(:e);
select is((select count(*) from public.swimmers)::int, 0, 'E non activé ne voit rien, même membre');
set local role anon;
select is((select count(*) from public.sessions)::int, 0, 'anon ne voit rien');
```
(Les UUID sont stockés dans une table temporaire et lus avec des sous-requêtes. Le constructeur choisit la forme, mais chaque table métier doit avoir ses tests de lecture, insertion, modification et suppression, côté non-membre comme côté membre.)

- [ ] **Step 2 : lancer les tests sur le projet hébergé** (Docker ne tourne pas dans cet environnement ; en CI, c'est `supabase start && supabase test db`). Exécuter `00_helpers.sql` puis `isolation.test.sql` avec `execute_sql` sur `zuguceilohochmpnbzaz` : le `rollback` final garantit qu'il ne reste rien. Attendu : échec, les tables n'existent pas.
- [ ] **Step 3 : écrire la migration** puis l'appliquer avec `apply_migration` (même nom, même SQL que le fichier).
- [ ] **Step 4 : relancer les tests.** Attendu : tous `ok`. Lancer ensuite `get_advisors` (sécurité et performance). Attendu : aucune alerte de sécurité ; toute alerte restante est justifiée par écrit dans `docs/security-notes.md`. Ajouter un job CI `db-tests` : `supabase start`, puis `supabase db reset`, puis `supabase test db`.
- [ ] **Step 5 : commit** `feat(db): schéma par espace d'équipe, RLS et tests d'isolation`

### Task 4 : activation par code du club

**Files :** Create `supabase/migrations/20261119120100_invite_code.sql`, `supabase/tests/database/invite_code.test.sql`

**Interfaces :**
- Produces : `private.club_invite(id int primary key check (id=1), code_hash text not null, updated_at)` ; `private.code_attempts(coach_id uuid, attempted_at timestamptz default now())`. RPC `public.redeem_invite_code(code text) returns boolean` (`security definer`, `execute` accordé à `authenticated` seulement) : normalise avec `upper(btrim(code))`, lève `too_many_attempts` (SQLSTATE `P0001`, message exact `too_many_attempts`) à partir de 5 essais dans l'heure (vérification **avant** l'enregistrement de l'essai), enregistre l'essai, compare avec `extensions.crypt`, pose `activated_at = now()`, appelle `private.claim_invites()` (tâche 4 bis ; dans cette tâche, une fonction vide qui renvoie `0`) et renvoie `true` si le code est bon, `false` sinon. Un compte déjà activé reçoit `true` sans nouvel essai. `private.set_invite_code(code text)` : aucun `execute` pour `anon` ni `authenticated` ; Damien l'appelle dans l'éditeur SQL. Elle stocke `crypt(upper(btrim(code)), gen_salt('bf'))`.

- [ ] **Step 1 : tests qui échouent**

```sql
select private.set_invite_code('TOAC2026');  -- en tant que postgres
select tests.as_coach(:c);
select is(public.redeem_invite_code('faux'), false, 'mauvais code');
select is(public.redeem_invite_code('  toac2026 '), true, 'espaces et minuscules acceptés');
select ok((select activated_at is not null from public.coaches where id = :c), 'compte activé');
-- nouveau compte D : 5 mauvais essais, puis le bon code
select throws_ok($$select public.redeem_invite_code('TOAC2026')$$, 'P0001', 'too_many_attempts', '6e essai refusé même avec le bon code');
select throws_ok($$select private.set_invite_code('X')$$, '42501', null, 'set_invite_code interdit au client');
set local role anon;
select throws_ok($$select public.redeem_invite_code('TOAC2026')$$, '42501', null, 'anon ne peut pas appeler');
```
- [ ] **Step 2 : lancer sur le projet hébergé** (même procédure qu'à la tâche 3). Attendu : échec.
- [ ] **Step 3 : écrire la migration, l'appliquer.** (Le « Before User Created hook » n'est pas retenu : il bloquerait la création de compte, alors qu'ici le compte existe mais reste inactif. C'est plus simple et le résultat est le même côté base.)
- [ ] **Step 4 : relancer les tests et `get_advisors`.** Attendu : tous `ok`, aucune alerte nouvelle.
- [ ] **Step 5 : commit** `feat(db): activation des comptes par code du club`

### Task 4 bis : espaces d'équipe, membres et invitations (base)

**Files :** Create `supabase/migrations/20261119120150_teams.sql`, `supabase/tests/database/teams.test.sql`

**Interfaces :**
- Produces (RPC `security definer`, `search_path=''`, `execute` pour `authenticated` seulement ; chacune lève `not_allowed` (`P0001`) si l'appelant n'est pas membre actif de l'espace visé) :
  - `public.create_team(name text) returns uuid` : compte activé exigé ; crée l'espace et y inscrit l'appelant.
  - `public.rename_team(team uuid, name text) returns void`.
  - `public.add_team_member(team uuid, email text) returns text` : normalise `lower(btrim(email))`, refuse une adresse invalide (`invalid_email`). Si un compte `auth.users` avec cette adresse **et** `email_confirmed_at is not null` existe, l'ajoute à `team_members` et renvoie `'added'` ; s'il est déjà membre, renvoie `'already_member'` ; sinon, crée ou garde la ligne `team_invites` et renvoie `'invited'`. Plus de 20 appels dans l'heure par appelant → `too_many_invites`.
  - `public.cancel_invite(team uuid, email text) returns void`.
  - `public.remove_team_member(team uuid, coach uuid) returns void` : n'importe quel membre peut retirer n'importe quel membre, y compris lui-même (départ). Si c'est le dernier membre → `last_member`.
  - `public.delete_team(team uuid) returns void` : supprime l'espace (cascade sur toutes les données). Les fichiers de stockage `photos/<team>/` sont supprimés par l'app juste avant l'appel (tâche 17), pendant que l'appelant est encore membre.
  - `private.claim_invites() returns int` : pour l'appelant activé dont l'adresse est confirmée, transforme ses invitations en adhésions et les supprime ; renvoie le nombre d'espaces rejoints. Appelée par `redeem_invite_code` et par la RPC `public.claim_my_invites() returns int` (appelée par l'app à chaque connexion).
  - Les invitations d'une adresse non confirmée ne sont **jamais** rattachées.

- [ ] **Step 1 : tests qui échouent**

```sql
select tests.as_coach(:a);
select isnt(public.create_team('Pôle Formation 1'), null, 'A crée TA');
select is(public.add_team_member(:ta, ' C@Club.fr '), 'added', 'C existant et confirmé : ajouté');
select is(public.add_team_member(:ta, 'c@club.fr'), 'already_member', 'déjà membre');
select is(public.add_team_member(:ta, 'd@club.fr'), 'invited', 'D sans compte : invitation en attente');
select throws_ok($$select public.add_team_member('<TA>', 'pas-une-adresse')$$, 'P0001', 'invalid_email', 'adresse invalide');
select tests.as_coach(:b);
select throws_ok($$select public.add_team_member('<TA>', 'b2@club.fr')$$, 'P0001', 'not_allowed', 'B non membre ne peut pas inviter dans TA');
select throws_ok($$select public.remove_team_member('<TA>', '<C>')$$, 'P0001', 'not_allowed', 'B ne retire personne de TA');
-- D s'inscrit sans confirmer : claim_my_invites() = 0 ; après email_confirmed_at et activation : = 1, D lit TA
select tests.as_coach(:c);
select lives_ok($$select public.remove_team_member('<TA>', '<A>')$$, 'C (simple membre) peut retirer A');
select tests.as_coach(:a);
select is((select count(*) from public.swimmers)::int, 0, 'A retiré ne voit plus rien de TA');
select tests.as_coach(:c);
select lives_ok($$select public.remove_team_member('<TA>', '<D>')$$, 'C retire D');
select throws_ok($$select public.remove_team_member('<TA>', '<C>')$$, 'P0001', 'last_member', 'le dernier membre ne peut pas partir');
select lives_ok($$select public.delete_team('<TA>')$$, 'le dernier membre supprime l’espace');
select is((select count(*) from public.sessions where team_id = '<TA>')::int, 0, 'données de TA supprimées en cascade');
-- 21e invitation dans l'heure → too_many_invites
```
- [ ] **Step 2 : lancer sur le projet hébergé.** Attendu : échec.
- [ ] **Step 3 : écrire la migration** (elle remplace le corps de `private.claim_invites()` de la tâche 4), puis l'appliquer.
- [ ] **Step 4 : relancer `teams.test.sql`, `isolation.test.sql`, `invite_code.test.sql` et `get_advisors`.** Attendu : tous `ok`, aucune alerte nouvelle.
- [ ] **Step 5 : commit** `feat(db): espaces d'équipe, membres et invitations en attente`

### Task 5 : stockage privé des photos

**Files :** Create `supabase/migrations/20261119120200_storage.sql`, `supabase/tests/database/storage.test.sql`

**Interfaces :**
- Produces : bucket `photos` (`public = false`, `file_size_limit = 2097152`, `allowed_mime_types = '{image/jpeg,image/webp}'`). Chemins : `<team_id>/swimmers/<swimmer_id>.jpg` et `<team_id>/sessions/<session_id>.jpg`. Politiques sur `storage.objects` (select, insert, update, delete) : `bucket_id = 'photos' and (select private.is_team_member(((storage.foldername(name))[1])::uuid))` (avec une garde regex sur l'UUID, pour qu'un nom invalide donne `false` et pas une erreur).

- [ ] **Step 1 : tests qui échouent**, en insérant directement dans `storage.objects` (`bucket_id, name, owner`) : A dépose `<TA>/swimmers/x.jpg` ; C (membre de TA) le lit et peut le remplacer ; B ne le voit pas, ne peut pas déposer sous `<TA>/...` (42501), ni le supprimer, ni le renommer ; un nom `pasunuuid/x.jpg` est refusé sans erreur SQL ; E non activé ne peut pas déposer sous `<TA>/...` ; après le retrait de C, C ne lit plus l'objet.
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : migration, puis l'appliquer.**
- [ ] **Step 4 : relancer les tests et `get_advisors`.** Attendu : tous `ok`.
- [ ] **Step 5 : commit** `feat(db): stockage privé des photos par espace`

### Task 6 : Edge Functions `liveffn-proxy` et `delete-account`

**Files :** Create `supabase/functions/_shared/liveffn.js`, `supabase/functions/_shared/cors.js`, `supabase/functions/liveffn-proxy/index.ts`, `supabase/functions/delete-account/index.ts` · Modify `supabase/config.toml` (`verify_jwt = true` pour les deux) · Test `tests/unit/liveffn-proxy.test.js`

**Interfaces :**
- Produces :
  - `buildLiveffnUrl(competition: string, structure: number) -> string | null`, dans `_shared/liveffn.js` (JS pur, testé par Vitest). Renvoie `null` si `competition` n'est pas `^\d{1,7}$`. Sinon : `https://www.liveffn.com/cgi-bin/resultats.php?competition=<id>&langue=fra&go=detail&action=structure&structure=<structure>`.
  - `corsHeaders(origin) -> Record<string,string>`. Autorise `Authorization, apikey, Content-Type` ; l'origine est reprise de la requête.
  - `GET /functions/v1/liveffn-proxy?competition=<id>&structure=39` avec JWT. Réponses : 401 sans jeton, 403 si le compte n'est pas activé (lecture de `coaches` avec le jeton de l'appelant), 400 si l'id est invalide. Sinon, le texte de la page liveffn (`text/html; charset=utf-8`), délai de 12 s. La structure vient de la configuration (39), le paramètre client est ignoré.
  - `POST /functions/v1/delete-account` avec JWT : lit l'utilisateur ; avec la clé `service_role` (variable d'environnement fournie par Supabase, jamais dans le dépôt), cherche les espaces dont il est le **seul** membre, supprime leurs objets `photos/<team_id>/` (pagination de `list`) puis ces espaces ; appelle ensuite `auth.admin.deleteUser(uid)`. Les adhésions aux espaces partagés partent en cascade, les données de ces espaces restent. Renvoie `{ ok: true, deletedTeams: n }`.

- [ ] **Step 1 : tests qui échouent** : `buildLiveffnUrl('12345', 39)` contient `competition=12345` et `structure=39` ; `buildLiveffnUrl('1;rm', 39)`, `buildLiveffnUrl('', 39)` et `buildLiveffnUrl('https://evil', 39)` renvoient `null` ; `corsHeaders('https://swimmcoachapp.github.io')['Access-Control-Allow-Origin']` vaut cette origine ; `soleMemberTeams(memberships, uid)` (fonction pure dans `_shared/teams.js`) renvoie uniquement les espaces où `uid` est seul.
- [ ] **Step 2 : `npx vitest run tests/unit/liveffn-proxy.test.js`.** Attendu : échec.
- [ ] **Step 3 : implémenter**, puis déployer les deux fonctions avec `deploy_edge_function` (`verify_jwt: true`). Vérifier l'URL liveffn sur une vraie compétition : récupérer un id dans l'historique ou demander à Damien, et vérifier que `parseLiveFFNHTML` de `club4` (tâche 16) trouve au moins un nageur. Si le format diffère, ajuster `buildLiveffnUrl` et le test.
- [ ] **Step 4 : vérifier** les tests unitaires (réussite), puis appeler les fonctions déployées sans jeton. Attendu : 401 pour les deux.
- [ ] **Step 5 : commit** `feat(functions): proxy liveffn sécurisé et suppression de compte`

### Task 7 : client Supabase, session, authentification et choix de l'espace

**Files :** Create `src/core/supabase.js`, `src/core/session.js`, `src/core/teams.js`, `src/features/auth/index.js`, `src/features/auth/view.js`, `src/features/teams/picker.js`, `src/styles/auth.css`, `tests/e2e/fake-supabase.js`, `tests/e2e/auth.spec.js` · Modify `src/main.js`

**Interfaces :**
- Consumes : `coachStore`, `clearAllCoachData` (tâche 2) ; `redeem_invite_code` (tâche 4) ; `create_team`, `claim_my_invites` (tâche 4 bis).
- Produces :
  - `supabase` (client `createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { storageKey: 'swimcoach2_auth', persistSession: true } })`).
  - `session.js` : `getCoach() -> {id, email, activated:boolean} | null`, `onCoachChange(cb)`, `signIn(email, pw)`, `signUp(email, pw)` (refus local si moins de 10 caractères), `redeemCode(code) -> 'ok' | 'bad' | 'too_many'`, `sendPasswordReset(email)`, `updatePassword(pw)`, `signOut({force:boolean}) -> 'done' | 'pending'` (`'pending'` si l'outbox n'est pas vide et que `force` est faux ; voir tâche 8).
  - `teams.js` : `listMyTeams() -> [{id, name}]` (après `claim_my_invites()`), `getCurrentTeam() -> {id, name} | null`, `setCurrentTeam(id)` (retenu dans `coachStore(coachId).set('team')`), `onTeamChange(cb)`, `createTeam(name) -> id`.
  - `main.js` : garde de démarrage. Sans session → écran de connexion ; session non activée → écran du code ; activée sans espace → écran « Crée ton espace » (« Nom de l'espace », bouton « Créer », et le texte « Un collègue peut aussi t'ajouter à son espace avec ton adresse e-mail. ») ; activée avec au moins un espace → `startApp(coach, team)` (tâche 9) sur le dernier espace ouvert, ou le premier.
  - `fake-supabase.js` : `installFakeSupabase(page, {users, teams, members, tables})`. Faux serveur en mémoire branché avec `page.route` sur `**/auth/v1/**`, `**/rest/v1/**` (y compris les RPC), `**/storage/v1/**` et `**/functions/v1/**`, avec pagination `Range`/`limit`/`offset`, filtrage par appartenance du jeton aux espaces (imitation de la RLS) et `upsert` avec `on_conflict`. Il peut être partagé entre deux pages (deux entraîneurs) pour les tests à plusieurs. Toutes les specs e2e l'utilisent.
- Textes exacts : « Se connecter », « Créer un compte », « Mot de passe oublié ? », « Code du club », « Le mot de passe doit faire au moins 10 caractères », « Code incorrect », « Trop d'essais, réessaie dans une heure », « Vérifie ta boîte mail pour confirmer ton adresse », « Crée ton espace ».

- [ ] **Step 1 : tests e2e qui échouent** (`auth.spec.js`) : (a) inscription avec un mot de passe de 9 caractères, le message s'affiche ; (b) connexion d'un compte non activé, l'écran « Code du club » s'affiche, « faux » donne « Code incorrect », le bon code mène à « Crée ton espace », la création mène au calendrier ; (c) un compte invité dans un espace arrive directement sur le calendrier de cet espace après le code ; (d) le faux serveur renvoie `too_many_attempts`, « Trop d'essais… » s'affiche ; (e) « Mot de passe oublié ? » appelle `/auth/v1/recover` ; (f) après déconnexion, aucune clé `swimcoach2_<id>_*` ne reste et `swimcoach_v2` (pré-rempli) est intact.
- [ ] **Step 2 : `npx playwright test tests/e2e/auth.spec.js`.** Attendu : échec.
- [ ] **Step 3 : implémenter.** Les écrans reprennent les classes du design Club (`form-input`, boutons de `club4`). Le lien de réinitialisation du mot de passe revient sur l'app avec l'événement `PASSWORD_RECOVERY` et ouvre un écran « Nouveau mot de passe ».
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(auth): connexion, inscription par code, choix de l'espace`

### Task 8 : cache, file d'attente et synchronisation

**Files :** Create `src/core/store.js`, `src/core/outbox.js`, `src/core/sync.js` · Test `tests/unit/sync.test.js`, `tests/unit/outbox.test.js`

**Interfaces :**
- Consumes : `coachStore`, `teamStore` (tâche 2), `supabase`, `getCoach`, `getCurrentTeam`, `listMyTeams` (tâche 7).
- Produces :
  - `store.js` : `db` en mémoire `{groups, swimmers, sessions, presence, plan_weeks, plan_events, performances}` de l'**espace ouvert**. Chaque table est une `Map` indexée par la clé primaire ; la clé de `presence` est `${session_id}:${swimmer_id}`, celle de `plan_weeks` est `week_key`. Fonctions : `loadCache(coachId, teamId)`, `saveCache()` (différée de 300 ms, dans `teamStore`), `upsertLocal(table, row)` (pose `team_id` de l'espace ouvert), `deleteLocal(table, key)`, `subscribe(table, cb)` pour rafraîchir l'interface, `resetStore()` au changement d'espace.
  - `outbox.js` : `enqueue(op: {table, kind:'upsert'|'delete', key, row?})` (persistée dans `teamStore(coachId, teamId).set('outbox')`, chaque op porte le `coachId` et le `teamId` du moment), `pendingCount(teamId?)` (tous espaces si absent), `pendingKeys(table) -> Set`, `flush(supabase, coachId, teamId)`, `dropTeam(coachId, teamId)`. `flush` envoie dans l'ordre, retire chaque op après succès, s'arrête à la première erreur réseau et **ignore (sans les envoyer) les ops dont `coachId` ou `teamId` diffère** de l'entraîneur connecté et de l'espace visé. L'upsert utilise `onConflict` selon la table (`presence` : `session_id,swimmer_id` ; `plan_weeks` : `team_id,week_key` ; `performances` : `team_id,swimmer_id,competition_id,event_code,phase`). Une erreur RLS (`42501`) n'est pas une erreur réseau : elle déclenche `checkMembership()`.
  - `sync.js` : `fetchAll(table, teamId) -> rows[]` (filtre `team_id=eq.<teamId>`, pages de 1000 avec `.range()`, lève une erreur si une page échoue) ; `mergeTable(table, remoteRows)` : le serveur fait foi, sauf pour les clés présentes dans `pendingKeys(table)`, qui gardent la version locale ; une ligne absente du serveur et non en attente est retirée localement. `checkMembership() -> boolean` : relit `listMyTeams()` ; si l'espace ouvert n'y est plus, appelle `dropTeam`, `teamStore(...).clear()`, affiche le toast « Tu n'as plus accès à l'espace « <nom> » » et bascule sur un autre espace (ou l'écran « Crée ton espace »). `initialSync()` : `checkMembership`, charge les 7 tables, puis `flush`. `startLive()` : temps réel filtré `team_id=eq.<teamId>` pour chaque table, plus `team_members` pour l'entraîneur connecté (retrait détecté tout de suite), avec un délai de 800 ms par table avant `fetchAll` + `mergeTable` ; au retour de l'app au premier plan (`visibilitychange`) et sur l'événement `online` : `flush` puis `initialSync`. Changer d'espace : `flush` de l'ancien, désabonnement, `resetStore`, `loadCache`, `initialSync`, `startLive`.
  - Photos : pas d'outbox ; `uploadPhoto` (tâche 10) exige le réseau.

- [ ] **Step 1 : tests qui échouent**

```js
test('fetchAll pagine au-delà de 1000 lignes', async () => { /* faux client : 2400 lignes */ expect((await fetchAll('presence')).length).toBe(2400); });
test('fetchAll lève une erreur si une page échoue (pas de remplacement par une liste tronquée)', ...);
test('mergeTable garde la version locale en attente et retire ce que le serveur a supprimé', () => {
  // local {1:v2 en attente, 2:v1, 3:v1} ; serveur {1:v1, 2:v1}  →  {1:v2, 2:v1}
});
test("flush n'envoie jamais les ops d'un autre entraîneur", async () => {
  enqueue({table:'swimmers', kind:'upsert', key:'x', row:{id:'x'}}); // en tant que A
  // B se connecte : flush(client, 'B') → 0 appel réseau, op de A conservée
});
test("flush n'envoie pas les ops d'un espace vers un autre", ...); // op de T1 en attente, flush(client,'A','T2') → 0 appel
test('retiré de l’espace : 42501 au flush → checkMembership, cache et ops de cet espace effacés, toast affiché', ...);
test('mergeTable applique une modification faite par un autre membre (updated_by ≠ moi)', ...);
test('flush s’arrête à la première erreur réseau et garde l’ordre', ...);
test('upsert de présence utilise onConflict session_id,swimmer_id', ...);
```
- [ ] **Step 2 : `npx vitest run tests/unit/sync.test.js tests/unit/outbox.test.js`.** Attendu : échec.
- [ ] **Step 3 : implémenter.** Reprendre la logique de `club4` (1682–2093, `supaGetAll` 2063) en la simplifiant : le rôle de `isRecentlySaved` est tenu par `pendingKeys`. Dans `session.js`, quand `onCoachChange` passe d'un entraîneur à un autre, appeler `clearAllCoachData()` si l'outbox de l'ancien entraîneur n'est pas vide (l'avertissement s'affiche à la déconnexion volontaire ; dans le cas d'une session expirée, la tâche 17 affiche le même avertissement avant la connexion de B).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(core): cache local, file d'attente et synchro paginée`

### Task 9 : coque de l'app, styles Club, thème et mise à jour

**Files :** Create `src/app/shell.js`, `src/app/actions.js`, `src/app/html.js`, `src/app/theme.js`, `src/app/toast.js`, `src/app/update.js`, `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/club.css`, `public/icons/*` · Modify `index.html`, `vite.config.js`, `src/main.js` · Test `tests/unit/html.test.js`, `tests/e2e/shell.spec.js`

**Interfaces :**
- Produces :
  - `esc(str) -> string` (échappe `& < > " '`) et le gabarit balisé `` html`...${x}...` `` qui échappe chaque valeur, sauf celles enveloppées par `raw(str)`. `sanitizeRich(html) -> string` : ne garde que `b, i, u, br, div, p, ul, ol, li, span`, sans aucun attribut (DOMParser).
  - `on(action: string, handler: (el: HTMLElement, ev: Event) => void)` : un seul écouteur `click` (et `change`/`input` selon `data-on`) sur `document`, qui appelle le handler du `data-action` le plus proche. Les valeurs passent par `data-id`, `data-key`, etc.
  - `startApp(coach, team)`, `registerScreen(name, {title, render(root), icon})`, `showScreen(name)`, `openModal(id)`, `closeModal(id)` (feuilles du bas de `club4`, balisage repris de 4669 et suivantes). Écrans : `calendar`, `contacts`, `stats`, `planning`, `perfs`, `settings`. La barre du haut affiche le nom de l'espace ouvert ; un appui ouvre la liste des espaces de l'entraîneur pour en changer (`setCurrentTeam`).
  - `toast(msg)`, `applyTheme('light'|'dark')` (stocké dans `appStore 'theme'`).
  - `update.js` : `registerSW` de `vite-plugin-pwa` (`registerType: 'prompt'`), bandeau « Nouvelle version disponible — Recharger ». Manifest : `name: 'SwimCoach App'`, `start_url: './'`, `display: 'standalone'`, couleurs du thème Club.
- Styles : copier les CSS de `club4` (17–1017) en les répartissant dans `tokens.css` (variables de thème, 19–75), `base.css`, `club.css` (765–1017), puis un fichier par fonctionnalité dans les tâches suivantes. Polices `@fontsource/bricolage-grotesque` et `@fontsource/inter`, importées dans `main.js`. Barre du haut : nageur blanc sur bleu (SVG de `club4`, 75–152).

- [ ] **Step 1 : tests qui échouent** : `` html`<b>${'<img src=x onerror=alert(1)>'}</b>` `` donne `<b>&lt;img src=x onerror=alert(1)&gt;</b>` ; `sanitizeRich('<b onclick="x">a</b><script>1</script><img src=x>')` donne `<b>a</b>` ; e2e : la navigation entre les 6 écrans fonctionne au clic, le thème sombre persiste après rechargement, et la page ne fait aucune requête vers `fonts.googleapis.com`, `unpkg.com` ni `cdn.jsdelivr.net` (vérifié avec `page.on('request')`).
- [ ] **Step 2 : lancer les tests.** Attendu : échec.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer les tests, puis `npm run build && npm run guards`.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(app): coque, design Club, thème et bandeau de mise à jour`

### Task 10 : contacts, groupes, saisons et photos

**Files :** Create `src/core/dates.js`, `src/core/season.js`, `src/core/photos.js`, `src/features/contacts/{index,view,logic}.js`, `src/styles/contacts.css` · Test `tests/unit/season.test.js`, `tests/unit/dates.test.js`, `tests/e2e/contacts.spec.js`

**Interfaces :**
- Consumes : `db`, `upsertLocal`, `enqueue` (tâche 8) ; `html`, `on`, `registerScreen`, `openModal` (tâche 9).
- Produces :
  - `dates.js` : `dateKey(y, m0, d) -> 'YYYY-MM-DD'`, `todayKey(now = new Date())` (date locale, jamais `toISOString`), `monthKey(dateKey) -> 'YYYY-MM'`.
  - `season.js` (repris de `club4` 3656–3700, 5537–5543) : `seasonOfDateKey(k)`, `currentSeason(now = new Date())`, `swimmerIsActive(sw)`, `swimmerInSeason(sw, S)`, `swimmerEligibleForComp(sw, compSeason, now)`.
  - `photos.js` : `resizeImage(file, maxSide = 800, quality = 0.82) -> Blob (image/jpeg)`, `uploadPhoto(kind:'swimmers'|'sessions', id, blob) -> path` (`<teamId>/<kind>/<id>.jpg`, `upsert: true`), `photoUrl(path) -> Promise<string>` (`createSignedUrl` d'une heure, mis en cache en mémoire seulement), `deletePhoto(path)`.
  - `contacts/logic.js` : `saveSwimmer(form)` (nouveau nageur : `id = crypto.randomUUID()`, `joined_season = currentSeason()`), `archiveSwimmer(id, season = currentSeason())`, `restoreSwimmer(id)`, `deleteSwimmer(id)`, `addGroup(name)`, `deleteGroup(id)`, `listSwimmers({search, filter:'actifs'|'archives'})`. Groupes par défaut à la création d'un espace (liste `DEFAULT_GROUPS` de `club4`), créés comme des lignes `groups` de cet espace.

- [ ] **Step 1 : tests qui échouent** : `seasonOfDateKey('2026-08-31') === 2025`, `seasonOfDateKey('2026-09-01') === 2026` ; `todayKey(new Date('2026-11-19T23:30:00Z'))` donne `'2026-11-20'` quand `TZ=Europe/Paris` (lancer Vitest avec `TZ=Europe/Paris` dans le script `test`) ; `swimmerInSeason({joined_season:2024,left_season:2025}, 2026) === false`. E2E : créer un nageur avec photo (l'envoi va au faux serveur de stockage sous `<teamId>/swimmers/`), le modifier, l'archiver (il disparaît des « Actifs » et apparaît dans les « Archivés »), le restaurer, ajouter puis supprimer un groupe, et vérifier qu'un nageur nommé `<img src=x onerror=alert(1)>` s'affiche comme texte (aucune boîte de dialogue).
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter**, en reprenant le rendu et les comportements de `club4` 3159–3643 (liste, fiche, recherche différée de 150 ms, popup de contact, confirmation de suppression).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(contacts): nageurs, groupes, archivage et photos privées`

### Task 11 : import Excel / CSV

**Files :** Create `src/features/contacts/import.js` · Test `tests/unit/import.test.js`, `tests/e2e/import.spec.js`, `tests/fixtures/nageurs.xlsx`, `tests/fixtures/nageurs.csv`

**Interfaces :**
- Consumes : `saveSwimmer`, `listSwimmers`, `addGroup` (tâche 10).
- Produces : `parseImportFile(file) -> Promise<{rows: ImportRow[], errors: string[]}>`, avec `ImportRow = {firstname, lastname, dob: 'YYYY-MM-DD'|null, group, phone, email}`. `planImport(rows, existing) -> {toCreate, duplicates, ignoredArchived}` : clé `normalizeName(lastname)|normalizeName(firstname)`, reprise de `normalizeName` de `club4` ; un nageur archivé avec la même clé est compté dans `ignoredArchived`, il n'est pas recréé. `downloadTemplate()` : même fichier modèle que `club4`. Lecture `.xlsx` : `read-excel-file` (npm), chargé avec `import()` ; CSV : parseur repris de `parseCSVNative` (`club4` 4919).

- [ ] **Step 1 : tests qui échouent** : la cellule `45000` (nombre de série Excel) donne `'2023-03-15'` ; `'05/09/2014'` donne `'2014-09-05'` ; une ligne vide est ignorée ; « DUPONT Léa » face à un « dupont lea » existant compte comme doublon ; un homonyme archivé est classé dans `ignoredArchived`. E2E : l'import de `nageurs.xlsx` affiche l'aperçu (« N à créer, M doublons, 📦 K archivés ignorés »), puis crée exactement N nageurs.
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter** (aperçu et textes repris de `club4` 4906–5277).
- [ ] **Step 4 : relancer.** Attendu : réussite. Vérifier aussi que `dist/` ne charge le lecteur Excel qu'à l'ouverture de l'import (morceau séparé dans `dist/assets`).
- [ ] **Step 5 : commit** `feat(contacts): import Excel/CSV sans doublons`

### Task 12 : calendrier et séances

**Files :** Create `src/features/calendar/{index,view,logic}.js`, `src/styles/calendar.css` · Test `tests/unit/calendar.test.js`, `tests/e2e/calendar.spec.js`

**Interfaces :**
- Consumes : `dates.js`, `photos.js` (tâche 10), `sanitizeRich` (tâche 9), `db`/`enqueue` (tâche 8).
- Produces : `saveSession({id?, date, title, type, time, content, km, photoBlob?, removePhoto?}) -> session` (`km` mis à `null` quand `type === 'musc'`, comme dans `club4` 2886), `deleteSession(id)` (supprime aussi la photo), `sessionsOn(dateKey)`, `planMarksForMonth(y, m0) -> Map<dateKey, mark>` (priorité `comp > stage > nat > obj > note`, `club4` 2742–2771). L'écran `calendar` contient le mois, le panneau du jour et la modale séance (éditeur riche de `club4` 3153).

- [ ] **Step 1 : tests qui échouent** : `planMarksForMonth` avec un stage et une compétition le même jour renvoie la compétition ; une séance `musc` enregistrée avec `km: 5` donne `km === null` ; un contenu `<b>ok</b><img src=x onerror=1>` est stocké et affiché comme `<b>ok</b>`. E2E : créer une séance à une date donnée, la modifier, ajouter une photo (envoyée sous `<teamId>/sessions/`), la supprimer ; naviguer d'un mois à l'autre ; avec l'horloge Playwright réglée au 20/11/2026 à 00:30 (heure de Paris), « Aujourd'hui » ouvre le 20.
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter** (`club4` 2731–3152 et 2461–2730).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(calendar): calendrier, séances et photo de séance`

### Task 13 : présences et appel

**Files :** Create `src/features/presence/{index,view,logic}.js`, `src/styles/presence.css` · Test `tests/unit/presence.test.js`, `tests/e2e/presence.spec.js`

**Interfaces :**
- Consumes : `db`, `enqueue` (tâche 8), `swimmerInSeason`/`seasonOfDateKey` (tâche 10), modale séance (tâche 12).
- Produces : `togglePresence(sessionId, swimmerId, present: boolean)` (une op par nageur : `upsert` ou `delete` sur la clé `session_id:swimmer_id`) ; `rollCallList(session) -> swimmer[]` (nageurs du groupe pour la saison de la séance, archivés exclus, ordre de `club4`) ; `presenceGauge(sessionId) -> {present, total}`, affichée « N / M présents » avec la barre qui monte du design Club. Pour une séance pas encore enregistrée, les coches restent en mémoire et ne sont envoyées qu'à l'enregistrement : aucune ligne `___new`. L'appel compétition est la même fenêtre pour les séances de type `comp`.

- [ ] **Step 1 : tests qui échouent** : cocher A, B, C puis décocher B en rafale donne exactement les ops `upsert A, upsert B, upsert C, delete B`, et l'état final est `{A, C}` ; `rollCallList` exclut un nageur archivé la saison précédente ; une séance non enregistrée ne crée aucune op avant `saveSession`. E2E : ouvrir l'appel, cocher 12 nageurs sur 16, la jauge affiche « 12 / 16 présents » ; recharger la page, les coches sont toujours là. **Deux entraîneurs, même espace** (deux pages Playwright sur le même faux serveur, temps réel simulé) : A coche les nageurs 1 à 6 pendant que C coche 7 à 12 sur la même séance ; après synchro, les deux pages affichent « 12 / 16 présents » et le serveur a exactement 12 lignes.
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter** (`club4` 2600–2730 et `renderModalPresence`).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(presence): appel par séance et jauge de présence`

### Task 14 : module PDF, statistiques et PDF des stats

**Files :** Create `src/features/pdf/index.js`, `src/features/stats/{index,view,logic}.js`, `src/styles/stats.css` · Test `tests/unit/stats.test.js`, `tests/e2e/stats.spec.js`

**Interfaces :**
- Produces :
  - `exportPdf(html: string, name: string) -> void`. Sur le web : comportement de `club4` (fenêtre imprimable, avec ses polices embarquées en `@font-face` à partir des fichiers de `@fontsource` résolus par Vite). La version native sera branchée plus tard, derrière la même fonction.
  - `computeStats({scope:'month'|'season', y, m0?}) -> {sessions: {nat, musc, comp}, km, perSwimmer: [{swimmer, natPres, muscPres, compPres, natPct, muscPct, compPct}]}`. Règles de `club4` 3731 : `other` compte comme natation, `comp` est une catégorie à part.
  - `statsPdfHtml(stats) -> string` (style Club : cartes arrondies, barres, pastille km). Graphique de progression avec Chart.js (npm, `import { Chart, ... } from 'chart.js'`, uniquement les modules utilisés).

- [ ] **Step 1 : tests qui échouent** : avec 2 séances `nat` (dont une de 3 km), 1 `other` de 2 km, 1 `comp` et 1 `musc`, `computeStats` donne `sessions = {nat:3, musc:1, comp:1}` et `km = 5` ; les pourcentages de chaque nageur suivent `club4`. E2E : l'écran stats affiche ces chiffres ; le bouton PDF appelle `exportPdf` avec un HTML qui contient le nom du premier nageur (`window.open` intercepté).
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter** (`club4` 3644–4109, styles PDF 3979–4039).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(stats): statistiques, graphique et PDF des stats`

### Task 15 : planning et PDF du planning

**Files :** Create `src/features/planning/{index,view,logic}.js`, `src/styles/planning.css` · Test `tests/unit/planning.test.js`, `tests/e2e/planning.spec.js`

**Interfaces :**
- Consumes : `exportPdf` (tâche 14), `dates.js`/`season.js` (tâche 10), `db`/`enqueue` (tâche 8).
- Produces : `savePlanWeek(weekKey, seasonStart, content, kmTarget, zone)` (pose toujours `updated_at`), `savePlanEvent({id?, type, title, description, start, end})` (`month_key = monthKey(start)`), `deletePlanEvent(id)`, `isoWeekKey(date) -> 'YYYY-Www'`, `weeksOfMonth(year, m0) -> [{mondayDate, sundayDate, weekKey, weekLabel, overlapsMonths}]` (repris de `club4` 4130–4200 : une semaine à cheval sur deux mois apparaît dans les deux et partage son contenu), `planningPdfHtml(seasonStart) -> string`. Les sauvegardes locales `backupPlanning` de `club4` ne sont **pas** reprises : la file d'attente et `pendingKeys` les remplacent.

- [ ] **Step 1 : tests qui échouent** : `isoWeekKey(new Date(2026,0,1)) === '2026-W01'` et `isoWeekKey(new Date(2027,0,1)) === '2026-W53'` ; `weeksOfMonth(2026, 8)[0]` commence le lundi 31/08/2026, a `overlapsMonths: true` et la même `weekKey` que la dernière semaine de `weeksOfMonth(2026, 7)` ; `savePlanEvent` avec `start: '2026-12-05'` donne `month_key: '2026-12'`. E2E : modifier le contenu et l'objectif km d'une semaine, créer un stage sur 3 jours (il apparaît sur le calendrier), exporter le PDF du planning.
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter** (`club4` 4110–4833, styles 4614–4669).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(planning): planning annuel, événements et PDF`

### Task 16 : performances liveffn et bilan individuel

**Files :** Create `src/features/perfs/{index,view,logic,parse}.js`, `src/styles/perfs.css`, `tests/fixtures/liveffn-sample.html` · Test `tests/unit/perfs-parse.test.js`, `tests/e2e/perfs.spec.js`

**Interfaces :**
- Consumes : `swimmerEligibleForComp`, `seasonOfDateKey` (tâche 10) ; `exportPdf` (tâche 14) ; `supabase.functions.invoke` (tâche 7) ; proxy de la tâche 6.
- Produces : `parse.js` = `FFN_EVENTS`, `parseLiveFFNHTML(html)`, `normalizeName`, `matchSwimmersToDB(parsed, compDate, swimmers)`, copiés **tels quels** de `club4` 5293–5573 (seule différence : `swimmers` passé en paramètre au lieu de `DB.swimmers`). `fetchLiveFFN(competitionId) -> html` (GET avec JWT, délai de 15 s, `AbortController`). `importCompetition(compId)` : aperçu, puis upsert des perfs avec `onConflict 'team_id,swimmer_id,competition_id,event_code,phase'`, chaque ligne avec un `id = crypto.randomUUID()` neuf (le serveur garde l'id existant en cas de conflit). `bilanPdfHtml(swimmerId) -> string` (fiche A4 style Club, `club4` 6345–6398). Saisie : « URL liveffn ou ID compétition », extraction de l'id comme dans `club4`.

- [ ] **Step 1 : tests qui échouent** : `parseLiveFFNHTML(fixture)` renvoie les nageurs, épreuves, temps, rangs, points et fractionnés attendus (fixture : une page liveffn réelle récupérée avec le proxy déployé à la tâche 6, anonymisée si besoin, avec les valeurs attendues relevées à la main) ; `matchSwimmersToDB` trouve « MARTIN Léo » face à « Léo Martin » (ordre inversé) et ignore un archivé pour une compétition de la saison en cours. E2E : avec le proxy simulé, importer une compétition, l'aperçu montre « N perfs, 📦 K archivés ignorés » ; après import, la fiche perfs affiche le graphique ; un 2e import ne crée pas de doublons ; le PDF du bilan contient le meilleur temps.
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter** (`club4` 5278–6575).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(perfs): import liveffn, progression et bilan PDF`

### Task 17 : réglages, membres de l'espace, déconnexion et suppression du compte

**Files :** Create `src/features/settings/{index,view}.js`, `src/features/teams/members.js`, `src/styles/settings.css` · Test `tests/e2e/settings.spec.js`, `tests/e2e/team-members.spec.js`, `tests/e2e/same-device.spec.js`

**Interfaces :**
- Consumes : `signOut`, `pendingCount`, `listMyTeams`, `setCurrentTeam`, `checkMembership` (tâches 7 et 8), groupes (tâche 10), `applyTheme` (tâche 9), RPC de la tâche 4 bis, `delete-account` (tâche 6).
- Produces : écran Réglages (nom affiché → `coaches.display_name`, thème, groupes, « Se déconnecter », « Supprimer mon compte »). À la déconnexion avec `pendingCount() > 0` : fenêtre « N modifications ne sont pas encore envoyées » avec les choix « Attendre le réseau » et « Se déconnecter quand même » (ce dernier appelle `signOut({force:true})`). La suppression du compte demande de taper `SUPPRIMER`, prévient « Les espaces dont tu es le seul membre seront supprimés avec leurs données », appelle `delete-account`, puis `clearAllCoachData()` et ramène à l'écran de connexion.
  - Section « Espace » des réglages (`members.js`) : renommer l'espace (`rename_team`) ; liste des membres (nom affiché, e-mail) avec « Retirer » sur chacun, y compris soi-même sous le libellé « Quitter l'espace » (`remove_team_member`, confirmation ; message « Tu es le dernier membre : supprime l'espace si tu n'en as plus besoin » sur `last_member`) ; champ « Ajouter un entraîneur (adresse e-mail) » (`add_team_member` : `added` → « <email> a été ajouté », `invited` → « Invitation en attente : demande à <email> de créer son compte avec cette adresse », `already_member` → « Déjà membre », `invalid_email` → « Adresse e-mail invalide », `too_many_invites` → « Trop d'invitations, réessaie dans une heure ») ; liste des invitations en attente avec « Annuler » (`cancel_invite`) ; « Créer un autre espace » (`create_team`) ; « Supprimer l'espace et toutes ses données » (taper le nom de l'espace ; supprime d'abord les fichiers `photos/<teamId>/`, puis `delete_team`).

- [ ] **Step 1 : tests qui échouent** : (a) hors ligne, une modification en attente, puis « Se déconnecter » affiche « 1 modification n'est pas encore envoyée » ; « Se déconnecter quand même » vide l'outbox et toutes les clés `swimcoach2_<A>_*`. (b) Même navigateur : A crée 3 nageurs et une photo, se déconnecte ; B se connecte et ne voit aucun nageur, aucune URL de photo de A ne reste en mémoire, aucune clé `swimcoach2_<A>_` n'existe, et le faux serveur n'a reçu aucune requête avec le jeton de B portant une ligne de A. (c) La session de A expire hors ligne avec une op en attente, B se connecte : l'avertissement s'affiche, et l'op de A n'est jamais envoyée. (d) La suppression du compte appelle `delete-account` et ramène à la connexion. (e) `team-members.spec.js`, deux pages : A ajoute C par e-mail (« a été ajouté »), C voit l'espace et ses nageurs après rechargement ; A invite `d@club.fr` sans compte (« Invitation en attente »), l'invitation apparaît puis s'annule ; C retire A, et la page de A affiche « Tu n'as plus accès à l'espace … », bascule sur l'écran « Crée ton espace », et n'a plus aucune clé `swimcoach2_<A>_<TA>_*` ; C, dernier membre, voit le message `last_member` en voulant quitter. (f) Retiré pendant qu'il est hors ligne avec une op en attente : au retour du réseau, l'op n'est pas renvoyée, le cache de l'espace est effacé et le message s'affiche.
- [ ] **Step 2 : lancer.** Attendu : échec.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat(settings): réglages, membres de l'espace, déconnexion sûre et suppression du compte`

### Task 18 : préparation aux stores et hors ligne

**Files :** Create `capacitor.config.json`, `public/privacy.html`, `public/icons/icon-1024.png`, `public/splash.png`, `docs/store-readiness.md`, `docs/demo-account.md` · Test `tests/e2e/offline.spec.js`

**Interfaces :**
- Produces : `capacitor.config.json` = `{ "appId": "fr.toacnatation.swimcoach", "appName": "SwimCoach App", "webDir": "dist" }` (identifiant provisoire, à confirmer par Damien), sans dépendance Capacitor installée ni dossier natif. `privacy.html` : texte en français (responsable de traitement : le club ; données traitées ; hébergement UE `eu-west-1` ; durée de conservation « à définir par le club » ; droits et suppression du compte depuis l'app ; contact). Un lien « Confidentialité » sur l'écran de connexion et dans les Réglages. `demo-account.md` : procédure de création d'un compte de démonstration pour les relecteurs (inscription, puis code du club, puis jeu de données fictif) et de suppression. `store-readiness.md` : les éléments de la section 9 de la spec qui restent à la charge de Damien ou du club, cochés ou non.

- [ ] **Step 1 : test qui échoue** (`offline.spec.js`) : charger l'app, laisser le service worker s'installer (build de prévisualisation : `vite preview`), passer `context.setOffline(true)`, recharger. Le calendrier et les contacts s'affichent depuis le cache ; une séance créée hors ligne apparaît localement ; avec `setOffline(false)`, l'upsert part vers le faux serveur.
- [ ] **Step 2 : lancer** `npx playwright test tests/e2e/offline.spec.js`. Attendu : échec.
- [ ] **Step 3 : implémenter** (précache Workbox des assets de `dist`, pas de mise en cache des réponses `/rest/v1/`).
- [ ] **Step 4 : relancer.** Attendu : réussite.
- [ ] **Step 5 : commit** `feat: préparation stores, confidentialité et hors ligne`

### Task 19 : vérification finale et mise en ligne

**Files :** Modify `README.md` (démarrage, déploiement, définir le code du club, procédure des tests de base), `docs/security-notes.md`

- [ ] **Step 1 : relancer tous les tests pgTAP** sur `zuguceilohochmpnbzaz` avec `rollback`. Attendu : tous `ok`. Puis `get_advisors` sécurité et performance. Attendu : aucune alerte de sécurité non justifiée.
- [ ] **Step 2 : `npm ci && npm run guards && npm test && npm run build && node scripts/check-guards.mjs dist && npx playwright test`.** Attendu : tout passe. Contrôler la liste d'acceptation de la spec (section 10, points 1 à 10), point par point, et noter dans le README le test qui couvre chacun.
- [ ] **Step 3 : vérifier dans `dist/`** : `grep -r "aijgczmszymfjkeegbjz\|vijexmmydvgfpkyzkgls\|service_role\|sb_secret_" dist` ne trouve rien ; `grep -o "swimcoach_v2\|__app_version__" -r dist` ne trouve rien.
- [ ] **Step 4 : pousser la branche, ouvrir une PR vers `main`, CI verte.** La fusion et la première mise en ligne attendent l'accord de Damien. Prérequis à lui rappeler : activer GitHub Pages (source « GitHub Actions »), définir le code du club (`select private.set_invite_code('…')` dans l'éditeur SQL), configurer le SMTP, puis ajouter l'URL Pages dans Auth → URL Configuration (Site URL et Redirect URLs).
- [ ] **Step 5 : commit** `docs: README et notes de sécurité`
