import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

const PW = 'motdepasse-long';
const TA = '55555555-5555-4555-8555-555555555555';
const GA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function seed() {
  return {
    users: [{ email: 'a@toac.fr', password: PW, activated: true }, { email: 'c@toac.fr', password: PW, activated: true }],
    teams: [{ id: TA, name: 'Pôle <i>Formation</i>' }],
    members: [{ team_id: TA, email: 'a@toac.fr' }],
    tables: {
      groups: [{ id: GA, team_id: TA, name: 'Benjamins', sort_order: 0 }],
      swimmers: [{ id: SW, team_id: TA, firstname: 'Léa', lastname: 'Martin', dob: null, group_id: GA, phone: '', email: '', photo_path: null, joined_season: 2026, left_season: null }],
    },
  };
}

async function login(page, email) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PW);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

async function settings(page) {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
}

const teamKeys = (page, coach, team) => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)), `swimcoach2_${coach}_${team}_`);
/** Les tests à deux pages relancent la synchro par l'événement `online` (temps réel neutralisé, voir R4). */
const nudge = (page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

test('(e) ajout par e-mail, invitation, retrait d’un membre par un autre, dernier membre', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxC = await browser.newContext();
  const fake = await installFakeSupabase([ctxA, ctxC], seed());
  const A = fake.coachId('a@toac.fr');
  const pageA = await ctxA.newPage();
  const pageC = await ctxC.newPage();

  // C n'est encore membre d'aucun espace
  await login(pageC, 'c@toac.fr');
  await expect(pageC.getByRole('heading', { name: 'Crée ton espace' })).toBeVisible();

  await login(pageA, 'a@toac.fr');
  await expect(pageA.locator('[data-screen="calendar"]')).toBeVisible();
  await settings(pageA);
  const add = pageA.getByLabel('Ajouter un entraîneur (adresse e-mail)');
  const msg = pageA.locator('[data-members-msg]');

  await add.fill('pas-une-adresse');
  await pageA.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(msg).toHaveText('Adresse e-mail invalide');

  await add.fill('c@toac.fr');
  await pageA.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(msg).toHaveText('c@toac.fr a été ajouté');
  await expect(pageA.locator('.member-row', { hasText: 'c@toac.fr' })).toBeVisible();

  await add.fill('c@toac.fr');
  await pageA.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(msg).toHaveText('Déjà membre');

  // C voit l'espace et ses nageurs après rechargement
  await pageC.reload();
  await expect(pageC.locator('[data-team-name]')).toHaveText('Pôle <i>Formation</i>');
  await pageC.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await expect(pageC.locator('.contact-row', { hasText: 'Léa Martin' })).toBeVisible();

  // invitation d'une adresse sans compte, puis annulation
  await add.fill('d@club.fr');
  await pageA.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(msg).toHaveText('Invitation en attente : demande à d@club.fr de créer son compte avec cette adresse');
  const invite = pageA.locator('.invite-row', { hasText: 'd@club.fr' });
  await expect(invite).toBeVisible();
  expect(fake.state.tables.team_invites.map((i) => i.email)).toEqual(['d@club.fr']);
  await invite.getByRole('button', { name: 'Annuler' }).click();
  await expect(invite).toHaveCount(0);
  expect(fake.state.tables.team_invites).toEqual([]);

  // C retire A
  await settings(pageC);
  const rowA = pageC.locator('.member-row', { hasText: 'a@toac.fr' });
  await rowA.getByRole('button', { name: 'Retirer' }).click();
  await pageC.getByRole('dialog').getByRole('button', { name: 'Retirer' }).click();
  await expect(rowA).toHaveCount(0);
  expect(fake.state.tables.team_members.map((m) => m.coach_id)).toEqual([fake.coachId('c@toac.fr')]);

  expect((await teamKeys(pageA, A, TA)).length).toBeGreaterThan(0);
  await nudge(pageA);
  await expect(pageA.getByText("Tu n'as plus accès à l'espace « Pôle <i>Formation</i> »")).toBeVisible();
  await expect(pageA.getByRole('heading', { name: 'Crée ton espace' })).toBeVisible();
  expect(await teamKeys(pageA, A, TA)).toEqual([]);

  // C, dernier membre, ne peut pas quitter
  const self = pageC.locator('.member-row', { hasText: 'c@toac.fr' });
  await self.getByRole('button', { name: "Quitter l'espace" }).click();
  await pageC.getByRole('dialog').getByRole('button', { name: 'Quitter' }).click();
  await expect(pageC.locator('[data-members-msg]')).toHaveText("Tu es le dernier membre : supprime l'espace si tu n'en as plus besoin");
  expect(fake.state.tables.team_members).toHaveLength(1);

  await ctxA.close();
  await ctxC.close();
});

test('(f) retiré pendant qu’il est hors ligne avec une op en attente : rien n’est renvoyé, cache effacé, message', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const fake = await installFakeSupabase(ctxA, seed());
  const A = fake.coachId('a@toac.fr');
  fake.addMember(TA, 'c@toac.fr');
  const pageA = await ctxA.newPage();
  await login(pageA, 'a@toac.fr');
  await expect(pageA.locator('[data-screen="calendar"]')).toBeVisible();

  fake.state.offline = true;
  await ctxA.setOffline(true);
  await pageA.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await pageA.getByRole('button', { name: 'Ajouter un nageur' }).click();
  await pageA.getByLabel('Prénom').fill('Hors ligne');
  await pageA.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(pageA.locator('.contact-row', { hasText: 'Hors ligne' })).toBeVisible();
  // pendant ce temps, un autre membre retire A
  fake.state.tables.team_members = fake.state.tables.team_members.filter((m) => m.coach_id !== A);
  const mark = fake.calls.length;

  fake.state.offline = false;
  await ctxA.setOffline(false);
  await nudge(pageA);
  await expect(pageA.getByText("Tu n'as plus accès à l'espace « Pôle <i>Formation</i> »")).toBeVisible();
  await expect(pageA.getByRole('heading', { name: 'Crée ton espace' })).toBeVisible();
  expect(await teamKeys(pageA, A, TA)).toEqual([]);
  expect(fake.calls.slice(mark).filter((c) => c.path === '/rest/v1/swimmers' && c.method === 'POST')).toEqual([]);
  expect(fake.state.tables.swimmers.map((s) => s.firstname)).toEqual(['Léa']);
  await ctxA.close();
});

test('renommer l’espace, quitter un espace partagé, créer un autre espace', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const fake = await installFakeSupabase(ctxA, seed());
  fake.addMember(TA, 'c@toac.fr');
  const pageA = await ctxA.newPage();
  await login(pageA, 'a@toac.fr');
  await expect(pageA.locator('[data-screen="calendar"]')).toBeVisible();
  await settings(pageA);

  await pageA.getByLabel("Nom de l'espace").fill('Pôle Perf');
  await pageA.getByRole('button', { name: 'Renommer' }).click();
  await expect(pageA.locator('[data-team-name]')).toHaveText('Pôle Perf');
  expect(fake.state.tables.teams[0].name).toBe('Pôle Perf');

  await pageA.getByLabel('Nom du nouvel espace').fill('Loisirs adultes');
  await pageA.getByRole('button', { name: "Créer l'espace" }).click();
  await expect(pageA.locator('[data-team-name]')).toHaveText('Loisirs adultes');
  await expect(pageA.locator('[data-screen="calendar"]')).toBeVisible();

  // retour sur l'espace partagé, puis départ volontaire
  await pageA.locator('.top-bar-team').click();
  await pageA.getByRole('button', { name: 'Pôle Perf' }).click();
  await expect(pageA.locator('[data-team-name]')).toHaveText('Pôle Perf');
  await expect(pageA.locator('[data-screen="calendar"]')).toBeVisible();
  await settings(pageA);
  await pageA.locator('.member-row', { hasText: 'a@toac.fr' }).getByRole('button', { name: "Quitter l'espace" }).click();
  await pageA.getByRole('dialog', { name: "Quitter l'espace « Pôle Perf » ?" }).getByRole('button', { name: 'Quitter' }).click();
  await expect(pageA.locator('[data-team-name]')).toHaveText('Loisirs adultes');
  await expect(pageA.getByText("Tu as quitté l'espace « Pôle Perf »")).toBeVisible();
  expect(fake.state.tables.team_members.filter((m) => m.team_id === TA).map((m) => m.coach_id)).toEqual([fake.coachId('c@toac.fr')]);
  await ctxA.close();
});

test('renommage lent puis changement d’espace : l’en-tête garde le nom du nouvel espace', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const fake = await installFakeSupabase(ctxA, seed());
  fake.addTeam({ id: '77777777-7777-4777-8777-777777777777', name: 'Zèbre' });
  fake.addMember('77777777-7777-4777-8777-777777777777', 'a@toac.fr');
  const pageA = await ctxA.newPage();
  await login(pageA, 'a@toac.fr');
  await expect(pageA.locator('[data-team-name]')).toHaveText('Pôle <i>Formation</i>');
  await settings(pageA);
  let release;
  const gate = new Promise((r) => { release = r; });
  await pageA.route('**/rest/v1/rpc/rename_team', async (route) => { await gate; await route.fallback(); });
  await pageA.getByLabel("Nom de l'espace").fill('Ancien renommé');
  await pageA.getByRole('button', { name: 'Renommer' }).click();
  await pageA.locator('.top-bar-team').click();
  await pageA.getByRole('button', { name: 'Zèbre' }).click();
  await expect(pageA.locator('[data-screen="calendar"]')).toBeVisible();
  await expect(pageA.locator('[data-team-name]')).toHaveText('Zèbre');
  release();
  await expect.poll(() => fake.state.tables.teams.find((t) => t.id === TA).name).toBe('Ancien renommé');
  await pageA.waitForTimeout(500);
  await expect(pageA.locator('[data-team-name]')).toHaveText('Zèbre');
  await ctxA.close();
});

test('renommé sur un autre appareil : l’en-tête suit à la resynchro', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const fake = await installFakeSupabase(ctxA, seed());
  const pageA = await ctxA.newPage();
  await login(pageA, 'a@toac.fr');
  await expect(pageA.locator('[data-team-name]')).toHaveText('Pôle <i>Formation</i>');
  fake.state.tables.teams.find((t) => t.id === TA).name = 'Pôle Perf';
  await nudge(pageA);
  await expect(pageA.locator('[data-team-name]')).toHaveText('Pôle Perf');
  await ctxA.close();
});
