/** Réglages : balisage (tous les textes variables passent par `html`, donc échappés). */
import { html, raw } from '../../core/html.js';

/**
 * @param {{email: string, displayName: string, theme: 'light'|'dark', space: string}} p
 *   space : balisage déjà sûr de la section « Espace »
 * @returns {string}
 */
export function screenHtml(p) {
  const themeBtn = (value, label) => html`<button type="button" class="settings-choice${p.theme === value ? ' active' : ''}" data-action="settings-theme" data-key="${value}" aria-pressed="${p.theme === value ? 'true' : 'false'}">${label}</button>`;
  return html`<h1 class="screen-title">Réglages</h1>
    <section class="settings-card" aria-labelledby="settings-profile-title">
      <h2 class="settings-title" id="settings-profile-title">Profil</h2>
      <p class="settings-note">Connecté en tant que <strong>${p.email}</strong></p>
      <label class="form-label" for="settings-display-name">Nom affiché</label>
      <div class="settings-row">
        <input type="text" class="form-input" id="settings-display-name" maxlength="60" autocomplete="name" value="${p.displayName}" placeholder="Prénom Nom">
        <button type="button" class="btn-sm btn-accent" data-action="settings-save-name">Enregistrer le nom</button>
      </div>
      <p class="settings-note">Visible par les autres membres de tes espaces.</p>
    </section>
    <section class="settings-card" aria-labelledby="settings-theme-title">
      <h2 class="settings-title" id="settings-theme-title">Apparence</h2>
      <div class="settings-choices" role="group" aria-label="Thème">${raw(themeBtn('light', 'Clair'))}${raw(themeBtn('dark', 'Sombre'))}</div>
    </section>
    <section class="settings-card" aria-labelledby="settings-groups-title">
      <h2 class="settings-title" id="settings-groups-title">Groupes</h2>
      <div id="settings-groups"></div>
      <div class="settings-row">
        <input type="text" class="form-input" id="settings-group-input" maxlength="40" autocomplete="off" placeholder="Nouveau groupe…" aria-label="Nouveau groupe">
        <button type="button" class="btn-sm btn-accent" data-action="settings-add-group">Ajouter le groupe</button>
      </div>
    </section>
    ${raw(p.space)}
    <section class="settings-card" aria-labelledby="settings-sync-title">
      <h2 class="settings-title" id="settings-sync-title">Synchronisation</h2>
      <div id="settings-sync"></div>
    </section>
    <section class="settings-card" aria-labelledby="settings-account-title">
      <h2 class="settings-title" id="settings-account-title">Compte</h2>
      <button type="button" class="btn-full btn-accent" data-action="logout">Se déconnecter</button>
      <button type="button" class="btn-full btn-danger-ghost settings-gap" data-action="settings-delete-account">Supprimer mon compte</button>
      <p class="settings-note settings-gap"><a class="btn-link" href="./privacy.html">Confidentialité</a></p>
    </section>`;
}

/** @param {{id: string, name: string}[]} groups @returns {string} */
export function groupsHtml(groups) {
  if (!groups.length) return '<p class="settings-note">Aucun groupe.</p>';
  return html`<ul class="settings-list">${groups.map((g) => raw(html`<li class="settings-group-row">
      <span class="member-name">📁 ${g.name}</span>
      <button type="button" class="btn-sm btn-ghost" data-action="settings-del-group" data-id="${g.id}" aria-label="Supprimer le groupe ${g.name}">−</button>
    </li>`))}</ul>`;
}

/**
 * @param {number} pending écritures en attente d'envoi
 * @param {number} rejected écritures refusées par le serveur
 * @returns {string}
 */
export function syncHtml(pending, rejected) {
  const pendingText = pending ? `${pending} ${pending > 1 ? "modifications en attente d'envoi" : "modification en attente d'envoi"}` : 'Toutes les modifications sont envoyées';
  const rejectedBlock = rejected
    ? html`<div class="settings-rejected">
        <p class="settings-warn">${rejected} modification(s) refusée(s) par le serveur</p>
        <p class="settings-note">Exporte-les pour garder une trace avant de les effacer.</p>
        <div class="settings-row">
          <button type="button" class="btn-sm btn-ghost" data-action="settings-export-rejected">Exporter</button>
          <button type="button" class="btn-sm btn-danger-ghost" data-action="settings-clear-rejected">Effacer</button>
        </div>
      </div>`
    : '';
  return html`<p class="settings-note">${pendingText}</p>${raw(rejectedBlock)}`;
}
