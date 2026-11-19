import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

test.use({ timezoneId: 'Europe/Paris', locale: 'fr-FR' });

const T1 = '55555555-5555-4555-8555-555555555555';
const MORNING = new Date('2026-11-20T09:00:00+01:00'); // vendredi 20 nov. 2026, semaine 47
const sess = (i, date, type, km) => ({ id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, team_id: T1, date, title: `S${i}`, type, time: '18:00', content: '', km, photo_path: null });

async function open(page, { tables = {} } = {}) {
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
    tables,
  });
  await page.clock.install({ time: MORNING });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  return fake;
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

const gotoPlanning = async (page) => {
  await page.getByRole('button', { name: 'Planif.' }).click();
  await expect(page.locator('[data-screen="planning"]')).toBeVisible();
};

test('semaine : thème, zone et objectif km enregistrés, km réalisés calculés, sauvegarde envoyée au serveur', async ({ page }) => {
  const fake = await open(page, { tables: { sessions: [sess(1, '2026-11-17', 'nat', 8), sess(2, '2026-11-19', 'comp', 4), sess(3, '2026-11-18', 'musc', 9)] } });
  await gotoPlanning(page);
  const screen = page.locator('[data-screen="planning"]');
  await expect(screen.locator('#plan-year-label')).toHaveText('2026–27');
  await expect(screen.locator('.plan-month-block.open .plan-month-name')).toHaveText('Novembre 2026');
  const block = screen.locator('[data-week-block="2026-W47"]');
  await expect(block.locator('.plan-week-label')).toHaveText('S47');
  await expect(block.locator('.plan-week-range')).toHaveText('16 → 22 nov');
  await expect(block.locator('.plan-week-km-real-val')).toHaveText('12.0'); // 8 + 4 ; la muscu ne compte pas

  await block.getByLabel('Zone de travail S47').fill('aérobie · seuil');
  await block.getByLabel('Thème S47').fill('Ligne 1\nLigne 2');
  await block.getByLabel('Objectif km S47').fill('15');
  await block.getByLabel('Objectif km S47').blur();
  await expect(block.locator('.plan-week-km-real')).toHaveClass(/week-km-close/);
  await expect(block.locator('.plan-week-km-status')).toHaveText('80%');
  await expect.poll(() => fake.state.tables.plan_weeks.length).toBe(1);
  await expect.poll(() => fake.state.tables.plan_weeks[0]).toMatchObject({ team_id: T1, week_key: '2026-W47', season_start: 2026, content: 'Ligne 1\nLigne 2', zone: 'aérobie · seuil', km_target: 15 });

  // la valeur est relue du store quand on revient sur l'écran
  await page.getByRole('button', { name: 'Calendrier' }).click();
  await gotoPlanning(page);
  await expect(page.locator('[data-week-block="2026-W47"]').getByLabel('Thème S47')).toHaveValue('Ligne 1\nLigne 2');
  await expect(page.locator('[data-week-block="2026-W47"]').getByLabel('Objectif km S47')).toHaveValue('15');
});

test('stage de 3 jours : créé dans la planification, visible sur le calendrier, modifiable puis supprimé', async ({ page }) => {
  const fake = await open(page);
  await gotoPlanning(page);
  const month = page.locator('.plan-month-block.open');
  await month.getByRole('button', { name: '+ Ajouter un événement' }).click();
  const sheet = page.locator('#modal-plan-event');
  await expect(sheet).toHaveClass(/open/);
  await sheet.getByRole('button', { name: /Stage/ }).click();
  await sheet.getByLabel('Titre').fill('Stage de Toussaint');
  await sheet.getByLabel('Description / Objectifs').fill('Volume en bassin de 50 m');
  await sheet.getByLabel('Date de début').fill('2026-11-24');
  await sheet.getByLabel('Date de fin (optionnel)').fill('2026-11-26');
  await sheet.getByRole('button', { name: '💾 Enregistrer' }).click();
  await expect(sheet).not.toHaveClass(/open/);

  await expect(month.locator('.plan-event-title')).toHaveText('Stage de Toussaint');
  await expect(month.locator('.plan-event-date')).toHaveText('24 nov. → 26 nov.');
  await expect(month.locator('.plan-badge-stage')).toBeVisible();
  await expect(month.locator('[data-week-block="2026-W48"] .plan-week-event-stage')).toContainText('Stage de Toussaint');
  await expect.poll(() => fake.state.tables.plan_events.length).toBe(1);
  expect(fake.state.tables.plan_events[0]).toMatchObject({ team_id: T1, month_key: '2026-11', type: 'stage', title: 'Stage de Toussaint', start_date: '2026-11-24', end_date: '2026-11-26' });

  // le calendrier le montre sur les trois jours, pas autour
  await page.getByRole('button', { name: 'Calendrier' }).click();
  for (const day of ['24', '25', '26']) await expect(page.locator(`.cal-day[data-key="2026-11-${day}"]`)).toHaveClass(/ev-stage/);
  await expect(page.locator('.cal-day[data-key="2026-11-23"]')).not.toHaveClass(/has-plan-event/);
  await expect(page.locator('.cal-day[data-key="2026-11-27"]')).not.toHaveClass(/has-plan-event/);

  // modification : le déplacer en décembre le change de mois
  await gotoPlanning(page);
  await page.getByRole('button', { name: 'Modifier Stage de Toussaint' }).click();
  await sheet.getByLabel('Date de début').fill('2026-12-05');
  await sheet.getByLabel('Date de fin (optionnel)').fill('2026-12-07');
  await sheet.getByRole('button', { name: '💾 Enregistrer' }).click();
  await expect.poll(() => fake.state.tables.plan_events[0].month_key).toBe('2026-12');
  await expect(page.locator('.plan-month-block.open .plan-event-row')).toHaveCount(0);
  await page.locator('[data-month="2026-12"] .plan-month-header').click();
  await expect(page.locator('[data-month="2026-12"] .plan-event-title')).toHaveText('Stage de Toussaint');

  // suppression avec confirmation
  await page.getByRole('button', { name: 'Supprimer Stage de Toussaint' }).click();
  await expect(page.locator('#dialog-plan-event')).toHaveClass(/open/);
  await page.locator('#dialog-plan-event').getByRole('button', { name: 'Annuler' }).click();
  expect(fake.state.tables.plan_events).toHaveLength(1);
  await page.getByRole('button', { name: 'Supprimer Stage de Toussaint' }).click();
  await page.locator('#dialog-plan-event').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect.poll(() => fake.state.tables.plan_events.length).toBe(0);
});

test('PDF du planning : exportPdf reçoit le document Club, échappé, sans script ni Google Fonts', async ({ page }) => {
  await interceptOpen(page);
  await open(page, { tables: { sessions: [sess(1, '2026-11-17', 'nat', 8)] } });
  await gotoPlanning(page);
  const block = page.locator('[data-week-block="2026-W47"]');
  await block.getByLabel('Thème S47').fill('<img src=x onerror=alert(1)> Fond');
  await block.getByLabel('Zone de travail S47').fill('seuil');
  await block.getByLabel('Objectif km S47').fill('10');
  await block.getByLabel('Objectif km S47').blur();
  await page.getByRole('button', { name: /Exporter la planification en PDF/ }).click();
  const pdf = await page.evaluate(() => window.__pdf);
  expect(pdf.calls).toBe(1);
  expect(pdf.title).toBe('Planification saison 2026–27');
  expect(pdf.html).toContain('Planification saison 2026–27');
  expect(pdf.html).toContain('TOAC Natation');
  expect(pdf.html).toContain('Novembre 2026');
  expect(pdf.html).toContain('&lt;img src=x onerror=alert(1)&gt; Fond');
  expect(pdf.html).toContain('>seuil<');
  expect(pdf.html).toContain('8.0 km');
  expect(pdf.html).toContain('@font-face'); // polices embarquées par exportPdf
  expect(pdf.html).not.toContain('<script');
  expect(pdf.html).not.toContain('<img');
  expect(pdf.html).not.toContain('fonts.googleapis.com');
});
