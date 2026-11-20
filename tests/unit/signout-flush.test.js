import { vi } from 'vitest';

// Client Supabase factice : auth pour la connexion, tables pour l'envoi de la file.
let send = async () => ({ error: null });
const sent = [];
const auth = {
  signOut: vi.fn(async () => ({ error: null })),
  signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'A', email: 'a@b.fr' } }, error: null })),
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
};
const client = {
  auth,
  from: (table) => {
    if (table === 'coaches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'A', activated_at: '2026-01-01' }, error: null }) }) }) };
    return { upsert: (row) => { sent.push(row); return send(); } };
  },
};
vi.mock('../../src/core/supabase.js', () => ({ supabase: client }));

const { signIn, signOut, configureSession, FLUSH_WAIT_MS } = await import('../../src/core/session.js');
const { enqueue, pendingCount, flushCoach } = await import('../../src/core/outbox.js');
const { loadCache, resetStore } = await import('../../src/core/store.js');

const TEAM = '55555555-5555-4555-8555-555555555555';
const online = (v) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });

beforeEach(async () => {
  localStorage.clear();
  sent.length = 0;
  send = async () => ({ error: null });
  vi.useRealTimers();
  online(true);
  configureSession({ getPendingCount: (id) => pendingCount(undefined, id), flushPending: (id) => flushCoach(client, id) });
  await signIn('a@b.fr', 'motdepasse-long');
  resetStore({ save: false });
  loadCache('A', TEAM);
  // les groupes par défaut viennent d'être mis en file, pas encore envoyés
  for (const name of ['Benjamins', 'Loisirs']) enqueue({ table: 'groups', kind: 'upsert', row: { id: name, name, sort_order: 0 } });
  resetStore({ save: false });
});

test("en ligne, la file part d'abord : la déconnexion aboutit ('done')", async () => {
  expect(pendingCount(undefined, 'A')).toBe(2);
  expect(await signOut()).toBe('done');
  expect(sent.map((r) => r.name)).toEqual(['Benjamins', 'Loisirs']);
  expect(auth.signOut).toHaveBeenCalled();
});

test("hors ligne : rien n'est tenté, 'pending', rien n'est effacé", async () => {
  online(false);
  expect(await signOut()).toBe('pending');
  expect(sent).toEqual([]);
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(pendingCount(undefined, 'A')).toBe(2);
});

test(`serveur trop lent (> ${3000} ms) : 'pending' au bout de l'attente bornée, sans bloquer`, async () => {
  expect(FLUSH_WAIT_MS).toBe(3000);
  vi.useFakeTimers();
  send = () => new Promise(() => {}); // ne répond jamais
  const result = signOut();
  await vi.advanceTimersByTimeAsync(FLUSH_WAIT_MS);
  expect(await result).toBe('pending');
  expect(auth.signOut).not.toHaveBeenCalled();
});

test("l'envoi échoue (erreur temporaire) : 'pending'", async () => {
  send = async () => ({ error: { message: 'down' }, status: 503 });
  expect(await signOut()).toBe('pending');
  expect(pendingCount(undefined, 'A')).toBe(2);
});
