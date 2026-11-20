import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

// Ces tests ont besoin du service worker (build de prévisualisation) : il est autorisé ici seulement.
test.use({ serviceWorkers: 'allow', timezoneId: 'Europe/Paris', locale: 'fr-FR' });

const T1 = '55555555-5555-4555-8555-555555555555';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SW1 = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-20T09:00:00+01:00');

async function open(page) {
  const fake = await installFakeSupabase(page, {
    clock: NOW,
    users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
    tables: {
      groups: [{ id: G1, team_id: T1, name: 'Benjamins', sort_order: 0 }],
      swimmers: [{ id: SW1, team_id: T1, firstname: 'Éloïse', lastname: 'Bernard', group_id: G1, joined_season: 2025, left_season: null }],
      sessions: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', team_id: T1, date: '2026-11-20', title: 'Endurance', type: 'nat', time: '18:00', content: '', km: 3, photo_path: null }],
    },
  });
  await page.clock.install({ time: NOW });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  // les données de l'espace sont arrivées et sauvegardées dans le cache local
  await page.locator('.cal-day[data-key="2026-11-20"]').click();
  await expect(page.locator('.session-card', { hasText: 'Endurance' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith('_cache') && localStorage.getItem(k).includes('Endurance')))).toBe(true);
  // service worker installé (précache terminé), puis page contrôlée par lui
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  return fake;
}

async function goOffline(page, context, fake) {
  fake.state.offline = true;
  await context.setOffline(true);
}

test('hors ligne : rechargement servi par le cache, calendrier et nageurs affichés, séance locale puis envoyée au retour du réseau', async ({ page, context }) => {
  const fake = await open(page);
  await goOffline(page, context, fake);

  await page.reload(); // la page elle-même vient du précache du service worker
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await page.locator('.cal-day[data-key="2026-11-20"]').click();
  await expect(page.locator('.session-card', { hasText: 'Endurance' })).toBeVisible();
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await expect(page.locator('.contact-row', { hasText: 'Éloïse' })).toBeVisible();

  // séance créée hors ligne : visible tout de suite, rien côté serveur
  await page.getByRole('button', { name: 'Calendrier', exact: true }).click();
  await page.locator('.cal-day[data-key="2026-11-20"]').click();
  await page.getByRole('button', { name: '+ Séance' }).click();
  await page.getByLabel('Titre de la séance').fill('Technique');
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect(page.locator('.session-card', { hasText: 'Technique' })).toBeVisible();
  expect(fake.state.tables.sessions.map((s) => s.title)).toEqual(['Endurance']);

  // retour du réseau : l'écriture part vers le serveur
  fake.state.offline = false;
  await context.setOffline(false);
  await expect.poll(() => fake.state.tables.sessions.map((s) => s.title).sort()).toEqual(['Endurance', 'Technique']);
});

test('le service worker ne met en cache que les fichiers de l’application, jamais les réponses Supabase', async ({ page }) => {
  await open(page);
  const cached = await page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(3);
  expect(cached.some((u) => u.endsWith('index.html') || u.endsWith('/'))).toBe(true);
  expect(cached.filter((u) => /\/(rest|auth|storage|functions)\/v1\//.test(u))).toEqual([]);
});

test('page de confidentialité servie hors ligne par le cache', async ({ page, context }) => {
  const fake = await open(page);
  await goOffline(page, context, fake);
  await page.goto('/privacy.html');
  await expect(page.getByRole('heading', { level: 1, name: /Confidentialité/ })).toBeVisible();
});

test('le lien « Confidentialité » de la connexion ouvre la page, avec retour vers l’application', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Confidentialité' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Confidentialité' })).toBeVisible();
  await expect(page.getByText(/Le responsable de traitement est le créateur et éditeur de l'application/)).toBeVisible();
  await expect(page.locator('main')).not.toContainText('à compléter');
  await expect(page.getByText('eu-west-1')).toBeVisible();
  await page.getByRole('link', { name: /Retour à l'application/ }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});
