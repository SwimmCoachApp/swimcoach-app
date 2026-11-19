/** Gabarits HTML du calendrier et des séances. Tout texte saisi passe par `html` (échappé), le contenu riche par sanitizeRich. */
import { html, raw, sanitizeRich } from '../../core/html.js';
import { dateKey } from '../../core/dates.js';
import { SESSION_TYPES, SESSION_NAMES, SESSION_SHORT, EVENT_LABELS, presenceCount, formatPlanDate, monthName } from './logic.js';

const TYPE_ICONS = { nat: '🏊', musc: '💪', comp: '🏆', other: '📌' };
const EVENT_ICONS = { comp: '🏆', stage: '🏕', nat: '🎯', obj: '💪', note: '📝' };
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const RICH_BUTTONS = [
  ['bold', '<b>B</b>', 'Gras'],
  ['italic', '<i>I</i>', 'Italique'],
  ['underline', '<u>U</u>', 'Souligné'],
  null,
  ['insertUnorderedList', '•≡', 'Liste à puces'],
  ['insertOrderedList', '1≡', 'Liste numérotée'],
  null,
  ['removeFormat', '✕f', 'Effacer la mise en forme'],
];

/** @returns {string} structure de l'écran : calendrier, panneau du jour, feuilles */
export function screenHtml() {
  return html`<div class="cal-hero">
      <div class="cal-header">
        <button type="button" class="cal-nav-btn" data-action="cal-prev" aria-label="Mois précédent">‹</button>
        <div class="cal-month" id="cal-month-label" aria-live="polite"></div>
        <button type="button" class="cal-nav-btn" data-action="cal-next" aria-label="Mois suivant">›</button>
      </div>
      <div class="cal-today-row"><button type="button" class="cal-today-btn" data-action="cal-today">Aujourd'hui</button></div>
      <div class="cal-weekdays">${WEEKDAYS.map((d) => raw(html`<div class="cal-wd">${d}</div>`))}</div>
      <div class="cal-grid" id="cal-grid"></div>
    </div>
    <div class="day-panel">
      <div class="day-panel-header">
        <div class="day-panel-title" id="day-panel-title">Sélectionne un jour</div>
        <button type="button" class="btn-add-session" data-action="add-session">+ Séance</button>
      </div>
      <div id="sessions-list"></div>
    </div>
    <div class="section-gap"></div>
    <div class="modal-overlay" id="modal-session-view" data-action="close-backdrop"><div class="session-view-sheet" role="dialog" aria-label="Séance" id="session-view-sheet"></div></div>
    <div class="modal-overlay" id="modal-session" data-action="close-backdrop"><div class="modal-sheet" role="dialog" aria-label="Séance" id="session-sheet"></div></div>
    <div class="modal-overlay dialog" id="dialog-session" data-action="close-backdrop"><div class="dialog-box" role="dialog" id="dialog-session-box"></div></div>
    <div class="photo-fullscreen" id="photo-fullscreen" data-action="close-photo" role="dialog" aria-label="Photo de la séance">
      <button type="button" class="photo-fullscreen-close" data-action="close-photo" aria-label="Fermer">✕</button>
    </div>`;
}

/** @param {number} y @param {number} m0 @returns {string} 'Novembre <span>2026</span>' */
export function monthLabelHtml(y, m0) {
  return html`${monthName(m0)} <span class="cal-year">${y}</span>`;
}

/**
 * @param {number} y
 * @param {number} m0
 * @param {{selected: string|null, today: string, marks: Map<string, object>, byDay: Map<string, object[]>}} ctx
 * @returns {string} cases du mois (semaine du lundi au dimanche)
 */
export function gridHtml(y, m0, { selected, today, marks, byDay }) {
  const firstDow = new Date(y, m0, 1).getDay();
  const blanks = firstDow === 0 ? 6 : firstDow - 1;
  const days = new Date(y, m0 + 1, 0).getDate();
  const cells = Array.from({ length: blanks }, () => '<div class="cal-day empty"></div>');
  for (let d = 1; d <= days; d += 1) {
    const key = dateKey(y, m0, d);
    const mark = marks.get(key);
    const cls = ['cal-day', key === today && 'today', key === selected && 'selected', mark && `has-plan-event ev-${mark.type}`].filter(Boolean).join(' ');
    const inner = mark
      ? html`<span class="day-num">${d}</span><div class="plan-event-cal-label">${mark.isFirst ? `${EVENT_ICONS[mark.type] ?? '📌'} ` : ''}${mark.title}</div>`
      : html`<span class="day-num">${d}</span><div class="dot-row">${(byDay.get(key) ?? []).map((s) => raw(html`<span class="session-dot dot-${s.type}"></span>`))}</div>`;
    cells.push(html`<div class="${cls}" role="button" tabindex="0" data-action="select-day" data-key="${key}" aria-label="${d} ${monthName(m0).toLowerCase()} ${y}"${key === selected ? raw(' aria-pressed="true"') : ''}>${raw(inner)}</div>`);
  }
  return cells.join('');
}

/** @param {object} s séance @returns {string} carte de la liste du jour */
export function sessionCardHtml(s) {
  const n = presenceCount(s.id);
  const meta = [
    s.km ? html`<span class="session-km">${s.km} km</span>` : '',
    n > 0 ? html`<span class="session-presence">${n} présent${n > 1 ? 's' : ''}</span>` : '',
    s.photo_path ? '<span class="session-photo-badge">📷 photo</span>' : '',
  ].filter(Boolean);
  return html`<div class="session-card sc-${s.type}" role="button" tabindex="0" data-action="open-session" data-id="${s.id}">
    <div class="sc-time"><b>${s.time || '--:--'}</b><span>${SESSION_SHORT[s.type] ?? ''}</span></div>
    <div class="session-info">
      <div class="session-title">${s.title || SESSION_NAMES[s.type]}</div>
      ${meta.length ? raw(`<div class="session-meta">${meta.join('')}</div>`) : ''}
    </div>
    <div class="session-chevron" aria-hidden="true">›</div>
  </div>`;
}

/** @param {object} mark repère d'un événement du plan @returns {string} bandeau du panneau */
function bannerHtml(mark) {
  return html`<div class="plan-event-banner">
    <div class="plan-event-banner-icon peb-${mark.type}" aria-hidden="true">${EVENT_ICONS[mark.type] ?? '📌'}</div>
    <div class="plan-event-banner-body">
      <div class="plan-event-banner-title">${mark.title || EVENT_LABELS[mark.type]}</div>
      ${mark.desc ? raw(html`<div class="plan-event-banner-sub">${mark.desc}</div>`) : ''}
      <div class="plan-event-banner-date peb-${mark.type}">${formatPlanDate(mark.start, mark.end)}</div>
    </div>
  </div>`;
}

/**
 * @param {object[]} events événements du plan ce jour-là
 * @param {object[]} sessions séances du jour
 * @returns {string} contenu du panneau du jour
 */
export function dayPanelHtml(events, sessions) {
  const cards = sessions.length === 0
    ? '<div class="empty-day"><div class="empty-icon" aria-hidden="true">🏊‍♂️</div>Aucune séance — tape + pour en créer une</div>'
    : sessions.map(sessionCardHtml).join('');
  return events.map(bannerHtml).join('') + cards;
}

/** @returns {string} panneau quand aucun jour n'est choisi */
export function noDayHtml() {
  return '<div class="empty-day"><div class="empty-icon" aria-hidden="true">📅</div>Sélectionne un jour</div>';
}

/**
 * Fiche de lecture d'une séance.
 * @param {object} s
 * @returns {string} contenu de la feuille (la photo s'affiche quand son URL signée arrive)
 */
export function sessionViewHtml(s) {
  const content = sanitizeRich(s.content);
  return html`<div class="modal-handle"></div>
    <div class="sess-view-header">
      <button type="button" class="sess-view-close" data-action="close-modal" data-id="modal-session-view" aria-label="Fermer">✕</button>
      <div class="sess-view-type-badge sv-${s.type}" aria-hidden="true">${TYPE_ICONS[s.type] ?? '📌'}</div>
      <div class="sess-view-title">${s.title || SESSION_NAMES[s.type]}</div>
      <div class="sess-view-meta"><span class="tag tag-${s.type}">${SESSION_NAMES[s.type]}</span><span class="sess-view-time">⏰ ${s.time || '--:--'}</span></div>
    </div>
    <div class="sess-view-body">
      <div class="sess-view-content-html">${content ? raw(content) : raw('<span class="sess-view-empty">Aucun contenu rédigé</span>')}</div>
      ${s.photo_path ? raw(html`<div class="sv-photo-wrapper">
        <img class="sv-photo" data-photo="${s.photo_path}" data-action="open-photo" alt="Photo de la séance" hidden>
        <div class="sv-photo-hint">👆 Toucher pour agrandir</div>
      </div>`) : ''}
      ${s.km > 0 ? raw(html`<div class="sess-view-km"><span class="sess-view-km-icon" aria-hidden="true">🏊</span><div><div class="sess-view-km-val">${s.km} km</div><div class="sess-view-km-label">kilomètres parcourus</div></div></div>`) : ''}
    </div>
    <div class="sess-view-footer">
      <button type="button" class="btn-full btn-ghost" data-action="close-modal" data-id="modal-session-view">Fermer</button>
      <button type="button" class="btn-full btn-accent" data-action="edit-session" data-id="${s.id}">✏️ Modifier</button>
    </div>`;
}

/**
 * Formulaire d'une séance.
 * @param {object|null} s séance modifiée, null pour une nouvelle
 * @param {{type: string}} opts type choisi au départ
 * @returns {string} contenu de la feuille
 */
export function sessionFormHtml(s, { type }) {
  const v = s ?? {};
  return html`<div class="modal-handle"></div>
    <div class="modal-header">
      <div class="modal-title">${s ? 'Modifier la séance' : 'Nouvelle séance'}</div>
      <button type="button" class="modal-close" data-action="close-modal" data-id="modal-session" aria-label="Fermer">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label" for="sess-title">Titre de la séance</label><input type="text" class="form-input" id="sess-title" placeholder="Ex : Endurance, Vitesse, Compétition…" value="${v.title ?? ''}"></div>
      <div class="form-group">
        <span class="form-label" id="sess-type-label">Type</span>
        <div class="type-pills" role="group" aria-labelledby="sess-type-label">${SESSION_TYPES.map((t) => raw(html`<button type="button" class="type-pill${t === type ? ` selected-${t}` : ''}" data-action="pick-type" data-key="${t}" aria-pressed="${t === type}">${TYPE_ICONS[t]} ${SESSION_NAMES[t]}</button>`))}</div>
      </div>
      <div class="form-group"><label class="form-label" for="sess-time">Heure du cours</label><input type="time" class="form-input" id="sess-time" value="${v.time || '08:00'}"></div>
      <div class="form-group">
        <span class="form-label" id="sess-content-label">Contenu de la séance</span>
        <div class="editor-wrapper">
          <div class="editor-toolbar" id="editor-toolbar" role="toolbar" aria-label="Mise en forme">${RICH_BUTTONS.map((b) => raw(b ? html`<button type="button" class="tb-btn" data-action="fmt" data-cmd="${b[0]}" aria-label="${b[2]}">${raw(b[1])}</button>` : '<div class="tb-sep"></div>'))}</div>
          <div class="editor-content" id="editor-content" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="sess-content-label" data-placeholder="Écris ton entraînement ici…" spellcheck="false">${raw(sanitizeRich(v.content))}</div>
          <div class="km-row"${type === 'musc' ? raw(' hidden') : ''} id="sess-km-row">
            <label class="km-label" for="sess-km">🏊 Km :</label>
            <input type="number" class="km-input" id="sess-km" placeholder="0" min="0" step="0.1" value="${v.km ?? ''}">
            <span class="km-unit">km</span>
          </div>
        </div>
      </div>
      <div class="form-group">
        <span class="form-label">📷 Photo de la séance (feuille papier, tableau…)</span>
        <div class="sess-photo-zone" id="sess-photo-zone">
          <div class="sess-photo-empty" id="sess-photo-empty">
            <div class="sess-photo-icon" aria-hidden="true">📷</div>
            <div class="sess-photo-text">Ajouter une photo</div>
            <div class="sess-photo-hint">Prendre en photo ou choisir depuis la galerie</div>
            <div class="sess-photo-actions">
              <button type="button" class="sess-photo-btn" data-action="photo-camera">📸 Prendre une photo</button>
              <button type="button" class="sess-photo-btn secondary" data-action="photo-gallery">🖼 Depuis la galerie</button>
            </div>
          </div>
          <div class="sess-photo-preview" id="sess-photo-preview" hidden>
            <img id="sess-photo-img" alt="Photo de la séance">
            <div class="sess-photo-preview-actions">
              <button type="button" class="sess-photo-btn secondary" data-action="photo-gallery">🔄 Remplacer</button>
              <button type="button" class="sess-photo-btn danger" data-action="photo-remove">🗑 Supprimer la photo</button>
            </div>
          </div>
        </div>
        <input type="file" class="visually-hidden" id="sess-photo-input-cam" data-action="pick-session-photo" data-on="change" accept="image/*" capture="environment" aria-label="Prendre une photo" tabindex="-1">
        <input type="file" class="visually-hidden" id="sess-photo-input-file" data-action="pick-session-photo" data-on="change" accept="image/*" aria-label="Fichier photo" tabindex="-1">
      </div>
      <div class="form-group presence-section" id="session-presence-slot" data-presence-slot></div>
    </div>
    <div class="modal-footer">
      ${s ? raw(html`<button type="button" class="btn-full btn-danger-ghost" data-action="ask-delete-session" data-id="${s.id}">🗑 Supprimer</button>`) : ''}
      <button type="button" class="btn-full btn-accent" data-action="save-session">💾 Enregistrer</button>
    </div>`;
}

/** @param {object} s @returns {string} confirmation de suppression */
export function deleteSessionDialogHtml(s) {
  return html`<div class="dialog-icon" aria-hidden="true">🗑</div>
    <div class="dialog-title">Supprimer « ${s.title || SESSION_NAMES[s.type]} » ?</div>
    <div class="dialog-text">La séance, sa photo et ses présences seront supprimées.</div>
    <div class="dialog-actions">
      <button type="button" class="btn-full btn-ghost" data-action="close-modal" data-id="dialog-session">Annuler</button>
      <button type="button" class="btn-full btn-danger" data-action="do-delete-session" data-id="${s.id}">Supprimer</button>
    </div>`;
}
