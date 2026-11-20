import { vi } from 'vitest';
import { teamStore, coachStore } from '../../src/core/storage.js';

const A = '11111111-1111-4111-8111-111111111111';
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const server = { teams: [], error: null };
vi.mock('../../src/core/supabase.js', () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        then: (resolve) => resolve(server.error ? { data: null, error: server.error } : { data: server.teams, error: null }),
      };
      return q;
    },
  },
}));
vi.mock('../../src/core/session.js', () => ({
  getCoach: () => ({ id: A }),
  onCoachChange: () => () => {},
}));

const { listMyTeams } = await import('../../src/core/teams.js');

beforeEach(() => {
  localStorage.clear();
  server.error = null;
});

function cacheTwoTeams() {
  coachStore(A).set('teams', [{ id: T1, name: 'Benjamins' }, { id: T2, name: 'Avenirs' }]);
  teamStore(A, T1).set('cache', { groups: [] });
  teamStore(A, T2).set('cache', { groups: [{ id: 'g' }] });
  teamStore(A, T2).set('outbox', [{ id: 'o', table: 'groups', kind: 'delete', key: 'g', coachId: A, teamId: T2 }]);
  coachStore(A).set('outboxTeams', [T2]);
}

const keysOf = (team) => Object.keys(localStorage).filter((k) => k.startsWith(`swimcoach2_${A}_${team}_`));

test("listMyTeams : le cache et la file d'un espace qui n'est plus dans la liste sont effacés", async () => {
  cacheTwoTeams();
  server.teams = [{ id: T1, name: 'Benjamins' }];
  expect(await listMyTeams()).toEqual([{ id: T1, name: 'Benjamins' }]);
  expect(keysOf(T2)).toEqual([]);
  expect(coachStore(A).get('outboxTeams')).toBeNull();
  expect(teamStore(A, T1).get('cache')).toEqual({ groups: [] });
});

test("listMyTeams : un espace en cache absent de l'ancienne liste (clés seulement) est aussi effacé", async () => {
  coachStore(A).set('teams', [{ id: T1, name: 'Benjamins' }]);
  teamStore(A, T1).set('cache', { groups: [] });
  teamStore(A, T3).set('cache', { groups: [{ id: 'x' }] });
  server.teams = [{ id: T1, name: 'Benjamins' }];
  await listMyTeams();
  expect(keysOf(T3)).toEqual([]);
  expect(keysOf(T1)).toHaveLength(1);
});

test('listMyTeams hors ligne (lecture en échec) : rien n’est effacé', async () => {
  cacheTwoTeams();
  server.error = { message: 'Failed to fetch' };
  expect(await listMyTeams()).toHaveLength(2);
  expect(keysOf(T1)).toHaveLength(1);
  expect(keysOf(T2)).toHaveLength(2);
  expect(coachStore(A).get('outboxTeams')).toEqual([T2]);
});

test("listMyTeams : l'espace ouvert n'est pas effacé ici (checkMembership le ferme et prévient)", async () => {
  const { loadCache, resetStore } = await import('../../src/core/store.js');
  cacheTwoTeams();
  loadCache(A, T2);
  server.teams = [{ id: T1, name: 'Benjamins' }];
  await listMyTeams();
  expect(keysOf(T2).length).toBeGreaterThan(0);
  resetStore({ save: false });
});
