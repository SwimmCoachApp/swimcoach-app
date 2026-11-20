import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

test.use({ timezoneId: 'Europe/Paris', locale: 'fr-FR' });

const T1 = '55555555-5555-4555-8555-555555555555';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MORNING = new Date('2026-11-20T09:00:00+01:00');
const PASSWORD = 'motdepasse-long';
const sid = (i) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`;
const swId = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const sess = (i, date, type, km) => ({ id: sid(i), team_id: T1, date, title: `S${i}`, type, time: '18:00', content: '', km, photo_path: null });
const here = (s, w) => ({ team_id: T1, session_id: sid(s), swimmer_id: swId(w) });

/** Novembre 2026 : 2 nat (3 km et 1 km), 1 other de 2 km, 1 comp, 1 muscu ; une séance de natation en octobre. */
const SESSIONS = [
  sess(1, '2026-11-03', 'nat', 3), sess(2, '2026-11-05', 'nat', 1), sess(3, '2026-11-10', 'other', 2),
  sess(4, '2026-11-12', 'comp', null), sess(5, '2026-11-14', 'musc', null), sess(6, '2026-10-20', 'nat', 5),
];

function seed() {
  return {
    clock: MORNING, // horloge de la page (page.clock) : jetons émis selon cette heure
    users: [{ email: 'coach@toac.fr', password: PASSWORD, activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
    tables: {
      groups: [{ id: G1, team_id: T1, name: 'Benjamins', sort_order: 0 }],
      swimmers: [
        { id: swId(1), team_id: T1, firstname: 'Camille', lastname: 'Durand', group_id: G1, joined_season: 2026, left_season: null },
        { id: swId(2), team_id: T1, firstname: 'Louis', lastname: 'Martin', group_id: G1, joined_season: 2026, left_season: null },
        { id: swId(3), team_id: T1, firstname: 'Parti', lastname: 'Avant', group_id: G1, joined_season: 2023, left_season: 2025 },
      ],
      sessions: SESSIONS,
      // Camille : 3 séances de natation du mois sur 3, muscu 1/1, compét. 1/1 ; Louis : natation 1/3 seulement
      presence: [here(1, 1), here(2, 1), here(3, 1), here(5, 1), here(4, 1), here(1, 2), here(6, 1)],
    },
  };
}

async function login(page) {
  await page.clock.install({ time: MORNING });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
}

/** Remplace window.open : la fenêtre ouverte est un faux document qui garde le HTML écrit. */
async function interceptOpen(page, { blocked = false } = {}) {
  await page.addInitScript((isBlocked) => {
    window.__pdf = { calls: 0, html: '', title: '' };
    window.open = () => {
      window.__pdf.calls += 1;
      if (isBlocked) return null;
      return { document: { write: (h) => { window.__pdf.html += h; }, close() {}, set title(t) { window.__pdf.title = t; } } };
    };
  }, blocked);
}

test('stats du mois : séances, km, pourcentages par nageur ; archivé d\'une saison passée absent', async ({ page }) => {
  await installFakeSupabase(page, seed());
  await login(page);
  await page.getByRole('button', { name: 'Stats' }).click();
  const screen = page.locator('[data-screen="stats"]');
  await expect(screen.locator('#stat-month-label')).toHaveText('Novembre 2026');
  await expect(screen.locator('#stats-hero-km')).toHaveText('6,0 km');
  await expect(screen.locator('#stats-hero-sub')).toContainText('3 séances');
  await expect(screen.locator('#stats-hero-sub')).toContainText('2,0 km / séance');
  await expect(screen.locator('.sp-musc b')).toHaveText('1');
  await expect(screen.locator('.sp-comp b')).toHaveText('1');
  const rows = screen.locator('.stat-swimmer-row');
  await expect(rows).toHaveCount(2); // Parti Avant (archivé en 2025) n'y est pas
  await expect(rows.nth(0)).toContainText('Camille Durand');
  await expect(rows.nth(0)).toContainText('3/3');
  await expect(rows.nth(0)).toContainText('100%');
  await expect(rows.nth(0)).toContainText('6,0 km');
  await expect(rows.nth(1)).toContainText('Louis Martin');
  await expect(rows.nth(1)).toContainText('1/3');
  await expect(rows.nth(1)).toContainText('33%');
  await expect(screen.locator('canvas')).toHaveCount(0);
  // saison : octobre s'ajoute (11 km), navigation de saison
  await screen.getByRole('button', { name: 'Saison', exact: true }).click();
  await expect(screen.locator('#stat-month-label')).toHaveText('Saison 2026–27');
  await expect(screen.locator('#stats-hero-km')).toHaveText('11,0 km');
  await expect(screen.locator('#stats-hero-sub')).toContainText('4 séances');
  await screen.getByRole('button', { name: 'Période précédente' }).click();
  await expect(screen.locator('#stat-month-label')).toHaveText('Saison 2025–26');
  await expect(screen.locator('#stats-hero-km')).toHaveText('0,0 km');
  await expect(screen.locator('.stat-swimmer-row')).toHaveCount(1); // seul l'archivé était là en 2025–26
});

test('PDF : exportPdf reçoit un HTML qui contient le nom du premier nageur, sans Google Fonts', async ({ page }) => {
  await installFakeSupabase(page, seed());
  await interceptOpen(page);
  await login(page);
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.getByRole('button', { name: /Exporter en PDF/ }).click();
  const pdf = await page.evaluate(() => window.__pdf);
  expect(pdf.calls).toBe(1);
  expect(pdf.html).toContain('Camille Durand');
  expect(pdf.html).toContain('Bilan');
  expect(pdf.html).toContain('TOAC Natation');
  expect(pdf.html).toContain("@font-face");
  expect(pdf.html).not.toContain("<script");
  expect(pdf.html).not.toContain('fonts.googleapis.com');
  expect(pdf.title).toBe('Bilan Novembre 2026');
});

test('PDF : pop-up bloquée, un message l\'explique', async ({ page }) => {
  await installFakeSupabase(page, seed());
  await interceptOpen(page, { blocked: true });
  await login(page);
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.getByRole('button', { name: /Exporter en PDF/ }).click();
  await expect(page.getByRole('status')).toHaveText('Autorise les fenêtres pop-up pour exporter le PDF');
});
