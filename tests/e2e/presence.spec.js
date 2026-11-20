import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

test.use({ timezoneId: 'Europe/Paris', locale: 'fr-FR' });

const T1 = '55555555-5555-4555-8555-555555555555';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID = '33333333-3333-4333-8333-333333333333';
const COMP = '44444444-4444-4444-8444-444444444444';
const OLD = '99999999-9999-4999-8999-999999999999';
const MORNING = new Date('2026-11-20T09:00:00+01:00');
const PASSWORD = 'motdepasse-long';

const swId = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const pad = (i) => String(i).padStart(2, '0');
/** 16 nageurs de la saison 2026 (« Nageur 01 » … « Nageur 16 ») et un archivé de 2025, absent de l'appel. */
const SWIMMERS = [
  ...Array.from({ length: 16 }, (_, k) => ({ id: swId(k + 1), team_id: T1, firstname: 'Nageur', lastname: pad(k + 1), group_id: G1, joined_season: 2026, left_season: null })),
  { id: OLD, team_id: T1, firstname: 'Parti', lastname: 'Avant', group_id: G1, joined_season: 2023, left_season: 2025 },
];

function seed(extra = {}) {
  return {
    clock: MORNING, // horloge de la page (page.clock) : jetons émis selon cette heure
    users: [
      { email: 'coach@toac.fr', password: PASSWORD, activated: true },
      { email: 'collegue@toac.fr', password: PASSWORD, activated: true },
    ],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }, { team_id: T1, email: 'collegue@toac.fr' }],
    tables: {
      groups: [{ id: G1, team_id: T1, name: 'Benjamins', sort_order: 0 }],
      swimmers: SWIMMERS,
      sessions: [
        { id: SID, team_id: T1, date: '2026-11-20', title: 'Endurance', type: 'nat', time: '18:00', content: '', km: 3, photo_path: null },
        { id: COMP, team_id: T1, date: '2026-11-20', title: 'Interclubs', type: 'comp', time: '19:00', content: '', km: null, photo_path: null },
      ],
      ...extra,
    },
  };
}

async function login(page, email = 'coach@toac.fr') {
  await page.clock.install({ time: MORNING });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
}

/** Ouvre la feuille de modification d'une séance du 20 novembre (là où se fait l'appel). */
async function openRollCall(page, title = 'Endurance') {
  await page.locator('.cal-day[data-key="2026-11-20"]').click();
  await page.locator('.session-card', { hasText: title }).click();
  await page.locator('#modal-session-view').getByRole('button', { name: /Modifier/ }).click();
  await expect(page.locator('#modal-session')).toHaveClass(/open/);
  await expect(page.locator('.presence-row')).toHaveCount(16);
}

const row = (page, i) => page.getByRole('checkbox', { name: new RegExp(`Nageur ${pad(i)}\\b`) });
const gauge = (page) => page.locator('#pm-top');
const serverPresence = (fake, sid = SID) => fake.state.tables.presence.filter((p) => p.session_id === sid).map((p) => p.swimmer_id).sort();

test('appel : cocher 12 nageurs sur 16, la jauge affiche « 12 / 16 présents », les coches tiennent au rechargement', async ({ page }) => {
  const fake = await installFakeSupabase(page, seed());
  await login(page);
  await openRollCall(page);
  await expect(gauge(page)).toHaveText('0 / 16 présents');
  // l'archivé d'une saison précédente n'est pas dans l'appel ; le groupe n'est pas affiché (groupes masqués)
  await expect(page.locator('#presence-list')).not.toContainText('Parti');
  await expect(row(page, 1)).not.toContainText('Benjamins');
  await expect(page.locator('#pm-fill')).toHaveAttribute('style', /width: 0%/);

  for (let i = 1; i <= 12; i += 1) await row(page, i).click();
  await expect(gauge(page)).toHaveText('12 / 16 présents');
  await expect(row(page, 12)).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 13)).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#pm-fill')).toHaveAttribute('style', /width: 75%/);
  await expect.poll(() => serverPresence(fake)).toEqual(Array.from({ length: 12 }, (_, k) => swId(k + 1)));

  // décocher puis recocher : une op par nageur, rien d'autre ne bouge
  await row(page, 3).click();
  await expect(gauge(page)).toHaveText('11 / 16 présents');
  await expect.poll(() => serverPresence(fake).length).toBe(11);
  await row(page, 3).click();
  await expect.poll(() => serverPresence(fake).length).toBe(12);
  expect(fake.callsTo('/rest/v1/presence').filter((c) => c.method !== 'GET' && c.method !== 'HEAD')).toHaveLength(14);

  if (process.env.ROLLCALL_SHOT) {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); // thème clair (le bouton est sous la feuille)
    await page.setViewportSize({ width: 430, height: 932 });
    await page.locator('.presence-meter').scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.ROLLCALL_SHOT });
  }

  // la carte du jour compte les présents ; après rechargement les coches sont toujours là
  await page.locator('#modal-session .modal-close').click();
  await expect(page.locator('.session-card', { hasText: 'Endurance' })).toContainText('12 présents');
  await page.reload();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await openRollCall(page);
  await expect(gauge(page)).toHaveText('12 / 16 présents');
  for (let i = 1; i <= 16; i += 1) await expect(row(page, i)).toHaveAttribute('aria-checked', String(i <= 12));
});

test('« Tous ✓ » et « Aucun », et l’appel d’une compétition dans la même fenêtre', async ({ page }) => {
  const fake = await installFakeSupabase(page, seed());
  await login(page);
  await openRollCall(page, 'Interclubs');
  await expect(page.locator('#modal-session .type-pill[aria-pressed="true"]')).toContainText('Compétition');
  await page.getByRole('button', { name: 'Tous ✓' }).click();
  await expect(gauge(page)).toHaveText('16 / 16 présents');
  await expect.poll(() => serverPresence(fake, COMP).length).toBe(16);
  await page.getByRole('button', { name: 'Aucun' }).click();
  await expect(gauge(page)).toHaveText('0 / 16 présents');
  await expect.poll(() => serverPresence(fake, COMP).length).toBe(0);
});

test('nouvelle séance : les coches partent après la séance ; fermée sans enregistrer, elles sont oubliées', async ({ page }) => {
  const fake = await installFakeSupabase(page, seed({ sessions: [] }));
  await login(page);
  await page.locator('.cal-day[data-key="2026-11-21"]').click();

  // feuille fermée sans enregistrer : rien ne part, et la feuille suivante repart de zéro
  await page.getByRole('button', { name: '+ Séance' }).click();
  await expect(page.locator('.presence-row')).toHaveCount(16);
  await row(page, 1).click();
  await row(page, 2).click();
  await expect(gauge(page)).toHaveText('2 / 16 présents');
  await page.locator('#modal-session .modal-close').click();
  await expect(page.locator('#modal-session')).not.toHaveClass(/open/);
  await page.getByRole('button', { name: '+ Séance' }).click();
  await expect(gauge(page)).toHaveText('0 / 16 présents');
  expect(fake.callsTo('/rest/v1/presence').filter((c) => c.method === 'POST')).toHaveLength(0);

  // coches puis enregistrement : la séance est envoyée avant ses présences
  await page.getByLabel('Titre de la séance').fill('Vitesse');
  for (const i of [4, 5, 6]) await row(page, i).click();
  await row(page, 5).click();
  await expect(gauge(page)).toHaveText('2 / 16 présents');
  expect(fake.callsTo('/rest/v1/presence').filter((c) => c.method !== 'GET')).toHaveLength(0);
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect(page.locator('#modal-session')).not.toHaveClass(/open/);
  await expect.poll(() => fake.state.tables.presence.length).toBe(2);
  const sid = fake.state.tables.sessions[0].id;
  expect(serverPresence(fake, sid)).toEqual([swId(4), swId(6)]);
  const writes = fake.calls.filter((c) => c.method === 'POST' && /\/rest\/v1\/(sessions|presence)$/.test(c.path)).map((c) => c.path.split('/').pop());
  expect(writes).toEqual(['sessions', 'presence', 'presence']);
  await expect(page.locator('.session-card', { hasText: 'Vitesse' })).toContainText('2 présents');
});

test('deux entraîneurs font l’appel de la même séance en même temps : aucune coche perdue', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxC = await browser.newContext();
  const fake = await installFakeSupabase([ctxA, ctxC], seed());
  const a = await ctxA.newPage();
  const c = await ctxC.newPage();
  await Promise.all([login(a, 'coach@toac.fr'), login(c, 'collegue@toac.fr')]);
  await Promise.all([openRollCall(a), openRollCall(c)]);

  const tick = async (page, from, to) => {
    for (let i = from; i <= to; i += 1) await row(page, i).click();
  };
  await Promise.all([tick(a, 1, 6), tick(c, 7, 12)]);
  await expect(gauge(a)).toHaveText('6 / 16 présents');
  await expect(gauge(c)).toHaveText('6 / 16 présents');
  await expect.poll(() => serverPresence(fake).length).toBe(12);

  // synchro (temps réel simulé : retour en ligne → envoi de la file puis relecture)
  for (const page of [a, c]) {
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(gauge(page)).toHaveText('12 / 16 présents', { timeout: 1000 });
    }).toPass();
  }
  for (const page of [a, c]) {
    for (let i = 1; i <= 16; i += 1) await expect(row(page, i)).toHaveAttribute('aria-checked', String(i <= 12));
  }
  expect(fake.state.tables.presence).toHaveLength(12);
  expect(serverPresence(fake)).toEqual(Array.from({ length: 12 }, (_, k) => swId(k + 1)));
  await ctxA.close();
  await ctxC.close();
});
