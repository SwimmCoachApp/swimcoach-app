import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

// Dates en heure de Paris, quelle que soit la machine : 20/11/2026 est un vendredi.
test.use({ timezoneId: 'Europe/Paris', locale: 'fr-FR' });

const T1 = '55555555-5555-4555-8555-555555555555';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHOTO_PATH = new RegExp(`^${T1}/sessions/[0-9a-f-]{36}\\.jpg$`);
/** 20/11/2026 00:30 à Paris = 19/11/2026 23:30 UTC : le jour local et le jour UTC diffèrent. */
const MIDNIGHT = new Date('2026-11-19T23:30:00Z');
const MORNING = new Date('2026-11-20T09:00:00+01:00');

async function open(page, { tables = {}, now = MORNING } = {}) {
  const fake = await installFakeSupabase(page, {
    users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
    tables: { groups: [{ id: G1, team_id: T1, name: 'Benjamins', sort_order: 0 }], ...tables },
  });
  await page.clock.install({ time: now });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  return fake;
}

async function bigPng(page, w = 2000, h = 1200) {
  const b64 = await page.evaluate(([W, H]) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#38d1f0';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff5a36';
    g.fillRect(W / 4, H / 4, W / 2, H / 2);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h]);
  return { name: 'feuille.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('pas un jpeg');
}

const cell = (page, key) => page.locator(`.cal-day[data-key="${key}"]`);
const form = (page) => page.locator('#modal-session');

test('séance : créer à une date, la lire, la modifier, ajouter une photo, la retirer, la supprimer', async ({ page }) => {
  const fake = await open(page);
  await expect(page.locator('#cal-month-label')).toHaveText('Novembre 2026');
  await expect(page.locator('#day-panel-title')).toHaveText('Sélectionne un jour');

  // « + Séance » sans jour choisi : message, pas de feuille
  await page.getByRole('button', { name: '+ Séance' }).click();
  await expect(page.locator('.toast, #toast').first()).toContainText("Sélectionne un jour d'abord");
  await expect(form(page)).not.toHaveClass(/open/);

  // création : jour 20, texte riche, km, photo
  await cell(page, '2026-11-20').click();
  await expect(page.locator('#day-panel-title')).toHaveText('Vendredi 20 nov');
  await expect(page.locator('#sessions-list')).toContainText('Aucune séance');
  await page.getByRole('button', { name: '+ Séance' }).click();
  await expect(form(page)).toHaveClass(/open/);
  await expect(form(page).locator('.modal-title')).toHaveText('Nouvelle séance');
  await page.getByLabel('Titre de la séance').fill('Endurance');
  await page.getByLabel('Heure du cours').fill('07:30');
  await page.locator('#editor-content').click();
  await page.keyboard.type('Série 4x100');
  await page.getByRole('button', { name: 'Gras' }).click();
  await page.keyboard.type(' dur');
  await page.getByLabel('Km :').fill('3.5');
  await page.locator('#sess-photo-input-file').setInputFiles(await bigPng(page));
  await expect(page.locator('#sess-photo-preview')).toBeVisible();
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect(form(page)).not.toHaveClass(/open/);

  // dans la liste du jour et sur la grille
  const card = page.locator('.session-card.sc-nat');
  await expect(card).toContainText('07:30');
  await expect(card).toContainText('Endurance');
  await expect(card).toContainText('3.5 km');
  await expect(card).toContainText('photo');
  await expect(cell(page, '2026-11-20').locator('.dot-nat')).toHaveCount(1);

  // côté serveur : bonne date, contenu nettoyé, photo réduite sous <équipe>/sessions/
  await expect.poll(() => fake.state.tables.sessions.length).toBe(1);
  const row = () => fake.state.tables.sessions[0];
  expect(row()).toMatchObject({ date: '2026-11-20', title: 'Endurance', type: 'nat', time: '07:30', km: 3.5, team_id: T1 });
  expect(row().content).toMatch(/^Série 4x100<b>(&nbsp;| )dur<\/b>$/);
  expect(row().content).not.toMatch(/style|class|<font/);
  await expect.poll(() => row().photo_path).toMatch(PHOTO_PATH);
  const path = row().photo_path;
  const stored = fake.state.photos.get(path);
  expect(stored.mime).toBe('image/jpeg');
  expect(stored.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(Math.max(...Object.values(jpegSize(stored.data)))).toBe(1600);

  // lecture : contenu, photo signée, km
  await card.click();
  const view = page.locator('#modal-session-view');
  await expect(view).toHaveClass(/open/);
  await expect(view.locator('.sess-view-title')).toHaveText('Endurance');
  await expect(view.locator('.sess-view-content-html')).toContainText('Série 4x100');
  await expect(view.locator('.sess-view-km-val')).toHaveText('3.5 km');
  const photo = view.locator('img.sv-photo');
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
  expect(await photo.getAttribute('src')).toMatch(/\/storage\/v1\/object\/sign\/photos\/.+\?token=/);
  await photo.click();
  await expect(page.locator('#photo-fullscreen')).toHaveClass(/open/);
  await page.locator('#photo-fullscreen').click();
  await expect(page.locator('#photo-fullscreen')).not.toHaveClass(/open/);

  // modification : titre, type muscu (km masqué et vidé), la photo reste
  await view.getByRole('button', { name: /Modifier/ }).click();
  await expect(form(page)).toHaveClass(/open/);
  await expect(form(page).locator('.modal-title')).toHaveText('Modifier la séance');
  await expect(page.getByLabel('Titre de la séance')).toHaveValue('Endurance');
  await expect(page.locator('#sess-km')).toHaveValue('3.5');
  await expect(page.locator('#sess-photo-preview')).toBeVisible();
  await page.getByLabel('Titre de la séance').fill('Gainage');
  await page.getByRole('button', { name: /Muscu/ }).click();
  await expect(page.locator('#sess-km-row')).toBeHidden();
  await expect(page.locator('#sess-km')).toHaveValue('');
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect(form(page)).not.toHaveClass(/open/);
  await expect(page.locator('.session-card.sc-musc')).toContainText('Gainage');
  await expect(cell(page, '2026-11-20').locator('.dot-musc')).toHaveCount(1);
  await expect.poll(() => row().title).toBe('Gainage');
  expect(row()).toMatchObject({ type: 'musc', km: null, photo_path: path });
  expect(fake.state.tables.sessions).toHaveLength(1);

  // retirer la photo
  await page.locator('.session-card').click();
  await page.locator('#modal-session-view').getByRole('button', { name: /Modifier/ }).click();
  await expect(form(page)).toHaveClass(/open/);
  await page.getByRole('button', { name: 'Supprimer la photo' }).click();
  await expect(page.locator('#sess-photo-empty')).toBeVisible();
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect.poll(() => row().photo_path).toBeNull();
  expect([...fake.state.photos.keys()]).toEqual([]);
  await expect(page.locator('.session-card')).not.toContainText('photo');

  // nouvelle photo (appareil), puis suppression de la séance : photo supprimée avant la ligne
  await page.locator('.session-card').click();
  await page.locator('#modal-session-view').getByRole('button', { name: /Modifier/ }).click();
  await expect(form(page)).toHaveClass(/open/);
  await page.locator('#sess-photo-input-cam').setInputFiles(await bigPng(page, 800, 600));
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect.poll(() => fake.state.photos.size).toBe(1);
  await page.locator('.session-card').click();
  await page.locator('#modal-session-view').getByRole('button', { name: /Modifier/ }).click();
  await expect(form(page)).toHaveClass(/open/);
  await form(page).getByRole('button', { name: /Supprimer$/ }).click();
  await expect(page.locator('#dialog-session')).toHaveClass(/open/);
  await page.locator('#dialog-session').getByRole('button', { name: 'Annuler' }).click();
  expect(fake.state.tables.sessions).toHaveLength(1);
  await form(page).getByRole('button', { name: /Supprimer$/ }).click();
  await page.locator('#dialog-session').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.locator('.session-card')).toHaveCount(0);
  await expect(cell(page, '2026-11-20').locator('.session-dot')).toHaveCount(0);
  await expect.poll(() => fake.state.tables.sessions.length).toBe(0);
  expect(fake.state.photos.size).toBe(0);
});

test('navigation d’un mois à l’autre, changement d’année, événements du plan', async ({ page }) => {
  await open(page, {
    tables: {
      plan_events: [
        { id: '11111111-1111-4111-8111-111111111111', team_id: T1, month_key: '2026-12', type: 'stage', title: 'Stage Noël', description: 'Piscine Léo Lagrange', start_date: '2026-12-27', end_date: '2027-01-02' },
        { id: '22222222-2222-4222-8222-222222222222', team_id: T1, month_key: '2026-12', type: 'comp', title: 'Régionaux', description: '', start_date: '2026-12-28', end_date: '2026-12-28' },
      ],
      sessions: [{ id: '33333333-3333-4333-8333-333333333333', team_id: T1, date: '2026-10-31', title: 'Octobre', type: 'nat', time: '08:00', content: '', km: 2, photo_path: null }],
    },
  });
  const label = page.locator('#cal-month-label');
  await expect(label).toHaveText('Novembre 2026');
  await expect(cell(page, '2026-11-01')).toBeVisible();
  await expect(page.locator('.cal-day:not(.empty)')).toHaveCount(30);
  await expect(page.locator('.cal-day.empty')).toHaveCount(6); // 1er novembre 2026 : dimanche

  await page.getByRole('button', { name: 'Mois précédent' }).click();
  await expect(label).toHaveText('Octobre 2026');
  await expect(page.locator('.cal-day:not(.empty)')).toHaveCount(31);
  await expect(cell(page, '2026-10-31').locator('.dot-nat')).toHaveCount(1);

  await page.getByRole('button', { name: 'Mois suivant' }).click();
  await page.getByRole('button', { name: 'Mois suivant' }).click();
  await expect(label).toHaveText('Décembre 2026');
  // la compétition l'emporte sur le stage le 28, le stage reste visible les autres jours
  await expect(cell(page, '2026-12-28')).toHaveClass(/ev-comp/);
  await expect(cell(page, '2026-12-28')).toContainText('Régionaux');
  await expect(cell(page, '2026-12-27')).toHaveClass(/ev-stage/);
  await expect(cell(page, '2026-12-27')).toContainText('Stage Noël');
  await expect(cell(page, '2026-12-29')).toHaveClass(/ev-stage/);
  await expect(cell(page, '2026-12-27')).toContainText('🏕'); // l'icône n'est que sur le premier jour
  await expect(cell(page, '2026-12-29')).not.toContainText('🏕');

  // le panneau du jour liste tous les événements, le plus prioritaire d'abord
  await cell(page, '2026-12-28').click();
  const banners = page.locator('.plan-event-banner');
  await expect(banners).toHaveCount(2);
  await expect(banners.nth(0)).toContainText('Régionaux');
  await expect(banners.nth(1)).toContainText('Stage Noël');
  await expect(banners.nth(1)).toContainText('Piscine Léo Lagrange');
  await expect(banners.nth(1)).toContainText('27 déc. → 2 janv.');

  await page.getByRole('button', { name: 'Mois suivant' }).click();
  await expect(label).toHaveText('Janvier 2027');
  await expect(cell(page, '2027-01-02')).toHaveClass(/ev-stage/);
  await expect(cell(page, '2027-01-03')).not.toHaveClass(/ev-/);
  // le jour choisi reste choisi (autre mois) ; on revient avec Aujourd'hui
  await expect(page.locator('#day-panel-title')).toHaveText('Lundi 28 déc');
  await page.getByRole('button', { name: "Aujourd'hui" }).click();
  await expect(label).toHaveText('Novembre 2026');
  await expect(page.locator('#day-panel-title')).toHaveText('Vendredi 20 nov');
});

test('horloge à 00:30 heure de Paris : « Aujourd’hui » ouvre le 20, et la séance est bien datée du 20', async ({ page }) => {
  const fake = await open(page, { now: MIDNIGHT });
  expect(await page.evaluate(() => [new Date().getDate(), new Date().getUTCDate()])).toEqual([20, 19]);
  await expect(page.locator('#cal-month-label')).toHaveText('Novembre 2026');
  await expect(cell(page, '2026-11-20')).toHaveClass(/today/);
  await expect(cell(page, '2026-11-19')).not.toHaveClass(/today/);

  await page.getByRole('button', { name: 'Mois précédent' }).click();
  await page.getByRole('button', { name: 'Mois précédent' }).click();
  await expect(page.locator('#cal-month-label')).toHaveText('Septembre 2026');
  await page.getByRole('button', { name: "Aujourd'hui" }).click();
  await expect(page.locator('#cal-month-label')).toHaveText('Novembre 2026');
  await expect(page.locator('#day-panel-title')).toHaveText('Vendredi 20 nov');
  await expect(cell(page, '2026-11-20')).toHaveClass(/selected/);

  await page.getByRole('button', { name: '+ Séance' }).click();
  await page.getByLabel('Titre de la séance').fill('Nuit');
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect.poll(() => fake.state.tables.sessions[0]?.date).toBe('2026-11-20');
});

test('contenu hostile en base : affiché comme du texte, jamais exécuté', async ({ page }) => {
  const SID = '44444444-4444-4444-8444-444444444444';
  await open(page, {
    tables: {
      sessions: [{ id: SID, team_id: T1, date: '2026-11-20', title: '<img src=x onerror=window.__xss=1>', type: 'nat', time: '08:00', km: 1, photo_path: null,
        content: '<b>ok</b><img src=x onerror=window.__xss=1><script>window.__xss=2</script><a href="javascript:window.__xss=3">lien</a>'
          + '<span style="color:#ff0000;position:fixed;top:0;background:url(javascript:window.__xss=4)">rouge</span>'
          + '<span style="background-color:expression(alert(1));color:var(--x)">neutre</span>'
          + '<font color="#00aa00" face="x" size="7">vert</font><strike>barré</strike>'
          + '<span style="background-color: rgba(253, 224, 71, 0.5)">surligné</span>' }],
    },
  });
  await cell(page, '2026-11-20').click();
  const card = page.locator('.session-card');
  await expect(card).toContainText('<img src=x onerror=window.__xss=1>');
  await card.click();
  const view = page.locator('#modal-session-view');
  await expect(view.locator('.sess-view-content-html b')).toHaveText('ok');
  await expect(view.locator('.sess-view-content-html')).toContainText('lien');
  expect(await page.locator('[data-screen="calendar"] img').count()).toBe(0);
  expect(await view.locator('a, script').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // couleurs et barré gardés (liste blanche stricte), tout autre style supprimé
  const rich = view.locator('.sess-view-content-html');
  expect(await rich.locator('span', { hasText: 'rouge' }).getAttribute('style')).toBe('color: #ff0000');
  expect(await rich.locator('span', { hasText: 'neutre' }).getAttribute('style')).toBeNull();
  expect(await rich.locator('span', { hasText: 'vert' }).getAttribute('style')).toBe('color: #00aa00');
  expect(await rich.locator('span', { hasText: 'surligné' }).getAttribute('style')).toBe('background-color: rgba(253, 224, 71, 0.5)');
  await expect(rich.locator('s')).toHaveText('barré');
  expect(await rich.locator('font, strike, [style*="position"], [style*="url"]').count()).toBe(0);
  await view.getByRole('button', { name: /Modifier/ }).click();
  await expect(page.locator('#editor-content b')).toHaveText('ok');
  expect(await page.locator('#editor-content img, #editor-content a').count()).toBe(0);
});

test('barre d’outils : barré, couleur et surlignage enregistrés nettoyés ; une séance sans heure le reste', async ({ page }) => {
  const SID = '66666666-6666-4666-8666-666666666666';
  const fake = await open(page, { tables: { sessions: [{ id: SID, team_id: T1, date: '2026-11-20', title: 'Sans heure', type: 'nat', time: null, content: '', km: null, photo_path: null }] } });
  await cell(page, '2026-11-20').click();
  await page.locator('.session-card').click();
  await page.locator('#modal-session-view').getByRole('button', { name: /Modifier/ }).click();
  await expect(form(page)).toHaveClass(/open/);
  await expect(page.getByLabel('Heure du cours')).toHaveValue('');

  const editor = page.locator('#editor-content');
  await editor.click();
  await page.keyboard.type('barré ');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Barré' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('vert ');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.getByLabel('Couleur du texte').fill('#00aa00');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('jaune');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Surligner' }).click();
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect(form(page)).not.toHaveClass(/open/);

  await expect.poll(() => fake.state.tables.sessions[0].content).toContain('jaune');
  const saved = fake.state.tables.sessions[0];
  expect(saved.time).toBeNull();
  expect(saved.content).toMatch(/^<s>barré/); // la mise en forme continue sur le texte tapé ensuite
  expect(saved.content).toMatch(/<span style="color: (#00aa00|rgb\(0, 170, 0\))">vert/);
  expect(saved.content).toMatch(/<span style="background-color: rgba\(253, 224, 71, 0\.5\)">jaune<\/span>/);
  expect(saved.content).not.toMatch(/<font|<strike|class=/);
});
