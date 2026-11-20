import { vi } from 'vitest';
import { on } from '../../src/app/actions.js';

afterEach(() => { document.body.innerHTML = ''; });

test('un clic appelle le handler du data-action le plus proche', () => {
  const card = vi.fn();
  const del = vi.fn();
  on('t-card', card);
  on('t-del', del);
  document.body.innerHTML = '<div data-action="t-card"><button id="b" data-action="t-del" data-id="7"><i id="i"></i></button></div>';
  document.getElementById('i').click();
  expect(del).toHaveBeenCalledTimes(1);
  expect(del.mock.calls[0][0].dataset.id).toBe('7');
  expect(card).not.toHaveBeenCalled();
});

test('un champ data-on="change" arrête la remontée : le clic ne déclenche pas l’action du parent', () => {
  const card = vi.fn();
  const pick = vi.fn();
  on('t-card2', card);
  on('t-pick', pick, 'change');
  document.body.innerHTML = '<div data-action="t-card2"><select id="s" data-action="t-pick" data-on="change"><option>a</option></select></div>';
  document.getElementById('s').click();
  expect(card).not.toHaveBeenCalled();
  document.getElementById('s').dispatchEvent(new Event('change', { bubbles: true }));
  expect(pick).toHaveBeenCalledTimes(1);
});

test('role="button" avec data-action s’active à Entrée et Espace, pas pour les autres touches', () => {
  const fn = vi.fn();
  on('t-key', fn);
  document.body.innerHTML = '<div id="r" role="button" tabindex="0" data-action="t-key"></div>';
  const r = document.getElementById('r');
  r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  r.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  r.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  expect(fn).toHaveBeenCalledTimes(2);
});

test('un vrai bouton n’est pas déclenché deux fois par le clavier', () => {
  const fn = vi.fn();
  on('t-key2', fn);
  document.body.innerHTML = '<button id="b" data-action="t-key2"></button>';
  document.getElementById('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(fn).not.toHaveBeenCalled();
});
