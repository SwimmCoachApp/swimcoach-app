import { vi } from 'vitest';

vi.mock('../../src/core/supabase.js', () => ({
  // l'envoi échoue (réseau) : la file reste lisible telle qu'elle a été remplie
  supabase: { storage: { from: () => ({}) }, from: () => ({ upsert: async () => { throw new Error('network'); } }) },
}));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));
const screens = new Map();
vi.mock('../../src/app/shell.js', () => ({
  registerScreen: (name, def) => screens.set(name, def),
  openModal: (id) => document.getElementById(id)?.classList.add('open'),
  closeModal: (id) => document.getElementById(id)?.classList.remove('open'),
}));
const toasts = [];
vi.mock('../../src/app/toast.js', () => ({ toast: (m) => toasts.push(m) }));
let releaseUpload;
vi.mock('../../src/core/photos.js', () => ({
  photoUrl: async () => 'blob:x',
  resizeImage: async () => new Blob(['x'], { type: 'image/jpeg' }),
  uploadPhoto: (kind, id) => new Promise((resolve) => { releaseUpload = () => resolve(`team/${kind}/${id}.jpg`); }),
  deletePhoto: async () => {},
}));

const { registerCalendarScreen } = await import('../../src/features/calendar/index.js');
const { registerPresence } = await import('../../src/features/presence/index.js');
const { db, loadCache, resetStore, upsertLocal, deleteLocal } = await import('../../src/core/store.js');
const { teamStore } = await import('../../src/core/storage.js');
const { todayKey } = await import('../../src/core/dates.js');
const { seasonOfDateKey } = await import('../../src/core/season.js');

const TEAM = '55555555-5555-4555-8555-555555555555';
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ops = () => (teamStore('A', TEAM).get('outbox') ?? []).map((o) => `${o.kind} ${o.table === 'presence' ? o.key.split(':')[1] : o.table}`);
let root;
const $ = (sel) => root.querySelector(sel);

registerCalendarScreen();
registerPresence();

beforeEach(() => {
  localStorage.clear();
  toasts.length = 0;
  resetStore({ save: false });
  loadCache('A', TEAM);
  const season = seasonOfDateKey(todayKey());
  for (const id of ['A', 'B', 'C']) upsertLocal('swimmers', { id, firstname: 'N', lastname: id, joined_season: season, left_season: null });
  root = document.createElement('section');
  document.body.replaceChildren(root);
  screens.get('calendar').render(root);
  $(`[data-action="select-day"][data-key="${todayKey()}"]`).click();
});

const rowOf = (id) => $(`.presence-row[data-id="${id}"]`);

test('séance supprimée ailleurs pendant l’appel : toast, liste bloquée, aucune op ni brouillon', async () => {
  upsertLocal('sessions', { id: S1, date: todayKey(), type: 'nat', title: 'Endurance', time: '18:00' });
  $('[data-action="open-session"]').click();
  $('[data-action="edit-session"]').click();
  await vi.waitFor(() => expect(rowOf('A')).not.toBeNull());
  deleteLocal('sessions', S1); // relecture : la séance n'existe plus sur le serveur
  expect($('#session-presence-slot').classList.contains('is-deleted')).toBe(true);
  rowOf('A').click();
  expect(toasts).toEqual(['Cette séance a été supprimée']);
  expect(rowOf('A').getAttribute('aria-disabled')).toBe('true');
  expect(rowOf('A').classList.contains('checked')).toBe(false);
  $('[data-action="presence-all"]').click();
  expect(ops()).toEqual([]);
  expect(db.presence.size).toBe(0);
});

test('nouvelle séance : une autre feuille ouverte pendant l’envoi de la photo ne fait pas perdre ses coches', async () => {
  $('[data-action="add-session"]').click();
  rowOf('A').click();
  rowOf('C').click();
  expect($('#pm-top').textContent).toBe('2 / 3 présents');
  const input = $('#sess-photo-input-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect($('#sess-photo-preview').hidden).toBe(false));
  $('[data-action="save-session"]').click();
  await vi.waitFor(() => expect(releaseUpload).toBeTypeOf('function'));
  // pendant l'envoi : fermeture et nouvelle feuille (qui oublie les brouillons non enregistrés)
  $('#modal-session .modal-close').click();
  $('[data-action="add-session"]').click();
  expect($('#pm-top').textContent).toBe('0 / 3 présents');
  releaseUpload();
  await vi.waitFor(() => expect(toasts).toContain('Séance enregistrée'));
  expect(ops()).toEqual(['upsert sessions', 'upsert A', 'upsert C']);
});
