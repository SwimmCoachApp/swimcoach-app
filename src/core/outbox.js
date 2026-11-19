/**
 * File d'attente des écritures vers Supabase.
 *
 * Chaque espace a sa file, persistée tout de suite dans `teamStore(coachId, teamId).set('outbox')` ;
 * la liste des espaces dont la file n'est pas vide est tenue dans `coachStore(coachId).set('outboxTeams')`.
 * Chaque op porte le `coachId` et le `teamId` du moment ; `flush` n'envoie que celles de
 * l'entraîneur et de l'espace visés.
 */
import { teamStore, coachStore } from './storage.js';
import { getContext } from './store.js';
import { getCoach } from './session.js';

/** Colonnes de conflit de l'upsert, par table. */
export const ON_CONFLICT = {
  groups: 'id',
  swimmers: 'id',
  sessions: 'id',
  presence: 'session_id,swimmer_id',
  plan_weeks: 'team_id,week_key',
  plan_events: 'id',
  performances: 'team_id,swimmer_id,competition_id,event_code,phase',
};

let handlers = {
  /** Refus RLS : renvoie true si l'entraîneur est toujours membre de l'espace. */
  forbidden: async () => true,
  /** Op refusée définitivement par le serveur (retirée de la file). */
  rejected: () => {},
};
const running = new Map();

/**
 * Branche les réactions aux refus du serveur (fait par sync.js).
 * @param {{forbidden?: (op: object) => Promise<boolean>, rejected?: (op: object, error: object) => void}} deps
 */
export function configureOutbox(deps = {}) {
  handlers = { ...handlers, ...deps };
}

const readOps = (coachId, teamId) => {
  const ops = teamStore(coachId, teamId).get('outbox');
  return Array.isArray(ops) ? ops : [];
};

function writeOps(coachId, teamId, ops) {
  const store = coachStore(coachId);
  const teams = new Set(store.get('outboxTeams') ?? []);
  if (ops.length) {
    teamStore(coachId, teamId).set('outbox', ops);
    teams.add(teamId);
  } else {
    teamStore(coachId, teamId).remove('outbox');
    teams.delete(teamId);
  }
  store.set('outboxTeams', [...teams]);
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Ajoute une écriture à la file de l'espace ouvert.
 * @param {{table: string, kind: 'upsert'|'delete', key: string, row?: object}} op
 * @throws {Error} si aucun espace n'est ouvert ou si l'op est invalide
 */
export function enqueue(op) {
  const ctx = getContext();
  if (!ctx) throw new Error('Aucun espace ouvert');
  if (!ON_CONFLICT[op.table]) throw new Error(`Table inconnue : ${op.table}`);
  if (op.kind !== 'upsert' && op.kind !== 'delete') throw new Error(`Opération inconnue : ${op.kind}`);
  if (op.kind === 'upsert' && !op.row) throw new Error('Upsert sans ligne');
  const entry = { id: newId(), table: op.table, kind: op.kind, key: op.key, coachId: ctx.coachId, teamId: ctx.teamId };
  if (op.kind === 'upsert') entry.row = { ...op.row, team_id: ctx.teamId };
  writeOps(ctx.coachId, ctx.teamId, [...readOps(ctx.coachId, ctx.teamId), entry]);
}

/**
 * Nombre d'écritures en attente.
 * @param {string} [teamId] un espace ; tous les espaces de l'entraîneur si absent
 * @param {string} [coachId] par défaut l'entraîneur connecté
 * @returns {number}
 */
export function pendingCount(teamId, coachId = getCoach()?.id) {
  if (!coachId) return 0;
  const teams = teamId ? [teamId] : coachStore(coachId).get('outboxTeams') ?? [];
  return teams.reduce((n, t) => n + readOps(coachId, t).length, 0);
}

/**
 * Clés en attente d'envoi pour une table de l'espace ouvert.
 * @param {string} table
 * @returns {Set<string>}
 */
export function pendingKeys(table) {
  const ctx = getContext();
  if (!ctx) return new Set();
  return new Set(readOps(ctx.coachId, ctx.teamId).filter((o) => o.table === table).map((o) => o.key));
}

/**
 * Efface la file d'un espace.
 * @param {string} coachId
 * @param {string} teamId
 */
export function dropTeam(coachId, teamId) {
  writeOps(coachId, teamId, []);
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

/** Erreur passagère (réseau, serveur, jeton expiré, trop de requêtes) : on réessaiera plus tard. */
function isTransient(error, status) {
  if (!error?.code || !status) return true;
  return status >= 500 || status === 401 || status === 408 || status === 429;
}

function removeOp(coachId, teamId, id) {
  writeOps(coachId, teamId, readOps(coachId, teamId).filter((o) => o.id !== id));
}

async function run(client, coachId, teamId) {
  const sent = new Set();
  for (;;) {
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
      removeOp(coachId, teamId, op.id);
      continue;
    }
    if (res.error.code === '42501') {
      if (!(await handlers.forbidden(op))) return; // plus membre : la file de l'espace a été effacée
      removeOp(coachId, teamId, op.id);
      handlers.rejected(op, res.error);
      continue;
    }
    if (isTransient(res.error, res.status)) return;
    removeOp(coachId, teamId, op.id);
    handlers.rejected(op, res.error);
  }
}

/**
 * Envoie dans l'ordre les écritures de l'entraîneur pour l'espace visé.
 * S'arrête à la première erreur réseau ; une op refusée définitivement est retirée.
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
