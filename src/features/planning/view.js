/** Gabarits HTML de la planification (écran et PDF « Club »). Tout texte saisi passe par `html` (échappé). */
import { html, raw } from '../../core/html.js';
import { dateKey } from '../../core/dates.js';
import { monthName, formatPlanDate } from '../calendar/logic.js';
import {
  EVENT_TYPES, EVENT_ICONS, EVENT_LABELS, seasonMonths, seasonLabel, weeksOfMonth, weekData, weekIsFilled, weekRealKm,
  kmStatus, formatWeekRange, eventsInWeek, eventsOfMonth,
} from './logic.js';

const TYPE_PILL = { comp: '🏆 Compétition', stage: '🏕 Stage', nat: '🎯 Objectif', obj: '💪 Prépa physique', note: '📝 Note' };
const DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/></svg>';

/** Couleur de chaque mois (janvier = 0) : liseré et fond de l'en-tête de semaine (club4). */
const MONTH_PALETTE = [
  ['#3b82f6', 'rgba(59,130,246,0.10)'], ['#8b5cf6', 'rgba(139,92,246,0.10)'], ['#ec4899', 'rgba(236,72,153,0.10)'],
  ['#f43f5e', 'rgba(244,63,94,0.10)'], ['#f59e0b', 'rgba(245,158,11,0.10)'], ['#eab308', 'rgba(234,179,8,0.10)'],
  ['#84cc16', 'rgba(132,204,22,0.10)'], ['#22c55e', 'rgba(34,197,94,0.10)'], ['#14b8a6', 'rgba(20,184,166,0.10)'],
  ['#06b6d4', 'rgba(6,182,212,0.10)'], ['#0ea5e9', 'rgba(14,165,233,0.10)'], ['#6366f1', 'rgba(99,102,241,0.10)'],
];

const monthKeyOf = (y, m) => dateKey(y, m, 1).slice(0, 7);
const fmtKm = (n) => n.toFixed(1);
const keyOf = (d) => dateKey(d.getFullYear(), d.getMonth(), d.getDate());

/** @returns {string} structure de l'écran : en-tête, légende, PDF, mois */
export function screenHtml() {
  return html`<div class="plan-header">
      <div class="plan-title">Planification</div>
      <div class="plan-year-nav">
        <button type="button" class="cal-nav-btn" data-action="plan-prev" aria-label="Saison précédente">‹</button>
        <div class="plan-year-label" id="plan-year-label" aria-live="polite"></div>
        <button type="button" class="cal-nav-btn" data-action="plan-next" aria-label="Saison suivante">›</button>
      </div>
    </div>
    <div class="plan-legend">${EVENT_TYPES.map((t) => raw(html`<div class="legend-item"><div class="legend-dot legend-${t}"></div>${EVENT_LABELS[t]}</div>`))}</div>
    <button type="button" class="plan-pdf-btn" data-action="plan-pdf">
      <div class="plan-pdf-btn-icon">${raw(DOC)}</div>
      <div class="plan-pdf-btn-info"><div>Exporter la planification en PDF</div><div class="plan-pdf-btn-sub">Saison complète imprimable — sept → août</div></div>
      <div class="plan-pdf-btn-chevron" aria-hidden="true">›</div>
    </button>
    <div class="plan-timeline" id="plan-timeline"></div>
    <div class="section-gap"></div>
    <div class="modal-overlay" id="modal-plan-event" data-action="close-backdrop"><div class="modal-sheet" role="dialog" aria-label="Événement" id="plan-event-sheet"></div></div>
    <div class="modal-overlay dialog" id="dialog-plan-event" data-action="close-backdrop"><div class="dialog-box" role="dialog" id="dialog-plan-event-box"></div></div>`;
}

/** @param {object[]} events @returns {string} pastilles du mois : compétition, stage, objectif */
export function monthBadgesHtml(events) {
  const has = (t) => events.some((e) => e.type === t);
  return [['comp', '🏆'], ['stage', '🏕'], ['nat', '🎯']].filter(([t]) => has(t)).map(([t, icon]) => html`<span class="plan-badge plan-badge-${t}">${icon}</span>`).join('');
}

/** @param {object} ev @param {string} mKey @returns {string} */
function eventRowHtml(ev) {
  return html`<div class="plan-event-row">
      <div class="plan-event-icon ${ev.type}">${EVENT_ICONS[ev.type] || '📝'}</div>
      <div class="plan-event-body">
        <div class="plan-event-title">${ev.title || EVENT_LABELS[ev.type]}</div>
        ${ev.description ? raw(html`<div class="plan-event-desc">${ev.description}</div>`) : ''}
        <div class="plan-event-date">${formatPlanDate(ev.start_date, ev.end_date)}</div>
      </div>
      <div class="plan-event-actions">
        <button type="button" class="icon-btn-sm" data-action="plan-edit-event" data-id="${ev.id}" aria-label="Modifier ${ev.title || EVENT_LABELS[ev.type]}">✏️</button>
        <button type="button" class="icon-btn-sm" data-action="plan-ask-delete-event" data-id="${ev.id}" aria-label="Supprimer ${ev.title || EVENT_LABELS[ev.type]}">🗑</button>
      </div>
    </div>`;
}

/** @param {string} mKey 'AAAA-MM' @returns {string} liste des événements du mois (vide : rien) */
export function monthEventsHtml(mKey) {
  const events = eventsOfMonth(mKey);
  return events.length ? html`<div class="plan-events-section">${events.map((e) => raw(eventRowHtml(e)))}</div>` : '';
}

/** @param {Date} monday @param {Date} sunday @returns {string} événements qui touchent la semaine */
export function weekEventsHtml(monday, sunday) {
  const events = eventsInWeek(monday, sunday);
  if (!events.length) return '';
  return html`<div class="plan-week-events">${events.map((ev) => raw(html`<div class="plan-week-event plan-week-event-${ev.type}">
      <span class="plan-week-event-icon">${EVENT_ICONS[ev.type] || '📝'}</span>
      <span class="plan-week-event-title">${ev.title || EVENT_LABELS[ev.type]}</span>
      <span class="plan-week-event-date">${formatPlanDate(ev.start_date, ev.end_date)}</span>
    </div>`))}</div>`;
}

/** @param {Date} monday @param {Date} sunday @param {number} target @returns {string} case « Réal. » (classe et pourcentage selon l'objectif) */
export function weekRealHtml(monday, sunday, target) {
  const real = weekRealKm(monday, sunday);
  const { cls, pct } = kmStatus(real, target);
  return html`<div class="plan-week-km-real week-km-${cls}">
      <div class="plan-week-km-real-label">🏊 Réal.</div>
      <div class="plan-week-km-real-val">${fmtKm(real)}</div>
      ${pct != null ? raw(html`<div class="plan-week-km-status">${pct}%</div>`) : ''}
    </div>`;
}

function weekBlockHtml(w, seasonStart, m) {
  const wd = weekData(w.weekKey);
  const target = parseFloat(wd.km_target) || 0;
  const [color, bg] = MONTH_PALETTE[m];
  const data = html`data-week="${w.weekKey}" data-season="${seasonStart}"`;
  const label = `S${w.weekLabel}`;
  return html`<div class="plan-week-block${weekIsFilled(wd) ? ' has-content' : ''}" data-week-block="${w.weekKey}" data-monday="${keyOf(w.mondayDate)}" data-sunday="${keyOf(w.sundayDate)}" style="--week-color:${color};--week-color-bg:${bg};">
      <div class="plan-week-header">
        <div><span class="plan-week-label">${label}</span>${w.overlapsMonths ? raw('<span class="plan-week-overlap-tag">🔗 partagée</span>') : ''}</div>
        <div class="plan-week-range">${formatWeekRange(w.mondayDate, w.sundayDate)}</div>
      </div>
      <div class="plan-week-body">
        <div class="plan-week-events-slot" data-week-events>${raw(weekEventsHtml(w.mondayDate, w.sundayDate))}</div>
        <label class="plan-week-field-label" for="zone-${m}-${w.weekKey}">💪 Zone de travail</label>
        <input type="text" class="plan-week-zone-input" id="zone-${m}-${w.weekKey}" placeholder="ex. aérobie · seuil · vitesse..." value="${wd.zone || ''}" ${raw(data)} data-field="zone" data-action="plan-week-change" data-on="change" aria-label="Zone de travail ${label}">
        <label class="plan-week-field-label plan-week-field-gap" for="theme-${m}-${w.weekKey}">📝 Thème de la semaine</label>
        <textarea class="plan-week-textarea" id="theme-${m}-${w.weekKey}" placeholder="Objectifs, contenu, notes..." ${raw(data)} data-field="theme" data-action="plan-week-change" data-on="change" aria-label="Thème ${label}">${wd.content || ''}</textarea>
        <div class="plan-week-km-row">
          <div class="plan-week-km-target">
            <label class="plan-week-field-label" for="km-${m}-${w.weekKey}">🎯 Objectif km</label>
            <input type="number" step="0.5" min="0" class="plan-week-km-input" id="km-${m}-${w.weekKey}" placeholder="0" value="${target || ''}" ${raw(data)} data-field="km" data-action="plan-week-change" data-on="change" aria-label="Objectif km ${label}">
          </div>
          <div class="plan-week-km-slot" data-week-km>${raw(weekRealHtml(w.mondayDate, w.sundayDate, target))}</div>
        </div>
      </div>
    </div>`;
}

/**
 * @param {{y: number, m: number}} month
 * @param {number} seasonStart
 * @param {boolean} open
 * @returns {string} un mois de la saison : en-tête repliable, événements, semaines
 */
export function monthBlockHtml({ y, m }, seasonStart, open) {
  const mKey = monthKeyOf(y, m);
  const events = eventsOfMonth(mKey);
  return html`<div class="plan-month-block${open ? ' open' : ''}" data-month="${mKey}">
      <button type="button" class="plan-month-header" data-action="plan-toggle-month" data-key="${mKey}" aria-expanded="${open}">
        <span class="plan-month-name">${monthName(m)} ${y}</span>
        <span class="plan-month-right"><span class="plan-month-badges" data-badges-of="${mKey}">${raw(monthBadgesHtml(events))}</span><span class="plan-month-toggle" aria-hidden="true">›</span></span>
      </button>
      <div class="plan-month-body">
        <div data-events-slot="${mKey}">${raw(monthEventsHtml(mKey))}</div>
        <button type="button" class="plan-add-btn" data-action="plan-add-event" data-key="${mKey}">+ Ajouter un événement</button>
        <div class="plan-weeks-section">
          <div class="plan-weeks-section-title">📅 Semaines du mois</div>
          ${weeksOfMonth(y, m).map((w) => raw(weekBlockHtml(w, seasonStart, m)))}
        </div>
      </div>
    </div>`;
}

/** @param {number} seasonStart @param {Set<string>} openMonths @returns {string} les 12 mois de la saison */
export function timelineHtml(seasonStart, openMonths) {
  return seasonMonths(seasonStart).map((mo) => monthBlockHtml(mo, seasonStart, openMonths.has(monthKeyOf(mo.y, mo.m)))).join('');
}

/**
 * Formulaire d'un événement.
 * @param {object|null} ev événement modifié, null pour un nouveau
 * @param {{type: string, start: string}} opts
 * @returns {string} contenu de la feuille
 */
export function eventFormHtml(ev, { type, start }) {
  const v = ev ?? {};
  return html`<div class="modal-handle"></div>
    <div class="modal-header">
      <div class="modal-title">${ev ? "Modifier l'événement" : 'Nouvel événement'}</div>
      <button type="button" class="modal-close" data-action="close-modal" data-id="modal-plan-event" aria-label="Fermer">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <span class="form-label" id="plan-ev-type-label">Type d'événement</span>
        <div class="event-type-pills" role="group" aria-labelledby="plan-ev-type-label">${EVENT_TYPES.map((t) => raw(html`<button type="button" class="event-type-pill${t === type ? ` sel-${t}` : ''}" data-action="plan-pick-type" data-key="${t}" aria-pressed="${t === type}">${TYPE_PILL[t]}</button>`))}</div>
      </div>
      <div class="form-group"><label class="form-label" for="plan-ev-title">Titre</label><input type="text" class="form-input" id="plan-ev-title" placeholder="Ex : Championnats régionaux…" value="${v.title ?? ''}"></div>
      <div class="form-group"><label class="form-label" for="plan-ev-desc">Description / Objectifs</label><textarea class="form-input plan-ev-desc" id="plan-ev-desc" rows="3" placeholder="Détails, objectifs, notes…">${v.description ?? ''}</textarea></div>
      <div class="form-group"><label class="form-label" for="plan-ev-start">Date de début</label><input type="date" class="form-input" id="plan-ev-start" value="${ev ? v.start_date ?? '' : start}"></div>
      <div class="form-group"><label class="form-label" for="plan-ev-end">Date de fin (optionnel)</label><input type="date" class="form-input" id="plan-ev-end" value="${v.end_date ?? ''}"></div>
    </div>
    <div class="modal-footer">
      ${ev ? raw(html`<button type="button" class="btn-full btn-danger-ghost" data-action="plan-ask-delete-event" data-id="${ev.id}" aria-label="Supprimer l'événement">🗑</button>`) : ''}
      <button type="button" class="btn-full btn-accent" data-action="plan-save-event">💾 Enregistrer</button>
    </div>`;
}

/** @param {object} ev @returns {string} confirmation de suppression */
export function deleteEventDialogHtml(ev) {
  return html`<div class="dialog-icon" aria-hidden="true">🗑</div>
    <div class="dialog-title">Supprimer « ${ev.title || EVENT_LABELS[ev.type]} » ?</div>
    <div class="dialog-text">L'événement disparaît aussi du calendrier.</div>
    <div class="dialog-actions">
      <button type="button" class="btn-full btn-ghost" data-action="close-modal" data-id="dialog-plan-event">Annuler</button>
      <button type="button" class="btn-full btn-danger" data-action="plan-do-delete-event" data-id="${ev.id}">Supprimer</button>
    </div>`;
}

// ───────────── Fiche PDF (style Club de club4) ─────────────

/** Couleur de chaque mois dans le PDF (janvier = 0) : automne corail, hiver cyan, printemps violet, été orange. */
const PDF_MONTH_COLOR = ['#0A8FAE', '#0A8FAE', '#6C3BF5', '#6C3BF5', '#6C3BF5', '#C2410C', '#C2410C', '#C2410C', '#FF5A36', '#FF5A36', '#FF5A36', '#0A8FAE'];

const WAVE1 = 'M0 128 q20 -7 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V160 H0Z';
const WAVE2 = 'M0 142 q20 -6 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V160 H0Z';

const PDF_CSS = `
  *{margin:0;padding:0;box-sizing:border-box;}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:'Inter',system-ui,sans-serif;color:#0A1F44;background:#fff;padding:24px;font-size:11.5px;line-height:1.4;}
  .pdf-toolbar{display:flex;gap:8px;margin-bottom:16px;}
  .tb-btn{padding:9px 18px;border:none;border-radius:999px;font-family:'Inter',sans-serif;font-size:13px;font-weight:700;cursor:pointer;}
  .tb-print{background:#FF5A36;color:#fff;} .tb-close{background:#F3F5F9;color:#0A1F44;border:1px solid #CBD5E1;}
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
  .pdf-month{margin-bottom:16px;background:#fff;border:1px solid #E3E8F0;border-radius:16px;overflow:hidden;page-break-inside:avoid;break-inside:avoid;}
  .pdf-month-header{padding:10px 16px;background:#0A1F44;border-bottom:4px solid var(--mc);display:flex;align-items:center;gap:10px;}
  .pdf-month-header::before{content:'';width:10px;height:10px;border-radius:50%;background:var(--mc);flex-shrink:0;}
  .pdf-month-name{font-family:'Bricolage Grotesque',sans-serif;font-size:18px;font-weight:800;color:#fff;letter-spacing:-.3px;}
  .pdf-events{padding:8px 14px;background:#F3F5F9;border-bottom:1px solid #E3E8F0;display:flex;flex-wrap:wrap;gap:8px;}
  .pdf-event{background:#fff;border:1px solid #E3E8F0;border-radius:12px;padding:5px 11px;font-size:10.5px;display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;}
  .pdf-event-title{font-weight:700;}
  .pdf-event-date{color:#64748b;font-size:9.5px;}
  .pdf-event-desc{width:100%;font-size:10px;color:#64748b;margin-top:2px;font-style:italic;}
  .pdf-event-comp{border-color:#B9A3FB;background:#EFE9FF;}
  .pdf-event-stage{border-color:#86EFAC;background:#E7F7EC;}
  .pdf-event-nat{border-color:#67D5EA;background:#E6F8FC;}
  .pdf-event-obj{border-color:#FDBA9C;background:#FFEDE6;}
  .pdf-weeks-table{width:100%;border-collapse:collapse;}
  .pdf-weeks-table thead th{background:#F3F5F9;color:#0A1F44;padding:7px 12px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #E3E8F0;}
  .pdf-weeks-table tbody td{padding:8px 12px;border-bottom:1px solid #EEF1F6;vertical-align:top;}
  .pdf-weeks-table tbody tr:last-child td{border-bottom:none;}
  .pdf-week-col{width:100px;}
  .pdf-week-num{font-family:'Bricolage Grotesque',sans-serif;font-size:15px;color:var(--mc);font-weight:800;}
  .pdf-week-range{font-size:9.5px;color:#64748b;font-weight:600;margin-top:1px;}
  .pdf-content-col{font-size:11px;line-height:1.5;color:#334155;}
  .pdf-zone{display:inline-block;background:var(--mc);color:#fff;font-weight:700;font-size:10px;padding:3px 11px;border-radius:999px;margin-bottom:5px;letter-spacing:.4px;text-transform:uppercase;}
  .pdf-theme{color:#334155;}
  .pdf-none{color:#94a3b8;}
  .pdf-week-events{margin-bottom:5px;display:flex;flex-wrap:wrap;gap:4px;}
  .pdf-week-event{display:inline-flex;align-items:center;gap:3px;padding:2px 9px;border-radius:999px;font-size:9.5px;background:#fff;border:1px solid #E3E8F0;}
  .pdf-week-event em{color:#94a3b8;font-style:normal;margin-left:3px;font-size:9px;}
  .pdf-week-event-comp{background:#EFE9FF;border-color:#B9A3FB;}
  .pdf-week-event-stage{background:#E7F7EC;border-color:#86EFAC;}
  .pdf-week-event-nat{background:#E6F8FC;border-color:#67D5EA;}
  .pdf-week-event-obj{background:#FFEDE6;border-color:#FDBA9C;}
  .pdf-km-col{width:180px;}
  .pdf-km-line{display:flex;align-items:center;gap:5px;font-size:11px;}
  .pdf-km-target{color:#64748b;font-weight:600;}
  .pdf-km-arrow{color:#CBD5E1;}
  .pdf-km-real{font-weight:800;color:#0A1F44;}
  .pdf-km-badge{padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:700;margin-left:auto;}
  .pdf-km-ok{background:#DCFCE7;color:#15803D;}
  .pdf-km-close{background:#FFEDD5;color:#C2410C;}
  .pdf-km-under{background:#FEE2E2;color:#B91C1C;}
  .pdf-overlap-tag{font-size:8.5px;color:#C2410C;background:rgba(255,193,7,0.15);padding:1px 4px;border-radius:5px;font-weight:700;margin-left:3px;}
  .foot{margin-top:14px;padding-top:10px;border-top:1px solid #E3E8F0;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;}
  @page{size:A4;margin:12mm;}
  @media print{
    body{background:#fff;padding:12px;}
    .pdf-toolbar{display:none!important;}
    .pdf-month{box-shadow:none;}
  }`;

function pdfEventsHtml(events) {
  if (!events.length) return '';
  return html`<div class="pdf-events">${events.map((ev) => raw(html`<div class="pdf-event pdf-event-${ev.type}">
      <span class="pdf-event-icon">${EVENT_ICONS[ev.type] || '📝'}</span>
      <span class="pdf-event-title">${ev.title || EVENT_LABELS[ev.type]}</span>
      <span class="pdf-event-date">${formatPlanDate(ev.start_date, ev.end_date)}</span>
      ${ev.description ? raw(html`<div class="pdf-event-desc">${ev.description}</div>`) : ''}
    </div>`))}</div>`;
}

/** Texte brut d'une semaine : échappé, retours à la ligne conservés. */
const textHtml = (s) => html`${s}`.replace(/\r?\n/g, '<br>');

/**
 * Fiche de planification d'une saison, au style Club : bandeau marine, pastilles, un tableau par mois.
 * @param {number} seasonStart année de début de saison
 * @param {{teamName?: string, swimmerSvg?: string, now?: Date}} [opts] swimmerSvg : SVG de confiance du nageur du bandeau
 * @returns {string} document HTML complet (sans script)
 */
export function planningPdfHtml(seasonStart, { teamName = '', swimmerSvg = '', now = new Date() } = {}) {
  const label = seasonLabel(seasonStart);
  const date = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  let totalTarget = 0;
  let totalReal = 0;
  let filledWeeks = 0;
  let nbEvents = 0;
  const seen = new Set();

  const months = seasonMonths(seasonStart).map(({ y, m }) => {
    const events = eventsOfMonth(monthKeyOf(y, m));
    nbEvents += events.length;
    const rows = weeksOfMonth(y, m).map((w) => {
      const wd = weekData(w.weekKey);
      const real = weekRealKm(w.mondayDate, w.sundayDate);
      const target = parseFloat(wd.km_target) || 0;
      if (!seen.has(w.weekKey)) { // une semaine à cheval sur deux mois ne compte qu'une fois
        seen.add(w.weekKey);
        totalTarget += target;
        totalReal += real;
        if (weekIsFilled(wd)) filledWeeks += 1;
      }
      const { cls, pct } = kmStatus(real, target);
      const weekEvents = eventsInWeek(w.mondayDate, w.sundayDate);
      return html`<tr>
          <td class="pdf-week-col"><div class="pdf-week-num">S${w.weekLabel}${w.overlapsMonths ? raw(' <span class="pdf-overlap-tag">🔗</span>') : ''}</div><div class="pdf-week-range">${formatWeekRange(w.mondayDate, w.sundayDate)}</div></td>
          <td class="pdf-content-col">
            ${weekEvents.length ? raw(html`<div class="pdf-week-events">${weekEvents.map((ev) => raw(html`<span class="pdf-week-event pdf-week-event-${ev.type}">${EVENT_ICONS[ev.type] || '📝'} <strong>${ev.title || EVENT_LABELS[ev.type]}</strong> <em>${formatPlanDate(ev.start_date, ev.end_date)}</em></span>`))}</div>`) : ''}
            ${wd.zone && wd.zone.trim() ? raw(html`<div class="pdf-zone">${wd.zone}</div>`) : ''}
            <div class="pdf-theme">${wd.content && wd.content.trim() ? raw(textHtml(wd.content)) : raw('<span class="pdf-none">—</span>')}</div>
          </td>
          <td class="pdf-km-col"><div class="pdf-km-line"><span class="pdf-km-target">${target > 0 ? target.toFixed(1) : '—'}</span><span class="pdf-km-arrow">→</span><span class="pdf-km-real">${real.toFixed(1)} km</span>${pct != null ? raw(html`<span class="pdf-km-badge pdf-km-${cls}">${pct}%</span>`) : ''}</div></td>
        </tr>`;
    });
    return html`<div class="pdf-month" style="--mc:${PDF_MONTH_COLOR[m]};">
        <div class="pdf-month-header"><div class="pdf-month-name">${monthName(m)} ${y}</div></div>
        ${raw(pdfEventsHtml(events))}
        <table class="pdf-weeks-table">
          <thead><tr><th class="pdf-week-col">Semaine</th><th class="pdf-content-col">Zone · Thème · Événements</th><th class="pdf-km-col">Cible → Réalisé</th></tr></thead>
          <tbody>${rows.map(raw)}</tbody>
        </table>
      </div>`;
  });

  const globalPct = totalTarget > 0 ? Math.round((totalReal / totalTarget) * 100) : 0;
  const swimmer = swimmerSvg ? swimmerSvg.replace(/transform="[^"]*"/, 'transform="translate(385,28) scale(2.1)"') : '';

  return html`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Planification saison ${label}</title>
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
    <h1>Planification</h1>
    <div class="hero-sub">Saison ${label} · édité le ${date}</div>
  </div>
  <div class="hero-right">
    <span class="hero-label">KILOMÈTRES RÉALISÉS</span>
    <span class="hero-km">${totalReal.toFixed(0)}<small> km</small></span>
    <span class="hero-note">sur ${totalTarget.toFixed(0)} km d'objectif${globalPct > 0 ? ` · ${globalPct}%` : ''}</span>
  </div>
</div>
<div class="kpis">
  <div class="kpi kpi-nat"><span>Semaines planifiées</span><b>${filledWeeks}</b></div>
  <div class="kpi kpi-comp"><span>Événements</span><b>${nbEvents}</b></div>
  <div class="kpi kpi-musc"><span>Objectif saison</span><b>${totalTarget.toFixed(0)} km</b></div>
</div>
${months.map(raw)}
<div class="foot"><span>SwimCoach App${teamName ? raw(html` · ${teamName}`) : ''} — Planification saison ${label}</span><span>Généré le ${date}</span></div>
</body>
</html>`;
}
