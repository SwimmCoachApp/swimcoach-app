import { vi } from 'vitest';
import { makeFakeClient, networkError } from './helpers/fake-client.js';
import { teamStore } from '../../src/core/storage.js';

let me = { id: 'A' };
vi.mock('../../src/core/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => me, onCoachChange: () => () => {} }));

const { enqueue, flush, pendingCount, pendingKeys, dropTeam, ON_CONFLICT } = await import('../../src/core/outbox.js');
const { loadCache, resetStore, upsertLocal, db } = await import('../../src/core/store.js');

beforeEach(() => {
  localStorage.clear();
  me = { id: 'A' };
  resetStore({ save: false });
  loadCache('A', 'T1');
});

test("enqueue persiste tout de suite l'op avec le coachId et le teamId du moment", () => {
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x', name: 'Léa' } });
  const saved = teamStore('A', 'T1').get('outbox');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ table: 'swimmers', kind: 'upsert', key: 'x', coachId: 'A', teamId: 'T1' });
  expect(saved[0].row).toMatchObject({ id: 'x', team_id: 'T1' });
});

test("flush n'envoie jamais les ops d'un autre entraîneur", async () => {
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } }); // en tant que A
  me = { id: 'B' };
  resetStore({ save: false });
  loadCache('B', 'T1');
  const client = makeFakeClient();
  await flush(client, 'B');
  expect(client.calls).toHaveLength(0);
  expect(teamStore('A', 'T1').get('outbox')).toHaveLength(1);
});

test("flush n'envoie pas les ops d'un espace vers un autre", async () => {
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  const client = makeFakeClient();
  await flush(client, 'A', 'T2');
  expect(client.calls).toHaveLength(0);
  expect(teamStore('A', 'T1').get('outbox')).toHaveLength(1);
});

test("flush ignore une op rangée sous le mauvais espace (coachId/teamId de l'op font foi)", async () => {
  teamStore('A', 'T2').set('outbox', [
    { id: '1', table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x', team_id: 'T1' }, coachId: 'A', teamId: 'T1' },
    { id: '2', table: 'swimmers', kind: 'upsert', key: 'y', row: { id: 'y', team_id: 'T2' }, coachId: 'B', teamId: 'T2' },
  ]);
  const client = makeFakeClient();
  await flush(client, 'A', 'T2');
  expect(client.calls).toHaveLength(0);
  expect(teamStore('A', 'T2').get('outbox')).toHaveLength(2);
});

test("flush s'arrête à la première erreur réseau et garde l'ordre", async () => {
  enqueue({ table: 'sessions', kind: 'upsert', key: 's1', row: { id: 's1' } });
  enqueue({ table: 'presence', kind: 'upsert', key: 's1:w1', row: { session_id: 's1', swimmer_id: 'w1', status: 'P' } });
  enqueue({ table: 'swimmers', kind: 'delete', key: 'w9' });
  const client = makeFakeClient();
  client.failWith = (call) => (call.table === 'presence' ? networkError() : null);
  await flush(client, 'A', 'T1');
  expect(client.calls.map((c) => c.table)).toEqual(['sessions', 'presence']);
  const left = teamStore('A', 'T1').get('outbox');
  expect(left.map((o) => o.key)).toEqual(['s1:w1', 'w9']);
  expect(pendingCount('T1')).toBe(2);

  client.failWith = null;
  await flush(client, 'A', 'T1');
  expect(client.calls.map((c) => c.table)).toEqual(['sessions', 'presence', 'presence', 'swimmers']);
  expect(pendingCount('T1')).toBe(0);
});

test('upsert de présence utilise onConflict session_id,swimmer_id', async () => {
  enqueue({ table: 'presence', kind: 'upsert', key: 's1:w1', row: { session_id: 's1', swimmer_id: 'w1' } });
  enqueue({ table: 'plan_weeks', kind: 'upsert', key: '2026-W47', row: { week_key: '2026-W47' } });
  enqueue({ table: 'performances', kind: 'upsert', key: 'p1', row: { id: 'p1' } });
  const client = makeFakeClient();
  await flush(client, 'A', 'T1');
  expect(client.calls.map((c) => c.options.onConflict)).toEqual([
    'session_id,swimmer_id',
    'team_id,week_key',
    'team_id,swimmer_id,competition_id,event_code,phase',
  ]);
  expect(ON_CONFLICT.swimmers).toBe('id');
});

test('delete par clé primaire (présence : session_id + swimmer_id)', async () => {
  enqueue({ table: 'presence', kind: 'delete', key: 's1:w1' });
  enqueue({ table: 'plan_weeks', kind: 'delete', key: '2026-W47' });
  enqueue({ table: 'groups', kind: 'delete', key: 'g1' });
  const client = makeFakeClient();
  await flush(client, 'A', 'T1');
  expect(client.calls.map((c) => [c.op, c.filters])).toEqual([
    ['delete', [['session_id', 's1'], ['swimmer_id', 'w1']]],
    ['delete', [['team_id', 'T1'], ['week_key', '2026-W47']]],
    ['delete', [['team_id', 'T1'], ['id', 'g1']]],
  ]);
});

test('après un upsert réussi, la ligne locale est conservée', async () => {
  upsertLocal('swimmers', { id: 'x', name: 'Léa' });
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: db.swimmers.get('x') });
  await flush(makeFakeClient(), 'A', 'T1');
  expect(db.swimmers.get('x')).toMatchObject({ name: 'Léa' });
});

test('pendingCount compte tous les espaces, pendingKeys ceux de la table ouverte, dropTeam vide un espace', () => {
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  enqueue({ table: 'presence', kind: 'delete', key: 's:w' });
  resetStore({ save: false });
  loadCache('A', 'T2');
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'y', row: { id: 'y' } });
  expect(pendingCount()).toBe(3);
  expect(pendingCount('T1')).toBe(2);
  expect([...pendingKeys('swimmers')]).toEqual(['y']);
  dropTeam('A', 'T1');
  expect(pendingCount()).toBe(1);
  expect(teamStore('A', 'T1').get('outbox')).toBeNull();
  me = { id: 'B' };
  expect(pendingCount()).toBe(0);
  expect(pendingCount(undefined, 'A')).toBe(1);
});
