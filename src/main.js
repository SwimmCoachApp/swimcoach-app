import './styles/auth.css';
import { initSession, getCoach, onCoachChange, onPasswordRecovery, isRecovering, configureSession } from './core/session.js';
import { listMyTeams, getCurrentTeam, setCurrentTeam } from './core/teams.js';
import { pendingCount } from './core/outbox.js';
import { configureSync, openTeam, closeTeam } from './core/sync.js';
import { showCredentials, showCode, showRecovery, leaveSession } from './features/auth/index.js';
import { showCreateTeam } from './features/teams/picker.js';
import { startApp } from './app/shell.js';

const root = document.querySelector('#app');
let run = 0;

// signOut renvoie 'pending' tant que la file d'attente de l'entraîneur n'est pas vide.
configureSession({ getPendingCount: (coachId) => pendingCount(undefined, coachId) });
// Accès à l'espace ouvert perdu : on reprend le routage (autre espace ou « Crée ton espace »).
configureSync({ onTeamLost: () => route() });

/** Garde de démarrage : choisit l'écran selon la session, l'activation et les espaces. */
async function route() {
  const current = ++run;
  const coach = getCoach();
  if (isRecovering() || !coach?.activated) closeTeam();
  if (isRecovering()) return showRecovery(root, route);
  if (!coach) return showCredentials(root, 'login', route);
  if (!coach.activated) return showCode(root, coach, route, route);
  await listMyTeams();
  if (current !== run) return; // un routage plus récent a pris la main
  const team = getCurrentTeam();
  if (!team) {
    closeTeam();
    return showCreateTeam(root, coach, route, () => leaveSession(route));
  }
  setCurrentTeam(team.id);
  openTeam(coach.id, team).catch(() => {}); // cache local tout de suite, synchro en arrière-plan
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
