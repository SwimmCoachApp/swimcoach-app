import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

const T1 = '55555555-5555-4555-8555-555555555555';
const T2 = '66666666-6666-4666-8666-666666666666';

async function open(page, teams = [{ id: T1, name: 'TOAC <b>Natation</b>' }]) {
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }],
    teams,
    members: teams.map((t) => ({ team_id: t.id, email: 'coach@toac.fr' })),
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  return fake;
}

test('la navigation entre les 6 écrans fonctionne au clic', async ({ page }) => {
  await open(page);
  for (const [label, name] of [['Nageurs', 'contacts'], ['Stats', 'stats'], ['Perfs', 'perfs'], ['Planif.', 'planning'], ['Calendrier', 'calendar']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator(`[data-screen="${name}"]`)).toBeVisible();
    await expect(page.locator('[data-screen]')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
});

test('le nom de l’espace est échappé et la liste permet de changer d’espace', async ({ page }) => {
  await open(page, [{ id: T1, name: 'Alpha <b>Natation</b>' }, { id: T2, name: 'Zèbre' }]);
  const bar = page.locator('.top-bar-team');
  await expect(bar).toContainText('Alpha <b>Natation</b>');
  await expect(page.locator('.top-bar b')).toHaveCount(0);
  await bar.click();
  await expect(page.locator('#modal-teams')).toHaveClass(/open/);
  await page.getByRole('button', { name: 'Zèbre' }).click();
  await expect(page.locator('.top-bar-team')).toContainText('Zèbre');
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
});

test('changer de groupe garde l’écran ouvert (Nageurs, puis Réglages)', async ({ page }) => {
  await open(page, [{ id: T1, name: 'Alpha' }, { id: T2, name: 'Zèbre' }]);
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await expect(page.locator('[data-screen="contacts"]')).toBeVisible();
  await page.locator('.top-bar-team').click();
  await page.getByRole('button', { name: 'Zèbre' }).click();
  await expect(page.locator('.top-bar-team')).toContainText('Zèbre');
  await expect(page.locator('[data-screen="contacts"]')).toBeVisible();
  await expect(page.locator('.nav-item.active')).toHaveAttribute('data-key', 'contacts');
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.locator('.top-bar-team').click();
  await page.getByRole('button', { name: 'Alpha' }).click();
  await expect(page.locator('.top-bar-team')).toContainText('Alpha');
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
});

test('changement d’espace : écran de chargement tant que le nouveau groupe n’est pas ouvert, jamais les données de l’ancien', async ({ page }) => {
  await open(page, [{ id: T1, name: 'Alpha' }, { id: T2, name: 'Zèbre' }]);
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.locator('.top-bar-team').click();
  await expect(page.getByRole('button', { name: 'Zèbre' })).toBeVisible();
  await page.route('**/rest/v1/teams*', async (route) => { await gate; await route.fallback(); }); // liste des espaces lente
  await page.getByRole('button', { name: 'Zèbre' }).click();
  await expect(page.getByText("Chargement du groupe…")).toBeVisible();
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  await expect(page.locator('.top-bar-team')).toContainText('Zèbre');
  await page.getByRole('button', { name: 'Stats', exact: true }).click(); // navigation ignorée pendant le chargement
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.getByText("Chargement du groupe…")).toBeVisible();
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  release();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-loading]')).toHaveCount(0);
});

test('double changement A → B → A pendant le chargement : l’espace final est A, coche et en-tête cohérents', async ({ page }) => {
  await open(page, [{ id: T1, name: 'Alpha' }, { id: T2, name: 'Zèbre' }]);
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.locator('.top-bar-team').click();
  await expect(page.getByRole('button', { name: 'Zèbre' })).toBeVisible();
  await page.route('**/rest/v1/teams*', async (route) => { await gate; await route.fallback(); });
  await page.getByRole('button', { name: 'Zèbre' }).click();
  await expect(page.locator('.top-bar-team')).toContainText('Zèbre');
  await page.locator('.top-bar-team').click();
  await expect(page.locator('.team-item.current')).toContainText('Zèbre');
  await page.getByRole('button', { name: 'Alpha' }).click();
  await expect(page.locator('.top-bar-team')).toContainText('Alpha');
  release();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-team-name]')).toContainText('Alpha');
  await expect(page.locator('.top-bar-team')).toContainText('Alpha');
});

test('le thème sombre persiste après rechargement', async ({ page }) => {
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('aucune requête vers un CDN de polices ou de scripts', async ({ page }) => {
  const bad = [];
  page.on('request', (r) => { if (/fonts\.googleapis\.com|unpkg\.com|cdn\.jsdelivr\.net/.test(r.url())) bad.push(r.url()); });
  await open(page);
  expect(bad).toEqual([]);
});

test('la capture de la coque (clair et sombre)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page);
  await page.screenshot({ path: 'test-results/shell-dark.png' });
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await page.waitForTimeout(400); // fin de la transition de couleur
  await page.screenshot({ path: 'test-results/shell-light.png' });
});
