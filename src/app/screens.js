/** Écran provisoire restant : les réglages hébergent la déconnexion, jusqu'à la tâche 17. */
import { registerScreen } from './shell.js';

/** Enregistre les réglages provisoires (Calendrier : features/calendar, Nageurs : features/contacts, Stats : features/stats, Perfs : features/perfs, Planif. : features/planning). */
export function registerPlaceholderScreens() {
  registerScreen('settings', {
    title: 'Réglages',
    render(root) {
      root.classList.add('screen');
      root.innerHTML = '<h1 class="screen-title">Réglages</h1><button type="button" class="btn-accent" data-action="logout">Se déconnecter</button>';
    },
  });
}
