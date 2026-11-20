import { vi } from 'vitest';

vi.mock('../../src/core/supabase.js', () => ({ supabase: { from: () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) } }));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));

const { FEATURES } = await import('../../src/core/features.js');
const { saveSwimmer, groupLabel, groupName } = await import('../../src/features/contacts/logic.js');
const { runImport } = await import('../../src/features/contacts/import.js');
const { screenHtml } = await import('../../src/features/contacts/view.js');
const { db, loadCache, resetStore, upsertLocal } = await import('../../src/core/store.js');

beforeEach(() => {
  localStorage.clear();
  resetStore({ save: false });
  loadCache('A', 'T1');
  upsertLocal('groups', { id: 'g1', name: 'Benjamins', sort_order: 0 });
});
afterEach(() => { FEATURES.groups = false; });

test('groupes masqués par défaut : aucun groupe affiché, « Mail à tous » sans liste de groupes', () => {
  expect(FEATURES.groups).toBe(false);
  const sw = { id: 's1', firstname: 'Léa', group_id: 'g1' };
  expect(groupName(sw)).toBe('Benjamins');
  expect(groupLabel(sw)).toBe('');
  const page = screenHtml();
  expect(page).toContain('Mail à tous');
  expect(page).not.toContain('group-mail-select');
});

test('groupes masqués : modifier un nageur garde son groupe', async () => {
  upsertLocal('swimmers', { id: 's1', firstname: 'Léa', lastname: 'M', group_id: 'g1', joined_season: 2026, left_season: null });
  await saveSwimmer({ id: 's1', firstname: 'Léa', lastname: 'Martin' });
  expect(db.swimmers.get('s1')).toMatchObject({ lastname: 'Martin', group_id: 'g1' });
});

test('groupes masqués : l’import ignore la colonne Groupe et ne crée aucun groupe', async () => {
  const res = await runImport([{ firstname: 'Tom', lastname: 'B', group: 'Élite', dob: null, phone: '', email: '' }]);
  expect(res).toMatchObject({ created: 1, groupsCreated: 0 });
  expect(db.groups.size).toBe(1);
  expect([...db.swimmers.values()][0].group_id).toBeNull();
});

test('groupes réaffichés : l’import crée le groupe et y range le nageur', async () => {
  FEATURES.groups = true;
  const res = await runImport([{ firstname: 'Tom', lastname: 'B', group: 'Élite', dob: null, phone: '', email: '' }]);
  expect(res).toMatchObject({ created: 1, groupsCreated: 1 });
  const sw = [...db.swimmers.values()][0];
  expect(groupLabel(sw)).toBe('Élite');
  expect(screenHtml()).toContain('group-mail-select');
});
