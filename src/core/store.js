/**
 * Cache en mémoire de l'espace ouvert, sauvegardé dans `teamStore(coachId, teamId)` sous `cache`.
 *
 * Chaque table est une `Map` indexée par sa clé primaire : `id`, sauf `presence`
 * (`${session_id}:${swimmer_id}`) et `plan_weeks` (`week_key`).
 */
import { teamStore } from './storage.js';

/** Tables métier, dans l'ordre de chargement. */
export const TABLES = ['groups', 'swimmers', 'sessions', 'presence', 'plan_weeks', 'plan_events', 'performances'];

/** Délai de sauvegarde du cache. */
export const SAVE_DELAY_MS = 300;

/** @type {Record<string, Map<string, object>>} */
export const db = Object.fromEntries(TABLES.map((t) => [t, new Map()]));

/** @type {{coachId: string, teamId: string}|null} */
let ctx = null;
let saveTimer = null;
const listeners = new Map(TABLES.map((t) => [t, new Set()]));
const resetListeners = new Set();

/**
 * Clé locale d'une ligne.
 * @param {string} table
 * @param {object} row
 * @returns {string}
 */
export function keyOf(table, row) {
  if (table === 'presence') return `${row.session_id}:${row.swimmer_id}`;
  if (table === 'plan_weeks') return row.week_key;
  return row.id;
}

/** @returns {{coachId: string, teamId: string}|null} espace ouvert (copie) */
export function getContext() {
  return ctx ? { ...ctx } : null;
}

/** @param {{coachId: string, teamId: string}|null} c @returns {boolean} true si c désigne toujours l'espace ouvert */
export function isOpen(c) {
  return !!ctx && !!c && ctx.coachId === c.coachId && ctx.teamId === c.teamId;
}

function assertTable(table) {
  if (!db[table]) throw new Error(`Table inconnue : ${table}`);
}

function notify(table) {
  for (const cb of [...listeners.get(table)]) cb(db[table]);
}

function writeCache(c) {
  const snapshot = Object.fromEntries(TABLES.map((t) => [t, [...db[t].values()]]));
  teamStore(c.coachId, c.teamId).set('cache', snapshot);
}

/**
 * Ouvre le cache d'un espace (ferme le précédent en sauvegardant ce qui restait à écrire).
 * @param {string} coachId
 * @param {string} teamId
 */
export function loadCache(coachId, teamId) {
  resetStore();
  ctx = { coachId, teamId };
  const cached = teamStore(coachId, teamId).get('cache') ?? {};
  for (const t of TABLES) {
    for (const row of Array.isArray(cached[t]) ? cached[t] : []) db[t].set(keyOf(t, row), row);
    notify(t);
  }
}

/** Programme la sauvegarde du cache de l'espace ouvert (différée de 300 ms). */
export function saveCache() {
  if (!ctx) return;
  const c = ctx;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (isOpen(c)) writeCache(c);
  }, SAVE_DELAY_MS);
}

/** Écrit tout de suite la sauvegarde du cache en attente, s'il y en a une. */
export function saveCacheNow() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (ctx) writeCache(ctx);
}

// L'app peut être tuée sans prévenir une fois masquée : on ne garde pas d'écriture en suspens.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveCacheNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCacheNow();
  });
}

/**
 * Ajoute ou remplace une ligne locale ; pose le `team_id` de l'espace ouvert.
 * @param {string} table
 * @param {object} row
 * @returns {object} la ligne enregistrée
 * @throws {Error} si aucun espace n'est ouvert
 */
export function upsertLocal(table, row) {
  assertTable(table);
  if (!ctx) throw new Error('Aucun espace ouvert');
  const full = { ...row, team_id: ctx.teamId };
  db[table].set(keyOf(table, full), full);
  saveCache();
  notify(table);
  return full;
}

/**
 * @param {string} table
 * @param {string} key clé locale (voir keyOf)
 */
export function deleteLocal(table, key) {
  assertTable(table);
  if (!ctx) throw new Error('Aucun espace ouvert');
  if (!db[table].delete(key)) return;
  saveCache();
  notify(table);
}

/**
 * Remplace le contenu d'une table (utilisé par la synchronisation). Sans effet si rien ne change.
 * @param {string} table
 * @param {Map<string, object>} next
 */
export function replaceTable(table, next) {
  assertTable(table);
  if (!ctx) return;
  const cur = db[table];
  const same = cur.size === next.size && [...next].every(([k, row]) => cur.has(k) && JSON.stringify(cur.get(k)) === JSON.stringify(row));
  if (same) return;
  cur.clear();
  for (const [k, row] of next) cur.set(k, row);
  saveCache();
  notify(table);
}

/**
 * @param {string} table
 * @param {(rows: Map<string, object>) => void} cb appelé à chaque changement de la table
 * @returns {() => void} désabonnement
 */
export function subscribe(table, cb) {
  assertTable(table);
  listeners.get(table).add(cb);
  return () => listeners.get(table).delete(cb);
}

/**
 * @param {() => void} cb appelé à chaque fermeture de l'espace (changement d'espace, d'entraîneur, déconnexion)
 * @returns {() => void} désabonnement
 */
export function onReset(cb) {
  resetListeners.add(cb);
  return () => resetListeners.delete(cb);
}

/**
 * Vide le cache en mémoire (changement d'espace ou d'entraîneur).
 * @param {{save?: boolean}} [opts] save : écrit d'abord la sauvegarde en attente (faux après effacement des données)
 */
export function resetStore({ save = true } = {}) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (save && ctx) writeCache(ctx);
  }
  ctx = null;
  for (const cb of [...resetListeners]) cb();
  for (const t of TABLES) {
    if (db[t].size === 0) continue;
    db[t].clear();
    notify(t);
  }
}
