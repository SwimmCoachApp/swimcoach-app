/**
 * Temps réel de l'espace ouvert.
 *
 * INSERT / UPDATE : filtrés `team_id=eq.<teamId>`. DELETE : Supabase ne sait pas les filtrer et
 * n'envoie que la clé primaire ; on s'y abonne sans filtre et on relit simplement la table.
 * Aucun contenu d'événement n'est appliqué tel quel : chaque événement programme, 800 ms plus tard,
 * une relecture de la table de l'espace (fetchAll + mergeTable).
 * `team_members` (filtré sur l'entraîneur) : tout événement relance checkMembership().
 * Au retour au premier plan et sur `online` : flush puis initialSync.
 */
import { supabase } from './supabase.js';
import { TABLES, getContext, isOpen } from './store.js';
import { flush } from './outbox.js';
import { refreshTable, checkMembership, initialSync } from './sync.js';

/** Délai entre un événement et la relecture de la table. */
export const LIVE_DELAY_MS = 800;

/** @type {{ctx: {coachId: string, teamId: string}, channel: object, timers: Record<string, any>}|null} */
let live = null;

async function refresh(table, ctx) {
  if (live?.ctx !== ctx || !isOpen(ctx)) return;
  try {
    await refreshTable(table, ctx);
  } catch {
    // hors ligne : la prochaine synchro rattrapera
  }
}

/**
 * Programme (ou repousse) une relecture de la table dans 800 ms. Sans effet hors temps réel.
 * @param {string} table
 */
export function scheduleRefresh(table) {
  if (!live) return;
  const state = live;
  clearTimeout(state.timers[table]);
  state.timers[table] = setTimeout(() => {
    delete state.timers[table];
    refresh(table, state.ctx);
  }, LIVE_DELAY_MS);
}

async function resync() {
  const ctx = live?.ctx;
  if (!ctx || !isOpen(ctx)) return;
  try {
    await flush(supabase, ctx.coachId, ctx.teamId);
    await initialSync();
  } catch {
    // réessayé au prochain retour au premier plan
  }
}

function handleVisibility() {
  if (document.visibilityState === 'visible') resync();
}

function handleOnline() {
  resync();
}

function handleMembers() {
  checkMembership().catch(() => {});
}

/** S'abonne aux changements de l'espace ouvert (remplace l'abonnement précédent). */
export function startLive() {
  stopLive();
  const ctx = getContext();
  if (!ctx) return;
  const channel = supabase.channel(`team-${ctx.teamId}`);
  const filter = `team_id=eq.${ctx.teamId}`;
  for (const table of TABLES) {
    const handleChange = () => scheduleRefresh(table);
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, handleChange);
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, handleChange);
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, handleChange);
  }
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'team_members', filter: `coach_id=eq.${ctx.coachId}` }, handleMembers);
  channel.subscribe();
  live = { ctx, channel, timers: {} };
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('online', handleOnline);
}

/** Se désabonne et annule les relectures programmées. */
export function stopLive() {
  if (!live) return;
  const { channel, timers } = live;
  live = null;
  for (const t of Object.values(timers)) clearTimeout(t);
  document.removeEventListener('visibilitychange', handleVisibility);
  window.removeEventListener('online', handleOnline);
  try {
    Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
  } catch {
    // canal déjà fermé
  }
}
