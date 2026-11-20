/**
 * File d'attente des écritures vers Supabase.
 *
 * Chaque espace a sa file, persistée tout de suite dans `teamStore(coachId, teamId).set('outbox')`,
 * et sa liste des refus définitifs dans `outbox_rejected` (`[{op, error: {code, status, message}, at}]`) :
 * une op refusée n'est jamais perdue et ne bloque jamais la file. `coachStore(coachId).set('outboxTeams')`
 * liste les espaces dont l'une des deux listes n'est pas vide (clé retirée quand il n'y en a plus).
 * Chaque op porte le `coachId` et le `teamId` du moment ; `flush` n'envoie que celles de
 * l'entraîneur et de l'espace visés.
 */
import { teamStore, coachStore } from './storage.js';
import { getContext, keyOf } from './store.js';
import { getCoach } from './session.js';

/** Colonnes de conflit de l'upsert, par table. */
export const ON_CONFLICT = {
  groups: 'id',
  swimmers: 'id',
  sessions: 'id',
  presence: 'session_id,swimmer_id',
  plan_weeks: 'team_id,week_key',
  plan_events: 'id',
  // Sur conflit, l'upsert peut réécrire `id` avec celui du client : rien ne référence performances.id.
  performances: 'team_id,swimmer_id,competition_id,event_code,phase',
};

let handlers = {
  /** Refus RLS : 'member' (op mise de côté), 'removed' (espace effacé), 'unknown' (on garde et on s'arrête). */
  forbidden: async () => 'unknown',
  /** Op refusée définitivement et mise de côté ; `total` = nombre de refus de cet espace. */
  rejected: () => {},
};
const running = new Map();
/** Compteur par table, augmenté à chaque op retirée de la file (envoyée ou mise de côté). */
const epochs = new Map();

/**
 * Branche les réactions aux refus du serveur (fait par sync.js).
 * @param {{forbidden?: (op: object) => Promise<'member'|'removed'|'unknown'>, rejected?: (op: object, error: object, total: number) => void}} deps
 */
export function configureOutbox(deps = {}) {
  handlers = { ...handlers, ...deps };
}

/**
 * Change dès qu'une op de la table quitte une file : une lecture commencée avant ne reflète
 * peut-être pas cette écriture.
 * @param {string} table
 * @returns {number}
 */
export function flushEpoch(table) {
  return epochs.get(table) ?? 0;
}

const bump = (table) => epochs.set(table, flushEpoch(table) + 1);

const readList = (coachId, teamId, name) => {
  const list = teamStore(coachId, teamId).get(name);
  return Array.isArray(list) ? list : [];
};
const readOps = (coachId, teamId) => readList(coachId, teamId, 'outbox');
const readRejected = (coachId, teamId) => readList(coachId, teamId, 'outbox_rejected');

function writeList(coachId, teamId, name, list) {
  if (list.length) teamStore(coachId, teamId).set(name, list);
  else teamStore(coachId, teamId).remove(name);
  const store = coachStore(coachId);
  const before = store.get('outboxTeams') ?? [];
  const teams = new Set(before);
  if (readOps(coachId, teamId).length || readRejected(coachId, teamId).length) teams.add(teamId);
  else teams.delete(teamId);
  if (teams.size === before.length && before.every((t) => teams.has(t))) return;
  if (teams.size) store.set('outboxTeams', [...teams]);
  else store.remove('outboxTeams');
}

const teamsOf = (coachId, teamId) => (teamId ? [teamId] : coachStore(coachId).get('outboxTeams') ?? []);

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Ajoute une écriture à la file de l'espace ouvert.
 * La clé d'un upsert est dérivée de la ligne (`keyOf`) ; une `key` fournie doit lui être égale.
 * @param {{table: string, kind: 'upsert'|'delete', key?: string, row?: object}} op
 * @throws {Error} si aucun espace n'est ouvert ou si l'op est invalide
 */
export function enqueue(op) {
  const ctx = getContext();
  if (!ctx) throw new Error('Aucun espace ouvert');
  if (!ON_CONFLICT[op.table]) throw new Error(`Table inconnue : ${op.table}`);
  if (op.kind !== 'upsert' && op.kind !== 'delete') throw new Error(`Opération inconnue : ${op.kind}`);
  if (op.kind === 'upsert' && !op.row) throw new Error('Upsert sans ligne');
  const entry = { id: newId(), table: op.table, kind: op.kind, key: op.key, coachId: ctx.coachId, teamId: ctx.teamId };
  if (op.kind === 'upsert') {
    entry.row = { ...op.row, team_id: ctx.teamId };
    entry.key = keyOf(op.table, entry.row);
    if (op.key !== undefined && op.key !== entry.key) throw new Error(`Clé ${op.key} différente de celle de la ligne (${entry.key})`);
  }
  if (entry.key === undefined || entry.key === null) throw new Error('Op sans clé');
  writeList(ctx.coachId, ctx.teamId, 'outbox', [...readOps(ctx.coachId, ctx.teamId), entry]);
}

/**
 * Nombre d'écritures en attente (hors refus définitifs).
 * @param {string} [teamId] un espace ; tous les espaces de l'entraîneur si absent
 * @param {string} [coachId] par défaut l'entraîneur connecté
 * @returns {number}
 */
export function pendingCount(teamId, coachId = getCoach()?.id) {
  if (!coachId) return 0;
  return teamsOf(coachId, teamId).reduce((n, t) => n + readOps(coachId, t).length, 0);
}

/**
 * Nombre d'écritures refusées définitivement par le serveur et mises de côté.
 * @param {string} [teamId] un espace ; tous les espaces de l'entraîneur si absent
 * @param {string} [coachId] par défaut l'entraîneur connecté
 * @returns {number}
 */
export function rejectedCount(teamId, coachId = getCoach()?.id) {
  if (!coachId) return 0;
  return teamsOf(coachId, teamId).reduce((n, t) => n + readRejected(coachId, t).length, 0);
}

/**
 * Écritures refusées définitivement, tous espaces de l'entraîneur (pour l'export).
 * @param {string} [coachId] par défaut l'entraîneur connecté
 * @returns {{teamId: string, op: object, error: {code: string, status: number, message: string}, at: string}[]}
 */
export function listRejected(coachId = getCoach()?.id) {
  if (!coachId) return [];
  return teamsOf(coachId).flatMap((t) => readRejected(coachId, t).map((e) => ({ teamId: t, ...e })));
}

/**
 * Efface les refus définitifs de tous les espaces de l'entraîneur (la file en attente est gardée).
 * @param {string} [coachId] par défaut l'entraîneur connecté
 */
export function clearRejected(coachId = getCoach()?.id) {
  if (!coachId) return;
  for (const t of teamsOf(coachId)) writeList(coachId, t, 'outbox_rejected', []);
}

/**
 * Clés en attente d'envoi pour une table de l'espace ouvert (hors refus définitifs).
 * @param {string} table
 * @returns {Set<string>}
 */
export function pendingKeys(table) {
  const ctx = getContext();
  if (!ctx) return new Set();
  return new Set(readOps(ctx.coachId, ctx.teamId).filter((o) => o.table === table).map((o) => o.key));
}

/**
 * Efface la file et les refus d'un espace.
 * @param {string} coachId
 * @param {string} teamId
 */
export function dropTeam(coachId, teamId) {
  writeList(coachId, teamId, 'outbox', []);
  writeList(coachId, teamId, 'outbox_rejected', []);
}

function send(client, op) {
  const q = client.from(op.table);
  if (op.kind === 'upsert') return q.upsert(op.row, { onConflict: ON_CONFLICT[op.table] });
  const del = q.delete();
  if (op.table === 'presence') {
    const [sessionId, swimmerId] = String(op.key).split(':');
    return del.eq('session_id', sessionId).eq('swimmer_id', swimmerId);
  }
  if (op.table === 'plan_weeks') return del.eq('team_id', op.teamId).eq('week_key', op.key);
  return del.eq('team_id', op.teamId).eq('id', op.key);
}

/**
 * Erreur temporaire, l'op est gardée pour plus tard : réseau, serveur, jeton expiré, trop de requêtes,
 * base en lecture seule (25006 / 405), cache du schéma ou colonnes pas encore à jour (PGRST0xx, PGRST2xx).
 */
function isTransient(error, status) {
  const code = String(error?.code ?? '');
  if (!code || !status) return true;
  if (code === '25006' || /^PGRST[02]\d\d$/.test(code)) return true;
  return status >= 500 || [401, 405, 408, 429].includes(status);
}

function removeOp(coachId, teamId, op) {
  writeList(coachId, teamId, 'outbox', readOps(coachId, teamId).filter((o) => o.id !== op.id));
  bump(op.table);
}

function reject(coachId, teamId, op, error, status) {
  const entry = { op, error: { code: String(error?.code ?? ''), status: status ?? 0, message: String(error?.message ?? '') }, at: new Date().toISOString() };
  writeList(coachId, teamId, 'outbox_rejected', [...readRejected(coachId, teamId), entry]);
  removeOp(coachId, teamId, op);
  handlers.rejected(op, entry.error, readRejected(coachId, teamId).length);
}

async function run(client, coachId, teamId) {
  const sent = new Set();
  for (;;) {
    if (getCoach()?.id !== coachId) return; // l'entraîneur a changé : rien ne part sous un autre jeton
    const op = readOps(coachId, teamId).find((o) => o.coachId === coachId && o.teamId === teamId && !sent.has(o.id));
    if (!op) return;
    sent.add(op.id);
    let res;
    try {
      res = await send(client, op);
    } catch (error) {
      res = { error, status: 0 };
    }
    if (!res?.error) {
      removeOp(coachId, teamId, op);
      continue;
    }
    if (res.error.code === '42501') {
      const membership = await handlers.forbidden(op);
      if (membership !== 'member') return; // 'removed' : file effacée ; 'unknown' : on garde l'op
      reject(coachId, teamId, op, res.error, res.status);
      continue;
    }
    if (isTransient(res.error, res.status)) return;
    reject(coachId, teamId, op, res.error, res.status);
  }
}

/**
 * Envoie les files de tous les espaces de l'entraîneur (avant une déconnexion).
 * @param {object} client client Supabase
 * @param {string} coachId
 * @returns {Promise<void>}
 */
export async function flushCoach(client, coachId) {
  if (!coachId) return;
  await Promise.all(teamsOf(coachId).map((t) => flush(client, coachId, t)));
}

/**
 * Envoie dans l'ordre les écritures de l'entraîneur pour l'espace visé.
 * S'arrête à la première erreur temporaire ; une op refusée définitivement est mise de côté.
 * Un seul envoi à la fois par espace : un appel pendant un envoi attend celui-ci.
 * @param {object} client client Supabase
 * @param {string} coachId entraîneur connecté
 * @param {string} [teamId] par défaut l'espace ouvert
 * @returns {Promise<void>}
 */
export function flush(client, coachId, teamId = getContext()?.teamId) {
  if (!coachId || !teamId) return Promise.resolve();
  const id = `${coachId}|${teamId}`;
  if (!running.has(id)) {
    running.set(id, run(client, coachId, teamId).finally(() => running.delete(id)));
  }
  return running.get(id);
}
