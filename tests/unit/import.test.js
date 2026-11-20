import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeName } from '../../src/core/names.js';
import { FEATURES } from '../../src/core/features.js';
import { parseDob, tableToRows, parseCsv, parseImportFile, planImport, groupsToCreate, templateCsv, MAX_IMPORT_ROWS } from '../../src/features/contacts/import.js';

const fixture = (name) => resolve(process.cwd(), 'tests/fixtures', name);

describe('normalizeName', () => {
  test('sans accents, casse ni ponctuation', () => {
    expect(normalizeName('  Léa-Marie ')).toBe('LEAMARIE');
    expect(normalizeName(null)).toBe('');
  });
});

describe('parseDob', () => {
  test('nombre de série Excel', () => {
    expect(parseDob(45000)).toBe('2023-03-15');
    expect(parseDob('45000')).toBe('2023-03-15');
  });
  test('bug 1900 d\'Excel : 59 = 28/02/1900, 61 = 01/03/1900, 60 (29/02 inexistant) = null', () => {
    expect(parseDob(1)).toBe('1900-01-01');
    expect(parseDob(59)).toBe('1900-02-28');
    expect(parseDob(60)).toBeNull();
    expect(parseDob(61)).toBe('1900-03-01');
  });
  test('jj/mm/aaaa, jj-mm-aaaa, jj.mm.aaaa', () => {
    expect(parseDob('05/09/2014')).toBe('2014-09-05');
    expect(parseDob('5-9-2014')).toBe('2014-09-05');
    expect(parseDob('05.09.2014')).toBe('2014-09-05');
  });
  test('aaaa-mm-jj', () => {
    expect(parseDob('2014-09-05')).toBe('2014-09-05');
  });
  test('un objet Date (cellule date lue par le lecteur Excel) garde son jour', () => {
    expect(parseDob(new Date(Date.UTC(2014, 8, 5)))).toBe('2014-09-05');
  });
  test('nombre hors plage plausible (téléphone, année seule) : null, jamais de date invalide', () => {
    expect(parseDob(612345678)).toBeNull();
    expect(parseDob('0612345678')).toBeNull();
    expect(parseDob('2012')).toBeNull();
    expect(parseDob(new Date().getFullYear() * 400)).toBeNull();
    expect(parseDob(1e9)).toBeNull();
    expect(parseDob(Number.NaN)).toBeNull();
    expect(parseDob(Number.POSITIVE_INFINITY)).toBeNull();
  });
  test('vide ou illisible : null', () => {
    expect(parseDob('')).toBeNull();
    expect(parseDob(null)).toBeNull();
    expect(parseDob('31/02/2014')).toBeNull();
    expect(parseDob('bientôt')).toBeNull();
    expect(parseDob(-3)).toBeNull();
  });
});

describe('parseCsv', () => {
  test('détecte ; ou , , gère guillemets, BOM et \\r\\n', () => {
    expect(parseCsv('﻿Nom;Prénom\r\n"DU;PONT";"Léa ""Lilou"""\r\n')).toEqual([['Nom', 'Prénom'], ['DU;PONT', 'Léa "Lilou"']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('tableToRows', () => {
  const header = ['Nom', 'Prénom', 'Date de naissance', 'Email', 'Téléphone', 'Groupe'];
  test('colonnes reconnues par leur en-tête, ligne vide ignorée', () => {
    const { rows, errors } = tableToRows([header, ['DUPONT', 'Léa', 45000, 'lea@mail.fr', '0612345678', 'Benjamins'], [], ['', '', '', '', '', ''], ['Martin', 'Tom', '05/09/2014', '', '', '']]);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { firstname: 'Léa', lastname: 'DUPONT', dob: '2023-03-15', group: 'Benjamins', phone: '0612345678', email: 'lea@mail.fr' },
      { firstname: 'Tom', lastname: 'Martin', dob: '2014-09-05', group: '', phone: '', email: '' },
    ]);
  });
  test('« Prénom » placé avant « Nom » n\'est pas pris pour la colonne Nom', () => {
    const { rows } = tableToRows([['Prénom', 'Nom'], ['Léa', 'Dupont']]);
    expect(rows).toEqual([{ firstname: 'Léa', lastname: 'Dupont', dob: null, group: '', phone: '', email: '' }]);
  });
  test('sans en-tête : nom, prénom, naissance, email, téléphone', () => {
    const { rows } = tableToRows([['Dupont', 'Léa', '05/09/2014', 'a@b.fr', '06']]);
    expect(rows[0]).toMatchObject({ lastname: 'Dupont', firstname: 'Léa', dob: '2014-09-05', email: 'a@b.fr', phone: '06', group: '' });
  });
  test('en-têtes sans Nom ni Prénom : erreur', () => {
    const res = tableToRows([['Email', 'Groupe'], ['a@b.fr', 'x']]);
    expect(res.rows).toEqual([]);
    expect(res.errors).toEqual(['Colonnes Nom / Prénom introuvables.']);
  });
  test('fichier vide', () => {
    expect(tableToRows([[], ['', ' ']])).toEqual({ rows: [], errors: ['Fichier vide'] });
  });
  test('date illisible : ligne gardée sans date, avertissement', () => {
    const { rows, errors } = tableToRows([header, ['A', 'B', 'n/importe', '', '', '']]);
    expect(rows[0].dob).toBeNull();
    expect(errors).toEqual(['Ligne 2 : date de naissance illisible (« n/importe »)']);
  });
  test('plus de 1000 lignes : erreur, rien n\'est lu', () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`N${i}`, `P${i}`]);
    const res = tableToRows([['Nom', 'Prénom'], ...many]);
    expect(res.rows).toEqual([]);
    expect(res.errors).toEqual([`Fichier trop long : ${MAX_IMPORT_ROWS} lignes au maximum`]);
    expect(tableToRows([['Nom', 'Prénom'], ...many.slice(0, MAX_IMPORT_ROWS)]).rows).toHaveLength(MAX_IMPORT_ROWS);
  });
});

describe('planImport', () => {
  const row = (lastname, firstname) => ({ firstname, lastname, dob: null, group: '', phone: '', email: '' });
  test('« DUPONT Léa » face à « dupont lea » : doublon', () => {
    const plan = planImport([row('DUPONT', 'Léa'), row('Martin', 'Tom')], [{ lastname: 'dupont', firstname: 'lea', left_season: null }]);
    expect(plan.duplicates.map((r) => r.firstname)).toEqual(['Léa']);
    expect(plan.toCreate.map((r) => r.firstname)).toEqual(['Tom']);
    expect(plan.ignoredArchived).toEqual([]);
  });
  test('homonyme archivé : ignoré, pas recréé', () => {
    const plan = planImport([row('Dupont', 'Léa')], [{ lastname: 'Dupont', firstname: 'Léa', left_season: 2023 }]);
    expect(plan.ignoredArchived).toHaveLength(1);
    expect(plan.toCreate).toEqual([]);
    expect(plan.duplicates).toEqual([]);
  });
  test('actif et archivé de même nom : doublon', () => {
    const plan = planImport([row('Dupont', 'Léa')], [{ lastname: 'Dupont', firstname: 'Léa', left_season: 2023 }, { lastname: 'Dupont', firstname: 'Léa', left_season: null }]);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.ignoredArchived).toEqual([]);
  });
  test('deux fois le même nageur dans le fichier : un seul créé', () => {
    const plan = planImport([row('Dupont', 'Léa'), row('DUPONT', 'lea')], []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
  });
});

describe('planImport : cas limites', () => {
  const row = (lastname, firstname) => ({ firstname, lastname, dob: null, group: '', phone: '', email: '' });
  test('sans prénom : invalide, ni créé ni doublon', () => {
    const plan = planImport([row('Dupont', ''), row('Martin', 'Tom')], []);
    expect(plan.invalid.map((r) => r.lastname)).toEqual(['Dupont']);
    expect(plan.toCreate.map((r) => r.firstname)).toEqual(['Tom']);
  });
  test('noms sans lettres latines : pas de dédoublonnage entre eux', () => {
    const plan = planImport([row('Петров', 'Иван'), row('Иванов', 'Олег')], []);
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.duplicates).toEqual([]);
  });
});

describe('groupsToCreate', () => {
  afterEach(() => { FEATURES.groups = false; });
  test('groupes masqués (réglage par défaut) : aucun groupe à créer', () => {
    expect(FEATURES.groups).toBe(false);
    expect(groupsToCreate([{ group: 'Élite' }, { group: '' }], [])).toEqual([]);
  });
  test('groupes affichés : groupe vide = Autre, comparaison sans accents ni casse, une seule fois', () => {
    FEATURES.groups = true;
    const rows = [{ group: '' }, { group: 'autre' }, { group: 'Élite' }, { group: 'elite' }, { group: 'Benjamins' }];
    expect(groupsToCreate(rows, [{ name: 'benjamins' }])).toEqual(['Autre', 'Élite']);
    expect(groupsToCreate(rows, [{ name: 'Autre' }, { name: 'ELITE' }, { name: 'Benjamins' }])).toEqual([]);
  });
});

describe('modèle et fichiers', () => {
  test('CSV Windows-1252 (Excel français) : accents lus correctement', async () => {
    const bytes = readFileSync(fixture('nageurs-cp1252.csv'));
    expect(bytes.includes(0xe9)).toBe(true); // vrai cp1252 : é = 0xE9
    const { rows, errors } = await parseImportFile(new File([bytes], 'nageurs.csv', { type: 'text/csv' }));
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.firstname)).toEqual(['Léa', 'Hélène']);
    expect(rows[0].lastname).toBe('DUPONT');
  });
  test('CSV UTF-8 sans BOM avec accents : inchangé', async () => {
    const { rows } = await parseImportFile(new File([Buffer.from('Nom;Prénom\nA;Hélène\n', 'utf8')], 'a.csv'));
    expect(rows[0].firstname).toBe('Hélène');
  });
  test('modèle CSV : BOM, séparateur ;, en-têtes reconnus par l\'import', () => {
    const csv = templateCsv();
    expect(csv.startsWith('﻿')).toBe(true);
    const table = parseCsv(csv);
    expect(table[0]).toEqual(['Nom', 'Prénom', 'Date de naissance', 'Email', 'Téléphone', 'Groupe']);
  });
  test('parseImportFile lit le CSV de test', async () => {
    const text = readFileSync(fixture('nageurs.csv'), 'utf8');
    const { rows, errors } = await parseImportFile(new File([text], 'nageurs.csv', { type: 'text/csv' }));
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThan(2);
  });
  test('parseImportFile lit le .xlsx de test (lecteur chargé à la demande)', async () => {
    const buf = readFileSync(fixture('nageurs.xlsx'));
    const { rows, errors } = await parseImportFile(new File([buf], 'nageurs.xlsx'));
    expect(errors).toEqual([]);
    expect(rows.map((r) => `${r.lastname} ${r.firstname}`)).toContain('DUPONT Léa');
    expect(rows.find((r) => r.firstname === 'Léa').dob).toBe('2012-03-15');
  });
  test('fichier .xlsx illisible : erreur claire', async () => {
    const res = await parseImportFile(new File(['pas un zip'], 'x.xlsx'));
    expect(res.rows).toEqual([]);
    expect(res.errors).toEqual(['Fichier Excel illisible.']);
  });
});
