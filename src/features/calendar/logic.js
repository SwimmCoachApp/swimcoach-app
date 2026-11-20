/** Calendrier et séances : lectures depuis le store, écritures par core/data.js. */
import { db, deleteLocal } from '../../core/store.js';
import { saveRow, removeRow } from '../../core/data.js';
import { dateKey } from '../../core/dates.js';
import { sanitizeRich } from '../../core/html.js';
import { uploadPhoto, deletePhoto } from '../../core/photos.js';

const uuid = () => crypto.randomUUID();

/** Types de séance, dans l'ordre d'affichage. */
export const SESSION_TYPES = ['nat', 'musc', 'comp', 'other'];
export const SESSION_NAMES = { nat: 'Natation', musc: 'Muscu', comp: 'Compétition', other: 'Autre' };
/** Libellé court de la pastille d'heure (club4). */
export const SESSION_SHORT = { nat: 'Natation', musc: 'Muscu', comp: 'Compét.', other: 'Autre' };
export const EVENT_LABELS = { comp: 'Compétition', stage: 'Stage', nat: 'Objectif', obj: 'Prépa physique', note: 'Note' };
/** Priorité d'affichage d'un jour qui porte plusieurs événements : le plus petit gagne (club4). */
const EV_PRIORITY = { comp: 0, stage: 1, nat: 2, obj: 3, note: 4 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Colonnes de `sessions` écrites par l'app (le reste est posé par le serveur). */
const SESSION_COLUMNS = ['id', 'team_id', 'date', 'title', 'type', 'time', 'content', 'km', 'photo_path'];
const sessionRow = (s) => Object.fromEntries(SESSION_COLUMNS.filter((c) => c in s).map((c) => [c, s[c]]));

/** Numéro de jour d'une clé 'AAAA-MM-JJ' (calcul sur le calendrier seul, sans fuseau). */
function ordinal(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Clé 'AAAA-MM-JJ' d'un numéro de jour. */
function keyOfOrdinal(n) {
  const t = new Date(n * DAY_MS);
  return dateKey(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

const byTimeThenTitle = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || (a.title || '').localeCompare(b.title || '', 'fr');

/**
 * @param {string} key 'AAAA-MM-JJ'
 * @returns {object[]} séances du jour, par heure puis titre
 */
export function sessionsOn(key) {
  return [...db.sessions.values()].filter((s) => s.date === key).sort(byTimeThenTitle);
}

/**
 * @param {number} y année
 * @param {number} m0 mois à partir de 0
 * @returns {Map<string, object[]>} séances du mois par jour (un seul parcours du store)
 */
export function sessionsByDay(y, m0) {
  const prefix = dateKey(y, m0, 1).slice(0, 8);
  const out = new Map();
  for (const s of [...db.sessions.values()].sort(byTimeThenTitle)) {
    if (!s.date?.startsWith(prefix)) continue;
    if (!out.has(s.date)) out.set(s.date, []);
    out.get(s.date).push(s);
  }
  return out;
}

/** @param {string} sessionId @returns {number} nageurs présents (lecture seule : l'appel est dans la modale séance) */
export function presenceCount(sessionId) {
  let n = 0;
  for (const p of db.presence.values()) if (p.session_id === sessionId) n += 1;
  return n;
}

/** Jours couverts par un événement du plan : [début, fin] (fin avant début : un seul jour). */
function eventSpan(ev) {
  if (!DATE_RE.test(ev.start_date ?? '')) return null;
  const start = ordinal(ev.start_date);
  const end = DATE_RE.test(ev.end_date ?? '') ? Math.max(start, ordinal(ev.end_date)) : start;
  return { start, end };
}

const markOf = (ev, span, day) => ({
  title: ev.title || EVENT_LABELS[ev.type] || ev.type,
  type: ev.type,
  isFirst: day === span.start,
  isLast: day === span.end,
  desc: ev.description || '',
  start: ev.start_date,
  end: ev.end_date || '',
});

/**
 * Repères du plan sur un mois : un seul événement par jour, priorité comp > stage > nat > obj > note
 * (à priorité égale, le premier rencontré reste).
 * @param {number} y
 * @param {number} m0
 * @returns {Map<string, {title: string, type: string, isFirst: boolean, isLast: boolean, desc: string, start: string, end: string}>}
 */
export function planMarksForMonth(y, m0) {
  const first = ordinal(dateKey(y, m0, 1));
  const last = ordinal(dateKey(y, m0, new Date(y, m0 + 1, 0).getDate()));
  const map = new Map();
  for (const ev of db.plan_events.values()) {
    const span = eventSpan(ev);
    if (!span || !(ev.type in EV_PRIORITY)) continue;
    for (let day = Math.max(span.start, first); day <= Math.min(span.end, last); day += 1) {
      const key = keyOfOrdinal(day);
      const cur = map.get(key);
      if (!cur || EV_PRIORITY[ev.type] < EV_PRIORITY[cur.type]) map.set(key, markOf(ev, span, day));
    }
  }
  return map;
}

/**
 * Tous les événements du plan d'un jour (bandeaux du panneau), le plus prioritaire d'abord.
 * @param {string} key 'AAAA-MM-JJ'
 * @returns {object[]} marques (même forme que planMarksForMonth)
 */
export function planEventsOn(key) {
  const day = ordinal(key);
  return [...db.plan_events.values()]
    .map((ev) => ({ ev, span: eventSpan(ev) }))
    .filter(({ ev, span }) => span && ev.type in EV_PRIORITY && span.start <= day && day <= span.end)
    .sort((a, b) => EV_PRIORITY[a.ev.type] - EV_PRIORITY[b.ev.type] || a.span.start - b.span.start)
    .map(({ ev, span }) => markOf(ev, span, day));
}

/** Contenu riche nettoyé ; vide (texte ou liste absents) devient ''. */
export function cleanContent(content) {
  const clean = sanitizeRich(content);
  const probe = document.createElement('div');
  probe.innerHTML = clean;
  return probe.textContent.trim() === '' && !probe.querySelector('li') ? '' : clean;
}

/**
 * Enregistre une séance (créée si l'id est absent ou inconnu).
 * Le km n'a de sens qu'en eau : il vaut null pour la muscu (club4) et quand il est vide ou nul.
 * Une photo qui ne peut pas partir (hors ligne, refus) n'empêche pas l'enregistrement : la séance garde
 * alors son ancienne photo (`photo_path` inchangé, à comparer par l'appelant).
 * @param {{id?: string, date: string, title?: string, type: string, time?: string, content?: string, km?: number|string|null,
 *   photoBlob?: Blob|null, removePhoto?: boolean}} form photoBlob : image jpeg déjà réduite
 * @returns {Promise<object>} la séance enregistrée
 * @throws {Error} date ou type invalide
 */
export async function saveSession(form) {
  return (await saveSessionWithStatus(form)).session;
}

/**
 * Comme saveSession, en disant aussi si la photo demandée n'a pas pu partir ou être supprimée.
 * @param {Parameters<typeof saveSession>[0]} form
 * @returns {Promise<{session: object, photoFailed: boolean}>}
 */
export async function saveSessionWithStatus(form) {
  if (!DATE_RE.test(form.date ?? '')) throw new Error('Date invalide');
  if (!SESSION_TYPES.includes(form.type)) throw new Error('Type de séance invalide');
  const existing = form.id ? db.sessions.get(form.id) : null;
  const id = existing?.id ?? form.id ?? uuid();
  let photo_path = existing?.photo_path ?? null;
  let photoFailed = false;
  if (form.photoBlob) {
    try {
      photo_path = await uploadPhoto('sessions', id, form.photoBlob);
    } catch {
      photoFailed = true; // la séance est quand même enregistrée
    }
  } else if (form.removePhoto && photo_path) {
    try {
      await deletePhoto(photo_path);
      photo_path = null;
    } catch {
      photoFailed = true; // le chemin reste
    }
  }
  const km = form.type === 'musc' ? null : Number.parseFloat(String(form.km ?? '').replace(',', '.'));
  const session = saveRow('sessions', sessionRow({
    ...existing,
    id,
    date: form.date,
    title: String(form.title ?? '').trim(),
    type: form.type,
    time: String(form.time ?? '').trim() || null,
    content: cleanContent(form.content),
    km: Number.isFinite(km) && km > 0 ? km : null,
    photo_path,
  }));
  return { session, photoFailed };
}

/**
 * Supprime une séance : sa photo d'abord (jamais d'image orpheline), puis la ligne.
 * Ses présences disparaissent avec elle côté serveur ; on les retire aussi du cache local.
 * @param {string} id
 * @throws {Error} si la photo ne peut pas être supprimée (rien n'est supprimé)
 */
export async function deleteSession(id) {
  const s = db.sessions.get(id);
  if (!s) return;
  if (s.photo_path) {
    try {
      await deletePhoto(s.photo_path);
    } catch (e) {
      throw Object.assign(new Error('Photo non supprimée'), { photo: true, network: !navigator.onLine || /fetch|network|failed/i.test(String(e?.message)) });
    }
  }
  removeRow('sessions', id);
  for (const [key, p] of [...db.presence]) if (p.session_id === id) deleteLocal('presence', key);
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MONTHS_SHORT = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jui', 'aoû', 'sep', 'oct', 'nov', 'déc'];
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** @param {number} m0 @returns {string} 'Novembre' */
export const monthName = (m0) => MONTHS[m0];

/** @param {string} key 'AAAA-MM-JJ' @returns {string} 'Vendredi 20 nov' (titre du panneau, club4) */
export function dayTitle(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${DAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** @param {string} key @returns {string} '20 nov.' */
function shortDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** @param {string} start @param {string} [end] @returns {string} '20 nov. → 22 nov.' */
export function formatPlanDate(start, end) {
  if (!start) return '';
  return end && end !== start ? `${shortDate(start)} → ${shortDate(end)}` : shortDate(start);
}
