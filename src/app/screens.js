/** Écrans provisoires : les tâches suivantes les remplacent par les vrais écrans (registerScreen). */
import { html, raw } from '../core/html.js';
import { currentTeamName, registerScreen } from './shell.js';

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  contacts: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.5 0 4 1.8 4 4.5"/>'),
  stats: svg('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
  perfs: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H4v1a3 3 0 0 0 4 2.8M16 6h4v1a3 3 0 0 1-4 2.8M12 13v4M8 20h8"/>'),
  planning: svg('<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
};

const TITLES = { calendar: 'Calendrier', contacts: 'Nageurs', stats: 'Stats', perfs: 'Perfs', planning: 'Planification' };

/** Enregistre un écran provisoire. */
function placeholder(name, extra = '') {
  registerScreen(name, {
    title: TITLES[name],
    icon: ICONS[name],
    render(root) {
      root.classList.add('screen');
      root.innerHTML = html`<h1 class="screen-title">${TITLES[name]}</h1>${name === 'calendar' ? raw(html`<p>${currentTeamName()}</p>`) : ''}`;
      if (extra) root.insertAdjacentHTML('beforeend', extra);
    },
  });
}

/** Enregistre les six écrans (réglages hébergé provisoirement la déconnexion, jusqu'à la tâche 17). */
export function registerPlaceholderScreens() {
  for (const name of Object.keys(ICONS)) placeholder(name);
  registerScreen('settings', {
    title: 'Réglages',
    render(root) {
      root.classList.add('screen');
      root.innerHTML = '<h1 class="screen-title">Réglages</h1><button type="button" class="btn-accent" data-action="logout">Se déconnecter</button>';
    },
  });
}
