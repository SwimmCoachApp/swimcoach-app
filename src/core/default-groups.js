/** Groupes d'un nouvel espace (club4), créés par la file d'attente quand l'espace ouvert n'en a aucun. */
import { db, getContext } from './store.js';
import { teamStore } from './storage.js';
import { saveRow } from './data.js';

/** Groupes créés avec un nouvel espace. */
export const DEFAULT_GROUPS = ['Benjamins', 'École de natation', 'Loisirs', 'Pôle Formation 1', 'Compétition', 'Autre'];

/**
 * Crée les groupes par défaut si l'espace ouvert n'a aucun groupe (à appeler après une synchro complète).
 * Une seule fois par espace et par appareil (drapeau `defaults_offered`) : un entraîneur qui a supprimé
 * tous ses groupes ne les voit pas revenir à chaque synchro.
 * Deux appareils qui le font en même temps : l'unicité (team_id, name) refuse le doublon, la file le met de côté.
 * @returns {boolean} true si des groupes ont été créés
 */
export function ensureDefaultGroups() {
  const ctx = getContext();
  if (!ctx) return false;
  const store = teamStore(ctx.coachId, ctx.teamId);
  if (store.get('defaults_offered')) return false;
  store.set('defaults_offered', true);
  if (db.groups.size > 0) return false;
  DEFAULT_GROUPS.forEach((name, sort_order) => saveRow('groups', { id: crypto.randomUUID(), name, sort_order }));
  return true;
}
