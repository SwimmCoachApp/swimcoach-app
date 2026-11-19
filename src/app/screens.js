/** Écrans provisoires : les tâches suivantes les remplacent par les vrais écrans (registerScreen). */
import { html } from '../core/html.js';
import { registerScreen } from './shell.js';

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  perfs: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H4v1a3 3 0 0 0 4 2.8M16 6h4v1a3 3 0 0 1-4 2.8M12 13v4M8 20h8"/>'),
  planning: svg('<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
};

const TITLES = { perfs: 'Perfs', planning: 'Planification' };

/** Enregistre un écran provisoire. */
function placeholder(name, extra = '') {
  registerScreen(name, {
    title: TITLES[name],
    icon: ICONS[name],
    render(root) {
      root.classList.add('screen');
      root.innerHTML = html`<h1 class="screen-title">${TITLES[name]}</h1>`;
      if (extra) root.insertAdjacentHTML('beforeend', extra);
    },
  });
}

/** Enregistre les écrans provisoires restants (Calendrier : features/calendar, Nageurs : features/contacts, Stats : features/stats). Les réglages hébergent provisoirement la déconnexion, jusqu'à la tâche 17. */
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
