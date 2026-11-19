/**
 * Écran Stats : bilan du mois ou de la saison de l'espace ouvert, graphique de progression des km, PDF.
 * Tout vient du store ; l'écran se redessine à chaque changement des séances, présences ou nageurs.
 */
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler } from 'chart.js';
import { on } from '../../app/actions.js';
import { registerScreen, currentTeamName } from '../../app/shell.js';
import { subscribe, onReset } from '../../core/store.js';
import { exportPdf } from '../pdf/index.js';
import { computeStats, periodLabel, seasonOfPeriod, shiftPeriod, currentMonth } from './logic.js';
import { screenHtml, pdfSubLabel, heroTexts, summaryHtml, swimmerRowsHtml, statsPdfHtml } from './view.js';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler);

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>';

/** Période affichée : gardée d'un affichage à l'autre, remise à zéro à la fermeture de l'espace. */
let period = null;

const ui = { root: null, unsubs: [], chart: null, drawn: '' };

function destroyChart() {
  ui.chart?.destroy();
  ui.chart = null;
  ui.drawn = '';
}

function stop() {
  for (const off of ui.unsubs) off();
  ui.unsubs = [];
  destroyChart();
  ui.root = null;
}

const find = (id) => ui.root?.querySelector(`#${id}`) ?? null;

function drawChart(stats) {
  const key = JSON.stringify([stats.period, stats.series]);
  if (ui.chart && key === ui.drawn) return; // rien n'a changé : le graphique reste en place
  destroyChart();
  ui.drawn = key;
  const canvas = find('stats-chart');
  if (!canvas) return;
  const isSeason = stats.period.scope === 'season';
  find('stats-chart-title').textContent = isSeason ? 'Progression · km par mois' : 'Progression · km par jour';
  const style = getComputedStyle(document.documentElement);
  const accent = '#0A8FAE';
  const text = style.getPropertyValue('--text2').trim() || '#4A5D80';
  const data = {
    labels: stats.series.map((p) => p.label),
    datasets: [{
      label: 'km',
      data: stats.series.map((p) => Math.round(p.km * 10) / 10),
      borderColor: accent,
      backgroundColor: isSeason ? `${accent}CC` : `${accent}33`,
      borderRadius: 6,
      fill: !isSeason,
      tension: 0.3,
      pointRadius: 3,
    }],
  };
  ui.chart = new Chart(canvas, {
    type: isSeason ? 'bar' : 'line',
    data,
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: text }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: text }, grid: { color: `${text}22` } },
      },
    },
  });
}

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
  drawChart(stats);
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
  onReset(() => { period = null; stop(); }); // changement d'espace : le graphique de l'ancien espace est libéré
  registerScreen('stats', { title: 'Stats', icon: ICON, render });
  on('stats-mode', (el) => {
    if (!period || el.dataset.key === period.scope) return;
    if (el.dataset.key === 'season') {
      period = { scope: 'season', y: seasonOfPeriod(period) };
    } else {
      const now = currentMonth();
      period = seasonOfPeriod(now) === period.y ? now : { scope: 'month', y: period.y, m0: 8 }; // saison passée : septembre
    }
    refresh();
  });
  on('stats-prev', () => { if (period) { period = shiftPeriod(period, -1); refresh(); } });
  on('stats-next', () => { if (period) { period = shiftPeriod(period, 1); refresh(); } });
  on('stats-pdf', () => { if (period) exportStats(); });
}
