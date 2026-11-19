import { vi } from 'vitest';
import { makeFakeClient, networkError, rlsError, pgError } from './helpers/fake-client.js';
import { teamStore } from '../../src/core/storage.js';

const fake = { client: makeFakeClient() };
let me = { id: 'A' };
const coachCbs = new Set();
let myTeams = [{ id: 'T1', name: 'Benjamins' }, { id: 'T2', name: 'Avenirs' }];
const listMyTeams = vi.fn(async () => myTeams);
vi.mock('../../src/core/supabase.js', () => ({
  supabase: new Proxy({}, { get: (_, p) => (typeof fake.client[p] === 'function' ? fake.client[p].bind(fake.client) : fake.client[p]) }),
}));
vi.mock('../../src/core/session.js', () => ({
  getCoach: () => me,
  onCoachChange: (cb) => { coachCbs.add(cb); return () => coachCbs.delete(cb); },
}));
vi.mock('../../src/core/teams.js', () => ({
  listMyTeams: (...a) => listMyTeams(...a),
  getCurrentTeam: () => myTeams[0] ?? null,
  setCurrentTeam: vi.fn(),
}));

const { fetchAll, mergeTable, checkMembership, initialSync, startLive, stopLive, openTeam, closeTeam, configureSync, LIVE_DELAY_MS } =
  await import('../../src/core/sync.js');
const { db, loadCache, resetStore, upsertLocal, subscribe } = await import('../../src/core/store.js');
const { enqueue, flush, pendingCount, rejectedCount } = await import('../../src/core/outbox.js');

const toast = vi.fn();
const onTeamLost = vi.fn();

beforeEach(async () => {
  vi.useRealTimers();
  closeTeam();
  localStorage.clear();
  me = { id: 'A' };
  myTeams = [{ id: 'T1', name: 'Benjamins' }, { id: 'T2', name: 'Avenirs' }];
  fake.client = makeFakeClient();
  configureSync({ toast, onTeamLost });
  await openTeam('A', { id: 'T1', name: 'Benjamins' });
  fake.client.calls.length = 0;
  listMyTeams.mockClear();
  toast.mockClear();
  onTeamLost.mockClear();
});

const presenceRows = (n, team = 'T1') =>
  Array.from({ length: n }, (_, i) => ({ session_id: `s${Math.floor(i / 100)}`, swimmer_id: `w${i}`, team_id: team, status: 'P' }));

test('fetchAll pagine au-delà de 1000 lignes', async () => {
  fake.client.tables.presence = [...presenceRows(2400), ...presenceRows(5, 'T9')];
  expect((await fetchAll('presence')).length).toBe(2400);
  const pages = fake.client.calls.map((c) => c.range);
  expect(pages).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  expect(fake.client.calls.every((c) => c.filters.some(([k, v]) => k === 'team_id' && v === 'T1'))).toBe(true);
});

test('fetchAll lève une erreur si une page échoue (pas de remplacement par une liste tronquée)', async () => {
  fake.client.tables.presence = presenceRows(2400);
  fake.client.failWith = (call) => (call.range[0] === 1000 ? networkError() : null);
  upsertLocal('presence', { session_id: 'old', swimmer_id: 'w', status: 'P' });
  await expect(fetchAll('presence')).rejects.toThrow();
  expect(await initialSync()).toBe(false);
  expect(db.presence.has('old:w')).toBe(true);
});

test('mergeTable garde la version locale en attente et retire ce que le serveur a supprimé', () => {
  upsertLocal('swimmers', { id: '1', v: 2 });
  enqueue({ table: 'swimmers', kind: 'upsert', key: '1', row: db.swimmers.get('1') });
  upsertLocal('swimmers', { id: '2', v: 1 });
  upsertLocal('swimmers', { id: '3', v: 1 });
  mergeTable('swimmers', [{ id: '1', v: 1, team_id: 'T1' }, { id: '2', v: 1, team_id: 'T1' }]);
  expect([...db.swimmers.keys()].sort()).toEqual(['1', '2']);
  expect(db.swimmers.get('1').v).toBe(2);
  expect(db.swimmers.get('2').v).toBe(1);
});

test("mergeTable ne fait pas réapparaître une ligne dont la suppression est en attente", () => {
  enqueue({ table: 'presence', kind: 'delete', key: 's1:w1' });
  mergeTable('presence', [{ session_id: 's1', swimmer_id: 'w1', team_id: 'T1' }]);
  expect(db.presence.has('s1:w1')).toBe(false);
});

test('mergeTable applique une modification faite par un autre membre (updated_by ≠ moi)', () => {
  upsertLocal('sessions', { id: 's1', title: 'Endurance', updated_by: 'A' });
  const cb = vi.fn();
  const off = subscribe('sessions', cb);
  mergeTable('sessions', [{ id: 's1', title: 'Vitesse', team_id: 'T1', updated_by: 'B' }]);
  off();
  expect(db.sessions.get('s1')).toMatchObject({ title: 'Vitesse', updated_by: 'B' });
  expect(cb).toHaveBeenCalled();
});

test('mergeTable est sauvegardé dans le cache (différé de 300 ms)', () => {
  vi.useFakeTimers();
  mergeTable('groups', [{ id: 'g1', name: 'Benjamins', team_id: 'T1' }]);
  expect(teamStore('A', 'T1').get('cache')).toBeNull();
  vi.advanceTimersByTime(300);
  expect(teamStore('A', 'T1').get('cache').groups).toHaveLength(1);
  resetStore({ save: false });
  loadCache('A', 'T1');
  expect(db.groups.get('g1').name).toBe('Benjamins');
});

test('retiré de l’espace : 42501 au flush → checkMembership, cache et ops de cet espace effacés, toast affiché', async () => {
  teamStore('A', 'T1').set('cache', { groups: [] });
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'y', row: { id: 'y' } });
  teamStore('A', 'T2').set('outbox', [{ id: 'k', table: 'groups', kind: 'delete', key: 'g', coachId: 'A', teamId: 'T2' }]);
  myTeams = [{ id: 'T2', name: 'Avenirs' }];
  fake.client.failWith = () => rlsError();
  await flush(fake.client, 'A', 'T1');
  expect(fake.client.calls).toHaveLength(1);
  expect(listMyTeams).toHaveBeenCalled();
  expect(pendingCount('T1')).toBe(0);
  expect(pendingCount('T2')).toBe(1);
  expect(teamStore('A', 'T1').get('cache')).toBeNull();
  expect(toast).toHaveBeenCalledWith("Tu n'as plus accès à l'espace « Benjamins »");
  expect(onTeamLost).toHaveBeenCalledWith({ id: 'T2', name: 'Avenirs' });
});

test('42501 alors que je suis toujours membre : l’op refusée est retirée, la suite part', async () => {
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'y', row: { id: 'y' } });
  fake.client.failWith = (call) => (call.row?.id === 'x' ? rlsError() : null);
  await flush(fake.client, 'A', 'T1');
  expect(fake.client.calls.map((c) => c.row.id)).toEqual(['x', 'y']);
  expect(pendingCount('T1')).toBe(0);
  expect(rejectedCount('T1')).toBe(1);
  expect(onTeamLost).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith('1 modification(s) refusée(s) par le serveur');
});

test('42501 alors que l’appartenance est inconnue (liste illisible) : la file s’arrête, l’op est gardée', async () => {
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'y', row: { id: 'y' } });
  listMyTeams.mockRejectedValueOnce(new Error('offline'));
  fake.client.failWith = () => rlsError();
  await flush(fake.client, 'A', 'T1');
  expect(fake.client.calls).toHaveLength(1);
  expect(pendingCount('T1')).toBe(2);
  expect(rejectedCount('T1')).toBe(0);
  expect(onTeamLost).not.toHaveBeenCalled();
});

test('refus définitifs : le toast donne le nombre total de modifications refusées', async () => {
  enqueue({ table: 'groups', kind: 'upsert', key: 'g1', row: { id: 'g1' } });
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'w1', row: { id: 'w1' } });
  fake.client.failWith = () => pgError('23503');
  await flush(fake.client, 'A', 'T1');
  expect(toast).toHaveBeenLastCalledWith('2 modification(s) refusée(s) par le serveur');
});

test("refus définitif : la table de l'op refusée est relue pour revenir à l'état du serveur", async () => {
  vi.useFakeTimers();
  startLive();
  fake.client.tables.swimmers = [{ id: 'w1', team_id: 'T1', name: 'serveur' }];
  upsertLocal('swimmers', { id: 'w1', name: 'refusé' });
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'w1', row: db.swimmers.get('w1') });
  fake.client.failWith = (call) => (call.op === 'select' ? null : pgError('23503'));
  await flush(fake.client, 'A', 'T1');
  expect(rejectedCount('T1')).toBe(1);
  await vi.advanceTimersByTimeAsync(LIVE_DELAY_MS);
  expect(fake.client.calls.some((c) => c.op === 'select' && c.table === 'swimmers')).toBe(true);
  expect(db.swimmers.get('w1').name).toBe('serveur');
});

test('relecture tardive : une page lue avant notre écriture ne la défait pas, une nouvelle relecture est programmée', async () => {
  vi.useFakeTimers();
  startLive();
  const ch = fake.client.channels.at(-1);
  fake.client.tables.presence = [{ session_id: 's1', swimmer_id: 'w1', team_id: 'T1', status: 'P' }];
  upsertLocal('presence', { session_id: 's1', swimmer_id: 'w1', status: 'A' });
  enqueue({ table: 'presence', kind: 'upsert', row: db.presence.get('s1:w1') });
  fake.client.hold = (call) => call.table === 'presence';
  ch.emit('presence', 'UPDATE');
  await vi.advanceTimersByTimeAsync(LIVE_DELAY_MS);
  expect(fake.client.held).toHaveLength(1); // instantané pris avant l'écriture : status P
  await flush(fake.client, 'A', 'T1');
  expect(pendingCount('T1')).toBe(0);
  fake.client.hold = null;
  fake.client.held[0].release();
  await vi.advanceTimersByTimeAsync(0);
  expect(db.presence.get('s1:w1').status).toBe('A');
  const selects = () => fake.client.calls.filter((c) => c.op === 'select').length;
  expect(selects()).toBe(1);
  await vi.advanceTimersByTimeAsync(LIVE_DELAY_MS);
  expect(selects()).toBe(2);
  expect(db.presence.get('s1:w1').status).toBe('A');
});

test('relectures dans le désordre : la plus récente gagne', async () => {
  vi.useFakeTimers();
  startLive();
  const ch = fake.client.channels.at(-1);
  fake.client.hold = () => true;
  fake.client.tables.swimmers = [{ id: 'w1', team_id: 'T1', name: 'v1' }];
  ch.emit('swimmers', 'UPDATE');
  await vi.advanceTimersByTimeAsync(LIVE_DELAY_MS);
  fake.client.tables.swimmers = [{ id: 'w1', team_id: 'T1', name: 'v2' }];
  ch.emit('swimmers', 'UPDATE');
  await vi.advanceTimersByTimeAsync(LIVE_DELAY_MS);
  expect(fake.client.held).toHaveLength(2);
  fake.client.held[1].release();
  await vi.advanceTimersByTimeAsync(0);
  expect(db.swimmers.get('w1').name).toBe('v2');
  fake.client.held[0].release();
  await vi.advanceTimersByTimeAsync(0);
  expect(db.swimmers.get('w1').name).toBe('v2');
});

test('le cache en attente est écrit tout de suite à pagehide et quand la page passe en arrière-plan', () => {
  vi.useFakeTimers();
  upsertLocal('groups', { id: 'g1' });
  expect(teamStore('A', 'T1').get('cache')).toBeNull();
  window.dispatchEvent(new Event('pagehide'));
  expect(teamStore('A', 'T1').get('cache').groups).toHaveLength(1);
  upsertLocal('groups', { id: 'g2' });
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.visibilityState;
  expect(teamStore('A', 'T1').get('cache').groups).toHaveLength(2);
});

test("checkMembership : 'member', 'unknown' si la liste est illisible", async () => {
  expect(await checkMembership()).toBe('member');
  listMyTeams.mockRejectedValueOnce(new Error('offline'));
  expect(await checkMembership()).toBe('unknown');
  expect(db.groups).toBeDefined();
  expect(onTeamLost).not.toHaveBeenCalled();
});

test("checkMembership sans le dernier espace → onTeamLost(null)", async () => {
  myTeams = [];
  expect(await checkMembership()).toBe('removed');
  expect(onTeamLost).toHaveBeenCalledWith(null);
});

test('initialSync : vérifie l’appartenance, charge les 7 tables puis envoie la file', async () => {
  fake.client.tables.groups = [{ id: 'g1', team_id: 'T1' }];
  fake.client.tables.plan_weeks = [{ week_key: '2026-W47', team_id: 'T1' }];
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  expect(await initialSync()).toBe(true);
  const tables = fake.client.calls.map((c) => `${c.op}:${c.table}`);
  expect(tables).toEqual([
    'select:groups', 'select:swimmers', 'select:sessions', 'select:presence',
    'select:plan_weeks', 'select:plan_events', 'select:performances', 'upsert:swimmers',
  ]);
  expect(db.groups.has('g1')).toBe(true);
  expect(db.plan_weeks.has('2026-W47')).toBe(true);
  expect(db.swimmers.has('x')).toBe(false); // jamais ajouté localement : seule l'op était en file
  expect(pendingCount()).toBe(0);
});

test('startLive : INSERT/UPDATE filtrés par espace, DELETE non filtré qui relit, team_members filtré par entraîneur', async () => {
  vi.useFakeTimers();
  startLive();
  const ch = fake.client.channels.at(-1);
  const filters = ch.handlers.map((h) => h.filter);
  const swimmers = filters.filter((f) => f.table === 'swimmers');
  expect(swimmers).toEqual([
    { event: 'INSERT', schema: 'public', table: 'swimmers', filter: 'team_id=eq.T1' },
    { event: 'UPDATE', schema: 'public', table: 'swimmers', filter: 'team_id=eq.T1' },
    { event: 'DELETE', schema: 'public', table: 'swimmers' },
  ]);
  expect(filters.filter((f) => f.table !== 'team_members')).toHaveLength(21);
  expect(filters.find((f) => f.table === 'team_members')).toEqual({ event: '*', schema: 'public', table: 'team_members', filter: 'coach_id=eq.A' });

  upsertLocal('swimmers', { id: 'gone' });
  fake.client.tables.swimmers = [{ id: 'w1', team_id: 'T1', name: 'Léo' }];
  ch.emit('swimmers', 'DELETE', { old: { id: 'gone' } });
  ch.emit('swimmers', 'UPDATE', { new: { id: 'w1', team_id: 'T1', name: 'pas appliqué tel quel' } });
  expect(fake.client.calls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(LIVE_DELAY_MS);
  expect(fake.client.calls).toHaveLength(1); // une seule relecture pour les deux événements
  expect([...db.swimmers.keys()]).toEqual(['w1']);
  expect(db.swimmers.get('w1').name).toBe('Léo');

  myTeams = [{ id: 'T2', name: 'Avenirs' }];
  ch.emit('team_members', 'DELETE', { old: {} });
  await vi.waitFor(() => expect(toast).toHaveBeenCalled());
  expect(listMyTeams).toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("Tu n'as plus accès à l'espace « Benjamins »");
  expect(ch.removed).toBe(true);
});

test('retour au premier plan et événement online : flush puis initialSync', async () => {
  startLive();
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(fake.client.calls.filter((c) => c.op === 'select')).toHaveLength(7));
  expect(fake.client.calls[0].op).toBe('upsert');
  stopLive();
  fake.client.calls.length = 0;
  window.dispatchEvent(new Event('online'));
  await new Promise((r) => setTimeout(r, 20));
  expect(fake.client.calls).toHaveLength(0);
});

test("openTeam : flush de l'ancien, désabonnement, nouveau cache, synchro et temps réel", async () => {
  await openTeam('A', { id: 'T1', name: 'Benjamins' });
  const first = fake.client.channels.at(-1);
  enqueue({ table: 'swimmers', kind: 'upsert', key: 'x', row: { id: 'x' } });
  teamStore('A', 'T2').set('cache', { groups: [{ id: 'g2', team_id: 'T2' }] });
  fake.client.tables.groups = [{ id: 'g2', team_id: 'T2' }, { id: 'g3', team_id: 'T2' }];
  fake.client.calls.length = 0;
  const p = openTeam('A', { id: 'T2', name: 'Avenirs' });
  expect(db.groups.has('g2')).toBe(false); // le cache de T2 est chargé après le flush de T1
  await p;
  expect(fake.client.calls[0]).toMatchObject({ op: 'upsert', table: 'swimmers' });
  expect(first.removed).toBe(true);
  expect(fake.client.channels.at(-1).handlers[0].filter.filter).toBe('team_id=eq.T2');
  expect([...db.groups.keys()].sort()).toEqual(['g2', 'g3']);
  expect(pendingCount()).toBe(0);
});

test("changement d'entraîneur : l'espace ouvert est fermé sans rien envoyer", async () => {
  await openTeam('A', { id: 'T1', name: 'Benjamins' });
  const ch = fake.client.channels.at(-1);
  upsertLocal('groups', { id: 'g1' });
  for (const cb of coachCbs) cb(null);
  expect(ch.removed).toBe(true);
  expect(db.groups.size).toBe(0);
  expect(() => upsertLocal('groups', { id: 'g2' })).toThrow();
});
