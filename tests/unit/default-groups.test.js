import { vi } from 'vitest';

vi.mock('../../src/core/supabase.js', () => ({ supabase: { from: () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) } }));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));

const { ensureDefaultGroups, DEFAULT_GROUPS } = await import('../../src/core/default-groups.js');
const { db, loadCache, resetStore, upsertLocal, deleteLocal } = await import('../../src/core/store.js');
const { pendingCount } = await import('../../src/core/outbox.js');

beforeEach(() => {
  localStorage.clear();
  resetStore({ save: false });
  loadCache('A', 'T1');
});

test('espace sans groupe : les 6 groupes par défaut sont créés (store + file), dans l’ordre', () => {
  expect(ensureDefaultGroups()).toBe(true);
  expect([...db.groups.values()].map((g) => g.name)).toEqual(DEFAULT_GROUPS);
  expect([...db.groups.values()].map((g) => g.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(pendingCount('T1', 'A')).toBe(6);
  expect(ensureDefaultGroups()).toBe(false); // une seule fois
  expect(db.groups.size).toBe(6);
});

test('espace avec au moins un groupe : rien n’est créé', () => {
  upsertLocal('groups', { id: 'g1', name: 'Mon groupe', sort_order: 0 });
  expect(ensureDefaultGroups()).toBe(false);
  expect(db.groups.size).toBe(1);
  expect(pendingCount('T1', 'A')).toBe(0);
});

test('une seule fois par espace et par appareil : groupes tous supprimés, ils ne reviennent pas', () => {
  expect(ensureDefaultGroups()).toBe(true);
  for (const key of [...db.groups.keys()]) deleteLocal('groups', key);
  expect(db.groups.size).toBe(0);
  expect(ensureDefaultGroups()).toBe(false);
  expect(db.groups.size).toBe(0);
  resetStore({ save: false });
  loadCache('A', 'T2'); // un autre espace est proposé à son tour
  expect(ensureDefaultGroups()).toBe(true);
});

test('espace qui a déjà des groupes : compté comme proposé, vider les groupes ne les recrée pas', () => {
  upsertLocal('groups', { id: 'g1', name: 'Mon groupe', sort_order: 0 });
  expect(ensureDefaultGroups()).toBe(false);
  deleteLocal('groups', 'g1');
  expect(ensureDefaultGroups()).toBe(false);
});
