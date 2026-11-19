/** Groupes d'un nouvel espace (club4), créés par la file d'attente quand l'espace ouvert n'en a aucun. */
import { db } from './store.js';
import { saveRow } from './data.js';

/** Groupes créés avec un nouvel espace. */
export const DEFAULT_GROUPS = ['Benjamins', 'École de natation', 'Loisirs', 'Pôle Formation 1', 'Compétition', 'Autre'];

/**
 * Crée les groupes par défaut si l'espace ouvert n'a aucun groupe (à appeler après une synchro complète).
 * Deux appareils qui le font en même temps : l'unicité (team_id, name) refuse le doublon, la file le met de côté.
 * @returns {boolean} true si des groupes ont été créés
 */
export function ensureDefaultGroups() {
  if (db.groups.size > 0) return false;
  DEFAULT_GROUPS.forEach((name, sort_order) => saveRow('groups', { id: crypto.randomUUID(), name, sort_order }));
  return true;
}
