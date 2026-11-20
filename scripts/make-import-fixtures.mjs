// Fabrique tests/fixtures/nageurs.xlsx et nageurs.csv (données fictives).
// Usage : node scripts/make-import-fixtures.mjs   (écrivain : write-excel-file, dépendance de développement)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import writeExcelFile from 'write-excel-file/node';

const out = (name) => fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url));
const HEADER = ['Nom', 'Prénom', 'Date de naissance', 'Email', 'Téléphone', 'Groupe'];
const dateCell = (y, m, d) => ({ value: new Date(Date.UTC(y, m - 1, d)), format: 'dd/mm/yyyy' });
const empty = () => ['', '', '', '', '', ''].map(() => null);

const rows = [
  ['DUPONT', 'Léa', dateCell(2012, 3, 15), 'lea.dupont@example.org', '06 12 34 56 78', 'Benjamins'], // cellule date
  ['MARTIN', 'Tom', '05/09/2014', 'tom.martin@example.org', '', 'Loisirs'], // texte jj/mm/aaaa (homonyme archivé dans le test e2e)
  ['BERNARD', 'Chloé', 45000, '', '0611223344', 'Avenir'], // nombre de série Excel, groupe qui n'existe pas encore
  ['PETIT', 'Hugo', null, '', '', 'Benjamins'], // homonyme actif dans le test e2e : doublon
  empty(), // ligne vide : ignorée
  ['ROUX', 'Emma', '2013-07-21', 'emma.roux@example.org', '', ''], // aaaa-mm-jj, sans groupe
];

const sheet = [HEADER.map((value) => ({ value, fontWeight: 'bold' })), ...rows.map((r) => r.map((value) => (value === null ? null : value)))];
await writeExcelFile(sheet).toFile(out('nageurs.xlsx'));

const csv = ['﻿' + HEADER.join(';'), ...[
  ['DUPONT', 'Léa', '15/03/2012', 'lea.dupont@example.org', '06 12 34 56 78', 'Benjamins'],
  ['MARTIN', 'Tom', '05/09/2014', 'tom.martin@example.org', '', 'Loisirs'],
  ['BERNARD', 'Chloé', '15/03/2023', '', '0611223344', 'Avenir'],
  ['PETIT', 'Hugo', '', '', '', 'Benjamins'],
  ['ROUX', 'Emma', '2013-07-21', 'emma.roux@example.org', '', ''],
].map((r) => r.join(';'))].join('\r\n') + '\r\n';
writeFileSync(out('nageurs.csv'), csv);

// Export « CSV (séparateur : point-virgule) » d'Excel français : Windows-1252, sans BOM.
writeFileSync(out('nageurs-cp1252.csv'), Buffer.from('Nom;Prénom;Date de naissance;Groupe\r\nDUPONT;Léa;15/03/2012;Benjamins\r\nMARTIN;Hélène;05/09/2014;Loisirs\r\n', 'latin1'));
