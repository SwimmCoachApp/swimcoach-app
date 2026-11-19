/** Thème clair / sombre, mémorisé dans appStore 'theme'. Sombre par défaut (comme l'ancienne app). */
import { appStore } from '../core/storage.js';

const THEMES = ['light', 'dark'];

/** @returns {'light'|'dark'} */
export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** @param {'light'|'dark'} theme */
export function applyTheme(theme) {
  if (!THEMES.includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  appStore.set('theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#0A1F44' : '#071327');
}

/** Applique le thème mémorisé (sombre à défaut). */
export function initTheme() {
  const saved = appStore.get('theme');
  applyTheme(THEMES.includes(saved) ? saved : 'dark');
}
