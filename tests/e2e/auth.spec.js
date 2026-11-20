import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

const PW = 'motdepasse-long';

async function login(page, email, pw = PW) {
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(pw);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test('(a) un mot de passe de 9 caractères est refusé avant tout appel', async ({ page }) => {
  const fake = await installFakeSupabase(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Adresse e-mail').fill('nouveau@toac.fr');
  await page.getByLabel('Mot de passe').fill('123456789');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await expect(page.getByText('Le mot de passe doit faire au moins 10 caractères')).toBeVisible();
  expect(fake.callsTo('/auth/v1/signup')).toHaveLength(0);
});

test('(a bis) une inscription valide demande de confirmer l’adresse', async ({ page }) => {
  const fake = await installFakeSupabase(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Adresse e-mail').fill('nouveau@toac.fr');
  await page.getByLabel('Mot de passe').fill(PW);
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await expect(page.getByText('Vérifie ta boîte mail pour confirmer ton adresse')).toBeVisible();
  const calls = fake.callsTo('/auth/v1/signup');
  expect(calls).toHaveLength(1);
  // Le lien de confirmation doit revenir vers l'app, pas vers l'« URL du site » par défaut.
  const redirect = new URLSearchParams(calls[0].search).get('redirect_to');
  expect(redirect).toBe(new URL('/', page.url()).href);
  // Le formulaire disparaît : impossible de renvoyer l'inscription par erreur.
  await expect(page.getByLabel('Mot de passe')).toHaveCount(0);
  await expect(page.getByText('nouveau@toac.fr')).toBeVisible();
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
});

test('(b) compte non activé : code du club, puis création de l’espace, puis calendrier', async ({ page }) => {
  const fake = await installFakeSupabase(page, { users: [{ email: 'coach@toac.fr', password: PW }] });
  await page.goto('/');
  await login(page, 'coach@toac.fr');
  await expect(page.getByLabel('Code du club')).toBeVisible();

  await page.getByLabel('Code du club').fill('faux');
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText('Code incorrect')).toBeVisible();

  await page.getByLabel('Code du club').fill(fake.state.clubCode);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { name: 'Crée ton espace' })).toBeVisible();
  await expect(page.getByText("Un collègue peut aussi t'ajouter à son espace avec ton adresse e-mail.")).toBeVisible();

  await page.getByLabel("Nom de l'espace").fill('TOAC Natation');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-team-name]')).toContainText('TOAC Natation');
  expect(fake.state.tables.teams.map((t) => t.name)).toEqual(['TOAC Natation']);
});

test('(c) un compte invité arrive directement sur le calendrier de l’espace', async ({ page }) => {
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'invite@toac.fr', password: PW }],
    teams: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Pôle Formation' }],
    members: [{ team_id: '11111111-1111-4111-8111-111111111111', email: 'invite@toac.fr' }],
  });
  await page.goto('/');
  await login(page, 'invite@toac.fr');
  await page.getByLabel('Code du club').fill(fake.state.clubCode);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-team-name]')).toContainText('Pôle Formation');
});

test('(c bis) une invitation en attente est réclamée à l’activation', async ({ page }) => {
  const fake = await installFakeSupabase(page, {
    teams: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Espace du collègue' }],
    members: [{ team_id: '22222222-2222-4222-8222-222222222222', email: 'tardif@toac.fr' }], // invitation
  });
  fake.addUser({ email: 'tardif@toac.fr', password: PW });
  await page.goto('/');
  await login(page, 'tardif@toac.fr');
  await page.getByLabel('Code du club').fill(fake.state.clubCode);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-team-name]')).toContainText('Espace du collègue');
});

test('(d) trop d’essais : le message s’affiche', async ({ page }) => {
  await installFakeSupabase(page, { users: [{ email: 'coach@toac.fr', password: PW }], tooManyAttempts: true });
  await page.goto('/');
  await login(page, 'coach@toac.fr');
  await page.getByLabel('Code du club').fill('quelconque');
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText("Trop d'essais, réessaie dans une heure")).toBeVisible();
});

test('(e) « Mot de passe oublié ? » appelle /auth/v1/recover avec le retour sur l’app', async ({ page }) => {
  const fake = await installFakeSupabase(page);
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
  await expect.poll(() => fake.callsTo('/auth/v1/recover').length).toBe(1);
  const call = fake.callsTo('/auth/v1/recover')[0];
  expect(call.body.email).toBe('coach@toac.fr');
  const redirect = new URL(`http://x/${call.search}`).searchParams.get('redirect_to');
  expect(redirect).toBe(new URL(page.url()).origin + '/');
});

test('(e bis) le lien de réinitialisation ouvre « Nouveau mot de passe »', async ({ page }) => {
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: PW, activated: true }],
    teams: [{ id: '33333333-3333-4333-8333-333333333333', name: 'TOAC' }],
    members: [{ team_id: '33333333-3333-4333-8333-333333333333', email: 'coach@toac.fr' }],
  });
  const s = fake.sessionFor('coach@toac.fr');
  await page.goto(`/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`);
  await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible();
  await page.getByLabel('Nouveau mot de passe').fill('court');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Le mot de passe doit faire au moins 10 caractères')).toBeVisible();
  await page.getByLabel('Nouveau mot de passe').fill('un-autre-mot-de-passe');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  expect(fake.state.users[0].password).toBe('un-autre-mot-de-passe');
});

test('(f) la déconnexion efface les données de l’entraîneur et laisse l’ancienne app intacte', async ({ page }) => {
  const teamId = '44444444-4444-4444-8444-444444444444';
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: PW, activated: true }],
    teams: [{ id: teamId, name: 'TOAC' }],
    members: [{ team_id: teamId, email: 'coach@toac.fr' }],
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('swimcoach_v2')) localStorage.setItem('swimcoach_v2', 'ANCIENNE-APP');
  });
  await page.goto('/');
  await login(page, 'coach@toac.fr');
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();

  const id = fake.coachId('coach@toac.fr');
  const keysBefore = await page.evaluate(() => Object.keys(localStorage));
  expect(keysBefore).toContain('swimcoach2_auth');
  expect(keysBefore).toContain(`swimcoach2_${id}_team`);

  await page.getByRole('button', { name: 'Réglages' }).click(); // la déconnexion est dans les réglages
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();

  const after = await page.evaluate(() => ({
    keys: Object.keys(localStorage),
    legacy: localStorage.getItem('swimcoach_v2'),
  }));
  expect(after.keys.filter((k) => k.startsWith('swimcoach2_') && k !== 'swimcoach2_theme')).toEqual([]);
  expect(after.legacy).toBe('ANCIENNE-APP');
});

test('(g) une session existante rouvre l’app sans reconnexion', async ({ page }) => {
  const teamId = '55555555-5555-4555-8555-555555555555';
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: PW, activated: true }],
    teams: [{ id: teamId, name: 'TOAC' }, { id: '66666666-6666-4666-8666-666666666666', name: 'Autre' }],
    members: [
      { team_id: teamId, email: 'coach@toac.fr' },
      { team_id: '66666666-6666-4666-8666-666666666666', email: 'coach@toac.fr' },
    ],
  });
  const session = fake.sessionFor('coach@toac.fr');
  await page.addInitScript(([s, id, team]) => {
    if (!localStorage.getItem('swimcoach2_auth')) {
      localStorage.setItem('swimcoach2_auth', JSON.stringify(s));
      localStorage.setItem(`swimcoach2_${id}_team`, JSON.stringify(team));
    }
  }, [session, session.user.id, '66666666-6666-4666-8666-666666666666']);
  await page.goto('/');
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-team-name]')).toContainText('Autre');
});

test('(h) une requête sans clé apikey reçoit 401', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/');
  const statuses = await page.evaluate(async () => {
    const out = [];
    for (const path of ['/rest/v1/teams', '/auth/v1/settings', '/storage/v1/object/x', '/functions/v1/liveffn-proxy']) {
      const r = await fetch(`https://zuguceilohochmpnbzaz.supabase.co${path}`);
      out.push(r.status);
    }
    return out;
  });
  expect(statuses).toEqual([401, 401, 401, 401]);
});

test('(i) l’espace mémorisé dont on n’est plus membre : ouvre le premier et réécrit la clé', async ({ page }) => {
  const teamId = '77777777-7777-4777-8777-777777777777';
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: PW, activated: true }],
    teams: [{ id: teamId, name: 'Seul espace' }],
    members: [{ team_id: teamId, email: 'coach@toac.fr' }],
  });
  const session = fake.sessionFor('coach@toac.fr');
  await page.addInitScript(([s, id]) => {
    if (!localStorage.getItem('swimcoach2_auth')) {
      localStorage.setItem('swimcoach2_auth', JSON.stringify(s));
      localStorage.setItem(`swimcoach2_${id}_team`, JSON.stringify('99999999-9999-4999-8999-999999999999'));
    }
  }, [session, session.user.id]);
  await page.goto('/');
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-team-name]')).toContainText('Seul espace');
  const stored = await page.evaluate((id) => localStorage.getItem(`swimcoach2_${id}_team`), session.user.id);
  expect(JSON.parse(stored)).toBe(teamId);
});

test('(j) XSS : nom d’espace et e-mail s’affichent comme du texte', async ({ page }) => {
  const evil = '<img src=x onerror=window.__xss=1>';
  await installFakeSupabase(page, { users: [{ email: 'coach@toac.fr', password: PW, activated: true }] });
  await page.goto('/');
  await login(page, 'coach@toac.fr');
  await expect(page.getByRole('heading', { name: 'Crée ton espace' })).toBeVisible();
  await expect(page.locator('[data-screen="create-team"] strong')).toHaveText('coach@toac.fr');
  await page.getByLabel("Nom de l'espace").fill(evil);
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-team-name]')).toContainText(evil);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('[data-screen="calendar"] img, [data-team-name] img').count()).toBe(0);
});

test('(j bis) XSS : un e-mail piégé reste du texte sur l’écran du code', async ({ page }) => {
  const evilMail = 'a<img src=x onerror=window.__xss=1>@toac.fr';
  await installFakeSupabase(page, { users: [{ email: evilMail, password: PW }] });
  await page.goto('/');
  await login(page, evilMail);
  await expect(page.getByLabel('Code du club')).toBeVisible();
  await expect(page.locator('[data-screen="code"] strong')).toHaveText(evilMail);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
