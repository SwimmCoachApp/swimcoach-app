/** Gabarits HTML des performances (écran, aperçu d'import) et du bilan PDF « Club ». Toute valeur passe par `html` (échappée). */
import { html, raw } from '../../core/html.js';
import { db } from '../../core/store.js';
import { currentSeason, seasonOfDateKey } from '../../core/season.js';
import { listSwimmers, groupLabel } from '../contacts/logic.js';
import { shortEventLabel } from './parse.js';
import { perfsOf, seasonRange, swimmerSeasonPoints, swimmerSeasonRaces, bestTimes, byDateDesc, formatDateFR } from './logic.js';

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const initials = (sw) => `${(sw.firstname || '').charAt(0)}${(sw.lastname || '').charAt(0)}`.toUpperCase();
const fmtPts = (n) => n.toLocaleString('fr-FR');
const poolClass = (pool) => (pool === '25m' ? '25' : pool === '50m' ? '50' : '');
const phaseLabel = (phase) => phase.replace('_', ' ');

/** @returns {string} structure de l'écran : liste, fiche, feuilles d'import et de graphique */
export function screenHtml() {
  return html`<div class="perfs-screen">
    <div id="perfs-list-screen">
      <div class="perfs-header">
        <h1 class="perfs-title">🏆 Performances</h1>
        <button type="button" class="perfs-import-btn" data-action="perfs-open-import"><span aria-hidden="true">📥</span><span>Importer une compétition</span></button>
      </div>
      <div id="perfs-swimmers-list"></div>
      <div class="section-gap"></div>
    </div>
    <div id="perfs-detail-screen" hidden>
      <div class="perfs-detail-header">
        <button type="button" class="perfs-back-btn" data-action="perfs-back" aria-label="Retour à la liste">‹</button>
        <h1 class="perfs-detail-title" id="perf-detail-name"></h1>
        <div class="perfs-detail-actions">
          <button type="button" class="perfs-detail-action" data-action="perfs-pdf" aria-label="Exporter le bilan PDF" title="Exporter PDF">📄</button>
        </div>
      </div>
      <div class="perf-season-banner" id="perf-season-banner" hidden>
        <div class="perf-season-icon" aria-hidden="true">⭐</div>
        <div class="perf-season-info">
          <div class="perf-season-label">Total points de la saison</div>
          <div class="perf-season-value" id="perf-season-value">0</div>
          <div class="perf-season-sub" id="perf-season-sub"></div>
        </div>
        <div class="perf-season-period" id="perf-season-period"></div>
      </div>
      <div class="perfs-filters">
        <select class="perfs-filter-select" id="perf-filter-event" data-action="perfs-filter" data-on="change" aria-label="Épreuve"></select>
        <select class="perfs-filter-select" id="perf-filter-pool" data-action="perfs-filter" data-on="change" aria-label="Bassin">
          <option value="all">Tous bassins</option>
          <option value="25">25m</option>
          <option value="50">50m</option>
        </select>
      </div>
      <div class="perfs-legend">
        <span class="legend-item"><span class="legend-swatch swim-25"></span>25m</span>
        <span class="legend-item"><span class="legend-swatch swim-50"></span>50m</span>
      </div>
      <h2 class="perfs-section-label">🏅 Meilleurs temps</h2>
      <div id="perf-mt-list"></div>
      <h2 class="perfs-section-label">📋 Historique des courses</h2>
      <div id="perf-history-list"></div>
      <div class="section-gap"></div>
    </div>
    <div class="modal-overlay" id="modal-import-comp" data-action="close-backdrop">
      <div class="modal-sheet" role="dialog" aria-label="Importer une compétition">
        <div class="modal-handle"></div>
        <div class="modal-header"><div class="modal-title">📥 Importer une compétition</div><button type="button" class="modal-close" data-action="close-modal" data-id="modal-import-comp" aria-label="Fermer">✕</button></div>
        <div class="modal-body">
          <div id="import-step-url">
            <div class="form-group">
              <label class="form-label" for="import-comp-url">URL liveffn ou ID compétition</label>
              <input type="text" class="form-input" id="import-comp-url" placeholder="ex: 92968 ou URL complète" autocomplete="off" inputmode="url">
              <div class="import-comp-hint">Va sur liveffn.com, trouve ta compétition, clique « Résultats par structures » pour TOAC, copie l'URL ici.</div>
            </div>
            <button type="button" class="btn-full btn-accent" id="btn-fetch-comp" data-action="perfs-fetch">🔍 Rechercher</button>
          </div>
          <div id="import-step-preview" hidden></div>
        </div>
        <div class="modal-footer" id="import-footer" hidden>
          <button type="button" class="btn-full btn-ghost" data-action="perfs-reset-import">← Nouvelle recherche</button>
          <button type="button" class="btn-full btn-accent" id="btn-confirm-import-comp" data-action="perfs-confirm-import">✅ Importer</button>
        </div>
      </div>
    </div>
    <div class="modal-overlay" id="modal-chart" data-action="close-backdrop">
      <div class="modal-sheet" role="dialog" aria-label="Progression">
        <div class="modal-handle"></div>
        <div class="modal-header"><div class="modal-title" id="chart-title">Progression</div><button type="button" class="modal-close" data-action="close-modal" data-id="modal-chart" aria-label="Fermer">✕</button></div>
        <div class="modal-body">
          <div class="perf-chart-box"><canvas id="progress-chart" role="img" aria-label="Graphique de progression"></canvas></div>
          <div class="perf-chart-info" id="chart-info" aria-live="polite"></div>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * Liste des nageurs actifs avec leur nombre de perfs et leurs points de la saison.
 * @param {Date} [now]
 */
export function swimmersListHtml(now = new Date()) {
  const actives = listSwimmers({ filter: 'actifs' });
  if (actives.length === 0) return '<div class="perfs-empty-msg"><div class="em-icon">👥</div>Aucun nageur actif dans ton groupe.</div>';
  const counts = new Map();
  for (const p of db.performances.values()) if (p.status === 'ok') counts.set(p.swimmer_id, (counts.get(p.swimmer_id) ?? 0) + 1);
  const season = seasonRange(now);
  return actives.map((sw) => {
    const nb = counts.get(sw.id) ?? 0;
    const pts = swimmerSeasonPoints(sw.id, season);
    return html`<button type="button" class="perf-swimmer-card" data-action="perfs-open" data-id="${sw.id}">
      <span class="stat-swimmer-avatar">${initials(sw)}</span>
      <span class="perf-swimmer-info">
        <span class="perf-swimmer-name">${sw.firstname} ${sw.lastname}</span>
        <span class="perf-swimmer-sub">${plural(nb, 'perf')} ${nb > 1 ? 'enregistrées' : 'enregistrée'}</span>
        ${pts > 0 ? raw(html`<span class="perf-season-points">⭐ ${fmtPts(pts)} pts saison ${season.label}</span>`) : ''}
      </span>
      <span class="perf-count-badge${nb > 0 ? '' : ' empty'}">${nb}</span>
      <span class="perf-chevron" aria-hidden="true">›</span>
    </button>`;
  }).join('');
}

/**
 * Contenu de la fiche d'un nageur, d'après les filtres.
 * @param {string} swimmerId
 * @param {{event: string, pool: string}} filters
 * @param {Date} [now]
 * @returns {{banner: null|{value: string, sub: string, period: string}, eventOptions: string, mt: string, history: string}}
 */
export function detailParts(swimmerId, filters, now = new Date()) {
  const perfs = perfsOf(swimmerId);
  const season = seasonRange(now);
  const pts = swimmerSeasonPoints(swimmerId, season);
  const races = swimmerSeasonRaces(swimmerId, season);
  const banner = pts > 0 || races > 0
    ? { value: `${fmtPts(pts)} pts`, sub: `Sur ${plural(races, 'course')} ${races > 1 ? 'chronométrées' : 'chronométrée'}`, period: season.label }
    : null;

  const codes = [...new Set(perfs.map((p) => String(p.event_code)).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const eventOptions = html`<option value="all">Toutes épreuves</option>${codes.map((c) => raw(html`<option value="${c}">${shortEventLabel(c)}</option>`))}`;

  let filtered = perfs;
  if (filters.event !== 'all') filtered = filtered.filter((p) => String(p.event_code) === String(filters.event));
  if (filters.pool !== 'all') filtered = filtered.filter((p) => p.pool === `${filters.pool}m`);

  const best = bestTimes(filtered);
  const mt = best.length === 0
    ? '<div class="perfs-empty-msg small">Aucun chrono enregistré.</div>'
    : best.map((p) => {
      const pc = poolClass(p.pool);
      const label = shortEventLabel(p.event_code);
      return html`<div class="perf-mt-row${pc ? ` pool-row-${pc}` : ''}">
        <div class="perf-mt-event">${label}</div>
        <span class="perf-mt-pool${pc ? ` pool-${pc}` : ''}">${p.pool || '?'}</span>
        <div class="perf-mt-time">${p.time_display}</div>
        <button type="button" class="perf-chart-btn" data-action="perfs-chart" data-event="${p.event_code}" data-pool="${p.pool || ''}" aria-label="Progression ${label} ${p.pool || ''}">📈</button>
      </div>`;
    }).join('');

  const bestIds = new Set(best.map((p) => p.id));
  const hist = filtered.slice().sort(byDateDesc);
  const history = hist.length === 0
    ? '<div class="perfs-empty-msg"><div class="em-icon">🏊</div>Aucune course enregistrée.<br><span class="em-sub">Importe une compétition pour voir les chronos.</span></div>'
    : hist.map((p) => {
      const isBest = bestIds.has(p.id);
      const pc = poolClass(p.pool);
      const rank = p.rank == null ? '' : html`<span class="perf-rank-badge${p.rank <= 3 ? ` podium${p.rank}` : ''}">${p.rank}${p.rank === 1 ? 'er' : 'e'}</span>`;
      const timeCls = `perf-history-time${isBest ? ' best' : ''}${p.status === 'dsq' ? ' dsq' : ''}${p.status === 'dns' || p.status === 'dnf' ? ' dns' : ''}`;
      return html`<div class="perf-history-row${isBest ? ' is-best' : ''}${pc ? ` pool-row-${pc}` : ''}">
        <div class="perf-history-main">
          <div class="perf-history-event">${isBest ? raw('<span class="perf-best-star">🏆</span>') : ''}${shortEventLabel(p.event_code)}
            <span class="perf-mt-pool${pc ? ` pool-${pc}` : ''}">${p.pool || '?'}</span>
            ${p.phase && p.phase !== 'series' ? raw(html`<span class="perf-phase">${phaseLabel(p.phase)}</span>`) : ''}
          </div>
          <div class="perf-history-meta">${p.competition_date ? formatDateFR(p.competition_date) : ''} · ${p.competition_name || ''}${rank ? raw(` · ${rank}`) : ''}${p.points ? raw(html` · <span class="perf-points">${p.points} pts</span>`) : ''}</div>
        </div>
        <div class="${timeCls}">${p.time_display || '—'}</div>
      </div>`;
    }).join('');

  return { banner, eventOptions, mt, history };
}

/**
 * Aperçu d'une compétition avant import.
 * @param {{parsed: object, matches: object[], ignoredArchived: object[], perfCount: number, merged?: number}} preview
 * @returns {string}
 */
export function importPreviewHtml(preview) {
  const p = preview.parsed.competition;
  const ign = preview.ignoredArchived;
  const n = preview.perfCount;
  const summary = `${plural(n, 'perf')}${ign.length ? `, 📦 ${ign.length} ${ign.length > 1 ? 'archivés ignorés' : 'archivé ignoré'}` : ''}`;
  const ignHtml = ign.length
    ? html`<div class="import-match-sub import-ignored">📦 ${plural(ign.length, 'nageur')} ${ign.length > 1 ? 'archivés ignorés' : 'archivé ignoré'} : ${ign.map((w) => `${w.firstname} ${w.lastname}`).join(', ')}</div>`
    : '';
  const rows = preview.matches.map((m) => {
    const nb = m.perfs.length;
    const valid = m.perfs.filter((x) => x.status === 'ok').length;
    return html`<div class="import-match-row">
      <div class="import-match-check" aria-hidden="true">✓</div>
      <div class="import-match-info">
        <div class="import-match-name">${m.swimmer.firstname} ${m.swimmer.lastname}</div>
        <div class="import-match-sub">${plural(nb, 'course')} — ${plural(valid, 'chrono')} ${valid > 1 ? 'enregistrés' : 'enregistré'}</div>
      </div>
    </div>`;
  }).join('');
  return html`<div class="import-comp-info">
      <div class="ic-name">${p.name}</div>
      ${p.date ? raw(html`<div class="ic-date">${formatDateFR(p.date)}</div>`) : ''}
      ${p.pool ? raw(html`<span class="ic-pool">Bassin ${p.pool}m</span>`) : ''}
    </div>
    <div class="import-summary" id="import-summary">${summary}</div>
    ${preview.merged ? raw(html`<div class="import-match-sub import-merged">${plural(preview.merged, 'résultat')} ${preview.merged > 1 ? 'regroupés' : 'regroupé'} (même épreuve et même phase)</div>`) : ''}
    <h3 class="perfs-section-label">Nageurs trouvés dans ton groupe</h3>
    <div id="import-matches-list">${raw(ignHtml)}${raw(rows)}</div>
    ${preview.matches.length === 0 ? raw('<div class="import-empty">Aucun de tes nageurs n\'a participé à cette compétition.</div>') : ''}`;
}

// ───────────── Bilan PDF (style Club, club4 exportSwimmerPerfsPDF) ─────────────

const WAVE1 = 'M0 128 q20 -7 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V160 H0Z';
const WAVE2 = 'M0 142 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V160 H0Z';

const PDF_CSS = `
  *{margin:0;padding:0;box-sizing:border-box;}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:'Inter',sans-serif;color:#0A1F44;background:#fff;padding:28px;font-size:12px;line-height:1.5;}
  .pdf-toolbar{display:flex;gap:8px;margin-bottom:16px;}
  .tb-btn{padding:9px 18px;border:none;border-radius:999px;font-family:'Inter',sans-serif;font-size:13px;font-weight:700;cursor:pointer;}
  .tb-print{background:#FF5A36;color:#fff;}
  .tb-close{background:#F3F5F9;color:#0A1F44;border:1px solid #CBD5E1;}
  .hero{position:relative;background:#0A1F44;border-radius:22px;padding:26px 30px 24px;min-height:156px;overflow:hidden;color:#fff;display:flex;justify-content:space-between;align-items:flex-start;margin:0 0 18px;}
  .hero-scene{position:absolute;left:0;top:0;width:100%;height:100%;}
  .hero-left,.hero-right{position:relative;}
  .hero-brand{font-family:'Bricolage Grotesque',sans-serif;font-size:14px;font-weight:700;letter-spacing:.3px;}
  .hero-brand span{color:#38D1F0;} .hero-brand i{font-style:normal;font-weight:600;color:#A9B8D4;margin-left:4px;}
  .hero-left h1{font-family:'Bricolage Grotesque',sans-serif;font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1.05;margin-top:10px;}
  .hero-sub{font-size:12px;font-weight:600;color:#C9D4EA;margin-top:8px;}
  .hero-right{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px;}
  .hero-label{font-size:11px;font-weight:700;letter-spacing:1.3px;color:#A9B8D4;}
  .hero-km{font-family:'Bricolage Grotesque',sans-serif;font-size:62px;font-weight:800;letter-spacing:-2.5px;line-height:1;color:#38D1F0;}
  .hero-km small{font-size:24px;letter-spacing:0;color:#fff;font-weight:700;}
  .hero-note{font-size:12px;font-weight:600;color:#fff;}
  .kpis{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;}
  .kpi{flex:1;min-width:150px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 18px;border-radius:999px;font-size:12px;font-weight:700;}
  .kpi b{font-family:'Bricolage Grotesque',sans-serif;font-size:22px;font-weight:800;white-space:nowrap;}
  .kpi-nat{background:#E6F8FC;color:#0A6B84;} .kpi-nat b{color:#0A8FAE;}
  .kpi-musc{background:#FFEDE6;color:#9A3412;} .kpi-musc b{color:#C2410C;}
  .kpi-comp{background:#EFE9FF;color:#5B21B6;} .kpi-comp b{color:#6C3BF5;}
  h2{font-family:'Bricolage Grotesque',sans-serif;font-size:18px;font-weight:800;letter-spacing:-.4px;color:#0A1F44;margin:20px 0 6px;break-after:avoid;page-break-after:avoid;}
  table{width:100%;border-collapse:collapse;margin-bottom:14px;}
  thead th{background:#0A1F44;color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}
  tbody td{padding:7px 10px;border-bottom:1px solid #E3E8F0;font-size:11px;vertical-align:middle;}
  tbody tr.is-best{background:#FFF6D6;}
  tbody tr.mt-row{background:#F1FBFD;}
  .col-date{white-space:nowrap;color:#475569;width:90px;}
  .col-comp{max-width:180px;overflow:hidden;text-overflow:ellipsis;}
  .col-event{white-space:nowrap;}
  .col-pool{width:38px;text-align:center;}
  .col-time{width:80px;white-space:nowrap;font-family:'Bricolage Grotesque',sans-serif;font-size:13px;font-weight:800;}
  .col-rank{width:52px;text-align:center;}
  .col-pts{width:48px;text-align:center;color:#64748b;}
  thead th.col-date,thead th.col-pts{color:#fff;}
  thead th.col-time{font-family:'Inter',sans-serif;font-size:10px;font-weight:700;}
  .pool-pill{display:inline-block;padding:1px 7px;background:#E6F8FC;color:#0A6B84;border-radius:999px;font-size:9px;font-weight:700;}
  .phase-pill{display:inline-block;padding:1px 6px;background:#F3F5F9;color:#64748b;border-radius:999px;font-size:8px;font-weight:700;text-transform:uppercase;margin-left:3px;}
  .rank-badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;}
  .rank-badge.rk1{background:#FEF3C7;color:#92400E;}
  .rank-badge.rk2{background:#E5E7EB;color:#374151;}
  .rank-badge.rk3{background:#FED7AA;color:#9A3412;}
  .tm-bad{color:#B91C1C;font-weight:700;font-size:10px;}
  .foot{margin-top:22px;padding-top:10px;border-top:1px solid #E3E8F0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;}
  .points-banner{margin:16px 0;padding:14px 20px;background:#E6F8FC;border:1.5px solid #38D1F0;border-radius:18px;display:flex;align-items:center;gap:14px;}
  .pts-icon{font-size:30px;flex-shrink:0;}
  .pts-content{flex:1;}
  .pts-main{display:flex;align-items:center;gap:18px;}
  .pts-block{flex:1;}
  .pts-val{font-family:'Bricolage Grotesque',sans-serif;font-size:28px;font-weight:800;color:#0A8FAE;line-height:1;}
  .pts-val-total{color:#6C3BF5;}
  .pts-lbl{font-size:11px;font-weight:700;color:#0A1F44;text-transform:uppercase;letter-spacing:.5px;margin-top:3px;}
  .pts-sub{font-size:10px;color:#0A6B84;margin-top:2px;}
  .pts-divider{width:1px;height:42px;background:#8FDDEE;}
  .section-hint{font-size:10.5px;color:#64748b;font-style:italic;margin:0 0 8px;break-after:avoid;page-break-after:avoid;}
  .season-pill{display:inline-block;padding:2px 9px;background:#E6F8FC;color:#0A6B84;border:1px solid #67D5EA;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.3px;}
  .pool-section{margin-bottom:14px;border:1px solid #E3E8F0;border-radius:16px;overflow:hidden;}
  .pool-header{padding:8px 16px;font-size:12px;font-weight:700;letter-spacing:.5px;color:#fff;text-transform:uppercase;}
  .pool-header.pool-25{background:#0A8FAE;}
  .pool-header.pool-50{background:#0A1F44;}
  .pool-header.pool-other{background:#64748B;}
  .pool-table{margin-bottom:0;}
  .pool-table thead th{background:#F3F5F9;color:#0A1F44;font-size:10px;padding:6px 10px;}
  .empty-row{text-align:center;color:#94a3b8;padding:14px;font-size:11px;}
  tbody tr.is-record{background:#FFFBEB;}
  tbody tr.is-record .record-star{font-size:11px;}
  @page{size:A4;margin:0;}
  @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;} body{padding:14mm;} .pdf-toolbar{display:none !important;}}`;

const seasonLabelOf = (s) => (s == null ? '—' : `${s}–${String(s + 1).slice(2)}`);
const perfSeason = (p) => (p.competition_date ? seasonOfDateKey(p.competition_date) : null);
const dateCell = (p) => (p.competition_date ? formatDateFR(p.competition_date) : '—');

function rankHtml(rank) {
  if (rank == null) return '—';
  if (rank === 1) return '<span class="rank-badge rk1">1<sup>er</sup></span>';
  if (rank === 2) return '<span class="rank-badge rk2">2<sup>e</sup></span>';
  if (rank === 3) return '<span class="rank-badge rk3">3<sup>e</sup></span>';
  return html`${rank}<sup>e</sup>`;
}

function timeHtml(p, isBest) {
  if (p.status === 'dsq') return '<span class="tm-bad">DSQ</span>';
  if (p.status === 'dns') return '<span class="tm-bad">DNS</span>';
  if (p.status === 'dnf') return '<span class="tm-bad">DNF</span>';
  return html`<strong>${p.time_display || '—'}</strong>${isBest ? ' 🏆' : ''}`;
}

function histRow(p, bestIds) {
  const isBest = bestIds.has(p.id);
  return html`<tr class="${isBest ? 'is-best' : ''}">
      <td class="col-date">${dateCell(p)}</td>
      <td class="col-comp">${p.competition_name || ''}</td>
      <td class="col-event">${shortEventLabel(p.event_code)}${p.phase && p.phase !== 'series' ? raw(html` <span class="phase-pill">${phaseLabel(p.phase)}</span>`) : ''}</td>
      <td class="col-pool"><span class="pool-pill">${p.pool || '?'}</span></td>
      <td class="col-time">${raw(timeHtml(p, isBest))}</td>
      <td class="col-rank">${raw(rankHtml(p.rank))}</td>
      <td class="col-pts">${p.points ? p.points : '—'}</td>
    </tr>`;
}

/** Un tableau par bassin (25 m, 50 m, autre s'il y en a). */
function poolSections(list, lastCol, rowFn, emptySuffix) {
  const head = html`<thead><tr><th>Épreuve</th><th class="col-time">Temps</th><th class="col-date">Date</th><th class="${lastCol === 'Saison' ? 'col-season' : 'col-rank'}">${lastCol}</th></tr></thead>`;
  const section = (cls, title, rows, empty) => html`<div class="pool-section">
      <div class="pool-header ${cls}">${title}</div>
      <table class="pool-table">${raw(head)}<tbody>${raw(rows.length ? rows.map(rowFn).join('') : html`<tr><td colspan="4" class="empty-row">${empty}</td></tr>`)}</tbody></table>
    </div>`;
  const p25 = list.filter((p) => (p.pool || '') === '25m');
  const p50 = list.filter((p) => (p.pool || '') === '50m');
  const other = list.filter((p) => (p.pool || '') !== '25m' && (p.pool || '') !== '50m');
  return section('pool-25', '🟢 Bassin 25m', p25, `Aucun temps en bassin 25m${emptySuffix}`)
    + section('pool-50', '🔵 Bassin 50m', p50, `Aucun temps en bassin 50m${emptySuffix}`)
    + (other.length ? section('pool-other', '⚪ Autre bassin', other, '') : '');
}

/**
 * Bilan individuel des performances, fiche A4 « Club » (club4 exportSwimmerPerfsPDF) : records tous temps et de la
 * saison par bassin, historique de la saison, points.
 * @param {string} swimmerId
 * @param {{teamName?: string, swimmerSvg?: string, now?: Date}} [opts] swimmerSvg : SVG de confiance du nageur du bandeau
 * @returns {string|null} document HTML complet (sans script) ; null si le nageur est inconnu
 */
export function bilanPdfHtml(swimmerId, { teamName = '', swimmerSvg = '', now = new Date() } = {}) {
  const sw = db.swimmers.get(swimmerId);
  if (!sw) return null;
  const perfs = perfsOf(swimmerId);
  const okPerfs = perfs.filter((p) => p.status === 'ok' && p.time_ms != null);

  // Records personnels tous temps (par épreuve × bassin)
  const mtList = bestTimes(perfs);
  const bestIds = new Set(mtList.map((p) => p.id));

  // Saison sportive en cours
  const season = seasonRange(now);
  const currSeason = currentSeason(now);
  const seasonPerfs = perfs.filter((p) => perfSeason(p) === currSeason);
  const seasonMtList = bestTimes(seasonPerfs);
  const seasonHist = seasonPerfs.slice().sort(byDateDesc);

  const nbCourses = perfs.length;
  const nbChronos = okPerfs.length;
  const nbDsqDns = perfs.filter((p) => ['dsq', 'dns', 'dnf'].includes(p.status)).length;
  const nbCompets = new Set(perfs.map((p) => p.competition_id).filter(Boolean)).size;
  const nbSeasonCourses = seasonPerfs.length;
  const seasonPts = swimmerSeasonPoints(swimmerId, season);
  const seasonRaces = swimmerSeasonRaces(swimmerId, season);
  const totalPts = perfs.filter((p) => p.status === 'ok' && p.points).reduce((s, p) => s + (parseInt(p.points, 10) || 0), 0);
  const dateGen = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const group = groupLabel(sw);
  const name = `${sw.firstname} ${sw.lastname}`;

  const allTimeRow = (p) => {
    const s = perfSeason(p);
    return html`<tr class="mt-row">
        <td class="col-event">${shortEventLabel(p.event_code)}</td>
        <td class="col-time"><strong>${p.time_display || ''}</strong></td>
        <td class="col-date">${dateCell(p)}</td>
        <td class="col-season">${s != null ? raw(html`<span class="season-pill">${seasonLabelOf(s)}</span>`) : '—'}</td>
      </tr>`;
  };
  const seasonRow = (p) => {
    const isRecord = bestIds.has(p.id);
    return html`<tr class="mt-row${isRecord ? ' is-record' : ''}">
        <td class="col-event">${shortEventLabel(p.event_code)}${isRecord ? raw(' <span class="record-star">🏆</span>') : ''}</td>
        <td class="col-time"><strong>${p.time_display || ''}</strong></td>
        <td class="col-date">${dateCell(p)}</td>
        <td class="col-rank">${p.rank != null ? raw(html`${p.rank}<sup>e</sup>`) : '—'}</td>
      </tr>`;
  };

  const seasonHistRows = seasonHist.length === 0
    ? '<tr><td colspan="7" class="empty-row">Aucune course cette saison</td></tr>'
    : seasonHist.map((p) => histRow(p, bestIds)).join('');

  const pointsBanner = seasonPts > 0 || totalPts > 0
    ? html`<div class="points-banner">
  <div class="pts-icon">⭐</div>
  <div class="pts-content">
    <div class="pts-main">
      <div class="pts-block">
        <div class="pts-val">${fmtPts(seasonPts)}</div>
        <div class="pts-lbl">Points saison ${season.label}</div>
        <div class="pts-sub">${plural(seasonRaces, 'course')} ${seasonRaces > 1 ? 'chronométrées' : 'chronométrée'}</div>
      </div>
      ${totalPts > seasonPts ? raw(html`<div class="pts-divider"></div>
      <div class="pts-block">
        <div class="pts-val pts-val-total">${fmtPts(totalPts)}</div>
        <div class="pts-lbl">Total cumulé toutes saisons</div>
      </div>`) : ''}
    </div>
  </div>
</div>`
    : '';

  const swimmer = swimmerSvg ? swimmerSvg.replace(/transform="[^"]*"/, 'transform="translate(430,28) scale(2.1)"') : '';
  const sLabel = seasonLabelOf(currSeason);

  return html`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Perfs ${name}</title>
<style>${raw(PDF_CSS)}</style>
</head>
<body>
<div class="pdf-toolbar">
  <button type="button" class="tb-btn tb-print" id="pdf-print">🖨 Imprimer</button>
  <button type="button" class="tb-btn tb-close" id="pdf-close">✕ Fermer</button>
</div>
<div class="hero">
  <svg class="hero-scene" viewBox="0 0 800 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="hw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38D1F0" stop-opacity=".5"/><stop offset="1" stop-color="#38D1F0" stop-opacity="0"/></linearGradient></defs>
    ${raw(swimmer)}
    <path d="${WAVE1}" fill="url(#hw)"/>
    <path d="${WAVE2}" fill="#38D1F0" fill-opacity=".1"/>
  </svg>
  <div class="hero-left">
    <div class="hero-brand">SwimCoach <span>App</span>${teamName ? raw(html` <i>· ${teamName}</i>`) : ''}</div>
    <h1>${name}</h1>
    <div class="hero-sub">Bilan des performances${group ? ` · ${group}` : ''} · édité le ${dateGen}</div>
  </div>
  <div class="hero-right">
    <span class="hero-label">RECORDS PERSO</span>
    <span class="hero-km">${mtList.length}</span>
    <span class="hero-note">${plural(nbCompets, 'compétition')} · ${plural(nbCourses, 'course')}</span>
  </div>
</div>
<div class="kpis">
  <div class="kpi kpi-nat"><span>Chronos</span><b>${nbChronos}</b></div>
  <div class="kpi kpi-comp"><span>Courses ${sLabel}</span><b>${nbSeasonCourses}</b></div>
  ${nbDsqDns > 0 ? raw(html`<div class="kpi kpi-musc"><span>DSQ / DNS</span><b>${nbDsqDns}</b></div>`) : ''}
</div>
${raw(pointsBanner)}
<h2>🏆 Records personnels — tous temps</h2>
<p class="section-hint">Meilleurs temps du nageur toutes saisons confondues, avec la saison où le record a été établi.</p>
${raw(poolSections(mtList, 'Saison', allTimeRow, ''))}
<h2>⚡ Meilleurs temps saison ${sLabel}</h2>
<p class="section-hint">Meilleurs temps réalisés cette saison. Un 🏆 indique un record personnel tous temps.</p>
${raw(poolSections(seasonMtList, 'Place', seasonRow, ' cette saison'))}
<h2>📋 Historique des courses — saison ${sLabel}</h2>
<p class="section-hint">Toutes les courses disputées cette saison sportive (1er septembre → 31 août).</p>
<table>
  <thead><tr><th class="col-date">Date</th><th>Compétition</th><th>Épreuve</th><th class="col-pool">Bas.</th><th class="col-time">Temps</th><th class="col-rank">Place</th><th class="col-pts">Pts</th></tr></thead>
  <tbody>${raw(seasonHistRows)}</tbody>
</table>
<div class="foot">
  <span>SwimCoach App${teamName ? raw(html` · ${teamName}`) : ''} — Bilan personnel</span>
  <span>${plural(nbCourses, 'course')} • ${plural(nbCompets, 'compétition')}</span>
</div>
</body>
</html>`;
}
