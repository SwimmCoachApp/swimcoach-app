/** Gabarits HTML de l'écran Nageurs. Tout texte saisi passe par `html` (échappé). */
import { html, raw } from '../../core/html.js';
import { ageOn } from '../../core/dates.js';
import { swimmerIsActive } from '../../core/season.js';
import { groupLabel, phoneNumbers, emailAddresses } from './logic.js';
import { FEATURES } from '../../core/features.js';

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
      ${FEATURES.groups ? raw('<select class="group-mail-select" id="group-mail-select" data-action="mail-group" data-on="change" aria-label="Groupe à écrire"></select>') : ''}
      <a class="group-mail-btn" id="group-mail-link" data-action="group-mail" href="#">✉️ ${FEATURES.groups ? 'Mail groupe' : 'Mail à tous'}</a>
    </div>
    <button type="button" class="import-btn" data-action="import-open">📊 Importer depuis Excel / CSV</button>
    <div class="contacts-list" id="contacts-list"></div>
  </div>
  <button type="button" class="fab" data-action="add-swimmer" aria-label="Ajouter un nageur">+</button>
  <div class="modal-overlay" id="modal-contact" data-action="close-backdrop"><div class="contact-popup" role="dialog" aria-label="Fiche du nageur" id="contact-popup"></div></div>
  <div class="modal-overlay" id="modal-swimmer" data-action="close-backdrop"><div class="modal-sheet" role="dialog" aria-label="Nageur" id="swimmer-sheet"></div></div>
  <div class="modal-overlay" id="modal-import" data-action="close-backdrop"><div class="modal-sheet" role="dialog" aria-label="Importer des nageurs">
    <input type="file" class="visually-hidden" id="import-file" data-action="import-file" data-on="change" accept=".xlsx,.csv,text/csv" aria-label="Fichier à importer" tabindex="-1">
    <div id="import-sheet"></div>
  </div></div>
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
    const sub = [groupLabel(sw), age == null ? '' : `${age} ans`].filter(Boolean).join(' · ');
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

/**
 * Fiche du nageur : le haut défile, les boutons (appeler, écrire, modifier, archiver) restent
 * toujours visibles en bas de l'écran.
 * @param {object} sw
 * @returns {string} contenu de la fiche
 */
export function ficheHtml(sw) {
  const archived = !swimmerIsActive(sw);
  const age = sw.dob ? ageOn(sw.dob) : null;
  const phones = phoneNumbers(sw.phone);
  const fields = [];
  if (phones.length) {
    for (const p of phones) fields.push(['📞', p.label ? `Téléphone · ${p.label}` : 'Téléphone', p.display]);
  } else if (sw.phone) {
    fields.push(['📞', 'Téléphone', sw.phone]);
  }
  const emails = emailAddresses(sw.email);
  if (emails.length) for (const e of emails) fields.push(['✉️', 'Email', e]);
  else if (sw.email) fields.push(['✉️', 'Email', sw.email]);
  fields.push(['🎂', 'Date de naissance', sw.dob ? formatDob(sw.dob) : 'Non renseignée']);
  if (age != null) fields.push(['🏅', 'Âge', `${age} ans`]);
  const callLabel = (p) => (p.label ? `${p.label} · ${p.display}` : p.display);
  let call = '';
  if (phones.length === 1) {
    call = html`<a class="contact-action-btn btn-call" href="tel:${phones[0].tel}">📞 Appeler</a>`;
  } else if (phones.length > 1) {
    call = html`<button type="button" class="contact-action-btn btn-call" data-action="call-choose" aria-expanded="false" aria-controls="call-choices">📞 Appeler</button>`;
  }
  return html`<div class="modal-handle"></div>
    <div class="contact-popup-body">
      <div class="contact-popup-header">
        <button type="button" class="contact-popup-avatar" data-action="edit-swimmer" data-id="${sw.id}" aria-label="Changer la photo">${raw(avatarHtml(sw))}</button>
        <div class="contact-popup-name">${`${sw.firstname} ${sw.lastname}`.trim()}</div>
        <div class="contact-popup-group">${[FEATURES.groups ? groupLabel(sw) || 'Sans groupe' : '', archived ? `archivé (${seasonLabel(sw.left_season)})` : ''].filter(Boolean).join(' · ')}</div>
        <button type="button" class="contact-popup-close" data-action="close-modal" data-id="modal-contact" aria-label="Fermer">✕</button>
      </div>
      <div class="contact-fields">${fields.map(([icon, label, val]) => raw(html`<div class="contact-field">
        <div class="field-icon" aria-hidden="true">${icon}</div>
        <div class="field-info"><div class="field-label">${label}</div><div class="field-value">${val}</div></div>
      </div>`))}</div>
    </div>
    <div class="contact-popup-footer">
      ${phones.length > 1 ? raw(html`<div class="call-choices" id="call-choices" hidden>
        <div class="call-choices-title">Quel numéro appeler ?</div>
        ${phones.map((p) => raw(html`<a class="call-choice" href="tel:${p.tel}">📞 ${callLabel(p)}</a>`))}
      </div>`) : ''}
      ${call || emails.length ? raw(html`<div class="contact-action-btns">
        ${call ? raw(call) : ''}
        ${emails.length ? raw(html`<a class="contact-action-btn btn-mail" href="mailto:${emails.map(encodeURIComponent).join(',')}">✉️ Email</a>`) : ''}
      </div>`) : ''}
      <div class="contact-popup-actions">
        <button type="button" class="btn-full btn-ghost" data-action="edit-swimmer" data-id="${sw.id}">✏️ Modifier</button>
        ${archived
          ? raw(html`<button type="button" class="btn-restore-ghost" data-action="restore" data-id="${sw.id}">↩ Restaurer</button>`)
          : raw(html`<button type="button" class="btn-archive-ghost" data-action="ask-archive" data-id="${sw.id}">📦 Archiver</button>`)}
      </div>
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
      ${FEATURES.groups ? raw(html`<div class="form-group"><span class="form-label">Groupe</span><div id="sw-group-block">${raw(groupBlockHtml(groups, v.group_id ?? ''))}</div></div>`) : ''}
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

const plural = (n, one, many) => (n > 1 ? many : one);
const nameOf = (r) => `${r.firstname} ${r.lastname}`.trim();
const nameList = (rows) => {
  const shown = rows.slice(0, 20).map(nameOf).join(', ');
  return rows.length > 20 ? `${shown}…` : shown;
};
const importHeader = html`<div class="modal-handle"></div>
    <div class="modal-header">
      <div class="modal-title">Importer des nageurs</div>
      <button type="button" class="modal-close" data-action="close-modal" data-id="modal-import" aria-label="Fermer">✕</button>
    </div>`;

/**
 * Première étape de l'import : choix du fichier (ou lecture en cours).
 * @param {{errors?: string[], busy?: boolean}} [opts] errors : messages du dernier fichier refusé
 * @returns {string}
 */
export function importChooseHtml({ errors = [], busy = false } = {}) {
  return html`${raw(importHeader)}
    <div class="modal-body">
      <p class="import-help">Un fichier Excel (.xlsx) ou CSV avec les colonnes Nom, Prénom, Date de naissance, Email${FEATURES.groups ? ', Téléphone et Groupe' : ' et Téléphone'}. Les nageurs déjà présents ne sont pas recréés.</p>
      ${errors.map((e) => raw(html`<div class="import-error" role="alert">❗ ${e}</div>`))}
      ${busy ? raw('<div class="import-help" role="status">📄 Lecture du fichier…</div>') : ''}
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-full btn-ghost" data-action="import-template">⬇️ Télécharger le modèle</button>
      <button type="button" class="btn-full btn-accent" data-action="import-choose"${busy ? raw(' disabled') : ''}>📄 Choisir un fichier</button>
    </div>`;
}

/**
 * Aperçu avant création (tout texte du fichier est échappé).
 * @param {{toCreate: object[], duplicates: object[], ignoredArchived: object[]}} plan
 * @param {{selected: Set<number>, newGroups: string[], warnings: string[], busy: boolean}} view
 * @returns {string}
 */
export function importPreviewHtml(plan, { selected, newGroups, warnings, busy }) {
  const n = selected.size;
  return html`${raw(importHeader)}
    <div class="modal-body">
      <div class="import-preview-header" id="import-summary">${plan.toCreate.length} à créer, ${plan.duplicates.length} doublons, 📦 ${plan.ignoredArchived.length} archivés ignorés</div>
      ${plan.invalid.length ? raw(html`<div class="import-warning">⚠️ ${plan.invalid.length} ${plural(plan.invalid.length, 'ligne sans prénom ignorée', 'lignes sans prénom ignorées')} : ${nameList(plan.invalid)}</div>`) : ''}
      ${warnings.slice(0, 5).map((w) => raw(html`<div class="import-warning">⚠️ ${w}</div>`))}
      ${warnings.length > 5 ? raw(html`<div class="import-warning">⚠️ … et ${warnings.length - 5} autres avertissements</div>`) : ''}
      <div class="import-preview-rows">${plan.toCreate.map((r, i) => raw(html`<div class="import-preview-row">
        <button type="button" class="imp-check${selected.has(i) ? ' on' : ''}" data-action="import-toggle" data-i="${i}" role="checkbox" aria-checked="${selected.has(i) ? 'true' : 'false'}" aria-label="${nameOf(r)}">${selected.has(i) ? '✓' : ''}</button>
        <div class="import-row-info">
          <div class="import-row-name">${nameOf(r)}</div>
          <div class="import-row-sub">${[FEATURES.groups ? r.group || 'Autre' : '', r.dob, r.phone].filter(Boolean).join(' · ')}</div>
        </div>
      </div>`))}</div>
      ${newGroups.length ? raw(html`<div class="import-note">📁 ${newGroups.length} ${plural(newGroups.length, 'groupe sera créé', 'groupes seront créés')} : ${newGroups.join(', ')}</div>`) : ''}
      ${plan.duplicates.length ? raw(html`<div class="import-note">Déjà présents : ${nameList(plan.duplicates)}</div>`) : ''}
      ${plan.ignoredArchived.length ? raw(html`<div class="import-note">📦 Archivés (non recréés) : ${nameList(plan.ignoredArchived)}</div>`) : ''}
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-full btn-ghost" data-action="import-cancel">✕ Annuler</button>
      <button type="button" class="btn-full btn-accent" data-action="import-confirm"${busy ? raw(' disabled') : ''}>✅ Importer ${n} ${plural(n, 'nageur', 'nageurs')}</button>
    </div>`;
}
