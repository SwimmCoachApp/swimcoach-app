/**
 * Planification annuelle (règles de club4) : semaines ISO, événements du plan, km réalisés.
 * Lectures depuis le store, écritures par core/data.js (une ligne par semaine, une par événement).
 * Toutes les dates sont calculées sur les éléments locaux (jamais toISOString).
 */
import { db } from '../../core/store.js';
import { saveRow, removeRow } from '../../core/data.js';
import { dateKey, monthKey } from '../../core/dates.js';
import { EVENT_LABELS } from '../calendar/logic.js';

export { EVENT_LABELS };

/** Types d'événement, dans l'ordre des pastilles. */
export const EVENT_TYPES = ['comp', 'stage', 'nat', 'obj', 'note'];
export const EVENT_ICONS = { comp: '🏆', stage: '🏕', nat: '🎯', obj: '💪', note: '📝' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const MONTHS_SHORT = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

const uuid = () => crypto.randomUUID();

/** Clé locale 'AAAA-MM-JJ' d'une date. */
const keyOfDate = (d) => dateKey(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Numéro de semaine ISO 8601 (lundi = premier jour).
 * @param {Date} date
 * @returns {{year: number, week: number}}
 */
function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // dimanche = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // le jeudi de la semaine donne l'année ISO
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7) };
}

/**
 * @param {Date} date
 * @returns {string} clé de semaine 'AAAA-Www'
 */
export function isoWeekKey(date) {
  const { year, week } = isoWeekOf(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function mondayOf(date) {
  const day = date.getDay(); // dimanche = 0
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (day === 0 ? -6 : 1 - day));
}

/**
 * Semaines dont au moins un jour est dans le mois. Une semaine à cheval sur deux mois apparaît dans les
 * deux et, comme les données sont indexées par weekKey, partage le même contenu.
 * @param {number} year
 * @param {number} m0 mois à partir de 0
 * @returns {{mondayDate: Date, sundayDate: Date, weekKey: string, weekLabel: number, overlapsMonths: boolean}[]}
 */
export function weeksOfMonth(year, m0) {
  const first = new Date(year, m0, 1);
  const last = new Date(year, m0 + 1, 0);
  const weeks = [];
  for (let monday = mondayOf(first); monday <= last; monday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)) {
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const inMonth = (d) => d.getMonth() === m0 && d.getFullYear() === year;
    weeks.push({
      mondayDate: monday,
      sundayDate: sunday,
      weekKey: isoWeekKey(monday),
      weekLabel: isoWeekOf(monday).week,
      overlapsMonths: !inMonth(monday) || !inMonth(sunday),
    });
  }
  return weeks;
}

/**
 * @param {number} seasonStart année de début de saison
 * @returns {{y: number, m: number}[]} les 12 mois de septembre à août
 */
export function seasonMonths(seasonStart) {
  const out = [];
  for (let m = 8; m <= 11; m += 1) out.push({ y: seasonStart, m });
  for (let m = 0; m <= 7; m += 1) out.push({ y: seasonStart + 1, m });
  return out;
}

/** @param {number} seasonStart @returns {string} '2026–27' */
export const seasonLabel = (seasonStart) => `${seasonStart}–${String(seasonStart + 1).slice(2)}`;

/** @param {Date} monday @param {Date} sunday @returns {string} '31 août → 6 sept' ou '2 → 8 nov' (club4) */
export function formatWeekRange(monday, sunday) {
  const [md, mm, sd, sm] = [monday.getDate(), monday.getMonth(), sunday.getDate(), sunday.getMonth()];
  return mm === sm ? `${md} → ${sd} ${MONTHS_SHORT[mm]}` : `${md} ${MONTHS_SHORT[mm]} → ${sd} ${MONTHS_SHORT[sm]}`;
}

const EMPTY_WEEK = { content: '', km_target: 0, zone: '' };

/** @param {string} weekKey @returns {{content: string, km_target: number, zone: string}} la semaine du store, ou une semaine vide */
export function weekData(weekKey) {
  return db.plan_weeks.get(weekKey) ?? EMPTY_WEEK;
}

/** Une semaine est « remplie » dès qu'elle a un thème, une zone ou un objectif km (club4). */
export function weekIsFilled(wd) {
  return !!((wd.content && wd.content.trim()) || (wd.zone && wd.zone.trim()) || (parseFloat(wd.km_target) || 0) > 0);
}

/**
 * Km réalisés d'une semaine : séances de natation et de compétition, du lundi au dimanche (club4).
 * @param {Date} monday
 * @param {Date} sunday
 * @returns {number}
 */
export function weekRealKm(monday, sunday) {
  const [from, to] = [keyOfDate(monday), keyOfDate(sunday)];
  let total = 0;
  for (const s of db.sessions.values()) {
    if ((s.type === 'nat' || s.type === 'comp') && s.date >= from && s.date <= to) total += parseFloat(s.km) || 0;
  }
  return total;
}

/** @param {number} real @param {number} target @returns {{cls: 'ok'|'close'|'under'|'neutral', pct: number|null}} */
export function kmStatus(real, target) {
  if (!(target > 0)) return { cls: 'neutral', pct: null };
  const pct = Math.round((real / target) * 100);
  return { cls: real >= target ? 'ok' : pct >= 80 ? 'close' : 'under', pct };
}

/** Dernier jour d'un événement : sa fin si elle n'est pas avant le début, sinon le début (comme le calendrier). */
function endOf(ev) {
  return ev.end_date && ev.end_date >= ev.start_date ? ev.end_date : ev.start_date;
}

const byStart = (a, b) => (a.start_date || '').localeCompare(b.start_date || '');

/**
 * Événements dont la période touche la semaine, par début (même ceux d'un autre mois).
 * @param {Date} monday
 * @param {Date} sunday
 * @returns {object[]}
 */
export function eventsInWeek(monday, sunday) {
  const [from, to] = [keyOfDate(monday), keyOfDate(sunday)];
  return [...db.plan_events.values()].filter((ev) => ev.start_date && ev.start_date <= to && endOf(ev) >= from).sort(byStart);
}

/**
 * @param {string} key 'AAAA-MM'
 * @returns {object[]} événements rangés dans ce mois (par leur début), par date
 */
export function eventsOfMonth(key) {
  return [...db.plan_events.values()].filter((ev) => ev.month_key === key).sort(byStart);
}

const WEEK_COLUMNS = ['team_id', 'week_key', 'season_start', 'content', 'km_target', 'zone'];
const EVENT_COLUMNS = ['id', 'team_id', 'month_key', 'type', 'title', 'description', 'start_date', 'end_date'];
const pick = (row, cols) => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));

function kmValue(v) {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Saison (année de début) d'une semaine : celle de son jeudi (règle ISO), quel que soit le mois d'où l'on modifie.
 * @param {string} weekKey 'AAAA-Www'
 * @returns {number}
 */
export function seasonOfWeek(weekKey) {
  const [y, w] = [Number(weekKey.slice(0, 4)), Number(weekKey.slice(6))];
  const monday1 = mondayOf(new Date(y, 0, 4)); // le 4 janvier est toujours en semaine 1
  const thursday = new Date(monday1.getFullYear(), monday1.getMonth(), monday1.getDate() + (w - 1) * 7 + 3);
  return thursday.getMonth() >= 8 ? thursday.getFullYear() : thursday.getFullYear() - 1;
}

/**
 * Enregistre une semaine du plan, champ par champ. `null` laisse le champ tel qu'il est : le store local garde
 * la ligne entière, mais seules les colonnes modifiées (avec la clé et la saison) partent au serveur, qui ne met
 * à jour que celles-là. Un entraîneur hors ligne ou en retard n'écrase donc jamais les autres champs de la
 * semaine, qu'un autre entraîneur a pu changer. `season_start` vient de la semaine (jeudi) ; `updated_at` est
 * posé par le serveur.
 * @param {string} weekKey 'AAAA-Www'
 * @param {number} _seasonStart ignoré (conservé pour l'interface) : la saison se déduit de la semaine
 * @param {string|null} content thème (texte brut)
 * @param {number|string|null} kmTarget
 * @param {string|null} zone
 * @returns {object} la ligne enregistrée localement
 * @throws {Error} clé de semaine invalide
 */
export function savePlanWeek(weekKey, _seasonStart, content, kmTarget, zone) {
  if (!WEEK_RE.test(weekKey ?? '')) throw new Error('Semaine invalide');
  const existing = db.plan_weeks.get(weekKey) ?? EMPTY_WEEK;
  const changed = {};
  if (content != null) changed.content = String(content);
  if (kmTarget != null) changed.km_target = kmValue(kmTarget);
  if (zone != null) changed.zone = String(zone).trim();
  const season_start = seasonOfWeek(weekKey);
  const full = pick({
    ...existing,
    week_key: weekKey,
    season_start,
    content: existing.content ?? '',
    km_target: kmValue(existing.km_target),
    zone: existing.zone ?? '',
    ...changed,
  }, WEEK_COLUMNS);
  return saveRow('plan_weeks', full, { send: { week_key: weekKey, season_start, ...changed } });
}

/**
 * Enregistre un événement du plan (créé si l'id est absent ou inconnu) ; son mois est celui de la date de début.
 * @param {{id?: string, type: string, title?: string, description?: string, start: string, end?: string}} form
 * @returns {object} la ligne enregistrée
 * @throws {Error} type, date de début ou date de fin invalide
 */
export function savePlanEvent(form) {
  if (!EVENT_TYPES.includes(form.type)) throw new Error("Type d'événement invalide");
  if (!DATE_RE.test(form.start ?? '')) throw new Error('Date de début invalide');
  const end = form.end || null;
  if (end && !DATE_RE.test(end)) throw new Error('Date de fin invalide');
  if (end && end < form.start) throw new Error('La date de fin précède le début');
  const existing = form.id ? db.plan_events.get(form.id) : null;
  return saveRow('plan_events', pick({
    ...existing,
    id: existing?.id ?? form.id ?? uuid(),
    month_key: monthKey(form.start),
    type: form.type,
    title: String(form.title ?? '').trim() || EVENT_LABELS[form.type],
    description: String(form.description ?? '').trim(),
    start_date: form.start,
    end_date: end,
  }, EVENT_COLUMNS));
}

/** @param {string} id */
export function deletePlanEvent(id) {
  removeRow('plan_events', id);
}
