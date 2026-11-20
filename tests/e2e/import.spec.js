import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { currentSeason } from '../../src/core/season.js';
import { installFakeSupabase } from './fake-supabase.js';

const T1 = '55555555-5555-4555-8555-555555555555';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const XLSX = resolve(process.cwd(), 'tests/fixtures/nageurs.xlsx');
const CSV = resolve(process.cwd(), 'tests/fixtures/nageurs.csv');
const sw = (n, firstname, lastname, left_season = null) => ({
  id: `0000000${n}-0000-4000-8000-00000000000${n}`, team_id: T1, firstname, lastname, group_id: G1, joined_season: 2024, left_season,
});

async function open(page, swimmers = [sw(1, 'Hugo', 'Petit'), sw(2, 'Tom', 'Martin', 2024)]) {
  const fake = await installFakeSupabase(page, {
    features: { groups: true },
    users: [{ email: 'coach@toac.fr', password: 'motdepasse-long', activated: true }],
    teams: [{ id: T1, name: 'TOAC Natation' }],
    members: [{ team_id: T1, email: 'coach@toac.fr' }],
    tables: { groups: [{ id: G1, team_id: T1, name: 'Benjamins', sort_order: 0 }], swimmers },
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('coach@toac.fr');
  await page.getByLabel('Mot de passe').fill('motdepasse-long');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('button', { name: 'Nageurs', exact: true }).click();
  await expect(page.locator('[data-screen="contacts"]')).toBeVisible();
  return fake;
}

test('import .xlsx : aperçu (à créer, doublons, archivés ignorés) puis création exacte, groupe créé une fois', async ({ page }) => {
  const fake = await open(page);
  // le lecteur Excel n'est téléchargé qu'à l'ouverture de l'import
  const chunks = [];
  page.on('request', (r) => { if (/assets\/universal-.*\.js/.test(r.url())) chunks.push(r.url()); });
  expect(chunks).toEqual([]);
  await page.getByRole('button', { name: /Importer depuis Excel/ }).click();
  await expect(page.locator('#modal-import')).toHaveClass(/open/);
  await expect.poll(() => chunks.length).toBeGreaterThan(0);
  await page.locator('#import-file').setInputFiles(XLSX);

  await expect(page.locator('#import-summary')).toHaveText('3 à créer, 1 doublons, 📦 1 archivés ignorés');
  await expect(page.locator('.import-preview-row')).toHaveCount(3);
  await expect(page.locator('.import-note', { hasText: 'groupes seront créés' })).toContainText('Avenir, Autre');
  expect(fake.state.tables.swimmers).toHaveLength(2); // rien d'écrit avant confirmation

  await page.getByRole('button', { name: /Importer 3 nageurs/ }).click();
  await expect(page.locator('#modal-import')).not.toHaveClass(/open/);
  await expect.poll(() => fake.state.tables.swimmers.length).toBe(5);
  const created = fake.state.tables.swimmers.filter((s) => !['Hugo', 'Tom'].includes(s.firstname));
  expect(created.map((s) => `${s.lastname} ${s.firstname}`).sort()).toEqual(['BERNARD Chloé', 'DUPONT Léa', 'ROUX Emma']);
  expect(created.find((s) => s.firstname === 'Léa')).toMatchObject({ dob: '2012-03-15', group_id: G1, email: 'lea.dupont@example.org', left_season: null });
  expect(created.find((s) => s.firstname === 'Chloé').dob).toBe('2023-03-15');
  const autreId = fake.state.tables.groups.find((g) => g.name === 'Autre')?.id;
  expect(autreId).toBeTruthy();
  expect(created.find((s) => s.firstname === 'Emma')).toMatchObject({ dob: '2013-07-21', group_id: autreId });
  expect(fake.state.tables.groups.map((g) => g.name).sort()).toEqual(['Autre', 'Avenir', 'Benjamins']);
  for (const s of created) expect(s.joined_season).toBe(currentSeason());
  const avenir = fake.state.tables.groups.find((g) => g.name === 'Avenir').id;
  expect(created.find((s) => s.firstname === 'Chloé').group_id).toBe(avenir);
  // l'archivé n'est pas recréé
  expect(fake.state.tables.swimmers.filter((s) => s.firstname === 'Tom')).toHaveLength(1);
  await expect(page.locator('[data-count="actifs"]')).toHaveText('(4)');

  // un deuxième import du même fichier ne crée plus rien
  await page.getByRole('button', { name: /Importer depuis Excel/ }).click();
  await page.locator('#import-file').setInputFiles(XLSX);
  await expect(page.locator('#import-summary')).toHaveText('0 à créer, 4 doublons, 📦 1 archivés ignorés');
});

test('import .csv, désélection d\'une ligne, annulation sans écriture', async ({ page }) => {
  const fake = await open(page);
  await page.getByRole('button', { name: /Importer depuis Excel/ }).click();
  await page.locator('#import-file').setInputFiles(CSV);
  await expect(page.locator('#import-summary')).toHaveText('3 à créer, 1 doublons, 📦 1 archivés ignorés');
  await page.getByRole('checkbox', { name: 'Léa DUPONT' }).click();
  await expect(page.getByRole('button', { name: /Importer 2 nageurs/ })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('#modal-import')).not.toHaveClass(/open/);
  expect(fake.state.tables.swimmers).toHaveLength(2);
});

test('fichier piégé : texte échappé dans l\'aperçu, erreurs lisibles, modèle téléchargeable', async ({ page }) => {
  await open(page);
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs += 1; d.dismiss(); });
  await page.getByRole('button', { name: /Importer depuis Excel/ }).click();
  const csv = 'Nom;Prénom;Groupe\n<img src=x onerror=alert(1)>;<b>Zed</b>;<script>alert(2)</script>\n';
  await page.locator('#import-file').setInputFiles({ name: 'piege.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('#import-summary')).toHaveText('1 à créer, 0 doublons, 📦 0 archivés ignorés');
  await expect(page.locator('.import-row-name')).toHaveText('<b>Zed</b> <img src=x onerror=alert(1)>');
  await expect(page.locator('#import-sheet img, #import-sheet script, #import-sheet b')).toHaveCount(0);
  expect(dialogs).toBe(0);

  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('button', { name: /Importer depuis Excel/ }).click();
  await page.locator('#import-file').setInputFiles({ name: 'vide.csv', mimeType: 'text/csv', buffer: Buffer.from('Email;Groupe\na@b.fr;x\n') });
  await expect(page.locator('.import-error')).toHaveText('❗ Colonnes Nom / Prénom introuvables.');
  await page.locator('#import-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  await expect(page.locator('.import-error')).toContainText('Format non pris en charge');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Télécharger le modèle/ }).click()]);
  expect(download.suggestedFilename()).toBe('modele-import-nageurs.csv');
  const body = readFileSync(await download.path(), 'utf8');
  expect(body).toBe('﻿Nom;Prénom;Date de naissance;Email;Téléphone;Groupe\r\n');
});

test('plus de 1000 lignes : message, pas de gel', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Importer depuis Excel/ }).click();
  const csv = `Nom;Prénom\n${Array.from({ length: 1001 }, (_, i) => `N${i};P${i}`).join('\n')}\n`;
  await page.locator('#import-file').setInputFiles({ name: 'gros.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('.import-error')).toHaveText('❗ Fichier trop long : 1000 lignes au maximum');
});
