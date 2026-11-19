import { vi } from 'vitest';

const upserts = [];
vi.mock('../../src/core/supabase.js', () => ({
  supabase: { from: (table) => ({ upsert: async (row) => { upserts.push({ table, row }); return { error: null }; } }) },
}));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));

const { saveRow } = await import('../../src/core/data.js');
const { db, loadCache, resetStore } = await import('../../src/core/store.js');

beforeEach(() => {
  localStorage.clear();
  upserts.length = 0;
  resetStore({ save: false });
  loadCache('A', 'T1');
});

test('saveRow : par défaut toute la ligne part ; avec send, le store garde la ligne entière mais seules ces colonnes partent', async () => {
  saveRow('swimmers', { id: 'x', firstname: 'Léa', lastname: 'M' });
  saveRow('plan_weeks', { week_key: '2026-W47', season_start: 2026, content: 'a', zone: 'z', km_target: 3 }, { send: { week_key: '2026-W47', season_start: 2026, zone: 'z' } });
  expect(db.plan_weeks.get('2026-W47')).toMatchObject({ content: 'a', zone: 'z', km_target: 3, team_id: 'T1' });
  await vi.waitFor(() => expect(upserts).toHaveLength(2));
  expect(upserts[0].row).toEqual({ id: 'x', firstname: 'Léa', lastname: 'M', team_id: 'T1' });
  expect(upserts[1].row).toEqual({ week_key: '2026-W47', season_start: 2026, zone: 'z', team_id: 'T1' });
});
