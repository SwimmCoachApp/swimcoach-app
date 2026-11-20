import { vi } from 'vitest';
import { authStorageAdapter, blockAuthWrites } from '../../src/core/storage.js';

const auth = {
  signOut: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
};
const rpc = vi.fn();
const coachRow = { data: { id: 'x', activated_at: '2026-01-01' }, error: null };
const from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => coachRow }) }) });
vi.mock('../../src/core/supabase.js', () => ({ supabase: { auth, rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }));

const { signUp, signIn, signOut, redeemCode, updatePassword, configureSession, isReloadPending, FLUSH_WAIT_MS } = await import('../../src/core/session.js');

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  configureSession({ getPendingCount: () => 0 });
});

test('signUp refuse moins de 10 caractères sans appeler le serveur', async () => {
  await expect(signUp('a@b.fr', '123456789')).rejects.toThrow('Le mot de passe doit faire au moins 10 caractères');
  expect(auth.signUp).not.toHaveBeenCalled();
});

test('signUp demande que le lien de confirmation revienne vers l’app', async () => {
  auth.signUp.mockResolvedValueOnce({ data: { session: null, user: { id: 'u' } }, error: null });
  expect(await signUp(' a@b.fr ', 'motdepasse-long')).toBe('confirm');
  expect(auth.signUp).toHaveBeenCalledWith({
    email: 'a@b.fr',
    password: 'motdepasse-long',
    options: { emailRedirectTo: location.origin + location.pathname },
  });
});

test('signUp : un e-mail déjà envoyé il y a moins d’une minute donne un message rassurant', async () => {
  auth.signUp.mockResolvedValueOnce({ data: {}, error: { code: 'over_email_send_rate_limit', status: 429 } });
  await expect(signUp('a@b.fr', 'motdepasse-long')).rejects.toThrow(
    'Un e-mail de confirmation vient déjà de partir : vérifie ta boîte mail (et les spams). Tu pourras en redemander un dans une minute.',
  );
});

test('updatePassword : un mot de passe identique à l’actuel n’est pas une erreur (le lien a déjà connecté)', async () => {
  auth.updateUser = vi.fn(async () => ({ data: {}, error: { code: 'same_password', status: 422 } }));
  await expect(updatePassword('motdepasse-long')).resolves.toBe('unchanged');
  auth.updateUser = vi.fn(async () => ({ data: {}, error: null }));
  await expect(updatePassword('motdepasse-long')).resolves.toBe('changed');
});

test("signOut renvoie 'pending' sans rien effacer tant que l'outbox n'est pas vide", async () => {
  localStorage.setItem('swimcoach2_A_x', '1');
  configureSession({ getPendingCount: () => 2 });
  expect(await signOut()).toBe('pending');
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(localStorage.getItem('swimcoach2_A_x')).toBe('1');
});

test('signOut({force:true}) efface les données malgré les écritures en attente', async () => {
  localStorage.setItem('swimcoach2_A_x', '1');
  localStorage.setItem('swimcoach_v2', 'OLD');
  configureSession({ getPendingCount: () => 2 });
  expect(await signOut({ force: true })).toBe('done');
  expect(localStorage.getItem('swimcoach2_A_x')).toBeNull();
  expect(localStorage.getItem('swimcoach_v2')).toBe('OLD');
});

test('redeemCode traduit les réponses du serveur', async () => {
  rpc.mockResolvedValueOnce({ data: false, error: null });
  expect(await redeemCode('x')).toBe('bad');
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'too_many_attempts' } });
  expect(await redeemCode('x')).toBe('too_many');
  rpc.mockResolvedValueOnce({ data: true, error: null });
  expect(await redeemCode('x')).toBe('ok');
});

test("l'adaptateur d'authentification ignore les clés hors swimcoach2_", () => {
  authStorageAdapter.setItem('swimcoach2_auth', 'S');
  authStorageAdapter.setItem('swimcoach_v2', 'X');
  expect(authStorageAdapter.getItem('swimcoach2_auth')).toBe('S');
  expect(localStorage.getItem('swimcoach_v2')).toBeNull();
  localStorage.setItem('swimcoach_v2', 'OLD');
  expect(authStorageAdapter.getItem('swimcoach_v2')).toBeNull();
  authStorageAdapter.removeItem('swimcoach_v2');
  expect(localStorage.getItem('swimcoach_v2')).toBe('OLD');
  authStorageAdapter.removeItem('swimcoach2_auth');
  expect(localStorage.getItem('swimcoach2_auth')).toBeNull();
});

test("passage d'un entraîneur à un autre : les données de l'ancien sont effacées si sa file n'est pas vide", async () => {
  const login = async (id) => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id, email: `${id}@b.fr` } }, error: null });
    await signIn(`${id}@b.fr`, 'motdepasse-long');
  };
  const pending = { A: 0, B: 0 };
  configureSession({ getPendingCount: (id) => pending[id] ?? 0 });
  await login('A');
  localStorage.setItem('swimcoach2_A_T1_outbox', '[1]');
  pending.A = 0;
  await login('B');
  expect(localStorage.getItem('swimcoach2_A_T1_outbox')).toBe('[1]'); // file vide pour session.js : rien effacé

  await login('A');
  pending.A = 1;
  localStorage.setItem('swimcoach2_auth', 'S');
  await login('B');
  expect(localStorage.getItem('swimcoach2_A_T1_outbox')).toBeNull();
  expect(localStorage.getItem('swimcoach2_B_activated')).toBe('true');
  expect(localStorage.getItem('swimcoach2_auth')).toBe('S');
});

describe('déconnexion dont l’attente est dépassée : pas de réécriture de session', () => {
  const hang = () => new Promise(() => {});

  afterEach(() => {
    vi.useRealTimers();
    blockAuthWrites(false);
    configureSession({ reloadPage: () => {} });
  });

  // En premier : l'état « rechargement en attente » dure jusqu'au rechargement de la page, donc ici jusqu'à la fin du fichier.
  test("une déconnexion normale n'empêche pas de se reconnecter ensuite", async () => {
    await signOut({ force: true });
    expect(isReloadPending()).toBe(false);
    authStorageAdapter.setItem('swimcoach2_auth', 'S');
    expect(localStorage.getItem('swimcoach2_auth')).toBe('S');
  });

  test("l'adaptateur refuse d'écrire la session pendant et après une déconnexion non terminée, jusqu'au rechargement", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    configureSession({ reloadPage: reload });
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: 'A', email: 'a@b.fr' } }, error: null });
    await signIn('a@b.fr', 'motdepasse-long');
    authStorageAdapter.setItem('swimcoach2_auth', 'avant');
    auth.signOut.mockImplementationOnce(hang); // renouvellement de jeton qui n'en finit pas
    const out = signOut({ force: true });
    await vi.advanceTimersByTimeAsync(FLUSH_WAIT_MS);
    expect(await out).toBe('done');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('swimcoach2_auth')).toBeNull();
    authStorageAdapter.setItem('swimcoach2_auth', 'tardive'); // le renouvellement tardif aboutit
    expect(localStorage.getItem('swimcoach2_auth')).toBeNull();
    authStorageAdapter.setItem('swimcoach2_auth-code-verifier', 'x');
    expect(localStorage.getItem('swimcoach2_auth-code-verifier')).toBeNull();
    expect(isReloadPending()).toBe(true);
  });
});

test("connexion d'un entraîneur : les données des autres entraîneurs sans écriture en attente ni refus sont effacées", async () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';
  const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  localStorage.setItem(`swimcoach2_${A}_teams`, '[]');
  localStorage.setItem(`swimcoach2_${A}_${T}_cache`, '{}');
  localStorage.setItem(`swimcoach2_${C}_${T}_outbox_rejected`, '[{}]');
  localStorage.setItem(`swimcoach2_${C}_outboxTeams`, JSON.stringify([T]));
  localStorage.setItem(`swimcoach2_${B}_teams`, '[]');
  localStorage.setItem('swimcoach2_theme', '"light"');
  localStorage.setItem('swimcoach2_auth', 'S');
  auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: B, email: 'b@toac.fr' } }, error: null });
  await signIn('b@toac.fr', 'motdepasse-long');
  expect(Object.keys(localStorage).filter((k) => k.startsWith(`swimcoach2_${A}_`))).toEqual([]);
  expect(localStorage.getItem(`swimcoach2_${C}_${T}_outbox_rejected`)).toBe('[{}]'); // gardées sous le préfixe de C
  expect(localStorage.getItem(`swimcoach2_${C}_outboxTeams`)).not.toBeNull();
  expect(localStorage.getItem(`swimcoach2_${B}_teams`)).toBe('[]');
  expect(localStorage.getItem('swimcoach2_theme')).toBe('"light"');
  expect(localStorage.getItem('swimcoach2_auth')).toBe('S');
});
