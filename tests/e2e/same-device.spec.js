import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

const PW = 'motdepasse-long';
const TA = '55555555-5555-4555-8555-555555555555';
const TB = '66666666-6666-4666-8666-666666666666';
const GA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function seed(extra = {}) {
  return {
    users: [{ email: 'a@toac.fr', password: PW, activated: true }, { email: 'b@toac.fr', password: PW, activated: true }],
    teams: [{ id: TA, name: 'Espace A' }, { id: TB, name: 'Espace B' }],
    members: [{ team_id: TA, email: 'a@toac.fr' }, { team_id: TB, email: 'b@toac.fr' }],
    tables: { groups: [{ id: GA, team_id: TA, name: 'Benjamins', sort_order: 0 }, { id: GB, team_id: TB, name: 'Loisirs', sort_order: 0 }] },
    ...extra,
  };
}

async function login(page, email) {
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PW);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
}

async function pngFile(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    c.getContext('2d').fillRect(0, 0, 40, 40);
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

async function addSwimmer(page, firstname, photo) {
  await page.getByRole('button', { name: 'Ajouter un nageur' }).click();
  await page.getByLabel('Prénom').fill(firstname);
  if (photo) await page.locator('#sw-photo-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('#modal-swimmer')).not.toHaveClass(/open/);
}

const keysOf = (page, id) => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)), `swimcoach2_${id}_`);

async function logout(page) {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.locator('[data-screen="settings"]').getByRole('button', { name: 'Se déconnecter' }).click();
}

test('(b) même navigateur : A crée 3 nageurs et une photo, se déconnecte ; B ne voit rien de A', async ({ page }) => {
  const fake = await installFakeSupabase(page, seed());
  const A = fake.coachId('a@toac.fr');
  const B = fake.coachId('b@toac.fr');
  await page.goto('/');
  await login(page, 'a@toac.fr');
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await addSwimmer(page, 'Léa', await pngFile(page));
  await addSwimmer(page, 'Tom');
  await addSwimmer(page, 'Zoé');
  await expect.poll(() => fake.state.tables.swimmers.length).toBe(3);
  await expect.poll(() => fake.state.photos.size).toBe(1);
  await expect(page.locator('.contact-row img[src*="/storage/v1/object/sign/photos/"]')).toHaveCount(1);
  const aIds = new Set(fake.state.tables.swimmers.map((s) => s.id));

  await logout(page);
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  expect(await keysOf(page, A)).toEqual([]);
  const before = fake.calls.length;

  await login(page, 'b@toac.fr');
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await expect(page.locator('[data-screen="contacts"]')).toBeVisible();
  await expect(page.locator('.contact-row')).toHaveCount(0);
  await expect(page.locator(`img[src*="${TA}"]`)).toHaveCount(0);
  expect(await page.content()).not.toContain(`/sign/photos/${TA}`);
  expect(await keysOf(page, A)).toEqual([]);
  const leaked = fake.calls.slice(before).filter((c) => c.userId === B && c.body && JSON.stringify(c.body).match(new RegExp([TA, ...aIds].join('|'))));
  expect(leaked).toEqual([]);
});

test('(c) la session de A expire hors ligne avec une op en attente ; avertissement, B se connecte, l’op de A ne part jamais', async ({ page, context }) => {
  const fake = await installFakeSupabase(page, seed());
  const A = fake.coachId('a@toac.fr');
  await page.clock.install({ time: Date.now() });
  await page.goto('/');
  await login(page, 'a@toac.fr');
  fake.state.offline = true;
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await addSwimmer(page, 'Perdu');
  await page.clock.fastForward('02:00:00'); // le jeton d'une heure de A est expiré, sans réseau pour le renouveler
  fake.state.clockOffsetMs = 2 * 3600 * 1000;

  await logout(page);
  const dialog = page.getByRole('dialog', { name: 'Modifications non envoyées' });
  await expect(dialog).toContainText("1 modification n'est pas encore envoyée");
  await dialog.getByRole('button', { name: 'Se déconnecter quand même' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  expect(await keysOf(page, A)).toEqual([]);

  fake.state.offline = false;
  await context.setOffline(false);
  await login(page, 'b@toac.fr');
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await expect(page.locator('.contact-row')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(fake.state.tables.swimmers).toEqual([]);
  expect(fake.callsTo('/rest/v1/swimmers').filter((c) => c.method === 'POST')).toEqual([]);
});
