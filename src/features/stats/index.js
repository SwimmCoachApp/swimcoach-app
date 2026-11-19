/**
 * Écran Stats : bilan du mois ou de la saison de l'espace ouvert, PDF.
 * Tout vient du store ; l'écran se redessine à chaque changement des séances, présences ou nageurs.
 */
import { on } from '../../app/actions.js';
import { registerScreen, currentTeamName } from '../../app/shell.js';
import { subscribe, onReset } from '../../core/store.js';
import { exportPdf } from '../pdf/index.js';
import { computeStats, periodLabel, seasonOfPeriod, shiftPeriod, currentMonth } from './logic.js';
import { screenHtml, pdfSubLabel, heroTexts, summaryHtml, swimmerRowsHtml, statsPdfHtml } from './view.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>';

/** Période affichée : gardée d'un affichage à l'autre, remise à zéro à la fermeture de l'espace. */
let period = null;

const ui = { root: null, unsubs: [] };
/** Dernier mois affiché avant de passer en saison : on y revient (club4 garde mois et saison séparés). */
let lastMonth = null;

function stop() {
  for (const off of ui.unsubs) off();
  ui.unsubs = [];
  ui.root = null;
}

const find = (id) => ui.root?.querySelector(`#${id}`) ?? null;

/** Redessine à chaque changement du store ; l'écran remplacé par un autre se désabonne et libère le graphique. */
function onStoreChange() {
  if (!ui.root) return;
  if (!ui.root.isConnected) {
    stop();
    return;
  }
  refresh();
}

function refresh() {
  if (!ui.root) return;
  const stats = computeStats(period);
  find('stat-month-label').textContent = periodLabel(period);
  find('stat-pdf-sub').textContent = pdfSubLabel(period);
  const hero = heroTexts(stats);
  find('stats-hero-km').innerHTML = `${hero.km}<span> km</span>`;
  find('stats-hero-sub').innerHTML = hero.sub;
  find('stats-summary').innerHTML = summaryHtml(stats);
  find('stats-swimmer-rows').innerHTML = swimmerRowsHtml(stats);
  for (const b of ui.root.querySelectorAll('.stats-mode-btn')) b.classList.toggle('active', b.dataset.key === period.scope);
}

function render(root) {
  stop();
  ui.root = root;
  period ??= currentMonth();
  root.innerHTML = screenHtml();
  refresh();
  ui.unsubs = ['sessions', 'presence', 'swimmers', 'groups'].map((t) => subscribe(t, onStoreChange));
}

function exportStats() {
  const stats = computeStats(period);
  const svg = document.querySelector('.top-bar-scene g[transform]')?.outerHTML ?? '';
  const label = periodLabel(period);
  exportPdf(statsPdfHtml(stats, { teamName: currentTeamName(), swimmerSvg: svg }), `Bilan ${label}`);
}

/** Enregistre l'écran Stats et ses actions. */
export function registerStatsScreen() {
  onReset(() => { period = null; lastMonth = null; stop(); });
  registerScreen('stats', { title: 'Stats', icon: ICON, render });
  on('stats-mode', (el) => {
    if (!period || el.dataset.key === period.scope) return;
    if (el.dataset.key === 'season') {
      lastMonth = period;
      period = { scope: 'season', y: seasonOfPeriod(period) };
    } else {
      period = lastMonth ?? currentMonth();
    }
    refresh();
  });
  on('stats-prev', () => { if (period) { period = shiftPeriod(period, -1); refresh(); } });
  on('stats-next', () => { if (period) { period = shiftPeriod(period, 1); refresh(); } });
  on('stats-pdf', () => { if (period) exportStats(); });
}
