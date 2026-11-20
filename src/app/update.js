/** Mise à jour de l'application : bandeau « Nouvelle version disponible — Recharger ». */
import { registerSW } from 'virtual:pwa-register';
import { on } from './actions.js';

let updateSW = null;

on('reload-app', () => {
  if (updateSW) updateSW(true);
  else location.reload();
});

function showBanner() {
  if (document.querySelector('.update-banner')) return;
  const el = document.createElement('div');
  el.className = 'update-banner';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'Nouvelle version disponible —';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.action = 'reload-app';
  btn.textContent = 'Recharger';
  el.append(text, btn);
  document.body.append(el);
}

/** Enregistre le service worker (mode « prompt » : la nouvelle version attend la confirmation). */
export function initUpdate() {
  updateSW = registerSW({ onNeedRefresh: showBanner });
}
