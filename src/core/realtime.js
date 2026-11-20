/**
 * Temps réel de l'espace ouvert.
 *
 * INSERT / UPDATE seulement, filtrés `team_id=eq.<teamId>`. La publication `supabase_realtime`
 * ne publie pas les DELETE (Supabase ne les filtre pas par RLS : ils exposeraient les clés
 * primaires de tous les espaces à tout compte connecté) et ne contient pas `team_members`.
 * Une suppression faite par un autre membre apparaît donc à la prochaine relecture de la table :
 * prochain INSERT / UPDATE de cette table, retour au premier plan ou retour du réseau.
 * Un retrait de l'espace est détecté à la resynchro (checkMembership) ou au premier envoi refusé.
 * Aucun contenu d'événement n'est appliqué tel quel : chaque événement programme, 800 ms plus tard,
 * une relecture de la table de l'espace (configureLive.refresh).
 * Au retour au premier plan et sur `online` : configureLive.resync (appartenance, flush, synchro).
 *
 * Ce module n'importe pas sync.js : sync.js lui fournit refresh et resync (pas d'import circulaire).
 */
import { supabase } from './supabase.js';
import { TABLES, getContext, isOpen } from './store.js';

let deps = { refresh: async () => {}, resync: async () => {} };

/**
 * Branche la relecture d'une table et la resynchro complète (fait par sync.js).
 * @param {{refresh?: (table: string, ctx: {coachId: string, teamId: string}) => Promise<any>, resync?: (ctx: {coachId: string, teamId: string}) => Promise<any>}} next
 */
export function configureLive(next = {}) {
  deps = { ...deps, ...next };
}

/** Délai entre un événement et la relecture de la table. */
export const LIVE_DELAY_MS = 800;

/** @type {{ctx: {coachId: string, teamId: string}, channel: object, timers: Record<string, any>}|null} */
let live = null;

async function refresh(table, ctx) {
  if (live?.ctx !== ctx || !isOpen(ctx)) return;
  try {
    await deps.refresh(table, ctx);
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

function resync() {
  const ctx = live?.ctx;
  if (!ctx || !isOpen(ctx)) return;
  Promise.resolve()
    .then(() => deps.resync(ctx))
    .catch(() => {
      // réessayé au prochain retour au premier plan
    });
}

function handleVisibility() {
  if (document.visibilityState === 'visible') resync();
}

function handleOnline() {
  resync();
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
  }
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
