// Génère les captures de l'accueil (public/welcome/*.png) à partir de la vraie app, avec des données
// d'exemple fictives (noms inventés). Ne tourne pas avec les autres tests :
//   npm run build && WELCOME_SHOTS=1 WELCOME_SHOTS_DIR=/tmp/ws npx playwright test zz-welcome-shots
// puis convertir chaque PNG en WebP, 540 px de large, qualité 80, dans public/welcome/.
import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

test.skip(!process.env.WELCOME_SHOTS, 'génération des captures de l’accueil seulement à la demande');
test.use({ timezoneId: 'Europe/Paris', locale: 'fr-FR', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const OUT = process.env.WELCOME_SHOTS_DIR || 'tmp-welcome';
const T1 = '55555555-5555-4555-8555-555555555555';
const MORNING = new Date('2026-11-20T09:00:00+01:00');
const PASSWORD = 'motdepasse-long';
const id = (p, i) => `${p}-0000-4000-8000-${String(i).padStart(12, '0')}`;

const NAMES = [
  ['Léa', 'Martin', '2014-03-12'], ['Hugo', 'Bernard', '2013-07-02'], ['Chloé', 'Petit', '2014-01-25'], ['Nathan', 'Robert', '2013-11-09'],
  ['Inès', 'Durand', '2014-06-30'], ['Lucas', 'Moreau', '2013-04-18'], ['Jade', 'Laurent', '2014-09-05'], ['Tom', 'Simon', '2013-02-21'],
  ['Manon', 'Michel', '2014-12-01'], ['Enzo', 'Lefebvre', '2013-08-14'], ['Zoé', 'Garcia', '2014-04-27'], ['Louis', 'David', '2013-10-03'],
];
const SWIMMERS = NAMES.map(([firstname, lastname, dob], i) => ({
  id: id('00000000', i + 1), team_id: T1, firstname, lastname: lastname.toUpperCase(), dob, email: `${firstname.toLowerCase()}@exemple.fr`,
  phone: '06 12 34 56 78', joined_season: 2026, left_season: null,
}));

const SESSIONS = [];
const PRESENCE = [];
const TYPES = { 2: ['nat', 'Endurance aérobie', 3.2], 3: ['musc', 'Renforcement', null], 4: ['nat', 'Vitesse 25 m', 2.6], 5: ['nat', 'Technique dos', 2.8], 6: ['comp', 'Meeting', null] };
for (let d = 2; d <= 30; d += 1) {
  const date = `2026-11-${String(d).padStart(2, '0')}`;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const t = TYPES[dow];
  if (!t || (t[0] === 'comp' && d !== 21)) continue;
  const sid = id('33333333', d);
  SESSIONS.push({ id: sid, team_id: T1, date, title: t[1], type: t[0], time: t[0] === 'comp' ? '09:00' : '18:00',
    content: '<p>400 échauffement<br>8 × 50 NL départ 1:00<br>4 × 100 4N<br>200 récupération</p>', km: t[2], photo_path: null });
  if (date <= '2026-11-20') SWIMMERS.forEach((s, i) => { if ((i + d) % 5) PRESENCE.push({ team_id: T1, session_id: sid, swimmer_id: s.id }); });
}

const perf = (i, date, comp, code, label, distance, ms, display, points, splits = null) => ({
  id: id('99999999', i), team_id: T1, swimmer_id: SWIMMERS[0].id, competition_id: String(90000 + i), competition_name: comp, competition_date: date,
  pool: '25m', event_code: code, event_label: label, distance, stroke: 'nl', phase: 'series', time_ms: ms, time_display: display, rank: 3, points, status: 'ok', splits, source: 'liveffn',
});
const sp = (rows) => rows.map(([dist, cum, lap]) => ({ dist, split_display: cum, lap_display: `(${lap})`, split_ms: 0 }));
const PERFS = [
  perf(1, '2026-09-27', 'Meeting de rentrée', '51', '50 Nage Libre Dames - Séries', 50, 34100, '00:34.10', 520),
  perf(2, '2026-10-11', 'Interclubs Benjamins', '51', '50 Nage Libre Dames - Séries', 50, 33400, '00:33.40', 556),
  perf(3, '2026-11-08', 'Meeting d’automne', '51', '50 Nage Libre Dames - Séries', 50, 32700, '00:32.70', 590),
  perf(4, '2026-10-11', 'Interclubs Benjamins', '53', '200 Nage Libre Dames - Séries', 200, 158900, '02:38.90', 540,
    sp([[50, '35.80', '35.80'], [100, '1:15.70', '39.90'], [150, '1:57.40', '41.70'], [200, '2:38.90', '41.50']])),
  perf(5, '2026-11-08', 'Meeting d’automne', '53', '200 Nage Libre Dames - Séries', 200, 154200, '02:34.20', 571,
    sp([[50, '35.10', '35.10'], [100, '1:13.90', '38.80'], [150, '1:54.60', '40.70'], [200, '2:34.20', '39.60']])),
];

async function open(page) {
  const fake = await installFakeSupabase(page, {
    clock: MORNING,
    users: [
      { email: 'claire.roux@exemple.fr', password: PASSWORD, activated: true },
      { email: 'julien.blanc@exemple.fr', password: PASSWORD, activated: true },
    ],
    teams: [{ id: T1, name: 'Benjamins' }],
    members: [{ team_id: T1, email: 'claire.roux@exemple.fr' }, { team_id: T1, email: 'julien.blanc@exemple.fr' }],
    tables: { swimmers: SWIMMERS, sessions: SESSIONS, presence: PRESENCE, performances: PERFS,
      team_invites: [{ team_id: T1, email: 'sophie.leroy@exemple.fr', invited_by: null, created_at: '2026-11-19T10:00:00Z' }] },
  });
  for (const [email, name] of [['claire.roux@exemple.fr', 'Claire Roux'], ['julien.blanc@exemple.fr', 'Julien Blanc']]) {
    fake.state.tables.coaches.find((c) => c.email === email).display_name = name;
  }
  await page.clock.install({ time: MORNING });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('claire.roux@exemple.fr');
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await page.waitForTimeout(600);
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

test('captures de l’accueil', async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  await page.locator('.cal-day[data-key="2026-11-20"]').click();
  await page.waitForTimeout(300);
  await shot(page, 'calendrier');

  await page.locator('.cal-day[data-key="2026-11-19"]').click();
  await page.locator('.session-card').first().click();
  await page.locator('#modal-session-view').getByRole('button', { name: /Modifier/ }).click();
  await page.locator('#modal-session .presence-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await shot(page, 'appel');
  await page.locator('#modal-session .modal-close').click();

  await page.getByRole('button', { name: 'Perfs', exact: true }).click();
  await page.locator('.perf-swimmer-card', { hasText: 'Léa' }).click();
  const row = page.locator('.perf-history-row.has-splits').first();
  await row.click();
  await page.locator('.perf-splits:not([hidden])').evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await page.evaluate(() => document.querySelector('[data-screen="perfs"]').scrollBy(0, 60));
  await page.waitForTimeout(400);
  await shot(page, 'perfs');

  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.locator('#settings-space-title').evaluate((el) => el.closest('section').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await shot(page, 'groupe');
});
