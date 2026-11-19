import './styles/auth.css';
import { initSession, getCoach, onCoachChange, onPasswordRecovery, isRecovering } from './core/session.js';
import { listMyTeams, getCurrentTeam, setCurrentTeam } from './core/teams.js';
import { showCredentials, showCode, showRecovery, leaveSession } from './features/auth/index.js';
import { showCreateTeam } from './features/teams/picker.js';
import { startApp } from './app/shell.js';

const root = document.querySelector('#app');
let run = 0;

/** Garde de démarrage : choisit l'écran selon la session, l'activation et les espaces. */
async function route() {
  const current = ++run;
  if (isRecovering()) return showRecovery(root, route);
  const coach = getCoach();
  if (!coach) return showCredentials(root, 'login', route);
  if (!coach.activated) return showCode(root, coach, route, route);
  await listMyTeams();
  if (current !== run) return; // un routage plus récent a pris la main
  const team = getCurrentTeam();
  if (!team) return showCreateTeam(root, coach, route, () => leaveSession(route));
  setCurrentTeam(team.id);
  startApp(root, coach, team, route);
}

onCoachChange(route);
onPasswordRecovery(route);
try {
  await initSession();
  await route();
} catch {
  root.textContent = "Impossible de démarrer l'application. Vérifie ta connexion puis recharge la page.";
}
