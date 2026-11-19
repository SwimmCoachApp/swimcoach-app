import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

test.use({ timezoneId: 'Europe/Paris', locale: 'fr-FR' });

const FIXTURE = readFileSync(resolve(process.cwd(), 'tests/fixtures/liveffn-sample.html'), 'utf8');
const T1 = '55555555-5555-4555-8555-555555555555';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MORNING = new Date('2026-11-20T09:00:00+01:00');
const PASSWORD = 'motdepasse-long';
const swId = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const LEO = swId(1);
const perf = (i, competition_id, competition_name, competition_date, pool, time_display, time_ms, points) => ({
  id: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`, team_id: T1, swimmer_id: LEO, competition_id, competition_name, competition_date,
  pool, event_code: '51', event_label: '50 Nage Libre Messieurs - Séries', distance: 50, stroke: 'nl', phase: 'series',
  time_ms, time_display, rank: 4, points, status: 'ok', splits: null, source: 'liveffn',
});
/** Perfs déjà connues de Léo sur 50 NL : deux en 25 m cette saison, une en 50 m la saison passée. */
const SEEDED = [
  perf(1, '89000', 'Meeting de rentrée', '2026-09-27', '25m', '00:30.10', 30100, 660),
  perf(2, '90001', 'Interclubs Benjamins', '2026-10-11', '25m', '00:29.60', 29600, 690),
  perf(3, '85000', 'Championnats régionaux', '2026-03-15', '50m', '00:30.80', 30800, 640),
];

function seed(pages = { 92968: FIXTURE }) {
  return {
    tokenTtl: 7 * 24 * 3600,
    users: [{ email: 'coach@toac.fr', password: PASSWORD, activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
    liveffnPages: pages,
    tables: {
      groups: [{ id: G1, team_id: T1, name: 'Benjamins', sort_order: 0 }],
      swimmers: [
        { id: LEO, team_id: T1, firstname: 'Léo', lastname: 'Martin', group_id: G1, joined_season: 2024, left_season: null },
        { id: swId(2), team_id: T1, firstname: 'Marie-Ève', lastname: 'De La Fontaine', group_id: G1, joined_season: 2025, left_season: null },
        { id: swId(3), team_id: T1, firstname: 'Hugo', lastname: 'Petit', group_id: G1, joined_season: 2023, left_season: 2025 },
      ],
      performances: SEEDED,
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
  await page.getByRole('button', { name: 'Perfs' }).click();
  await expect(page.locator('[data-screen="perfs"]')).toBeVisible();
}

/** Remplace window.open : la fenêtre ouverte est un faux document qui garde le HTML écrit. */
async function interceptOpen(page) {
  await page.addInitScript(() => {
    window.__pdf = { calls: 0, html: '', title: '' };
    window.open = () => {
      window.__pdf.calls += 1;
      return { document: { write: (h) => { window.__pdf.html += h; }, close() {}, set title(t) { window.__pdf.title = t; } } };
    };
  });
}

async function searchCompetition(page, value) {
  await page.getByRole('button', { name: 'Importer une compétition' }).click();
  const sheet = page.locator('#modal-import-comp');
  await expect(sheet).toHaveClass(/open/);
  await sheet.getByLabel('URL liveffn ou ID compétition').fill(value);
  await sheet.getByRole('button', { name: /Rechercher/ }).click();
  return sheet;
}

test('import liveffn : aperçu, perfs enregistrées, graphique de la fiche, 2e import sans doublon, bilan PDF', async ({ page }) => {
  const fake = await installFakeSupabase(page, seed());
  await interceptOpen(page);
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await login(page);
  const screen = page.locator('[data-screen="perfs"]');
  await expect(screen.locator('.perf-swimmer-card')).toHaveCount(2); // actifs seulement
  await expect(screen.locator('.perf-swimmer-card', { hasText: 'Léo Martin' })).toContainText('3 perfs enregistrées');

  const sheet = await searchCompetition(page, 'https://www.liveffn.com/cgi-bin/resultats.php?competition=92968&langue=fra&go=detail&action=structure&structure=39');
  await expect(sheet.locator('#import-summary')).toHaveText('7 perfs, 📦 1 archivé ignoré');
  await expect(sheet).toContainText("Meeting Régional d'Hiver");
  await expect(sheet).toContainText('15 novembre 2026');
  await expect(sheet).toContainText('📦 1 nageur archivé ignoré : Hugo Petit');
  await expect(sheet.locator('.import-match-row')).toHaveCount(2);
  await expect(sheet.locator('.import-match-row').first()).toContainText('4 courses — 3 chronos enregistrés');
  const proxy = fake.callsTo('/functions/v1/liveffn-proxy');
  expect(proxy).toHaveLength(1);
  expect(proxy[0].search).toBe('?competition=92968&structure=39');
  expect(proxy[0].userId).toBe(fake.coachId('coach@toac.fr'));

  await sheet.getByRole('button', { name: /Importer$/ }).click();
  await expect(page.getByRole('status')).toHaveText('✅ 7 perfs importées');
  await expect(sheet).not.toHaveClass(/open/);
  await expect.poll(() => fake.state.tables.performances.length).toBe(SEEDED.length + 7);
  await expect(screen.locator('.perf-swimmer-card', { hasText: 'Léo Martin' })).toContainText('6 perfs enregistrées');

  // Fiche de Léo : meilleurs temps, historique, graphique (Chart.js chargé à ce moment-là seulement)
  await screen.locator('.perf-swimmer-card', { hasText: 'Léo Martin' }).click();
  await expect(screen.locator('#perf-detail-name')).toHaveText('Léo Martin');
  await expect(screen.locator('#perf-season-value')).toHaveText(/3\s?627 pts/);
  const mt = screen.locator('.perf-mt-row');
  await expect(mt).toHaveCount(3);
  await expect(mt.nth(0)).toContainText('50 Nage libre');
  await expect(mt.nth(0)).toContainText('00:28.45');
  await expect(screen.locator('.perf-history-row')).toHaveCount(7);
  await expect(screen.locator('.perf-history-row.is-best')).toHaveCount(3);
  await expect(screen.locator('.perf-history-time.dsq')).toHaveText('DSQ');
  expect(scripts.some((u) => /\/chart-[\w-]+\.js$/.test(u))).toBe(false);
  await mt.nth(0).getByRole('button', { name: /Progression 50 Nage libre 25m/ }).click();
  const chart = page.locator('#modal-chart');
  await expect(chart).toHaveClass(/open/);
  await expect(chart.locator('#chart-title')).toHaveText('Léo Martin — 50 Nage libre (25m)');
  await expect(chart.locator('#chart-info')).toHaveText('4 chronos — Progression : -1.65s 🔥');
  await expect.poll(() => scripts.some((u) => /\/chart-[\w-]+\.js$/.test(u))).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector('#progress-chart');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true; // quelque chose est dessiné
    return false;
  })).toBe(true);
  await chart.getByRole('button', { name: 'Fermer' }).click();

  // Filtre bassin 50 m : seul le record de la saison passée reste
  await screen.getByLabel('Bassin').selectOption('50');
  await expect(mt).toHaveCount(1);
  await expect(mt.first()).toContainText('00:30.80');
  await screen.getByLabel('Bassin').selectOption('all');

  // 2e import de la même compétition : aucune ligne de plus, ni sur le serveur ni à l'écran
  await page.getByRole('button', { name: 'Retour à la liste' }).click();
  const again = await searchCompetition(page, '92968');
  await expect(again.locator('#import-summary')).toHaveText('7 perfs, 📦 1 archivé ignoré');
  await again.getByRole('button', { name: /Importer$/ }).click();
  await expect(page.getByRole('status')).toHaveText('✅ 7 perfs importées');
  await expect.poll(() => fake.callsTo('/rest/v1/performances').filter((c) => c.method === 'POST').length).toBe(14);
  expect(fake.state.tables.performances).toHaveLength(SEEDED.length + 7);
  const keys = fake.state.tables.performances.map((p) => `${p.swimmer_id}|${p.competition_id}|${p.event_code}|${p.phase}`);
  expect(new Set(keys).size).toBe(keys.length);
  await expect(screen.locator('.perf-swimmer-card', { hasText: 'Léo Martin' })).toContainText('6 perfs enregistrées');

  // Bilan PDF : meilleur temps, sans script
  await screen.locator('.perf-swimmer-card', { hasText: 'Léo Martin' }).click();
  await screen.getByRole('button', { name: 'Exporter le bilan PDF' }).click();
  const pdf = await page.evaluate(() => window.__pdf);
  expect(pdf.calls).toBe(1);
  expect(pdf.title).toBe('Perfs Léo Martin');
  expect(pdf.html).toContain('Léo Martin');
  expect(pdf.html).toContain('00:28.45');
  expect(pdf.html).toContain('TOAC Natation');
  expect(pdf.html).toContain('@font-face');
  expect(pdf.html).not.toMatch(/<script/i);
  expect(pdf.html).not.toContain('fonts.googleapis.com');
});

test('erreurs de récupération : messages en français ; données de la page échappées', async ({ page }) => {
  const evil = FIXTURE.replace("Meeting Régional d'Hiver", '&lt;img src=x onerror=window.__pwned=1&gt;');
  const fake = await installFakeSupabase(page, seed({ 92968: FIXTURE, 777: evil }));
  await login(page);
  const status = page.getByRole('status');

  const sheet = await searchCompetition(page, 'liveffn');
  await expect(status).toHaveText("Impossible de trouver l'ID de compétition");
  await sheet.getByLabel('URL liveffn ou ID compétition').fill('12345678');
  await sheet.getByRole('button', { name: /Rechercher/ }).click();
  await expect(status).toHaveText('Identifiant de compétition invalide');
  fake.state.liveffnStatus = 504;
  await sheet.getByLabel('URL liveffn ou ID compétition').fill('92968');
  await sheet.getByRole('button', { name: /Rechercher/ }).click();
  await expect(status).toHaveText('liveffn ne répond pas, réessaie plus tard');
  await expect(sheet.getByRole('button', { name: /Rechercher/ })).toBeEnabled();
  fake.state.liveffnStatus = null;

  await sheet.getByLabel('URL liveffn ou ID compétition').fill('777');
  await sheet.getByRole('button', { name: /Rechercher/ }).click();
  await expect(sheet.locator('.ic-name')).toHaveText('<img src=x onerror=window.__pwned=1>');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await sheet.getByRole('button', { name: 'Nouvelle recherche' }).click();
  await expect(sheet.getByLabel('URL liveffn ou ID compétition')).toBeVisible();
});
