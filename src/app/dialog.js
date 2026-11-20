/**
 * Fenêtre de confirmation (design Club, comme les confirmations des Nageurs), utilisable depuis
 * n'importe quel écran, y compris hors de la coque (écrans d'accès).
 * Tous les textes passent par `html` (échappés). Une seule fenêtre à la fois.
 */
import { html, raw } from '../core/html.js';

let current = null;

/**
 * Ouvre une fenêtre de choix et attend la réponse.
 * @param {{title: string, text?: string, icon?: string, cancel?: string, confirm: string, danger?: boolean,
 *   typed?: string, typedLabel?: string}} opts
 *   cancel : libellé du bouton qui ferme sans rien faire (« Annuler » par défaut) ;
 *   typed : texte exact (sensible à la casse) à saisir pour activer le bouton de confirmation
 * @returns {Promise<boolean>} true si l'entraîneur confirme
 */
export function askConfirm(opts) {
  current?.close(false);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay dialog open';
  overlay.innerHTML = html`<div class="dialog-box" role="dialog" aria-modal="true" aria-label="${opts.title}">
    ${opts.icon ? raw(html`<div class="dialog-icon" aria-hidden="true">${opts.icon}</div>`) : ''}
    <div class="dialog-title">${opts.title}</div>
    ${opts.text ? raw(html`<div class="dialog-text">${opts.text}</div>`) : ''}
    ${opts.typed ? raw(html`<label class="form-label dialog-typed-label" for="dialog-typed">${opts.typedLabel ?? ''}</label>
      <input type="text" class="form-input dialog-typed" id="dialog-typed" autocomplete="off" autocapitalize="off" spellcheck="false">`) : ''}
    <div class="dialog-actions">
      <button type="button" class="btn-full btn-ghost" data-dialog="cancel">${opts.cancel ?? 'Annuler'}</button>
      <button type="button" class="btn-full ${opts.danger ? 'btn-danger' : 'btn-accent'}" data-dialog="confirm"${opts.typed ? raw(' disabled') : ''}>${opts.confirm}</button>
    </div>
  </div>`;
  const ok = overlay.querySelector('[data-dialog="confirm"]');
  const input = overlay.querySelector('.dialog-typed');
  return new Promise((resolve) => {
    const close = (answer) => {
      if (current?.overlay !== overlay) return;
      current = null;
      overlay.remove();
      resolve(answer);
    };
    current = { overlay, close };
    input?.addEventListener('input', () => { ok.disabled = input.value !== opts.typed; });
    overlay.addEventListener('click', (ev) => {
      const btn = ev.target instanceof Element ? ev.target.closest('[data-dialog]') : null;
      if (ev.target === overlay || btn?.dataset.dialog === 'cancel') close(false);
      else if (btn?.dataset.dialog === 'confirm' && !btn.disabled) close(true);
    });
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        close(false);
        return;
      }
      if (ev.key !== 'Tab') return;
      // Le focus reste dans la fenêtre (Tab / Maj+Tab bouclent).
      const items = [...overlay.querySelectorAll('input, button')].filter((el) => !el.disabled);
      const at = items.indexOf(document.activeElement);
      const next = ev.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 ? 0 : at + 1);
      ev.preventDefault();
      items[next]?.focus();
    });
    document.body.append(overlay);
    // Jamais le bouton destructif par défaut : le champ à recopier, sinon « Annuler ».
    (input ?? overlay.querySelector('[data-dialog="cancel"]')).focus();
  });
}

/** Ferme la fenêtre ouverte (réponse : non). */
export function closeConfirm() {
  current?.close(false);
}
