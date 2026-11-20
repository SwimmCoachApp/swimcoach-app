import { test, expect } from '@playwright/test';
import { installFakeSupabase } from './fake-supabase.js';

const T1 = '55555555-5555-4555-8555-555555555555';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHOTO_PATH = new RegExp(`^${T1}/swimmers/[0-9a-f-]{36}\\.jpg$`);

async function open(page, tables = {}, features = { groups: true }) {
  const fake = await installFakeSupabase(page, {
    features, // ce fichier couvre aussi les groupes, masqués par défaut dans l'app
    users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
    tables: {
      groups: [{ id: G1, team_id: T1, name: 'Benjamins', sort_order: 0 }, { id: G2, team_id: T1, name: 'Loisirs', sort_order: 1 }],
      ...tables,
    },
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await expect(page.locator('[data-screen="contacts"]')).toBeVisible();
  return fake;
}

/** Grande image png fabriquée dans la page (le test vérifie qu'elle est réduite avant l'envoi). */
async function bigPng(page, w = 1600, h = 1000) {
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
  return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

/** Dimensions d'un jpeg (marqueur SOF). */
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

async function addSwimmer(page, { firstname, lastname = '', group, photo }) {
  await page.getByRole('button', { name: 'Ajouter un nageur' }).click();
  await expect(page.locator('#modal-swimmer')).toHaveClass(/open/);
  await page.getByLabel('Prénom').fill(firstname);
  await page.getByLabel('Nom', { exact: true }).fill(lastname);
  if (group) await page.getByLabel('Groupe', { exact: true }).selectOption({ label: group });
  if (photo) await page.locator('#sw-photo-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('#modal-swimmer')).not.toHaveClass(/open/);
}

test('nageur avec photo : envoi réduit sous <équipe>/swimmers/, liste, modification, archivage, restauration', async ({ page }) => {
  const fake = await open(page);
  const photo = await bigPng(page);
  await addSwimmer(page, { firstname: 'Léa', lastname: 'Martin', group: 'Benjamins', photo });

  const row = page.locator('.contact-row', { hasText: 'Léa Martin' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Benjamins');
  await expect(page.locator('[data-count="actifs"]')).toHaveText('(1)');

  // photo : objet jpeg réduit, sous le bon chemin ; la ligne en garde le chemin
  await expect.poll(() => [...fake.state.photos.keys()]).toHaveLength(1);
  const [path] = [...fake.state.photos.keys()];
  expect(path).toMatch(PHOTO_PATH);
  const stored = fake.state.photos.get(path);
  expect(stored.mime).toBe('image/jpeg');
  expect(stored.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  const { w, h } = jpegSize(stored.data);
  expect(Math.max(w, h)).toBe(800);
  await expect.poll(() => fake.state.tables.swimmers[0]?.photo_path).toBe(path);
  expect(fake.state.tables.swimmers[0]).toMatchObject({ firstname: 'Léa', lastname: 'Martin', group_id: G1, team_id: T1 });
  expect(fake.state.tables.swimmers[0].joined_season).toBeGreaterThan(2000);
  expect(fake.state.tables.swimmers[0].left_season).toBeNull();

  // la photo s'affiche (URL signée, sans clé dans l'URL)
  const avatar = row.locator('img[data-photo]');
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
  expect(await avatar.getAttribute('src')).toMatch(/\/storage\/v1\/object\/sign\/photos\/.+\?token=/);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('token=');

  // fiche puis modification (même objet remplacé)
  await row.click();
  await expect(page.locator('#modal-contact')).toHaveClass(/open/);
  await expect(page.locator('.contact-popup-name')).toHaveText('Léa Martin');
  await page.locator('#modal-contact').getByRole('button', { name: /Modifier$/ }).click();
  await expect(page.locator('#modal-swimmer')).toHaveClass(/open/);
  await page.getByLabel('Nom', { exact: true }).fill('Durand');
  await page.getByLabel('Téléphone').fill('06 12 34 56 78');
  await page.locator('#sw-photo-input').setInputFiles(await bigPng(page, 400, 600));
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect.poll(() => fake.state.tables.swimmers[0].lastname).toBe('Durand');
  expect([...fake.state.photos.keys()]).toEqual([path]);
  expect(jpegSize(fake.state.photos.get(path).data)).toEqual({ w: 400, h: 600 });
  await expect(page.locator('.contact-popup-name')).toHaveText('Léa Durand'); // la fiche se rouvre

  // archivage : sort des Actifs, apparaît dans Archivés
  await page.getByRole('button', { name: 'Archiver' }).click();
  await page.locator('.archive-season-btn.default').click();
  await expect(page.locator('.contact-row', { hasText: 'Léa Durand' })).toHaveCount(0);
  await expect(page.locator('[data-count="actifs"]')).toHaveText('(0)');
  await expect(page.locator('[data-count="archives"]')).toHaveText('(1)');
  await expect.poll(() => fake.state.tables.swimmers[0].left_season).not.toBeNull();
  await page.getByRole('button', { name: /Archivés/ }).click();
  const archived = page.locator('.contact-row', { hasText: 'Léa Durand' });
  await expect(archived).toBeVisible();
  await expect(archived.locator('.archived-badge')).toContainText('📦');

  // restauration
  await archived.click();
  await page.getByRole('button', { name: 'Restaurer' }).click();
  await expect(page.locator('.contact-row', { hasText: 'Léa Durand' })).toHaveCount(0);
  await expect.poll(() => fake.state.tables.swimmers[0].left_season).toBeNull();
  await page.getByRole('button', { name: /Actifs/ }).click();
  await expect(page.locator('.contact-row', { hasText: 'Léa Durand' })).toBeVisible();
});

test('groupes : ajout, doublon refusé, suppression, groupe utilisé protégé', async ({ page }) => {
  const fake = await open(page);
  await addSwimmer(page, { firstname: 'Tom', group: 'Loisirs' });
  await page.getByRole('button', { name: 'Ajouter un nageur' }).click();
  await page.getByLabel('Nouveau groupe').fill('Élites');
  await page.getByRole('button', { name: '+ Ajouter' }).click();
  await expect(page.getByLabel('Groupe', { exact: true })).toHaveValue(/.+/); // le nouveau groupe est choisi
  await expect(page.locator('.group-item-name', { hasText: 'Élites' })).toBeVisible();
  await expect.poll(() => fake.state.tables.groups.map((g) => g.name)).toContain('Élites');
  expect(fake.state.tables.groups.find((g) => g.name === 'Élites').sort_order).toBe(2);

  await page.getByLabel('Nouveau groupe').fill('élites');
  await page.getByRole('button', { name: '+ Ajouter' }).click();
  await expect(page.getByText('Ce groupe existe déjà')).toBeVisible();
  expect(fake.state.tables.groups).toHaveLength(3);

  await page.getByRole('button', { name: 'Supprimer le groupe Élites' }).click();
  await expect(page.locator('.group-item-name', { hasText: 'Élites' })).toHaveCount(0);
  await expect.poll(() => fake.state.tables.groups.map((g) => g.name)).not.toContain('Élites');

  await page.getByRole('button', { name: 'Supprimer le groupe Loisirs' }).click();
  await expect(page.getByText('Des nageurs utilisent ce groupe')).toBeVisible();
  expect(fake.state.tables.groups.map((g) => g.name)).toContain('Loisirs');
});

test('XSS : un nom piégé reste du texte (liste, fiche, formulaire), aucune boîte de dialogue', async ({ page }) => {
  const evil = '<img src=x onerror=alert(1)>';
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await open(page);
  await addSwimmer(page, { firstname: evil, lastname: '"><b>x</b>' });
  const row = page.locator('.contact-row').first();
  await expect(row.locator('.contact-name')).toContainText(evil);
  await expect(page.locator('[data-screen="contacts"] img, [data-screen="contacts"] b')).toHaveCount(0);
  await row.click();
  await expect(page.locator('.contact-popup-name')).toContainText(evil);
  await page.locator('#modal-contact').getByRole('button', { name: /Modifier$/ }).click();
  await expect(page.getByLabel('Prénom')).toHaveValue(evil);
  await page.waitForTimeout(300);
  expect(dialogs).toEqual([]);
});

test('recherche différée de 150 ms, sur le nom et le groupe, sans accent', async ({ page }) => {
  await open(page, {
    swimmers: [
      { id: '11111111-1111-4111-8111-111111111111', team_id: T1, firstname: 'Éloïse', lastname: 'Bernard', group_id: G1, joined_season: 2025, left_season: null },
      { id: '22222222-2222-4222-8222-222222222222', team_id: T1, firstname: 'Paul', lastname: 'Roux', group_id: G2, joined_season: 2025, left_season: null },
    ],
  });
  await expect(page.locator('.contact-row')).toHaveCount(2);
  await page.getByLabel('Chercher un nageur').pressSequentially('eloi');
  await expect(page.locator('.contact-row')).toHaveCount(1);
  await expect(page.locator('.contact-row')).toContainText('Éloïse Bernard');
  await page.getByLabel('Chercher un nageur').fill('loisirs');
  await expect(page.locator('.contact-row')).toContainText('Paul Roux');
  await page.getByLabel('Chercher un nageur').fill('zzz');
  await expect(page.getByText('Aucun résultat')).toBeVisible();
});

test('suppression : confirmation, photo supprimée avant la ligne', async ({ page }) => {
  const fake = await open(page);
  await addSwimmer(page, { firstname: 'Zoé', photo: await bigPng(page, 300, 300) });
  await expect.poll(() => fake.state.photos.size).toBe(1);
  await expect.poll(() => fake.state.tables.swimmers[0]?.photo_path).toMatch(PHOTO_PATH);

  await page.locator('.contact-row', { hasText: 'Zoé' }).click();
  await page.locator('#modal-contact').getByRole('button', { name: /Modifier$/ }).click();
  await page.locator('#modal-swimmer').getByRole('button', { name: /Supprimer$/ }).click();
  await expect(page.getByText('Supprimer Zoé ?')).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  expect(fake.state.tables.swimmers).toHaveLength(1);

  await page.locator('#modal-swimmer').getByRole('button', { name: /Supprimer$/ }).click();
  await page.locator('#dialog-contact').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.locator('.contact-row')).toHaveCount(0);
  await expect.poll(() => fake.state.tables.swimmers).toHaveLength(0);
  expect(fake.state.photos.size).toBe(0);
  const calls = fake.calls.map((c) => `${c.method} ${c.path}`);
  const photoDelete = calls.findIndex((c) => c === 'DELETE /storage/v1/object/photos');
  const rowDelete = calls.findIndex((c) => c === 'DELETE /rest/v1/swimmers');
  expect(photoDelete).toBeGreaterThan(-1);
  expect(rowDelete).toBeGreaterThan(photoDelete);
});

test('hors ligne : la photo attend la connexion, le reste est enregistré et part au retour du réseau', async ({ page, context }) => {
  const fake = await open(page);
  const photo = await bigPng(page, 300, 300);
  fake.state.offline = true;
  await context.setOffline(true); // navigator.onLine passe à faux
  await addSwimmer(page, { firstname: 'Max', photo });
  await expect(page.getByText('La photo nécessite une connexion')).toBeVisible();
  await expect(page.locator('.contact-row', { hasText: 'Max' })).toBeVisible();
  expect(fake.state.photos.size).toBe(0);
  expect(fake.state.tables.swimmers).toHaveLength(0);
  fake.state.offline = false;
  await context.setOffline(false);
  await expect.poll(() => fake.state.tables.swimmers.map((s) => s.firstname)).toEqual(['Max']);
  expect(fake.state.tables.swimmers[0].photo_path).toBeNull();
});

test('création d’un groupe : les groupes par défaut sont créés une seule fois', async ({ page }) => {
  const fake = await installFakeSupabase(page, { features: { groups: true }, users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }] });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByLabel("Nom du groupe").fill('Mon club');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  const names = () => fake.state.tables.groups.map((g) => g.name);
  await expect.poll(names).toHaveLength(6);
  expect(names()).toEqual(['Benjamins', 'École de natation', 'Loisirs', 'Pôle Formation 1', 'Compétition', 'Autre']);
  expect(fake.state.tables.groups.map((g) => g.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  await page.reload();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter un nageur' }).click();
  await expect(page.locator('#sw-group option')).toHaveText(['Aucun groupe', 'Benjamins', 'École de natation', 'Loisirs', 'Pôle Formation 1', 'Compétition', 'Autre']);
  expect(names()).toHaveLength(6);
});

test('espace sans groupe ouvert par un invité : les groupes par défaut arrivent une fois ; avec un groupe, rien n’est créé', async ({ page }) => {
  const fake = await installFakeSupabase(page, {
    features: { groups: true }, // ce fichier couvre aussi les groupes (masqués par défaut)
    users: [{ email: 'invite@toac.fr', password: 'motdepasse-long', activated: true }],
    teams: [{ id: T1, name: 'Chez le collègue' }],
    members: [{ team_id: T1, email: 'invite@toac.fr' }],
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('invite@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await expect.poll(() => fake.state.tables.groups.length).toBe(6);
  await page.reload();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  await page.waitForTimeout(600);
  expect(fake.state.tables.groups).toHaveLength(6);
});

test('espace qui a déjà un groupe : aucun groupe par défaut', async ({ page }) => {
  const fake = await open(page);
  await page.waitForTimeout(600);
  expect(fake.state.tables.groups.map((g) => g.name)).toEqual(['Benjamins', 'Loisirs']);
  expect(fake.callsTo('/rest/v1/groups').filter((c) => c.method === 'POST')).toHaveLength(0);
});

test('Mail groupe : adresses valides des actifs du groupe, encodées, en copie cachée', async ({ page }) => {
  const sw = (n, group_id, email, left_season = null) => ({
    id: `0000000${n}-0000-4000-8000-00000000000${n}`, team_id: T1, firstname: `N${n}`, lastname: 'X', group_id, email, joined_season: 2024, left_season,
  });
  await open(page, {
    swimmers: [sw(1, G1, 'a+b@toac.fr'), sw(2, G1, ''), sw(3, G1, 'pas-un-mail'), sw(4, G1, 'archive@toac.fr', 2025), sw(5, G2, 'c@toac.fr'), sw(6, G1, 'd@toac.fr')],
  });
  const link = page.locator('#group-mail-link');
  await expect(link).toHaveAttribute('href', `mailto:?bcc=${encodeURIComponent('a+b@toac.fr')},c%40toac.fr,d%40toac.fr&subject=${encodeURIComponent('Message de TOAC Natation')}`);
  await expect(page.locator('#group-mail-select option')).toHaveText(['Tous les actifs', 'Benjamins', 'Loisirs']);
  await page.locator('#group-mail-select').selectOption({ label: 'Benjamins' });
  await expect(link).toHaveAttribute('href', `mailto:?bcc=a%2Bb%40toac.fr,d%40toac.fr&subject=${encodeURIComponent('[Benjamins] Message de TOAC Natation')}`);
});

test('Mail groupe sans adresse : message, pas de navigation', async ({ page }) => {
  await open(page, { swimmers: [{ id: '00000001-0000-4000-8000-000000000001', team_id: T1, firstname: 'Sans', lastname: 'Mail', group_id: G1, joined_season: 2025, left_season: null }] });
  await page.locator('#group-mail-link').click();
  await expect(page.getByText('Aucun nageur actif avec un email')).toBeVisible();
  expect(page.url()).not.toContain('mailto');
});

test('clavier : Entrée et Espace ouvrent la fiche depuis la ligne', async ({ page }) => {
  await open(page, { swimmers: [{ id: '00000001-0000-4000-8000-000000000001', team_id: T1, firstname: 'Clara', lastname: 'Key', group_id: G1, joined_season: 2025, left_season: null }] });
  const row = page.locator('.contact-row');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#modal-contact')).toHaveClass(/open/);
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await expect(page.locator('#modal-contact')).not.toHaveClass(/open/);
  await row.focus();
  await page.keyboard.press(' ');
  await expect(page.locator('#modal-contact')).toHaveClass(/open/);
});

test('fiche avec photo : la photo remplit le cercle (captures clair et sombre) ; liens mailto et tel encodés', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page);
  await addSwimmer(page, { firstname: 'Léa', lastname: 'Martin', group: 'Benjamins', photo: await bigPng(page, 600, 800) });
  await page.locator('.contact-row', { hasText: 'Léa' }).click();
  await page.locator('#modal-contact').getByRole('button', { name: /Modifier$/ }).click();
  await expect(page.locator('#modal-swimmer')).toHaveClass(/open/);
  await expect(page.locator('#swimmer-sheet .modal-title')).toHaveText('Modifier nageur');
  await page.getByLabel('Téléphone').fill('06 12.34-56 78');
  await page.getByLabel('Email').fill('a+b@toac.fr');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('.btn-mail')).toBeVisible(); // la fiche s'est rouverte avec les nouvelles valeurs
  const avatar = page.locator('.contact-popup-avatar img');
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
  const box = await avatar.boundingBox();
  const frame = await page.locator('.contact-popup-avatar').boundingBox();
  expect(Math.abs(box.width - (frame.width - 6))).toBeLessThan(2); // bordure de 3 px
  expect(Math.abs(box.height - (frame.height - 6))).toBeLessThan(2);
  await expect(page.locator('.btn-mail')).toHaveAttribute('href', 'mailto:a%2Bb%40toac.fr');
  await expect(page.locator('.btn-call')).toHaveAttribute('href', 'tel:0612345678');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/contacts-fiche-photo-dark.png' });
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await page.locator('.contact-row', { hasText: 'Léa' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/contacts-fiche-photo-light.png' });
});

test('la capture de la liste et de la fiche (sombre et clair)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const swimmers = [
    ['Léa', 'Martin', G1, 2024, null, '2012-05-03'], ['Hugo', 'Bernard', G2, 2025, null, '2010-01-20'],
    ['Inès', 'Roux', G1, 2023, null, '2013-09-14'], ['Tom', 'Garcia', G2, 2022, 2025, '2009-03-30'], ['Zoé', 'Petit', G1, 2025, null, '2014-11-02'],
  ].map(([firstname, lastname, group_id, joined_season, left_season, dob], i) => ({
    id: `0000000${i}-0000-4000-8000-00000000000${i}`, team_id: T1, firstname, lastname, dob, group_id, phone: '06 12 34 56 78', email: 'nageur@exemple.fr', joined_season, left_season,
  }));
  await open(page, { swimmers });
  await expect(page.locator('.contact-row')).toHaveCount(4);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/contacts-list-dark.png' });
  await page.locator('.contact-row', { hasText: 'Léa' }).click();
  await expect(page.locator('#modal-contact')).toHaveClass(/open/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/contacts-fiche-dark.png' });
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/contacts-list-light.png' });
  await page.locator('.contact-row', { hasText: 'Léa' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/contacts-fiche-light.png' });
});

test('groupes masqués (réglage de l’app) : ni groupe, ni liste de groupes ; « Mail à tous » ; le groupe d’un nageur modifié est gardé', async ({ page }) => {
  const id = '00000001-0000-4000-8000-000000000001';
  const fake = await open(page, { swimmers: [{ id, team_id: T1, firstname: 'Léa', lastname: 'Roux', email: 'lea@toac.fr', group_id: G1, joined_season: 2025, left_season: null }] }, {});
  await expect(page.locator('#group-mail-select')).toHaveCount(0);
  await expect(page.locator('#group-mail-link')).toHaveText('✉️ Mail à tous');
  await expect(page.locator('#group-mail-link')).toHaveAttribute('href', /^mailto:\?bcc=lea%40toac\.fr/);
  await expect(page.locator('#contacts-list')).not.toContainText('Benjamins');
  await page.locator('.contact-row', { hasText: 'Léa' }).click();
  await expect(page.locator('#contact-popup')).not.toContainText('Benjamins');
  await expect(page.locator('#contact-popup')).not.toContainText('Sans groupe');
  await page.locator('#contact-popup').getByRole('button', { name: '✏️ Modifier' }).click();
  await expect(page.locator('#sw-group')).toHaveCount(0);
  await page.getByLabel('Nom', { exact: true }).fill('Roux-Martin');
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect.poll(() => fake.state.tables.swimmers.find((s) => s.id === id)?.lastname).toBe('Roux-Martin');
  expect(fake.state.tables.swimmers.find((s) => s.id === id).group_id).toBe(G1);
});
