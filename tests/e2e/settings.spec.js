import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

const PW = 'motdepasse-long';
const TA = '55555555-5555-4555-8555-555555555555';
const TB = '66666666-6666-4666-8666-666666666666';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHOTO = (team, kind, i) => `${team}/${kind}/${String(i).padStart(8, '0')}-1111-4111-8111-111111111111.jpg`;

function seed(extra = {}) {
  return {
    users: [{ email: 'a@toac.fr', password: PW, activated: true }],
    teams: [{ id: TA, name: 'TOAC Natation' }],
    members: [{ team_id: TA, email: 'a@toac.fr' }],
    tables: { groups: [{ id: G1, team_id: TA, name: 'Benjamins', sort_order: 0 }] },
    ...extra,
  };
}

async function login(page, email = 'a@toac.fr') {
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PW);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

async function open(page, opts) {
  const fake = await installFakeSupabase(page, opts ?? seed());
  await page.goto('/');
  await login(page);
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  return fake;
}

async function settings(page) {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
}

const coachKeys = (page, id) => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)), `swimcoach2_${id}_`);

async function addSwimmerOffline(page, context, fake, firstname) {
  fake.state.offline = true;
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter un nageur' }).click();
  await page.getByLabel('Prénom').fill(firstname);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('.contact-row', { hasText: firstname })).toBeVisible();
}

test('(a) hors ligne avec une modification en attente : avertissement, « Attendre le réseau », puis « Se déconnecter quand même » efface tout', async ({ page, context }) => {
  const fake = await open(page);
  const A = fake.coachId('a@toac.fr');
  await addSwimmerOffline(page, context, fake, 'Léa');
  await settings(page);
  await expect(page.getByText("1 modification en attente d'envoi")).toBeVisible();

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifications non envoyées' });
  await expect(dialog).toContainText("1 modification n'est pas encore envoyée");
  await dialog.getByRole('button', { name: 'Attendre le réseau' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  expect((await coachKeys(page, A)).length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.getByRole('dialog', { name: 'Modifications non envoyées' }).getByRole('button', { name: 'Se déconnecter quand même' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  expect(await coachKeys(page, A)).toEqual([]);
  expect(fake.state.tables.swimmers).toEqual([]);
});

test('(a bis) plusieurs modifications : accord au pluriel', async ({ page, context }) => {
  const fake = await open(page);
  await addSwimmerOffline(page, context, fake, 'Léa');
  await page.getByRole('button', { name: 'Ajouter un nageur' }).click();
  await page.getByLabel('Prénom').fill('Tom');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await settings(page);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('dialog', { name: 'Modifications non envoyées' })).toContainText('2 modifications ne sont pas encore envoyées');
});

test('(d) suppression du compte : taper SUPPRIMER, appel à delete-account, retour à la connexion', async ({ page }) => {
  const fake = await open(page, seed({
    users: [{ email: 'a@toac.fr', password: PW, activated: true }, { email: 'c@toac.fr', password: PW, activated: true }],
    teams: [{ id: TA, name: 'TOAC Natation' }, { id: TB, name: 'Partagé' }],
    members: [{ team_id: TA, email: 'a@toac.fr' }, { team_id: TB, email: 'a@toac.fr' }, { team_id: TB, email: 'c@toac.fr' }],
  }));
  const A = fake.coachId('a@toac.fr');
  fake.state.photos.set(PHOTO(TA, 'swimmers', 1), { data: Buffer.from('x'), mime: 'image/jpeg', size: 1 });
  await settings(page);
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer mon compte ?' });
  await expect(dialog).toContainText('Les espaces dont tu es le seul membre seront supprimés avec leurs données');
  const confirm = dialog.getByRole('button', { name: 'Supprimer définitivement' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Tape SUPPRIMER pour confirmer').fill('supprimer');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Tape SUPPRIMER pour confirmer').fill('SUPPRIMER');
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  const calls = fake.callsTo('/functions/v1/delete-account');
  expect(calls).toHaveLength(1);
  expect(calls[0].userId).toBe(A);
  expect(fake.state.users.map((u) => u.email)).toEqual(['c@toac.fr']);
  expect(fake.state.tables.teams.map((t) => t.name)).toEqual(['Partagé']);
  expect(fake.state.photos.size).toBe(0);
  expect(await coachKeys(page, A)).toEqual([]);
});

test('(d bis) suppression du compte impossible (réseau) : message, rien n’est effacé', async ({ page }) => {
  const fake = await open(page);
  const A = fake.coachId('a@toac.fr');
  await settings(page);
  await page.route('**/functions/v1/delete-account', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer mon compte ?' });
  await dialog.getByLabel('Tape SUPPRIMER pour confirmer').fill('SUPPRIMER');
  await dialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(page.getByText('Suppression du compte impossible, vérifie ta connexion et réessaie')).toBeVisible();
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  expect((await coachKeys(page, A)).length).toBeGreaterThan(0);
});

test('nom affiché, thème et groupes depuis les réglages', async ({ page }) => {
  const fake = await open(page);
  const A = fake.coachId('a@toac.fr');
  await settings(page);
  await page.getByLabel('Nom affiché').fill('Damien <b>R.</b>');
  await page.getByRole('button', { name: 'Enregistrer le nom' }).click();
  await expect.poll(() => fake.state.tables.coaches.find((c) => c.id === A).display_name).toBe('Damien <b>R.</b>');
  await expect(page.locator('.member-row').first()).toContainText('Damien <b>R.</b>');
  await expect(page.locator('[data-screen="settings"] b')).toHaveCount(0);

  await page.getByRole('button', { name: 'Clair' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Clair' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByLabel('Nouveau groupe').fill('Loisirs');
  await page.getByRole('button', { name: 'Ajouter le groupe' }).click();
  await expect(page.locator('.settings-group-row', { hasText: 'Loisirs' })).toBeVisible();
  await expect.poll(() => fake.state.tables.groups.map((g) => g.name).sort()).toEqual(['Benjamins', 'Loisirs']);
  await page.getByRole('button', { name: 'Supprimer le groupe Loisirs' }).click();
  await expect(page.locator('.settings-group-row', { hasText: 'Loisirs' })).toHaveCount(0);
  await expect.poll(() => fake.state.tables.groups.map((g) => g.name)).toEqual(['Benjamins']);
});

test('modifications refusées : compte, export JSON et effacement', async ({ page }) => {
  const fake = await open(page);
  const A = fake.coachId('a@toac.fr');
  await page.evaluate(([a, t]) => {
    const entry = { op: { id: 'op1', table: 'swimmers', kind: 'upsert', key: 'k', row: { id: 'k', firstname: 'Refusé' }, coachId: a, teamId: t }, error: { code: '23514', status: 400, message: 'check violation' }, at: '2026-11-20T10:00:00.000Z' };
    localStorage.setItem(`swimcoach2_${a}_${t}_outbox_rejected`, JSON.stringify([entry, { ...entry, op: { ...entry.op, id: 'op2' } }]));
    localStorage.setItem(`swimcoach2_${a}_outboxTeams`, JSON.stringify([t]));
  }, [A, TA]);
  await settings(page);
  await expect(page.getByText('2 modification(s) refusée(s) par le serveur')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^swimcoach-modifs-refusees-\d{4}-\d{2}-\d{2}\.json$/);
  const json = JSON.parse(await (await import('node:fs/promises')).readFile(await file.path(), 'utf8'));
  expect(json).toHaveLength(2);
  expect(json[0].op.row.firstname).toBe('Refusé');
  expect(json[0].teamName).toBe('TOAC Natation');
  await page.getByRole('button', { name: 'Effacer' }).click();
  await page.getByRole('dialog', { name: 'Effacer les modifications refusées ?' }).getByRole('button', { name: 'Effacer' }).click();
  await expect(page.getByText('refusée(s) par le serveur')).toHaveCount(0);
  expect(await coachKeys(page, A)).not.toContain(`swimcoach2_${A}_${TA}_outbox_rejected`);
});

test('déconnexion possible pendant le chargement d’un espace (liste des espaces bloquée)', async ({ page }) => {
  await open(page, seed({ teams: [{ id: TA, name: 'Alpha' }, { id: TB, name: 'Zèbre' }], members: [{ team_id: TA, email: 'a@toac.fr' }, { team_id: TB, email: 'a@toac.fr' }] }));
  await page.locator('.top-bar-team').click();
  await expect(page.getByRole('button', { name: 'Zèbre' })).toBeVisible();
  await page.route('**/rest/v1/teams*', () => {}); // ne répond jamais
  await page.getByRole('button', { name: 'Zèbre' }).click();
  await expect(page.getByText("Chargement de l'espace…")).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});

test('déconnexion possible au démarrage si la liste des espaces ne répond pas', async ({ page }) => {
  await installFakeSupabase(page, seed());
  await page.route('**/rest/v1/teams*', () => {}); // ne répond jamais
  await page.goto('/');
  await login(page);
  await expect(page.getByText("Chargement de l'espace…")).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});

test('supprimer l’espace : taper son nom, photos effacées d’abord (par pages), puis l’espace', async ({ page }) => {
  const fake = await open(page);
  for (let i = 0; i < 130; i += 1) fake.state.photos.set(PHOTO(TA, 'swimmers', i), { data: Buffer.from('x'), mime: 'image/jpeg', size: 1 });
  fake.state.photos.set(PHOTO(TA, 'sessions', 1), { data: Buffer.from('x'), mime: 'image/jpeg', size: 1 });
  fake.state.photos.set(PHOTO(TB, 'swimmers', 1), { data: Buffer.from('x'), mime: 'image/jpeg', size: 1 });
  await settings(page);
  await page.getByRole('button', { name: "Supprimer l'espace et toutes ses données" }).click();
  const dialog = page.getByRole('dialog', { name: "Supprimer l'espace « TOAC Natation » ?" });
  const confirm = dialog.getByRole('button', { name: "Supprimer l'espace" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Tape le nom de l'espace pour confirmer").fill('TOAC Natation');
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Crée ton espace' })).toBeVisible();
  expect([...fake.state.photos.keys()]).toEqual([PHOTO(TB, 'swimmers', 1)]);
  expect(fake.state.tables.teams).toEqual([]);
  const order = fake.calls.filter((c) => c.path === '/storage/v1/object/photos' || c.path === '/rest/v1/rpc/delete_team').map((c) => c.path);
  expect(order.at(-1)).toBe('/rest/v1/rpc/delete_team');
  expect(order.filter((p) => p.includes('storage')).length).toBeGreaterThanOrEqual(2); // 131 fichiers : au moins deux envois
});

test('supprimer l’espace sans pouvoir effacer les photos : rien n’est supprimé', async ({ page }) => {
  const fake = await open(page);
  fake.state.photos.set(PHOTO(TA, 'swimmers', 1), { data: Buffer.from('x'), mime: 'image/jpeg', size: 1 });
  await settings(page);
  fake.state.storageDown = true;
  await page.getByRole('button', { name: "Supprimer l'espace et toutes ses données" }).click();
  const dialog = page.getByRole('dialog', { name: "Supprimer l'espace « TOAC Natation » ?" });
  await dialog.getByLabel("Tape le nom de l'espace pour confirmer").fill('TOAC Natation');
  await dialog.getByRole('button', { name: "Supprimer l'espace" }).click();
  await expect(page.getByText("Impossible de supprimer les photos de l'espace (vérifie ta connexion) : l'espace n'a pas été supprimé")).toBeVisible();
  expect(fake.state.tables.teams.map((t) => t.name)).toEqual(['TOAC Natation']);
  expect(fake.callsTo('/rest/v1/rpc/delete_team')).toHaveLength(0);
  expect(fake.state.photos.size).toBe(1);
});

test('capture des réglages avec la section Espace (clair)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1600 });
  const fake = await open(page, seed({
    users: [{ email: 'a@toac.fr', password: PW, activated: true }, { email: 'c@toac.fr', password: PW, activated: true }],
    members: [{ team_id: TA, email: 'a@toac.fr' }, { team_id: TA, email: 'c@toac.fr' }, { team_id: TA, email: 'd@club.fr' }],
  }));
  fake.state.tables.coaches.find((c) => c.email === 'c@toac.fr').display_name = 'Marianne';
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await settings(page);
  await expect(page.locator('.member-row')).toHaveCount(2);
  await expect(page.locator('.invite-row')).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SETTINGS_SHOT || 'test-results/settings-light.png', fullPage: true });
});

test('modifications refusées : seules celles de l’espace ouvert sont comptées, exportées et effacées', async ({ page }) => {
  const fake = await open(page, seed({ teams: [{ id: TA, name: 'Alpha' }, { id: TB, name: 'Zèbre' }], members: [{ team_id: TA, email: 'a@toac.fr' }, { team_id: TB, email: 'a@toac.fr' }] }));
  const A = fake.coachId('a@toac.fr');
  await expect(page.locator('[data-team-name]')).toHaveText('Alpha');
  await page.evaluate(([a, ta, tb]) => {
    const entry = (t, id) => ({ op: { id, table: 'swimmers', kind: 'upsert', key: id, row: { id, firstname: id }, coachId: a, teamId: t }, error: { code: '23514', status: 400, message: 'x' }, at: '2026-11-20T10:00:00.000Z' });
    localStorage.setItem(`swimcoach2_${a}_${ta}_outbox_rejected`, JSON.stringify([entry(ta, 'alpha-1')]));
    localStorage.setItem(`swimcoach2_${a}_${tb}_outbox_rejected`, JSON.stringify([entry(tb, 'zebre-1'), entry(tb, 'zebre-2')]));
    localStorage.setItem(`swimcoach2_${a}_outboxTeams`, JSON.stringify([ta, tb]));
  }, [A, TA, TB]);
  await settings(page);
  await expect(page.getByText('1 modification(s) refusée(s) par le serveur')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter' }).click();
  const json = JSON.parse(await (await import('node:fs/promises')).readFile(await (await download).path(), 'utf8'));
  expect(json.map((e) => e.op.key)).toEqual(['alpha-1']);
  await page.getByRole('button', { name: 'Effacer' }).click();
  await page.getByRole('dialog', { name: 'Effacer les modifications refusées ?' }).getByRole('button', { name: 'Effacer' }).click();
  await expect(page.getByText('refusée(s) par le serveur')).toHaveCount(0);
  const left = await page.evaluate(([a, ta, tb]) => [localStorage.getItem(`swimcoach2_${a}_${ta}_outbox_rejected`), JSON.parse(localStorage.getItem(`swimcoach2_${a}_${tb}_outbox_rejected`)).length], [A, TA, TB]);
  expect(left).toEqual([null, 2]);
});

test('le compteur « en attente » ne compte que l’espace ouvert', async ({ page }) => {
  const fake = await open(page, seed({ teams: [{ id: TA, name: 'Alpha' }, { id: TB, name: 'Zèbre' }], members: [{ team_id: TA, email: 'a@toac.fr' }, { team_id: TB, email: 'a@toac.fr' }] }));
  const A = fake.coachId('a@toac.fr');
  await page.evaluate(([a, tb]) => {
    const op = (id) => ({ id, table: 'swimmers', kind: 'upsert', key: id, row: { id, team_id: tb }, coachId: a, teamId: tb });
    localStorage.setItem(`swimcoach2_${a}_${tb}_outbox`, JSON.stringify([op('z1'), op('z2')]));
    localStorage.setItem(`swimcoach2_${a}_outboxTeams`, JSON.stringify([tb]));
  }, [A, TB]);
  await settings(page);
  await expect(page.getByText('Toutes les modifications sont envoyées')).toBeVisible();
});

test('fenêtre de confirmation : le focus va sur « Annuler » et reste dans la fenêtre', async ({ page }) => {
  await open(page, seed({
    users: [{ email: 'a@toac.fr', password: PW, activated: true }, { email: 'c@toac.fr', password: PW, activated: true }],
    members: [{ team_id: TA, email: 'a@toac.fr' }, { team_id: TA, email: 'c@toac.fr' }],
  }));
  await settings(page);
  await page.locator('.member-row', { hasText: 'c@toac.fr' }).getByRole('button', { name: 'Retirer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Retirer' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Retirer' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('les Réglages proposent le lien « Confidentialité »', async ({ page }) => {
  await open(page);
  await settings(page);
  await expect(page.getByRole('link', { name: 'Confidentialité' })).toHaveAttribute('href', './privacy.html');
});
