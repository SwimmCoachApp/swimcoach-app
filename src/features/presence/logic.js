/**
 * Présences (appel d'une séance) : lectures depuis le store, écritures par core/data.js.
 *
 * Plusieurs entraîneurs peuvent faire l'appel de la même séance en même temps : chaque coche est une op
 * sur UN nageur (`upsert` en cochant, `delete` en décochant, clé `session_id:swimmer_id`), jamais un
 * remplacement de la liste. Les relectures du serveur gardent les coches encore dans la file (pendingKeys).
 *
 * Séance pas encore enregistrée : les coches restent en mémoire (brouillon) et ne partent qu'après la
 * ligne de la séance (commitDraft, appelé après l'enregistrement) : la file part dans l'ordre, la séance
 * existe donc côté serveur avant ses présences (pas de 23503).
 */
import { db, onReset } from '../../core/store.js';
import { saveRow, removeRow } from '../../core/data.js';
import { swimmerInSeason, seasonOfDateKey } from '../../core/season.js';

/** @type {Map<string, {date: string|null, ids: Set<string>, saving?: boolean}>} brouillons des séances pas encore enregistrées */
const drafts = new Map();
onReset(() => drafts.clear());

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} sessionId @param {string} swimmerId @returns {string} clé locale d'une présence */
export const presenceKey = (sessionId, swimmerId) => `${sessionId}:${swimmerId}`;

/**
 * Ouvre l'appel d'une séance pas encore enregistrée : ses coches restent en mémoire.
 * @param {string} sessionId id que la séance aura
 * @param {string} date 'AAAA-MM-JJ'
 */
export function startDraft(sessionId, date) {
  drafts.set(sessionId, { date, ids: new Set() });
}

/**
 * Met à l'abri le brouillon d'une séance dont l'enregistrement commence : discardDrafts ne le touche plus
 * (une autre feuille peut s'ouvrir pendant l'envoi de la photo) ; commitDraft l'envoie.
 * @param {string} sessionId
 */
export function protectDraft(sessionId) {
  const draft = drafts.get(sessionId);
  if (draft) draft.saving = true;
}

/** Oublie les coches des séances non enregistrées (feuille fermée sans enregistrer), sauf celles en cours d'enregistrement. */
export function discardDrafts() {
  for (const [id, draft] of drafts) if (!draft.saving) drafts.delete(id);
}

/**
 * Envoie les coches d'une séance qui vient d'être enregistrée (après sa ligne dans la file).
 * Sans effet si la séance n'est pas dans le store (jamais de présence avant sa séance).
 * @param {string} sessionId
 * @returns {number} nombre de coches envoyées
 */
export function commitDraft(sessionId) {
  const draft = drafts.get(sessionId);
  drafts.delete(sessionId);
  if (!draft || !db.sessions.has(sessionId)) return 0;
  let n = 0;
  for (const swimmerId of draft.ids) {
    if (!db.swimmers.has(swimmerId) || db.presence.has(presenceKey(sessionId, swimmerId))) continue;
    saveRow('presence', { session_id: sessionId, swimmer_id: swimmerId });
    n += 1;
  }
  return n;
}

/**
 * @param {string} sessionId
 * @param {string} swimmerId
 * @returns {boolean} le nageur est-il coché présent ?
 */
export function isPresent(sessionId, swimmerId) {
  const draft = drafts.get(sessionId);
  if (draft) return draft.ids.has(swimmerId);
  return db.presence.has(presenceKey(sessionId, swimmerId));
}

/**
 * Coche ou décoche un nageur : une op pour ce nageur seulement (aucune si rien ne change).
 * Séance pas encore enregistrée (brouillon) : la coche reste en mémoire jusqu'à commitDraft.
 * Séance inconnue (supprimée ailleurs) : rien n'est fait, aucun brouillon n'est créé.
 * @param {string} sessionId
 * @param {string} swimmerId
 * @param {boolean} present
 * @returns {boolean} false si la séance n'existe pas (ou plus)
 */
export function togglePresence(sessionId, swimmerId, present) {
  const draft = drafts.get(sessionId);
  if (draft) {
    if (present) draft.ids.add(swimmerId);
    else draft.ids.delete(swimmerId);
    return true;
  }
  if (!db.sessions.has(sessionId)) return false;
  const key = presenceKey(sessionId, swimmerId);
  if (present === db.presence.has(key)) return true;
  if (present) saveRow('presence', { session_id: sessionId, swimmer_id: swimmerId });
  else removeRow('presence', key);
  return true;
}

/**
 * Nageurs de l'appel : ceux qui font partie du groupe pendant la saison de la séance (un archivé d'une
 * saison précédente en est exclu, celui archivé cette saison-là y reste), triés par nom puis prénom (club4).
 * @param {{date?: string|null}} session
 * @returns {object[]}
 */
export function rollCallList(session) {
  if (!DATE_RE.test(session?.date ?? '')) return [];
  const season = seasonOfDateKey(session.date);
  return [...db.swimmers.values()]
    .filter((sw) => swimmerInSeason(sw, season))
    .sort((a, b) => (a.lastname || '').localeCompare(b.lastname || '', 'fr') || (a.firstname || '').localeCompare(b.firstname || '', 'fr'));
}

/**
 * Séance de l'appel, source unique de la liste et de la jauge : celle du store, sinon le brouillon
 * (seule sa date compte), sinon null (séance supprimée).
 * @param {string} sessionId
 * @returns {object|null}
 */
export function rollCallSession(sessionId) {
  return db.sessions.get(sessionId) ?? (drafts.has(sessionId) ? { id: sessionId, date: drafts.get(sessionId).date } : null);
}

/**
 * Jauge « N / M présents » : présents parmi les nageurs de l'appel.
 * @param {string} sessionId
 * @returns {{present: number, total: number}}
 */
export function presenceGauge(sessionId) {
  const list = rollCallList(rollCallSession(sessionId));
  return { present: list.filter((sw) => isPresent(sessionId, sw.id)).length, total: list.length };
}

/**
 * « Tous ✓ » : coche chaque nageur de l'appel. « Aucun » : décoche tous les présents connus de la séance.
 * Une op par nageur qui change, jamais de remplacement de la liste.
 * @param {string} sessionId
 * @param {boolean} present
 */
export function setAllPresence(sessionId, present) {
  if (present) {
    for (const sw of rollCallList(rollCallSession(sessionId))) togglePresence(sessionId, sw.id, true);
    return;
  }
  const draft = drafts.get(sessionId);
  if (draft) {
    draft.ids.clear();
    return;
  }
  for (const p of [...db.presence.values()]) if (p.session_id === sessionId) togglePresence(sessionId, p.swimmer_id, false);
}
