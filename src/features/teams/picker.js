/**
 * Écran « Crée ton espace » : premier espace d'un entraîneur activé qui n'est membre d'aucun espace.
 */
import { createTeam } from '../../core/teams.js';
import { renderCreateTeam } from '../auth/view.js';
import { setMessage, setBusy, fieldValue } from '../auth/view.js';

/**
 * @param {HTMLElement} root
 * @param {{email: string}} coach
 * @param {() => void} done appelé une fois l'espace créé
 * @param {() => void} signOutAction déconnexion demandée depuis l'écran
 */
export function showCreateTeam(root, coach, done, signOutAction) {
  renderCreateTeam(root, coach.email, {
    signOut: signOutAction,
    submit: async (form) => {
      setBusy(root, true);
      try {
        await createTeam(fieldValue(form, 'name'));
        done();
      } catch (e) {
        setMessage(root, e instanceof Error ? e.message : 'Une erreur est survenue, réessaie');
      } finally {
        setBusy(root, false);
      }
    },
  });
}
