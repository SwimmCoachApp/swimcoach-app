/** Gabarits HTML de l'écran Nageurs. Tout texte saisi passe par `html` (échappé). */
import { html, raw } from '../../core/html.js';
import { ageOn } from '../../core/dates.js';
import { swimmerIsActive } from '../../core/season.js';
import { groupName } from './logic.js';

const initials = (sw) => `${(sw.firstname || '')[0] || ''}${(sw.lastname || '')[0] || ''}`.toUpperCase();
const seasonLabel = (s) => `${s}–${String(s + 1).slice(2)}`;

/** @param {object} sw @returns {string} pastille ronde : initiales, et la photo par-dessus quand son URL est prête */
export function avatarHtml(sw) {
  return html`${initials(sw)}${sw.photo_path ? raw(html`<img data-photo="${sw.photo_path}" alt="" hidden>`) : ''}`;
}

/** @returns {string} structure de l'écran (liste, recherche, bascule, modales) */
export function screenHtml() {
  return html`<div class="contacts">
    <div class="search-bar">
      <span class="search-icon" aria-hidden="true">🔍</span>
      <input type="search" class="search-input" id="contact-search" data-action="search" data-on="input" placeholder="Chercher un nageur…" aria-label="Chercher un nageur" autocomplete="off">
    </div>
    <div class="contacts-mode-toggle" role="group" aria-label="Nageurs">
      <button type="button" class="contacts-mode-btn" data-action="mode" data-key="actifs">👥 Actifs <span data-count="actifs"></span></button>
      <button type="button" class="contacts-mode-btn" data-action="mode" data-key="archives">📦 Archivés <span data-count="archives"></span></button>
    </div>
    <div class="group-mail-bar">
      <select class="group-mail-select" id="group-mail-select" data-action="mail-group" data-on="change" aria-label="Groupe à écrire"></select>
      <a class="group-mail-btn" id="group-mail-link" data-action="group-mail" href="#">✉️ Mail groupe</a>
    </div>
    <div class="contacts-list" id="contacts-list"></div>
  </div>
  <button type="button" class="fab" data-action="add-swimmer" aria-label="Ajouter un nageur">+</button>
  <div class="modal-overlay" id="modal-contact" data-action="close-backdrop"><div class="contact-popup" role="dialog" aria-label="Fiche du nageur" id="contact-popup"></div></div>
  <div class="modal-overlay" id="modal-swimmer" data-action="close-backdrop"><div class="modal-sheet" role="dialog" aria-label="Nageur" id="swimmer-sheet"></div></div>
  <div class="modal-overlay dialog" id="dialog-contact" data-action="close-backdrop"><div class="dialog-box" role="dialog" id="dialog-box"></div></div>`;
}

/** @param {object[]} groups @param {string} selected @returns {string} options du « Mail groupe » */
export function mailOptionsHtml(groups, selected) {
  return html`<option value="all"${selected === 'all' ? raw(' selected') : ''}>Tous les actifs</option>${groups.map((g) => raw(html`<option value="${g.id}"${g.id === selected ? raw(' selected') : ''}>${g.name}</option>`))}`;
}

/**
 * @param {object[]} swimmers
 * @param {{filter: 'actifs'|'archives', search: string}} opts
 */
export function listHtml(swimmers, { filter, search }) {
  if (swimmers.length === 0) {
    const msg = filter === 'archives' ? 'Aucun nageur archivé' : search ? 'Aucun résultat' : 'Aucun nageur';
    return html`<div class="empty-day">${msg}</div>`;
  }
  return swimmers.map((sw) => {
    const archived = !swimmerIsActive(sw);
    const name = `${sw.firstname} ${sw.lastname}`.trim();
    const age = sw.dob ? ageOn(sw.dob) : null;
    const sub = [groupName(sw), age == null ? '' : `${age} ans`].filter(Boolean).join(' · ');
    return html`<div class="contact-row-wrap" data-swimmer="${sw.id}">
      <button type="button" class="contact-row-delete-bg" data-action="ask-delete" data-id="${sw.id}" aria-label="Supprimer ${name}" tabindex="-1">🗑</button>
      <div class="contact-row${archived ? ' archived' : ''}" role="button" tabindex="0" data-action="open-contact" data-id="${sw.id}">
        <div class="contact-avatar-lg">${raw(avatarHtml(sw))}</div>
        <div class="contact-info">
          <div class="contact-name">${name}${archived ? raw(html`<span class="archived-badge">📦 ${seasonLabel(sw.left_season)}</span>`) : ''}</div>
          <div class="contact-sub">${sub}</div>
        </div>
        <div class="contact-chevron" aria-hidden="true">›</div>
      </div>
    </div>`;
  }).join('');
}

function formatDob(dob) {
  const [y, m, d] = dob.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** @param {object} sw @returns {string} contenu de la fiche */
export function ficheHtml(sw) {
  const archived = !swimmerIsActive(sw);
  const age = sw.dob ? ageOn(sw.dob) : null;
  const fields = [];
  if (sw.phone) fields.push(['📞', 'Téléphone', sw.phone]);
  if (sw.email) fields.push(['✉️', 'Email', sw.email]);
  fields.push(['🎂', 'Date de naissance', sw.dob ? formatDob(sw.dob) : 'Non renseignée']);
  if (age != null) fields.push(['🏅', 'Âge', `${age} ans`]);
  const phone = (sw.phone || '').replace(/[^\d+]/g, '');
  return html`<div class="modal-handle"></div>
    <div class="contact-popup-header">
      <button type="button" class="contact-popup-avatar" data-action="edit-swimmer" data-id="${sw.id}" aria-label="Changer la photo">${raw(avatarHtml(sw))}</button>
      <div class="contact-popup-name">${`${sw.firstname} ${sw.lastname}`.trim()}</div>
      <div class="contact-popup-group">${groupName(sw) || 'Sans groupe'}${archived ? ` · archivé (${seasonLabel(sw.left_season)})` : ''}</div>
      <button type="button" class="contact-popup-close" data-action="close-modal" data-id="modal-contact" aria-label="Fermer">✕</button>
    </div>
    <div class="contact-fields">${fields.map(([icon, label, val]) => raw(html`<div class="contact-field">
      <div class="field-icon" aria-hidden="true">${icon}</div>
      <div class="field-info"><div class="field-label">${label}</div><div class="field-value">${val}</div></div>
    </div>`))}</div>
    <div class="contact-action-btns">
      ${sw.phone ? raw(html`<a class="contact-action-btn btn-call" href="tel:${phone}">📞 Appeler</a>`) : ''}
      ${sw.email ? raw(html`<a class="contact-action-btn btn-mail" href="mailto:${encodeURIComponent(sw.email)}">✉️ Email</a>`) : ''}
    </div>
    <div class="contact-popup-actions">
      <button type="button" class="btn-full btn-ghost" data-action="edit-swimmer" data-id="${sw.id}">✏️ Modifier</button>
      ${archived
        ? raw(html`<button type="button" class="btn-restore-ghost" data-action="restore" data-id="${sw.id}">↩ Restaurer</button>`)
        : raw(html`<button type="button" class="btn-archive-ghost" data-action="ask-archive" data-id="${sw.id}">📦 Archiver</button>`)}
    </div>`;
}

/** @param {object[]} groups @param {string} selected id du groupe choisi @returns {string} liste déroulante + gestion des groupes */
export function groupBlockHtml(groups, selected) {
  return html`<select class="form-select" id="sw-group" aria-label="Groupe">
      <option value=""${selected ? '' : raw(' selected')}>Aucun groupe</option>
      ${groups.map((g) => raw(html`<option value="${g.id}"${g.id === selected ? raw(' selected') : ''}>${g.name}</option>`))}
    </select>
    <div class="group-manager">
      <div class="group-list-edit">${groups.map((g) => raw(html`<div class="group-item-row">
        <span class="group-item-name">📁 ${g.name}</span>
        <button type="button" class="group-del-btn" data-action="del-group" data-id="${g.id}" aria-label="Supprimer le groupe ${g.name}">−</button>
      </div>`))}</div>
      <div class="group-add-row">
        <input type="text" class="group-add-input" id="group-add-input" placeholder="Nouveau groupe…" aria-label="Nouveau groupe" maxlength="40">
        <button type="button" class="group-add-btn" data-action="add-group">+ Ajouter</button>
      </div>
    </div>`;
}

/** @param {object|null} sw nageur modifié, null pour un nouveau @param {object[]} groups @returns {string} */
export function formHtml(sw, groups) {
  const v = sw ?? {};
  return html`<div class="modal-handle"></div>
    <div class="modal-header">
      <div class="modal-title">${sw ? 'Modifier nageur' : 'Nouveau nageur'}</div>
      <button type="button" class="modal-close" data-action="close-modal" data-id="modal-swimmer" aria-label="Fermer">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <span class="form-label">Photo</span>
        <div class="photo-picker">
          <button type="button" class="photo-preview" id="sw-photo-preview" data-action="choose-photo" aria-label="Choisir une photo"><span id="sw-photo-placeholder">📷</span></button>
          <div class="photo-picker-info">
            <div class="photo-picker-label">Photo du nageur</div>
            <div class="photo-picker-sub">Appuie pour choisir depuis ta galerie</div>
            <button type="button" class="photo-remove-btn" id="sw-photo-remove" data-action="remove-photo" hidden>✕ Supprimer la photo</button>
          </div>
        </div>
        <input type="file" class="visually-hidden" id="sw-photo-input" data-action="pick-photo" data-on="change" accept="image/*" aria-label="Fichier photo" tabindex="-1">
      </div>
      <div class="form-group"><label class="form-label" for="sw-firstname">Prénom</label><input type="text" class="form-input" id="sw-firstname" placeholder="Prénom" value="${v.firstname ?? ''}"></div>
      <div class="form-group"><label class="form-label" for="sw-lastname">Nom</label><input type="text" class="form-input" id="sw-lastname" placeholder="Nom" value="${v.lastname ?? ''}"></div>
      <div class="form-group"><label class="form-label" for="sw-dob">Date de naissance</label><input type="date" class="form-input" id="sw-dob" value="${v.dob ?? ''}"></div>
      <div class="form-group"><span class="form-label">Groupe</span><div id="sw-group-block">${raw(groupBlockHtml(groups, v.group_id ?? ''))}</div></div>
      <div class="form-group"><label class="form-label" for="sw-phone">Téléphone</label><input type="tel" class="form-input" id="sw-phone" placeholder="06 xx xx xx xx" value="${v.phone ?? ''}"></div>
      <div class="form-group"><label class="form-label" for="sw-email">Email</label><input type="email" class="form-input" id="sw-email" placeholder="nom@mail.com" value="${v.email ?? ''}"></div>
    </div>
    <div class="modal-footer">
      ${sw ? raw(html`<button type="button" class="btn-full btn-danger-ghost" data-action="ask-delete" data-id="${sw.id}">🗑 Supprimer</button>`) : ''}
      <button type="button" class="btn-full btn-accent" data-action="save-swimmer">💾 Enregistrer</button>
    </div>`;
}

/** @param {object} sw @returns {string} confirmation de suppression */
export function deleteDialogHtml(sw) {
  return html`<div class="dialog-icon" aria-hidden="true">🗑</div>
    <div class="dialog-title">Supprimer ${`${sw.firstname} ${sw.lastname}`.trim()} ?</div>
    <div class="dialog-text">Cette action supprimera le nageur de toutes les données (présences, statistiques).</div>
    <div class="dialog-actions">
      <button type="button" class="btn-full btn-ghost" data-action="close-modal" data-id="dialog-contact">Annuler</button>
      <button type="button" class="btn-full btn-danger" data-action="do-delete" data-id="${sw.id}">Supprimer</button>
    </div>`;
}

/** @param {object} sw @param {number[]} seasons saisons proposées @param {number} current @returns {string} */
export function archiveDialogHtml(sw, seasons, current) {
  return html`<div class="dialog-icon" aria-hidden="true">📦</div>
    <div class="dialog-title">Archiver ${`${sw.firstname} ${sw.lastname}`.trim()} ?</div>
    <div class="dialog-text">Son historique sera conservé, il n'apparaîtra plus dans l'appel quotidien.</div>
    <div class="dialog-sub">Dernière saison faite :</div>
    <div class="dialog-list">${seasons.map((s) => raw(html`<button type="button" class="archive-season-btn${s === current ? ' default' : ''}" data-action="do-archive" data-id="${sw.id}" data-season="${s}">Saison ${seasonLabel(s)}</button>`))}</div>
    <div class="dialog-actions"><button type="button" class="btn-full btn-ghost" data-action="close-modal" data-id="dialog-contact">Annuler</button></div>`;
}
