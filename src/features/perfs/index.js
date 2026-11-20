/**
 * Écran Perfs : nageurs actifs et leurs perfs, fiche d'un nageur (meilleurs temps, historique, graphique de
 * progression), import d'une compétition liveffn, bilan PDF. Tout s'affiche à partir du store.
 */
import { on } from '../../app/actions.js';
import { registerScreen, openModal, closeModal, currentTeamName } from '../../app/shell.js';
import { toast } from '../../app/toast.js';
import { db, subscribe, onReset } from '../../core/store.js';
import { exportPdf } from '../pdf/index.js';
import { extractCompetitionId, shortEventLabel } from './parse.js';
import { importCompetition, progressionSeries, progressionInfo, formatDateFR, PerfsError } from './logic.js';
import { screenHtml, swimmersListHtml, detailParts, importPreviewHtml, bilanPdfHtml } from './view.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H4v1a3 3 0 0 0 4 2.8M16 6h4v1a3 3 0 0 1-4 2.8M12 13v4M8 20h8"/></svg>';

const ui = { root: null, unsubs: [], swimmerId: null, filters: { event: 'all', pool: 'all' }, preview: null, busy: false, chart: null, chartRun: 0 };

const el = (id) => ui.root?.querySelector(`#${id}`) ?? null;

function destroyChart() {
  ui.chartRun += 1; // un graphique en cours de chargement ne sera pas dessiné
  ui.chart?.destroy();
  ui.chart = null;
}

function stop() {
  for (const off of ui.unsubs) off();
  ui.unsubs = [];
  destroyChart();
  ui.root = null;
  ui.swimmerId = null;
  ui.preview = null;
  ui.busy = false;
}

// ── Liste et fiche ───────────────────────────────────────────────────

function showList() {
  ui.swimmerId = null;
  el('perfs-list-screen').hidden = false;
  el('perfs-detail-screen').hidden = true;
  el('perfs-swimmers-list').innerHTML = swimmersListHtml();
}

function renderDetail() {
  const sw = db.swimmers.get(ui.swimmerId);
  if (!sw) {
    showList();
    return;
  }
  el('perf-detail-name').textContent = `${sw.firstname} ${sw.lastname}`;
  const parts = detailParts(sw.id, ui.filters);
  const banner = el('perf-season-banner');
  banner.hidden = !parts.banner;
  if (parts.banner) {
    el('perf-season-value').textContent = parts.banner.value;
    el('perf-season-sub').textContent = parts.banner.sub;
    el('perf-season-period').textContent = parts.banner.period;
  }
  const evSel = el('perf-filter-event');
  evSel.innerHTML = parts.eventOptions;
  evSel.value = ui.filters.event;
  if (evSel.value !== ui.filters.event) { // épreuve disparue (perfs supprimées ailleurs) : toutes
    ui.filters.event = 'all';
    evSel.value = 'all';
    renderDetail();
    return;
  }
  el('perf-filter-pool').value = ui.filters.pool;
  el('perf-mt-list').innerHTML = parts.mt;
  el('perf-history-list').innerHTML = parts.history;
}

function openDetail(id) {
  if (!db.swimmers.has(id)) return;
  ui.swimmerId = id;
  ui.filters = { event: 'all', pool: 'all' };
  el('perfs-list-screen').hidden = true;
  el('perfs-detail-screen').hidden = false;
  renderDetail();
  ui.root.closest('#views')?.scrollTo?.(0, 0);
}

/** Redessine à chaque changement du store ; l'écran remplacé par un autre se désabonne et libère le graphique. */
function refresh() {
  if (!ui.root) return;
  if (!ui.root.isConnected) {
    stop();
    return;
  }
  if (ui.swimmerId) renderDetail();
  else el('perfs-swimmers-list').innerHTML = swimmersListHtml();
}

function render(root) {
  stop();
  ui.root = root;
  root.innerHTML = screenHtml();
  showList();
  ui.unsubs = ['performances', 'swimmers', 'groups'].map((t) => subscribe(t, refresh));
}

// ── Import d'une compétition ─────────────────────────────────────────

function showImportStep(preview) {
  ui.preview = preview;
  el('import-step-url').hidden = !!preview;
  const step = el('import-step-preview');
  step.hidden = !preview;
  step.innerHTML = preview ? importPreviewHtml(preview) : '';
  el('import-footer').hidden = !preview;
  const confirm = el('btn-confirm-import-comp');
  confirm.disabled = !preview || preview.matches.length === 0;
  confirm.textContent = '✅ Importer';
  const fetchBtn = el('btn-fetch-comp');
  fetchBtn.disabled = ui.busy; // une recherche encore en cours garde son bouton occupé
  fetchBtn.textContent = ui.busy ? '⏳ Chargement…' : '🔍 Rechercher';
}

on('perfs-open-import', () => {
  if (!ui.root) return;
  el('import-comp-url').value = '';
  showImportStep(null);
  openModal('modal-import-comp');
  el('import-comp-url').focus();
});
on('perfs-reset-import', () => {
  if (!ui.root) return;
  showImportStep(null);
  el('import-comp-url').focus();
});

on('perfs-fetch', async () => {
  if (!ui.root || ui.busy) return;
  const raw = el('import-comp-url').value.trim();
  if (!raw) {
    toast('Saisis une URL ou un ID');
    return;
  }
  const compId = extractCompetitionId(raw);
  if (!compId) {
    toast("Impossible de trouver l'ID de compétition");
    return;
  }
  const root = ui.root;
  const btn = el('btn-fetch-comp');
  ui.busy = true;
  btn.disabled = true;
  btn.textContent = '⏳ Chargement…';
  try {
    const preview = await importCompetition(compId);
    if (ui.root !== root) return; // écran quitté pendant la recherche
    ui.busy = false;
    showImportStep(preview);
  } catch (e) {
    if (ui.root !== root) return;
    ui.busy = false;
    btn.disabled = false;
    btn.textContent = '🔍 Rechercher';
    toast(e instanceof PerfsError ? e.message : 'Lecture de la page liveffn impossible');
  }
});

on('perfs-confirm-import', () => {
  const preview = ui.preview;
  if (!ui.root || !preview || preview.matches.length === 0) return;
  let n = 0;
  try {
    n = preview.confirm();
  } catch (e) {
    toast(e instanceof PerfsError ? e.message : 'Import impossible');
    return;
  }
  ui.preview = null;
  closeModal('modal-import-comp');
  toast(`✅ ${n} perf${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}`);
});

// ── Fiche : navigation, filtres, graphique, PDF ──────────────────────

on('perfs-open', (btn) => { if (ui.root) openDetail(btn.dataset.id); });
on('perfs-back', () => { if (ui.root) showList(); });
on('perfs-filter', () => {
  if (!ui.root || !ui.swimmerId) return;
  ui.filters = { event: el('perf-filter-event').value, pool: el('perf-filter-pool').value };
  renderDetail();
}, 'change');

/** Graphique de progression (club4 openChartModal) : Chart.js n'est chargé qu'ici. */
async function showChart(swimmerId, evCode, pool) {
  const sw = db.swimmers.get(swimmerId);
  if (!sw || !ui.root) return;
  destroyChart();
  const run = ui.chartRun;
  const series = progressionSeries(swimmerId, evCode, pool);
  el('chart-title').textContent = `${sw.firstname} ${sw.lastname} — ${shortEventLabel(evCode)}${pool ? ` (${pool})` : ''}`;
  el('chart-info').textContent = progressionInfo(series);
  openModal('modal-chart');
  if (series.length === 0) return;

  const labels = series.map((p) => (p.competition_date ? formatDateFR(p.competition_date).replace(/\s+\d{4}$/, '') : ''));
  const data = series.map((p) => p.time_ms / 1000);
  const tooltips = series.map((p) => p.time_display);
  // Format adaptatif : course de 2 min ou plus → mm:ss ; sinon ss.cc (médiane, robuste à un chrono isolé)
  const sorted = [...data].sort((a, b) => a - b);
  const useMinutes = (sorted[Math.floor(sorted.length / 2)] || 0) >= 120;
  const formatSec = (sec) => {
    if (sec == null || Number.isNaN(sec)) return '';
    if (useMinutes) {
      const mn = Math.floor(sec / 60);
      return `${mn}:${(sec - mn * 60).toFixed(1).padStart(4, '0')}`;
    }
    return `${sec.toFixed(2)}s`;
  };

  let Chart;
  try {
    ({ Chart } = await import('./chart.js'));
  } catch {
    if (run === ui.chartRun) el('chart-info').textContent = 'Graphique indisponible hors ligne';
    return;
  }
  const canvas = el('progress-chart');
  if (run !== ui.chartRun || !canvas) return; // fermé, remplacé ou espace changé pendant le chargement
  const css = getComputedStyle(document.documentElement);
  const text2 = css.getPropertyValue('--text2').trim() || '#64748b';
  const grid = css.getPropertyValue('--border').trim() || '#E3E8F0';
  ui.chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Temps',
        data,
        borderColor: 'rgb(239, 68, 68)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 2.5,
        tension: 0.2,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: 'rgb(239, 68, 68)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => tooltips[c.dataIndex] || formatSec(c.parsed.y) } },
      },
      scales: {
        y: {
          reverse: false, // les temps plus bas = meilleurs : descendre, c'est progresser
          title: { display: true, text: useMinutes ? 'Temps (min:sec)' : 'Temps (sec)', color: text2 },
          ticks: { callback: (v) => formatSec(v), color: text2 },
          grid: { color: grid },
        },
        x: { ticks: { maxRotation: 45, minRotation: 0, color: text2 }, grid: { color: grid } },
      },
    },
  });
}

on('perfs-splits', (row) => {
  const panel = ui.root?.querySelector(`#splits-${CSS.escape(row.dataset.id)}`);
  if (!panel) return;
  panel.hidden = !panel.hidden;
  row.setAttribute('aria-expanded', String(!panel.hidden));
});
on('perfs-chart', (btn) => {
  if (!ui.root || !ui.swimmerId) return;
  showChart(ui.swimmerId, btn.dataset.event, btn.dataset.pool);
});

on('perfs-pdf', () => {
  if (!ui.root || !ui.swimmerId) {
    toast('Aucun nageur sélectionné');
    return;
  }
  const sw = db.swimmers.get(ui.swimmerId);
  if (!sw) {
    toast('Nageur introuvable');
    return;
  }
  if (![...db.performances.values()].some((p) => p.swimmer_id === sw.id)) {
    toast('Aucune perf à exporter');
    return;
  }
  const swimmerSvg = document.querySelector('.top-bar-scene g[transform]')?.outerHTML ?? '';
  exportPdf(bilanPdfHtml(sw.id, { teamName: currentTeamName(), swimmerSvg }), `Perfs ${sw.firstname} ${sw.lastname}`);
});

/** Enregistre l'écran Perfs (remplace l'écran provisoire). */
export function registerPerfsScreen() {
  onReset(stop); // changement d'espace : graphique détruit, aperçu oublié
  registerScreen('perfs', { title: 'Perfs', icon: ICON, render });
}
