/** Gabarits HTML de l'appel d'une séance (design Club). Tout texte saisi passe par `html` (échappé). */
import { html, raw } from '../../core/html.js';
import { swimmerIsActive } from '../../core/season.js';
import { avatarHtml } from '../contacts/view.js';
import { groupName } from '../contacts/logic.js';

/** @returns {string} en-tête, jauge et liste vide de l'appel */
export function rollCallHtml() {
  return `<div class="presence-header">
      <span class="form-label" id="presence-label">Présence des nageurs</span>
      <div class="presence-actions">
        <button type="button" class="btn-sm btn-outline" data-action="presence-all">Tous ✓</button>
        <button type="button" class="btn-sm btn-outline" data-action="presence-none">Aucun</button>
      </div>
    </div>
    <div class="presence-meter">
      <div class="pm-top" id="pm-top" aria-live="polite"><span class="pm-num" id="pm-num">0</span><span class="pm-txt"> / <span id="pm-tot">0</span> présents</span></div>
      <div class="pm-bar" role="progressbar" aria-labelledby="pm-top" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div class="pm-fill" id="pm-fill"></div></div>
    </div>
    <div class="presence-list" id="presence-list" role="group" aria-labelledby="presence-label"></div>`;
}

/**
 * @param {object} sw
 * @param {boolean} checked
 * @returns {string} ligne d'un nageur (bouton case à cocher)
 */
export function presenceRowHtml(sw, checked) {
  const name = `${sw.firstname} ${sw.lastname}`.trim();
  return html`<button type="button" class="presence-row${checked ? ' checked' : ''}" role="checkbox" aria-checked="${checked}" data-action="toggle-presence" data-id="${sw.id}">
    <span class="p-check" aria-hidden="true">${checked ? '✓' : ''}</span>
    <span class="p-avatar" aria-hidden="true">${raw(avatarHtml(sw))}</span>
    <span class="p-name">${name}${swimmerIsActive(sw) ? '' : raw('<span class="archived-badge" title="Archivé">📦</span>')}</span>
    <span class="p-group">${groupName(sw)}</span>
  </button>`;
}

/**
 * @param {object[]} list nageurs de l'appel
 * @param {(id: string) => boolean} isChecked
 * @returns {string} lignes de la liste
 */
export function presenceListHtml(list, isChecked) {
  if (list.length === 0) return '<div class="presence-empty">Aucun nageur dans le carnet</div>';
  return list.map((sw) => presenceRowHtml(sw, isChecked(sw.id))).join('');
}
