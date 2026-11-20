import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

const T1 = '55555555-5555-4555-8555-555555555555';

async function loginThenReload(page, clock) {
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
  });
  if (clock) await page.clock.install({ time: clock });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(page.locator('[data-screen="auth"]')).toHaveCount(0);
  return fake;
}

test('après connexion, un rechargement garde la session et ramène au calendrier', async ({ page }) => {
  await loginThenReload(page);
});

test('rechargement avec une horloge de page en avance sur le serveur (page.clock) : toujours connecté', async ({ page }) => {
  await loginThenReload(page, Date.now() + 9 * 3600 * 1000); // jetons d'1 h vus comme expirés par le client
});
