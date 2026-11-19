import { vi } from 'vitest';

vi.mock('../../src/core/supabase.js', () => ({
  supabase: {
    storage: { from: () => ({}) },
    // l'envoi échoue (réseau) : la file reste lisible telle qu'elle a été remplie
    from: () => ({ upsert: async () => { throw new Error('network'); }, delete: () => ({ eq: () => ({ eq: async () => { throw new Error('network'); } }) }) }),
  },
}));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));

const { togglePresence, rollCallList, presenceGauge, isPresent, startDraft, commitDraft, discardDrafts, setAllPresence, protectDraft, rollCallSession } = await import('../../src/features/presence/logic.js');
const { saveSession } = await import('../../src/features/calendar/logic.js');
const { db, loadCache, resetStore, upsertLocal } = await import('../../src/core/store.js');
const { teamStore } = await import('../../src/core/storage.js');
const { mergeTable } = await import('../../src/core/sync.js');

const TEAM = '55555555-5555-4555-8555-555555555555';
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ops = () => (teamStore('A', TEAM).get('outbox') ?? []).map((o) => `${o.kind} ${o.table === 'presence' ? o.key.split(':')[1] : o.table}`);

const swimmer = (id, o = {}) => upsertLocal('swimmers', { id, firstname: id, lastname: id, joined_season: 2026, left_season: null, group_id: null, ...o });

beforeEach(() => {
  localStorage.clear();
  resetStore({ save: false });
  loadCache('A', TEAM);
  upsertLocal('sessions', { id: S1, date: '2026-11-20', type: 'nat', title: '' });
  for (const id of ['A', 'B', 'C', 'D']) swimmer(id);
});

test('cocher A, B, C puis décocher B en rafale : upsert A, upsert B, upsert C, delete B ; état final {A, C}', () => {
  togglePresence(S1, 'A', true);
  togglePresence(S1, 'B', true);
  togglePresence(S1, 'C', true);
  togglePresence(S1, 'B', false);
  expect(ops()).toEqual(['upsert A', 'upsert B', 'upsert C', 'delete B']);
  expect([...db.presence.values()].map((p) => p.swimmer_id).sort()).toEqual(['A', 'C']);
  expect(isPresent(S1, 'A')).toBe(true);
  expect(isPresent(S1, 'B')).toBe(false);
  expect(presenceGauge(S1)).toEqual({ present: 2, total: 4 });
  const row = teamStore('A', TEAM).get('outbox')[0].row;
  expect(row).toEqual({ session_id: S1, swimmer_id: 'A', team_id: TEAM });
});

test('une coche déjà dans l’état voulu ne crée aucune op', () => {
  togglePresence(S1, 'A', true);
  togglePresence(S1, 'A', true);
  togglePresence(S1, 'B', false);
  expect(ops()).toEqual(['upsert A']);
});

test('rollCallList : nageurs de la saison de la séance, archivé la saison précédente exclu, trié par nom', () => {
  swimmer('OLD', { lastname: 'Ancien', left_season: 2025, joined_season: 2023 });
  swimmer('NOW', { lastname: 'Zola', firstname: 'Archivé', left_season: 2026, joined_season: 2024 });
  swimmer('NEXT', { lastname: 'Futur', joined_season: 2027 });
  swimmer('AB', { lastname: 'Aa', firstname: 'Bob' });
  swimmer('AA', { lastname: 'Aa', firstname: 'Alice' });
  const ids = rollCallList(db.sessions.get(S1)).map((s) => s.id);
  expect(ids).toEqual(['A', 'AA', 'AB', 'B', 'C', 'D', 'NOW']);
  // une séance de la saison 2024 : l'archivé de 2025 en fait partie, pas les arrivés en 2026
  expect(rollCallList({ id: 'x', date: '2025-03-10' }).map((s) => s.id)).toEqual(['OLD', 'NOW']);
});

test('jauge : un présent hors de la liste (autre saison) ne compte pas', () => {
  swimmer('OLD', { left_season: 2024, joined_season: 2023 });
  upsertLocal('presence', { session_id: S1, swimmer_id: 'OLD' });
  togglePresence(S1, 'A', true);
  expect(presenceGauge(S1)).toEqual({ present: 1, total: 4 });
});

test('séance non enregistrée : aucune op avant saveSession, puis la séance part avant ses présences', async () => {
  const NEW = 'bbbbbbbb-0000-4000-8000-000000000002';
  startDraft(NEW, '2026-11-21');
  togglePresence(NEW, 'A', true);
  togglePresence(NEW, 'C', true);
  togglePresence(NEW, 'B', true);
  togglePresence(NEW, 'B', false);
  expect(ops()).toEqual([]);
  expect([...db.presence.keys()]).toEqual([]);
  expect(presenceGauge(NEW)).toEqual({ present: 2, total: 4 });
  expect(isPresent(NEW, 'C')).toBe(true);
  await saveSession({ id: NEW, date: '2026-11-21', type: 'comp', title: 'Interclubs' });
  expect(ops()).toEqual(['upsert sessions']);
  commitDraft(NEW);
  expect(ops()).toEqual(['upsert sessions', 'upsert A', 'upsert C']);
  expect(db.presence.has(`${NEW}:A`)).toBe(true);
  // une fois envoyée, la séance n'est plus en brouillon : une coche part tout de suite
  togglePresence(NEW, 'D', true);
  expect(ops().at(-1)).toBe('upsert D');
});

test('brouillon abandonné (séance fermée sans enregistrer) : coches oubliées, rien n’est envoyé', () => {
  const NEW = 'cccccccc-0000-4000-8000-000000000003';
  startDraft(NEW, '2026-11-21');
  togglePresence(NEW, 'A', true);
  discardDrafts();
  expect(isPresent(NEW, 'A')).toBe(false);
  expect(commitDraft(NEW)).toBe(0);
  expect(ops()).toEqual([]);
});

test('brouillon dont la séance n’a pas été enregistrée : commitDraft n’envoie rien (pas de 23503)', () => {
  const NEW = 'dddddddd-0000-4000-8000-000000000004';
  startDraft(NEW, '2026-11-21');
  togglePresence(NEW, 'A', true);
  expect(commitDraft(NEW)).toBe(0);
  expect(ops()).toEqual([]);
});

test('Tous / Aucun : une op par nageur, seulement ceux qui changent', () => {
  togglePresence(S1, 'B', true);
  setAllPresence(S1, true);
  expect(ops()).toEqual(['upsert B', 'upsert A', 'upsert C', 'upsert D']);
  setAllPresence(S1, false);
  expect(ops().slice(4).sort()).toEqual(['delete A', 'delete B', 'delete C', 'delete D']);
  expect(presenceGauge(S1)).toEqual({ present: 0, total: 4 });
});

test('relecture du serveur pendant l’appel : mes coches en attente restent, celles d’un autre entraîneur arrivent', () => {
  togglePresence(S1, 'A', true);
  togglePresence(S1, 'B', true);
  togglePresence(S1, 'B', false);
  // le serveur ne connaît encore ni A ni le retrait de B, mais a la coche de C par un collègue (et un vieux B)
  mergeTable('presence', [
    { team_id: TEAM, session_id: S1, swimmer_id: 'B' },
    { team_id: TEAM, session_id: S1, swimmer_id: 'C' },
  ]);
  expect([...db.presence.values()].map((p) => p.swimmer_id).sort()).toEqual(['A', 'C']);
  expect(presenceGauge(S1)).toEqual({ present: 2, total: 4 });
});

test('séance supprimée ailleurs pendant l’appel : aucune coche, aucun brouillon créé, la source de la liste est vide', () => {
  db.sessions.delete(S1); // relecture : la séance a disparu du serveur
  expect(rollCallSession(S1)).toBeNull();
  expect(togglePresence(S1, 'A', true)).toBe(false);
  expect(isPresent(S1, 'A')).toBe(false);
  expect(ops()).toEqual([]);
  expect(presenceGauge(S1)).toEqual({ present: 0, total: 0 });
  // une séance encore là : la coche est appliquée
  upsertLocal('sessions', { id: S1, date: '2026-11-20', type: 'nat', title: '' });
  expect(togglePresence(S1, 'A', true)).toBe(true);
});

test('liste et jauge lisent la même séance : brouillon (date du brouillon) ou séance du store', () => {
  const NEW = 'eeeeeeee-0000-4000-8000-000000000005';
  startDraft(NEW, '2025-03-10'); // saison 2024 : aucun des nageurs de 2026
  expect(rollCallSession(NEW)).toEqual({ id: NEW, date: '2025-03-10' });
  expect(rollCallList(rollCallSession(NEW))).toEqual([]);
  expect(presenceGauge(NEW)).toEqual({ present: 0, total: 0 });
  expect(rollCallSession(S1)).toBe(db.sessions.get(S1));
});

test('brouillon en cours d’enregistrement : une autre feuille ouverte pendant l’envoi de la photo ne le perd pas', async () => {
  const NEW = 'ffffffff-0000-4000-8000-000000000006';
  startDraft(NEW, '2026-11-21');
  togglePresence(NEW, 'A', true);
  togglePresence(NEW, 'B', true);
  protectDraft(NEW); // début de l'enregistrement
  discardDrafts(); // une autre feuille s'ouvre pendant l'envoi
  expect(isPresent(NEW, 'A')).toBe(true);
  await saveSession({ id: NEW, date: '2026-11-21', type: 'nat' });
  expect(commitDraft(NEW)).toBe(2);
  expect(ops()).toEqual(['upsert sessions', 'upsert A', 'upsert B']);
});
