/**
 * Écritures de l'interface : ligne locale + file d'attente + envoi dès que possible.
 * Tous les écrans écrivent par ici (jamais directement dans le store ou la file).
 */
import { supabase } from './supabase.js';
import { getContext, upsertLocal, deleteLocal } from './store.js';
import { enqueue, flush } from './outbox.js';

/** Envoie la file de l'espace ouvert ; sans réseau, elle part au prochain retour en ligne. */
function scheduleFlush() {
  const ctx = getContext();
  if (!ctx) return;
  flush(supabase, ctx.coachId, ctx.teamId).catch(() => {
    // la file reste enregistrée
  });
}

/**
 * Enregistre une ligne : store local, file d'attente, envoi.
 * @param {string} table
 * @param {object} row
 * @returns {object} la ligne enregistrée localement
 */
export function saveRow(table, row) {
  const saved = upsertLocal(table, row);
  enqueue({ table, kind: 'upsert', row: saved });
  scheduleFlush();
  return saved;
}

/**
 * Supprime une ligne : store local, file d'attente, envoi.
 * @param {string} table
 * @param {string} key clé locale (voir keyOf)
 */
export function removeRow(table, key) {
  deleteLocal(table, key);
  enqueue({ table, kind: 'delete', key });
  scheduleFlush();
}
