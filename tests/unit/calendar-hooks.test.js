import { vi } from 'vitest';

vi.mock('../../src/core/supabase.js', () => ({
  supabase: { storage: { from: () => ({}) }, from: () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) },
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

const { registerCalendarScreen, onSessionFormOpen, onSessionSaved } = await import('../../src/features/calendar/index.js');
const { db, loadCache, resetStore } = await import('../../src/core/store.js');
const { todayKey } = await import('../../src/core/dates.js');

const TEAM = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  localStorage.clear();
  toasts.length = 0;
  resetStore({ save: false });
  loadCache('A', TEAM);
});

test('un crochet qui plante (ouverture ou enregistrement) n’empêche rien et n’affiche aucune erreur après un enregistrement réussi', async () => {
  const calls = [];
  const offs = [
    onSessionFormOpen(() => { throw new Error('boum ouverture'); }),
    onSessionFormOpen(() => calls.push('open')),
    onSessionSaved(() => { throw new Error('boum enregistrement'); }),
    onSessionSaved(() => calls.push('saved')),
  ];
  registerCalendarScreen();
  const root = document.createElement('section');
  document.body.replaceChildren(root);
  screens.get('calendar').render(root);
  root.querySelector(`[data-action="select-day"][data-key="${todayKey()}"]`).click();
  root.querySelector('[data-action="add-session"]').click();
  expect(root.querySelector('#modal-session').classList.contains('open')).toBe(true);
  root.querySelector('#sess-title').value = 'Endurance';
  root.querySelector('[data-action="save-session"]').click();
  await vi.waitFor(() => expect(toasts).toContain('Séance enregistrée'));
  await vi.waitFor(() => expect(calls).toEqual(['open', 'saved']));
  expect(toasts).toEqual(['Séance enregistrée']);
  expect([...db.sessions.values()].map((s) => s.title)).toEqual(['Endurance']);
  for (const off of offs) off();
});
