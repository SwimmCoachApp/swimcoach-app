/**
 * Synchronisation de l'espace ouvert avec Supabase : lecture paginée, fusion, appartenance,
 * ouverture / fermeture d'un espace. Le temps réel est dans realtime.js.
 *
 * Fusion : le serveur fait foi, sauf pour les clés encore dans la file d'attente (pendingKeys),
 * qui gardent la version locale. Aucune décision ne repose sur l'horloge du client.
 */
import { supabase } from './supabase.js';
import { teamStore } from './storage.js';
import { getCoach, onCoachChange } from './session.js';
import { listMyTeams, getCurrentTeam, setCurrentTeam } from './teams.js';
import { TABLES, db, keyOf, getContext, isOpen, loadCache, replaceTable, resetStore } from './store.js';
import { configureOutbox, dropTeam, flush, flushEpoch, pendingKeys } from './outbox.js';
import { startLive, stopLive, scheduleRefresh } from './realtime.js';

export { startLive, stopLive, LIVE_DELAY_MS } from './realtime.js';

/** Taille d'une page de lecture. */
export const PAGE_SIZE = 1000;

/** Colonnes de tri (clé primaire) pour une pagination stable. */
const ORDER = { presence: ['session_id', 'swimmer_id'], plan_weeks: ['week_key'] };

let hooks = { toast: () => {}, onTeamLost: () => {} };
/** @type {{coachId: string, team: {id: string, name: string}}|null} */
let current = null;
const checks = new Map();
/** Par table : dernier numéro de relecture lancé, et dernier appliqué. */
const started = new Map();
const applied = new Map();

/**
 * Branche l'interface.
 * @param {{toast?: (msg: string) => void, onTeamLost?: (next: {id: string, name: string}|null) => void}} deps
 *   toast : message court ; onTeamLost : l'espace ouvert n'est plus accessible, `next` est l'espace
 *   à ouvrir (déjà choisi comme espace courant) ou null (écran « Crée ton espace »).
 */
export function configureSync(deps = {}) {
  hooks = { ...hooks, ...deps };
}

configureOutbox({
  forbidden: (op) => verifyMembership(op.coachId, op.teamId),
  rejected: (op, _error, total) => {
    hooks.toast(`${total} modification(s) refusée(s) par le serveur`);
    scheduleRefresh(op.table); // la ligne refusée revient à l'état du serveur
  },
});

onCoachChange((coach) => {
  const ctx = getContext();
  if (ctx && (!coach || coach.id !== ctx.coachId)) closeTeam();
});

/**
 * Lit toutes les lignes d'une table pour un espace, par pages de 1000.
 * @param {string} table
 * @param {string} [teamId] par défaut l'espace ouvert
 * @returns {Promise<object[]>}
 * @throws {Error} si une page échoue (jamais de liste tronquée)
 */
export async function fetchAll(table, teamId = getContext()?.teamId) {
  if (!teamId) throw new Error('Aucun espace ouvert');
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase.from(table).select('*').eq('team_id', teamId);
    for (const col of ORDER[table] ?? ['id']) q = q.order(col);
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Lecture de ${table} impossible : ${error.message || error.code || 'erreur'}`);
    all.push(...data);
    if (data.length < PAGE_SIZE) return all;
  }
}

/**
 * Fusionne les lignes du serveur dans le cache de l'espace ouvert.
 * @param {string} table
 * @param {object[]} remoteRows toutes les lignes de l'espace pour cette table
 */
export function mergeTable(table, remoteRows) {
  const ctx = getContext();
  if (!ctx) return;
  const pending = pendingKeys(table);
  const next = new Map();
  for (const row of remoteRows) {
    if (row.team_id !== ctx.teamId) continue;
    const key = keyOf(table, row);
    if (!pending.has(key)) next.set(key, row);
  }
  for (const key of pending) if (db[table].has(key)) next.set(key, db[table].get(key));
  replaceTable(table, next);
}

/**
 * Relit une table et la fusionne, dans l'ordre : une relecture plus ancienne qu'une relecture déjà
 * appliquée est ignorée ; si une op de la table a quitté la file pendant la lecture, la page lue
 * peut précéder notre écriture : on ne fusionne pas et une nouvelle relecture est programmée.
 * @param {string} table
 * @param {{coachId: string, teamId: string}} ctx espace pour lequel la lecture est lancée
 * @returns {Promise<'merged'|'superseded'|'stale'|'closed'>}
 * @throws {Error} si la lecture échoue
 */
export async function refreshTable(table, ctx) {
  const seq = (started.get(table) ?? 0) + 1;
  started.set(table, seq);
  const epoch = flushEpoch(table);
  const rows = await fetchAll(table, ctx.teamId);
  if (!isOpen(ctx)) return 'closed';
  if ((applied.get(table) ?? 0) > seq) return 'superseded';
  if (flushEpoch(table) !== epoch) {
    scheduleRefresh(table);
    return 'stale';
  }
  applied.set(table, seq);
  mergeTable(table, rows);
  return 'merged';
}

function teamName(teamId) {
  if (current?.team.id === teamId) return current.team.name;
  const team = getCurrentTeam();
  return team?.id === teamId ? team.name : '';
}

async function runMembership(coachId, teamId) {
  const coach = getCoach();
  if (!coach || coach.id !== coachId) return 'unknown';
  const name = teamName(teamId);
  let teams;
  try {
    teams = await listMyTeams();
  } catch {
    return 'unknown'; // liste illisible : on ne retire rien
  }
  if (getCoach()?.id !== coachId) return 'unknown';
  if (teams.some((t) => t.id === teamId)) return 'member';
  const wasOpen = isOpen({ coachId, teamId });
  if (wasOpen) closeTeam();
  dropTeam(coachId, teamId);
  teamStore(coachId, teamId).clear();
  hooks.toast(`Tu n'as plus accès à l'espace « ${name} »`);
  if (wasOpen) {
    const next = teams[0] ?? null;
    if (next) setCurrentTeam(next.id);
    hooks.onTeamLost(next);
  }
  return 'removed';
}

/** Vérifie l'appartenance à un espace (appels simultanés regroupés). */
function verifyMembership(coachId, teamId) {
  const id = `${coachId}|${teamId}`;
  if (!checks.has(id)) checks.set(id, runMembership(coachId, teamId).finally(() => checks.delete(id)));
  return checks.get(id);
}

/**
 * Relit les espaces de l'entraîneur ; si l'espace ouvert n'y est plus, efface sa file et son cache,
 * affiche le toast et passe à un autre espace (ou à l'écran « Crée ton espace »).
 * Hors ligne, la dernière liste connue fait foi (rien n'est retiré).
 * @returns {Promise<'member'|'removed'|'unknown'>} 'unknown' : aucun espace ouvert, entraîneur changé
 *   ou liste des espaces illisible (rien n'est retiré)
 */
export function checkMembership() {
  const ctx = getContext();
  return ctx ? verifyMembership(ctx.coachId, ctx.teamId) : Promise.resolve('unknown');
}

/**
 * Vérifie l'appartenance, recharge les 7 tables puis envoie la file d'attente.
 * @returns {Promise<boolean>} false si l'appartenance n'est pas confirmée, si l'espace a changé ou si une lecture a échoué
 */
export async function initialSync() {
  const ctx = getContext();
  if (!ctx) return false;
  if ((await checkMembership()) !== 'member' || !isOpen(ctx)) return false;
  try {
    for (const table of TABLES) {
      if ((await refreshTable(table, ctx)) === 'closed') return false;
    }
    await flush(supabase, ctx.coachId, ctx.teamId);
  } catch {
    return false;
  }
  return true;
}

/**
 * Ouvre un espace : se désabonne de l'ancien, charge tout de suite le cache du nouveau, s'abonne, synchronise.
 * La file de l'ancien espace part en arrière-plan (elle est enregistrée par espace : un échec ou une
 * connexion lente ne bloque jamais l'ouverture et aucune ligne de l'ancien espace ne reste lisible).
 * Le cache du nouvel espace est chargé de façon synchrone dans cet appel : les écrans ne doivent
 * s'afficher qu'après lui, à partir du store seulement.
 * Sans effet si cet espace est déjà ouvert.
 * @param {string} coachId
 * @param {{id: string, name: string}} team
 * @returns {Promise<void>}
 */
export async function openTeam(coachId, team) {
  const prev = getContext();
  if (prev && prev.coachId === coachId && prev.teamId === team.id) {
    current = { coachId, team };
    return;
  }
  current = { coachId, team };
  if (prev && prev.coachId === coachId) flushInBackground(prev);
  stopLive();
  loadCache(coachId, team.id); // vide d'abord le store de l'ancien espace (et sauvegarde son cache)
  startLive();
  await initialSync();
}

function flushInBackground(ctx) {
  flush(supabase, ctx.coachId, ctx.teamId).catch(() => {
    // la file reste enregistrée pour un prochain envoi
  });
}

/**
 * Quitte l'espace ouvert tout de suite (changement d'espace en cours) : coupe le temps réel, vide le store
 * (après avoir sauvegardé le cache de cet espace) et envoie sa file en arrière-plan.
 */
export function suspendTeam() {
  const prev = getContext();
  current = null;
  stopLive();
  resetStore();
  if (prev) flushInBackground(prev);
}

/** Ferme l'espace ouvert sans rien envoyer (déconnexion, changement d'entraîneur, accès perdu). */
export function closeTeam() {
  current = null;
  stopLive();
  resetStore({ save: false });
}
