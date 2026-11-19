import { applyTheme, initTheme, currentTheme } from '../../src/app/theme.js';
import { appStore } from '../../src/core/storage.js';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

test('le thème par défaut est sombre (comme l’ancienne app)', () => {
  initTheme();
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(currentTheme()).toBe('dark');
});

test('applyTheme pose data-theme et le mémorise dans appStore', () => {
  applyTheme('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(appStore.get('theme')).toBe('light');
  initTheme();
  expect(document.documentElement.dataset.theme).toBe('light');
});

test('une valeur inconnue est ignorée', () => {
  applyTheme('light');
  applyTheme('rose');
  expect(currentTheme()).toBe('light');
});

test('au premier chargement, le thème par défaut n’est pas écrit dans le stockage', () => {
  initTheme();
  expect(appStore.get('theme')).toBeNull();
  applyTheme('dark'); // choix de l'utilisateur
  expect(appStore.get('theme')).toBe('dark');
});
