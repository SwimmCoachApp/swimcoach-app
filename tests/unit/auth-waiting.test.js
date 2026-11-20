import { vi } from 'vitest';

const auth = { signOut: vi.fn(), signInWithPassword: vi.fn(), onAuthStateChange: vi.fn(), getSession: vi.fn() };
const coachRow = { data: { id: 'A', activated_at: '2026-01-01' }, error: null };
vi.mock('../../src/core/supabase.js', () => ({
  supabase: { auth, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => coachRow }) }) }) },
}));

const { signIn, signOut, configureSession, FLUSH_WAIT_MS } = await import('../../src/core/session.js');
const { showCredentials } = await import('../../src/features/auth/index.js');
const { blockAuthWrites } = await import('../../src/core/storage.js');

afterEach(() => {
  vi.useRealTimers();
  blockAuthWrites(false);
  configureSession({ reloadPage: () => {} });
});

test('connexion normale : formulaire actif, aucun message d’attente', () => {
  const root = document.createElement('div');
  showCredentials(root, 'login');
  expect(root.querySelector('[data-msg]').textContent).toBe('');
  expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
  expect(root.querySelector('input[name="email"]').disabled).toBe(false);
});

test('rechargement forcé en attente (hors ligne) : « Reconnexion au retour du réseau », formulaire désactivé', async () => {
  vi.useFakeTimers();
  configureSession({ reloadPage: () => {} });
  auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: 'A', email: 'a@b.fr' } }, error: null });
  await signIn('a@b.fr', 'motdepasse-long');
  auth.signOut.mockImplementationOnce(() => new Promise(() => {}));
  const out = signOut({ force: true });
  await vi.advanceTimersByTimeAsync(FLUSH_WAIT_MS);
  await out;

  const root = document.createElement('div');
  showCredentials(root, 'login');
  expect(root.querySelector('[data-msg]').textContent).toBe('Reconnexion au retour du réseau');
  expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
  for (const input of root.querySelectorAll('input')) expect(input.disabled).toBe(true);
  for (const b of root.querySelectorAll('[data-action]')) expect(b.disabled).toBe(true);
});
