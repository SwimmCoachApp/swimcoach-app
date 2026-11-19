/**
 * Coque minimale de l'application (remplacée par la vraie coque à la tâche 9).
 */
import { leaveSession } from '../features/auth/index.js';

/**
 * @param {HTMLElement} root
 * @param {{id: string, email: string}} coach
 * @param {{id: string, name: string}} team
 * @param {() => void} leave appelé après la déconnexion
 */
export function startApp(root, coach, team, leave) {
  root.innerHTML = '<main data-screen="calendar"><header><h1 data-team-name></h1></header><button type="button" data-action="logout">Se déconnecter</button></main>';
  root.querySelector('[data-team-name]').textContent = team.name;
  root.querySelector('[data-action="logout"]').addEventListener('click', () => leaveSession(leave));
}
