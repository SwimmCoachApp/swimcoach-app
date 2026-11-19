/** Thème clair / sombre, mémorisé dans appStore 'theme'. Sombre par défaut (comme l'ancienne app). */
import { appStore } from '../core/storage.js';

const THEMES = ['light', 'dark'];

/** @returns {'light'|'dark'} */
export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Applique et mémorise le choix de l'utilisateur. @param {'light'|'dark'} theme */
export function applyTheme(theme) {
  if (!THEMES.includes(theme)) return;
  show(theme);
  appStore.set('theme', theme); // seulement sur choix de l'utilisateur
}

function show(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#0A1F44' : '#071327');
}

/** Applique le thème mémorisé (sombre à défaut). */
export function initTheme() {
  const saved = appStore.get('theme');
  show(THEMES.includes(saved) ? saved : 'dark'); // le défaut n'est pas écrit
}
