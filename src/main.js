import '@fontsource/bricolage-grotesque/latin-400.css';
import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/contacts.css'; // avant club.css : l'habillage Club surcharge les bases
import './styles/calendar.css';
import './styles/presence.css';
import './styles/stats.css';
import './styles/club.css';
import './styles/auth.css';
import { initSession, getCoach, onCoachChange, onPasswordRecovery, isRecovering, configureSession } from './core/session.js';
import { listMyTeams, getCurrentTeam, setCurrentTeam } from './core/teams.js';
import { pendingCount, flushCoach } from './core/outbox.js';
import { supabase } from './core/supabase.js';
import { ensureDefaultGroups } from './core/default-groups.js';
import { configureSync, openTeam, closeTeam } from './core/sync.js';
import { showCredentials, showCode, showRecovery, leaveSession } from './features/auth/index.js';
import { showCreateTeam } from './features/teams/picker.js';
import { startApp } from './app/shell.js';
import { registerPlaceholderScreens } from './app/screens.js';
import { registerContactsScreen } from './features/contacts/index.js';
import { registerCalendarScreen } from './features/calendar/index.js';
import { registerStatsScreen } from './features/stats/index.js';
import { registerPresence } from './features/presence/index.js';
import { initTheme } from './app/theme.js';
import { toast } from './app/toast.js';
import { initUpdate } from './app/update.js';

const root = document.querySelector('#app');
let run = 0;

// signOut envoie d'abord la file (en ligne, 3 s au plus) ; 'pending' s'il reste des écritures.
configureSession({ getPendingCount: (coachId) => pendingCount(undefined, coachId), flushPending: (coachId) => flushCoach(supabase, coachId) });
// Accès à l'espace ouvert perdu : on reprend le routage (autre espace ou « Crée ton espace »).
configureSync({ toast, onTeamLost: () => route(), onSynced: ensureDefaultGroups });
initTheme();
registerPlaceholderScreens();
registerContactsScreen();
registerCalendarScreen();
registerPresence();
registerStatsScreen();
initUpdate();

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
