/** Gabarits HTML des statistiques (écran) et de la fiche PDF « Club ». Toute valeur passe par `html` (échappée). */
import { html, raw } from '../../core/html.js';
import { groupLabel } from '../contacts/logic.js';
import { swimmerIsActive } from '../../core/season.js';
import { periodLabel } from './logic.js';

const fmtKm = (v) => v.toFixed(1).replace('.', ',');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const colorOf = (pct) => (pct >= 75 ? 'green' : pct >= 50 ? 'orange' : 'red');
const initials = (sw) => `${(sw.firstname || '').charAt(0)}${(sw.lastname || '').charAt(0)}`.toUpperCase();
const DOWNLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

/** @returns {string} structure de l'écran */
export function screenHtml() {
  return html`<div class="stats-hero">
      <div class="stats-hero-top">
        <div class="stats-hero-title">Bilan</div>
        <button type="button" class="stats-pdf-btn" data-action="stats-pdf" aria-label="Exporter en PDF">
          <div class="stats-pdf-btn-icon">${raw(DOWNLOAD)}</div>
          <div class="stats-pdf-btn-info"><div>Exporter en PDF</div><div class="stats-pdf-btn-sub" id="stat-pdf-sub"></div></div>
        </button>
      </div>
      <div class="stats-hero-controls">
        <div class="stats-mode-toggle">
          <button type="button" class="stats-mode-btn" data-action="stats-mode" data-key="month">Mois</button>
          <button type="button" class="stats-mode-btn" data-action="stats-mode" data-key="season">Saison</button>
        </div>
        <div class="stats-header">
          <div class="stats-month-nav">
            <button type="button" class="cal-nav-btn" data-action="stats-prev" aria-label="Période précédente">‹</button>
            <div class="stats-month-label" id="stat-month-label" aria-live="polite"></div>
            <button type="button" class="cal-nav-btn" data-action="stats-next" aria-label="Période suivante">›</button>
          </div>
        </div>
      </div>
      <div class="stats-hero-km">
        <div class="shk-main"><span class="shk-label">DISTANCE NATATION</span><span class="shk-val" id="stats-hero-km"></span></div>
        <div class="shk-side" id="stats-hero-sub"></div>
      </div>
    </div>
    <div class="stats-summary" id="stats-summary"></div>
    <div class="stats-swimmers">
      <div class="stats-swimmers-header">Participation et distance</div>
      <div id="stats-swimmer-rows"></div>
    </div>
    <div class="section-gap"></div>`;
}

/** @param {{scope: string}} period @returns {string} */
export function pdfSubLabel(period) {
  return period.scope === 'season' ? 'Bilan de saison — tous les nageurs' : 'Bilan du mois — tous les nageurs';
}

/** @param {object} stats résultat de computeStats @returns {{km: string, sub: string}} textes du bloc héros */
export function heroTexts(stats) {
  const n = stats.sessions.nat;
  return { km: fmtKm(stats.km), sub: html`<span>${plural(n, 'séance')}</span><span class="shk-dim">${n > 0 ? fmtKm(stats.km / n) : '0'} km / séance</span>` };
}

/** @param {object} stats @returns {string} pastilles muscu et compétitions */
export function summaryHtml(stats) {
  return html`<div class="stat-pill sp-musc"><span>Séances muscu</span><b>${stats.sessions.musc}</b></div>
    <div class="stat-pill sp-comp"><span>Compétitions</span><b>${stats.sessions.comp}</b></div>`;
}

const LABELS = { nat: 'Natation', comp: 'Compét.', musc: 'Muscu' };

function miniHtml(type, pres, total, pct) {
  if (total === 0) return html`<div class="stat-mini-row muted"><span class="stat-mini-ico">${LABELS[type]}</span><span class="stat-mini-txt">—</span></div>`;
  const col = colorOf(pct);
  return html`<div class="stat-mini-row"><span class="stat-mini-ico">${LABELS[type]}</span><span class="stat-mini-txt">${pres}/${total}</span><div class="progress-bar mini"><div class="progress-fill ${col}" style="width:${pct}%"></div></div><span class="stat-pct ${col} mini">${pct}%</span></div>`;
}

/** @param {object} stats @returns {string} une ligne par nageur */
export function swimmerRowsHtml(stats) {
  if (!stats.perSwimmer.length) return '<div class="empty-day" style="padding:20px">Aucun nageur pour cette période</div>';
  const { nat, musc, comp } = stats.sessions;
  return stats.perSwimmer.map((r) => html`<div class="stat-swimmer-row split">
      <div class="stat-swimmer-avatar">${initials(r.swimmer)}</div>
      <div class="stat-swimmer-info">
        <div class="stat-swimmer-name"><div class="ssn-id"><span class="ssn-name">${r.swimmer.firstname} ${r.swimmer.lastname}${swimmerIsActive(r.swimmer) ? '' : raw('<span class="archived-badge" title="Archivé">📦</span>')}</span><span class="stat-swimmer-sub">${groupLabel(r.swimmer)}</span></div>
          ${r.natKm > 0 ? raw(html`<span class="stat-km-pill">${fmtKm(r.natKm)} <i>km</i></span>`) : ''}
        </div>
        <div class="stat-swimmer-splits">
          ${raw(miniHtml('nat', r.natPres, nat, r.natPct))}${raw(miniHtml('musc', r.muscPres, musc, r.muscPct))}${comp > 0 ? raw(miniHtml('comp', r.compPres, comp, r.compPct)) : ''}
        </div>
      </div>
    </div>`).join('');
}

// ───────────── Fiche PDF (style Club de club4) ─────────────

const PDF_COLOR = { green: '#15803D', orange: '#C2410C', red: '#B91C1C' };
const AVATARS = ['#0A8FAE', '#6C3BF5', '#C2410C', '#0A1F44', '#15803D'];
const WAVES = 'M0 196 q20 -7 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V232 H0Z';
const WAVES2 = 'M0 212 q20 -5 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V232 H0Z';

const PDF_CSS = `
  *{box-sizing:border-box;margin:0;padding:0;}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:'Inter',system-ui,sans-serif;color:#0A1F44;background:#E9EDF3;}
  .toolbar{display:flex;gap:10px;padding:14px;max-width:794px;margin:0 auto;}
  .toolbar button{font-family:'Inter',sans-serif;font-size:14px;cursor:pointer;border-radius:999px;}
  .btn-print{padding:10px 22px;background:#FF5A36;color:#fff;border:none;font-weight:700;}
  .btn-close{padding:10px 18px;background:#f1f5f9;color:#333;border:1px solid #cbd5e1;}
  .sheet{width:100%;max-width:794px;margin:0 auto 24px;background:#fff;display:flex;flex-direction:column;box-shadow:0 4px 24px rgba(10,31,68,.14);}
  .hero{position:relative;height:232px;flex-shrink:0;background:#0A1F44;border-radius:0 0 40px 40px;overflow:hidden;}
  .hero svg{position:absolute;left:0;top:0;width:100%;height:100%;}
  .hero-in{position:relative;padding:32px 44px 0;display:flex;align-items:flex-start;justify-content:space-between;}
  .hero-l{display:flex;flex-direction:column;gap:6px;}
  .brand{font-family:'Bricolage Grotesque',sans-serif;font-size:16px;font-weight:700;color:#fff;letter-spacing:.4px;}
  .brand .a{color:#38D1F0;} .brand .t{font-weight:600;color:#A9B8D4;margin-left:4px;}
  h1{font-family:'Bricolage Grotesque',sans-serif;font-size:40px;font-weight:800;letter-spacing:-.8px;color:#fff;line-height:1.05;text-transform:uppercase;}
  .period{font-family:'Bricolage Grotesque',sans-serif;font-size:14px;font-weight:700;letter-spacing:6px;color:#38D1F0;}
  .hero-r{display:flex;flex-direction:column;align-items:flex-end;gap:2px;padding-top:4px;}
  .dlabel{font-size:12px;font-weight:700;letter-spacing:1.4px;color:#A9B8D4;}
  .dkm{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;letter-spacing:-3px;line-height:1;color:#38D1F0;}
  .dkm small{font-size:28px;letter-spacing:0;color:#fff;}
  .davg{font-size:13px;font-weight:600;color:#fff;}
  .kpis{padding:20px 40px 0;display:grid;gap:10px;}
  .kpi{padding:10px 18px;border-radius:999px;display:flex;align-items:center;justify-content:space-between;}
  .kpi span{font-size:13px;font-weight:700;}
  .kpi b{font-family:'Bricolage Grotesque',sans-serif;font-size:26px;font-weight:800;}
  .k-nat{background:#E6F8FC;} .k-nat span{color:#0A6B84;} .k-nat b{color:#0A8FAE;}
  .k-musc{background:#FFEDE6;} .k-musc span{color:#9A3412;} .k-musc b{color:#C2410C;}
  .k-comp{background:#EFE9FF;} .k-comp span{color:#5B21B6;} .k-comp b{color:#6C3BF5;}
  .list{padding:20px 40px 0;display:flex;flex-direction:column;gap:var(--gap);}
  .cols{display:grid;grid-template-columns:var(--tpl);gap:14px;}
  .head{padding:0 14px 2px;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#4A5D80;}
  .head .n{color:#0A8FAE;} .head .m{color:#C2410C;} .head .c{color:#6C3BF5;} .head .d{text-align:right;}
  .row{display:grid;grid-template-columns:var(--tpl);gap:14px;align-items:center;height:var(--rowh);padding:0 8px;border-radius:999px;background:#F3F5F9;break-inside:avoid;page-break-inside:avoid;}
  .who{display:flex;align-items:center;gap:10px;min-width:0;}
  .av{width:var(--av);height:var(--av);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bricolage Grotesque',sans-serif;font-size:var(--avfs);font-weight:800;color:#fff;flex-shrink:0;}
  .who-t{display:flex;flex-direction:column;gap:1px;min-width:0;}
  .nm{font-size:var(--nmfs);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .arch{font-size:10px;}
  .grp{font-size:var(--grfs);font-weight:600;color:#4A5D80;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cell{display:flex;flex-direction:column;gap:5px;}
  .cell-top{display:flex;align-items:baseline;justify-content:space-between;}
  .frac{font-family:'Bricolage Grotesque',sans-serif;font-size:var(--frfs);font-weight:800;} .frac.dim{color:#94A3B8;}
  .pct{font-family:'Bricolage Grotesque',sans-serif;font-size:var(--pcfs);font-weight:800;}
  .track{display:block;height:var(--bar);border-radius:999px;background:#D9E0EC;}
  .fill{display:block;height:100%;border-radius:999px;}
  .km{justify-self:end;padding:var(--pillv) 12px;border-radius:999px;background:#0A1F44;color:#fff;font-family:'Bricolage Grotesque',sans-serif;font-size:var(--kmfs);font-weight:800;white-space:nowrap;}
  .km small{font-size:11px;font-weight:700;color:#38D1F0;}
  .empty{padding:24px;text-align:center;color:#94A3B8;font-weight:600;}
  .foot{margin-top:18px;padding:0 40px 28px;display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:700;color:#4A5D80;}
  .leg{display:flex;align-items:center;gap:14px;} .leg span{display:flex;align-items:center;gap:5px;}
  .leg i{width:9px;height:9px;border-radius:50%;display:inline-block;}
  @page{size:A4;margin:0;}
  @media print{
    body{background:#fff;}
    .toolbar{display:none!important;}
    .sheet{max-width:none;margin:0;box-shadow:none;}
  }`;

function cell(pres, total, pct) {
  if (total === 0) return '<div class="cell"><div class="cell-top"><b class="frac dim">—</b></div><span class="track"></span></div>';
  const c = PDF_COLOR[colorOf(pct)];
  return html`<div class="cell"><div class="cell-top"><b class="frac">${pres}/${total}</b><b class="pct" style="color:${c}">${pct} %</b></div><span class="track"><span class="fill" style="background:${c};width:${pct}%"></span></span></div>`;
}

/**
 * Fiche A4 « Club » : bandeau marine, pastilles, une carte par nageur avec barres, pastille km.
 * @param {object} stats résultat de computeStats
 * @param {{teamName?: string, swimmerSvg?: string, now?: Date}} [opts] swimmerSvg : SVG de confiance du nageur du bandeau
 * @returns {string} document HTML complet
 */
export function statsPdfHtml(stats, { teamName = '', swimmerSvg = '', now = new Date() } = {}) {
  const { nat, musc, comp } = stats.sessions;
  const isSeason = stats.period.scope === 'season';
  const label = periodLabel(stats.period);
  const short = isSeason ? `${stats.period.y}–${String(stats.period.y + 1).slice(2)}` : label.toUpperCase();
  const hasComp = comp > 0;
  const rows = stats.perSwimmer;

  // Densité : plus il y a de nageurs, plus les lignes sont compactes, pour tenir sur une page A4
  const n = rows.length;
  const pitch = n > 0 ? Math.floor(700 / n) : 66;
  const rowH = Math.max(30, Math.min(60, pitch - 5));
  const gap = Math.max(3, Math.min(6, pitch - rowH));
  const big = rowH >= 50;
  const mid = rowH >= 40;
  const dens = [
    `--rowh:${rowH}px`, `--gap:${gap}px`,
    `--av:${Math.max(20, Math.min(36, rowH - 14))}px`, `--avfs:${big ? 13 : mid ? 12 : 10}px`,
    `--nmfs:${big ? 14 : mid ? 13 : 12}px`, `--grfs:${big ? 11 : mid ? 10 : 9.5}px`,
    `--frfs:${big ? 14 : mid ? 13 : 12}px`, `--pcfs:${big ? 12 : mid ? 11 : 10.5}px`,
    `--bar:${big ? 7 : mid ? 6 : rowH >= 34 ? 5 : 4}px`, `--pillv:${big ? 6 : 4}px`, `--kmfs:${big ? 16 : mid ? 14 : 13}px`,
    `--tpl:216px repeat(${hasComp ? 3 : 2},minmax(0,1fr)) 96px`,
  ].join(';');

  const lines = rows.map((r, i) => html`<div class="row">
      <div class="who"><span class="av" style="background:${AVATARS[i % 5]}">${initials(r.swimmer)}</span><div class="who-t"><span class="nm">${r.swimmer.firstname} ${r.swimmer.lastname}${swimmerIsActive(r.swimmer) ? '' : raw(' <span class="arch">📦</span>')}</span><span class="grp">${groupLabel(r.swimmer)}</span></div></div>
      ${raw(cell(r.natPres, nat, r.natPct))}${raw(cell(r.muscPres, musc, r.muscPct))}${hasComp ? raw(cell(r.compPres, comp, r.compPct)) : ''}
      <span class="km">${fmtKm(r.natKm)} <small>km</small></span>
    </div>`).join('');

  const kmStr = fmtKm(stats.km);
  const kmFs = kmStr.length > 6 ? 60 : 76;
  const avg = nat > 0 ? `${fmtKm(stats.km / nat)} km par séance en moyenne` : 'Aucune séance de natation';
  const date = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  // Le nageur du bandeau (SVG de l'application) est replacé dans le bandeau A4
  const swimmer = swimmerSvg ? swimmerSvg.replace(/transform="[^"]*"/, 'transform="translate(290,95) scale(2.92)"') : '';

  return html`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=794">
<title>Bilan ${label}</title>
<style>${raw(PDF_CSS)}</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" class="btn-print" id="pdf-print">🖨 Imprimer / Enregistrer en PDF</button>
    <button type="button" class="btn-close" id="pdf-close">✕ Fermer</button>
  </div>
  <div class="sheet" style="${dens}">
    <div class="hero">
      <svg viewBox="0 0 794 232" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs><linearGradient id="wCp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38D1F0" stop-opacity="0.5"/><stop offset="1" stop-color="#38D1F0" stop-opacity="0"/></linearGradient></defs>
        ${raw(swimmer)}
        <path d="${WAVES}" fill="url(#wCp)"/>
        <path d="${WAVES2}" fill="#38D1F0" fill-opacity="0.1"/>
      </svg>
      <div class="hero-in">
        <div class="hero-l">
          <span class="brand">SwimCoach <span class="a">App</span>${teamName ? raw(html` <span class="t">· ${teamName}</span>`) : ''}</span>
          <h1>Bilan<br>${isSeason ? 'de saison' : 'du mois'}</h1>
          <span class="period">${short}</span>
        </div>
        <div class="hero-r">
          <span class="dlabel">DISTANCE NATATION</span>
          <span class="dkm" style="font-size:${kmFs}px">${kmStr}<small> km</small></span>
          <span class="davg">${avg}</span>
        </div>
      </div>
    </div>
    <div class="kpis" style="grid-template-columns:repeat(${hasComp ? 3 : 2},minmax(0,1fr))">
      <div class="kpi k-nat"><span>Séances natation</span><b>${nat}</b></div>
      <div class="kpi k-musc"><span>Séances muscu</span><b>${musc}</b></div>
      ${hasComp ? raw(html`<div class="kpi k-comp"><span>Compétitions</span><b>${comp}</b></div>`) : ''}
    </div>
    <div class="list">
      <div class="head cols"><span>NAGEUR</span><span class="n">NATATION</span><span class="m">MUSCU</span>${hasComp ? raw('<span class="c">COMPÉT.</span>') : ''}<span class="d">DISTANCE</span></div>
      ${raw(lines || '<div class="empty">Aucun nageur sur cette période</div>')}
    </div>
    <div class="foot">
      <span class="leg">
        <span><i style="background:#15803D"></i>75 % et plus</span>
        <span><i style="background:#C2410C"></i>50 à 74 %</span>
        <span><i style="background:#B91C1C"></i>moins de 50 %</span>
      </span>
      <span>SwimCoach App${teamName ? raw(html` · ${teamName}`) : ''} · édité le ${date}</span>
    </div>
  </div>
</body>
</html>`;
}
