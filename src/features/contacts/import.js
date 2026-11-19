/**
 * Import de nageurs depuis Excel (.xlsx) ou CSV (reprise de club4 « IMPORT EXCEL / CSV »).
 * Ce module ne touche pas à l'écran : lecture du fichier, plan sans doublons, écriture par saveSwimmer.
 */
import { normalizeName } from '../../core/names.js';
import { dateKey } from '../../core/dates.js';
import { swimmerIsActive } from '../../core/season.js';
import { saveSwimmer, listGroups, addGroup } from './logic.js';

/** Au-delà, le fichier est refusé (l'écran ne doit pas se figer). */
export const MAX_IMPORT_ROWS = 1000;

/** Colonnes du modèle, dans l'ordre de club4 (nom, prénom, naissance, email, téléphone, groupe). */
export const TEMPLATE_HEADER = ['Nom', 'Prénom', 'Date de naissance', 'Email', 'Téléphone', 'Groupe'];
export const TEMPLATE_FILENAME = 'modele-import-nageurs.csv';

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Détection automatique des colonnes (club4 XL_COLS, comparée sans accents ni casse).
const COLS = {
  firstname: ['prenom', 'firstname', 'first name', 'first_name'],
  lastname: ['nom', 'lastname', 'last name', 'last_name', 'nom de famille', 'surname'],
  dob: ['date de naissance', 'dob', 'naissance', 'birth', 'birthday', 'date_naissance', 'ne le', 'nee le'],
  phone: ['telephone', 'tel', 'phone', 'mobile', 'portable'],
  email: ['email', 'mail', 'e-mail', 'courriel'],
  group: ['groupe', 'group', 'categorie', 'classe'],
};
const HEADER_WORDS = ['nom', 'prenom', 'name', 'firstname', 'lastname', 'email', 'telephone', 'phone', 'date', 'groupe', 'group'];

const cellText = (v) => (v == null ? '' : v instanceof Date ? parseDob(v) ?? '' : String(v)).trim();
const isBlank = (row) => !Array.isArray(row) || row.every((v) => cellText(v) === '');

/**
 * Colonne d'un champ : en-tête identique d'abord, puis en-tête qui le contient.
 * « Prénom » contient « nom » : il ne peut pas servir de colonne Nom.
 */
function detectCol(headers, field, taken) {
  const names = COLS[field];
  const free = (i) => !taken.has(i);
  let found = headers.findIndex((h, i) => free(i) && names.includes(h));
  if (found < 0) {
    found = headers.findIndex((h, i) => free(i) && !(field === 'lastname' && /prenom|first/.test(h)) && names.some((a) => h.includes(a)));
  }
  if (found >= 0) taken.add(found);
  return found;
}

const validDay = (y, m, d) => {
  if (y < 1900 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Date de naissance d'une cellule.
 * @param {unknown} val nombre de série Excel (système 1900, avec son faux 29/02/1900), objet Date,
 *   `jj/mm/aaaa` (séparateurs / - .) ou `aaaa-mm-jj`
 * @returns {string|null} 'AAAA-MM-JJ' (jamais toISOString) ; null si vide ou illisible
 */
export function parseDob(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : dateKey(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate()); // le lecteur Excel date en UTC minuit
  }
  if (typeof val === 'number' || /^\s*[1-9]\d{4,5}\s*$/.test(String(val))) {
    const n = Math.floor(Number(val));
    if (!Number.isFinite(n) || n < 1 || n === 60) return null; // 60 : le 29/02/1900 que seul Excel connaît
    const d = new Date(Date.UTC(1899, 11, 30 + (n < 60 ? n + 1 : n)));
    const y = d.getUTCFullYear();
    return y >= 1900 && y <= new Date().getFullYear() ? dateKey(y, d.getUTCMonth(), d.getUTCDate()) : null; // un téléphone n'est pas une date
  }
  const s = String(val).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return validDay(+m[3], +m[2], +m[1]) ? dateKey(+m[3], +m[2] - 1, +m[1]) : null;
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) return validDay(+m[1], +m[2], +m[3]) ? dateKey(+m[1], +m[2] - 1, +m[3]) : null;
  return null;
}

/**
 * Lecture CSV (club4 parseCSVNative) : BOM, séparateur , ou ; (le plus fréquent hors guillemets
 * dans les 5 premières lignes), guillemets doublés, champs sur plusieurs lignes, \r\n.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sample = text.split(/\r\n|\r|\n/).slice(0, 5).join('\n');
  const countOutside = (ch) => {
    let count = 0;
    let quoted = false;
    for (const c of sample) {
      if (c === '"') quoted = !quoted;
      else if (c === ch && !quoted) count++;
    }
    return count;
  };
  const delimiter = countOutside(';') > countOutside(',') ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Tableau de cellules → lignes de nageurs (club4 handleXLImport). Sans en-tête reconnu, l'ordre est
 * nom, prénom, naissance, email, téléphone. Les lignes sans nom ni prénom sont ignorées.
 * @param {unknown[][]} table
 * @returns {{rows: object[], errors: string[]}} errors : problèmes bloquants (rows vide) ou avertissements de ligne
 */
export function tableToRows(table) {
  const lines = table.map((r, i) => ({ r, i })).filter(({ r }) => !isBlank(r));
  if (lines.length < 1) return { rows: [], errors: ['Fichier vide'] };
  const hasHeader = lines[0].r.some((v) => HEADER_WORDS.some((k) => fold(cellText(v)).includes(k)));
  let cols;
  let data;
  if (hasHeader) {
    const headers = lines[0].r.map((v) => fold(cellText(v)));
    const taken = new Set();
    cols = {};
    for (const f of ['lastname', 'firstname', 'dob', 'phone', 'email', 'group']) cols[f] = detectCol(headers, f, taken);
    if (cols.firstname < 0 && cols.lastname < 0) return { rows: [], errors: ['Colonnes Nom / Prénom introuvables.'] };
    data = lines.slice(1);
  } else {
    cols = { lastname: 0, firstname: 1, dob: 2, email: 3, phone: 4, group: -1 };
    data = lines;
  }
  if (data.length > MAX_IMPORT_ROWS) return { rows: [], errors: [`Fichier trop long : ${MAX_IMPORT_ROWS} lignes au maximum`] };
  const rows = [];
  const errors = [];
  for (const { r, i } of data) {
    const get = (f) => (cols[f] >= 0 ? r[cols[f]] : '');
    const firstname = cellText(get('firstname'));
    const lastname = cellText(get('lastname'));
    if (!firstname && !lastname) continue;
    const rawDob = get('dob');
    const dob = parseDob(rawDob);
    if (dob == null && cellText(rawDob) !== '') errors.push(`Ligne ${i + 1} : date de naissance illisible (« ${cellText(rawDob)} »)`);
    rows.push({ firstname, lastname, dob, group: cellText(get('group')), phone: cellText(get('phone')), email: cellText(get('email')) });
  }
  if (rows.length === 0) return { rows: [], errors: ['Aucun nageur trouvé'] };
  return { rows, errors };
}

let readerPromise = null;
/** Charge le lecteur Excel (morceau séparé, uniquement à l'ouverture de l'import ou à la lecture d'un .xlsx). */
export function loadExcelReader() {
  readerPromise ??= import('read-excel-file/universal').catch((e) => {
    readerPromise = null;
    throw e;
  });
  return readerPromise;
}

const readBytes = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Impossible de lire le fichier CSV.'));
  reader.readAsArrayBuffer(file);
});

/** UTF-8 si valide, sinon Windows-1252 (« CSV (séparateur : point-virgule) » d'Excel français). */
async function readText(file) {
  const bytes = await readBytes(file);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * @param {File} file .xlsx ou .csv
 * @returns {Promise<{rows: {firstname: string, lastname: string, dob: string|null, group: string, phone: string, email: string}[], errors: string[]}>}
 */
export async function parseImportFile(file) {
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const isXlsx = /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (!isCsv && !isXlsx) return { rows: [], errors: ['Format non pris en charge : choisis un fichier .xlsx ou .csv.'] };
  let table;
  try {
    if (isCsv) table = parseCsv(await readText(file));
    else {
      const { readSheet } = await loadExcelReader();
      table = await readSheet(file);
    }
  } catch (e) {
    return { rows: [], errors: [isCsv ? (e?.message || 'Fichier CSV illisible.') : 'Fichier Excel illisible.'] };
  }
  return tableToRows(table);
}

/** @returns {string|null} clé nom|prénom ; null si aucun des deux ne contient de lettre latine ou chiffre (pas de dédoublonnage) */
const keyOf = (r) => {
  const l = normalizeName(r.lastname);
  const f = normalizeName(r.firstname);
  return l || f ? `${l}|${f}` : null;
};

/**
 * @param {object[]} rows lignes du fichier
 * @param {{firstname: string, lastname?: string, left_season?: number|null}[]} existing tous les nageurs de l'espace (actifs et archivés)
 * @returns {{toCreate: object[], duplicates: object[], ignoredArchived: object[], invalid: object[]}}
 *   doublon : même nom qu'un nageur actif (ou déjà vu plus haut dans le fichier) ;
 *   ignoredArchived : même nom qu'un nageur archivé seulement, il n'est pas recréé ;
 *   invalid : sans prénom (saveSwimmer les refuserait)
 */
export function planImport(rows, existing) {
  const active = new Set();
  const archived = new Set();
  for (const sw of existing) {
    const key = keyOf(sw);
    if (key) (swimmerIsActive(sw) ? active : archived).add(key);
  }
  const seen = new Set();
  const plan = { toCreate: [], duplicates: [], ignoredArchived: [], invalid: [] };
  for (const r of rows) {
    if (!r.firstname.trim()) { plan.invalid.push(r); continue; }
    const key = keyOf(r);
    if (key && (active.has(key) || seen.has(key))) plan.duplicates.push(r);
    else if (key && archived.has(key)) plan.ignoredArchived.push(r);
    else plan.toCreate.push(r);
    if (key) seen.add(key);
  }
  return plan;
}

/** Groupe d'un nageur sans groupe dans le fichier (club4). */
export const DEFAULT_GROUP = 'Autre';
const groupOf = (r) => r.group.trim() || DEFAULT_GROUP;

/**
 * @param {{group: string}[]} rows lignes qui seront créées
 * @param {{name: string}[]} groups groupes de l'espace
 * @returns {string[]} noms de groupes à créer (une fois chacun, comparaison sans accents ni casse)
 */
export function groupsToCreate(rows, groups) {
  const known = new Set(groups.map((g) => fold(g.name)));
  const out = new Map();
  for (const r of rows) {
    const name = groupOf(r);
    if (!known.has(fold(name)) && !out.has(fold(name))) out.set(fold(name), name);
  }
  return [...out.values()];
}

/**
 * Crée les nageurs du plan. Un groupe inconnu est créé une fois ; sans groupe dans le fichier : « Autre » (club4).
 * @param {object[]} rows lignes à créer
 * @returns {Promise<{created: number, groupsCreated: number, failed: number}>}
 */
export async function runImport(rows) {
  const byName = new Map(listGroups().map((g) => [fold(g.name), g.id]));
  let groupsCreated = 0;
  let created = 0;
  let failed = 0;
  for (const r of rows) {
    const name = groupOf(r);
    if (!byName.has(fold(name))) {
      const res = addGroup(name);
      if (res.ok) { byName.set(fold(name), res.id); groupsCreated++; }
    }
    const group_id = byName.get(fold(name)) ?? null;
    try {
      await saveSwimmer({ firstname: r.firstname, lastname: r.lastname, dob: r.dob, group_id, phone: r.phone, email: r.email });
      created++;
    } catch {
      failed++; // ex. prénom vide (ligne avec un nom seul)
    }
  }
  return { created, groupsCreated, failed };
}

/** @returns {string} modèle CSV : UTF-8 avec BOM, séparateur ; (lu par parseCsv) */
export function templateCsv() {
  return `﻿${TEMPLATE_HEADER.join(';')}\r\n`;
}

/** Télécharge le modèle (club4 n'en fournit pas : mêmes colonnes que son import). */
export function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = TEMPLATE_FILENAME;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
