import { vi } from 'vitest';

const calls = [];
let signCount = 0;
const bucket = {
  upload: vi.fn(async (path, blob, opts) => { calls.push(['upload', path, opts]); return { error: null }; }),
  createSignedUrl: vi.fn(async (path, ttl) => { signCount += 1; calls.push(['sign', path, ttl]); return { data: { signedUrl: `https://x/${path}?token=${signCount}` }, error: null }; }),
  remove: vi.fn(async (paths) => { calls.push(['remove', paths]); return { error: null }; }),
};
vi.mock('../../src/core/supabase.js', () => ({ supabase: { storage: { from: (b) => (b === 'photos' ? bucket : null) } } }));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));

const { uploadPhoto, photoUrl, deletePhoto, photoPath, URL_TTL_S } = await import('../../src/core/photos.js');
const { loadCache, resetStore } = await import('../../src/core/store.js');

const TEAM = '55555555-5555-4555-8555-555555555555';
const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  signCount = 0;
  resetStore({ save: false });
  loadCache('A', TEAM);
});

test('le nom respecte <équipe>/(swimmers|sessions)/<uuid>.jpg en minuscules', () => {
  expect(photoPath('swimmers', ID.toUpperCase())).toBe(`${TEAM}/swimmers/${ID}.jpg`);
  expect(photoPath('sessions', ID)).toBe(`${TEAM}/sessions/${ID}.jpg`);
});

test('uploadPhoto remplace l\'objet (upsert) en jpeg', async () => {
  const path = await uploadPhoto('swimmers', ID, new Blob(['x'], { type: 'image/jpeg' }));
  expect(path).toBe(`${TEAM}/swimmers/${ID}.jpg`);
  expect(calls[0]).toEqual(['upload', path, { upsert: true, contentType: 'image/jpeg' }]);
});

test('uploadPhoto : une erreur du serveur est relancée', async () => {
  bucket.upload.mockResolvedValueOnce({ error: { message: 'boom' } });
  await expect(uploadPhoto('swimmers', ID, new Blob(['x']))).rejects.toThrow('boom');
});

test("l'URL signée dure une heure, est gardée en mémoire seulement et n'est demandée qu'une fois", async () => {
  const path = photoPath('swimmers', ID);
  const a = await photoUrl(path);
  const b = await photoUrl(path);
  expect(a).toBe(b);
  expect(calls.filter((c) => c[0] === 'sign')).toEqual([['sign', path, URL_TTL_S]]);
  expect(URL_TTL_S).toBeLessThanOrEqual(3600);
  expect(JSON.stringify({ ...localStorage })).not.toContain('token');
});

test("le cache d'URL est vidé à la fermeture de l'espace", async () => {
  const path = photoPath('swimmers', ID);
  await photoUrl(path);
  resetStore({ save: false });
  loadCache('A', TEAM);
  await photoUrl(path);
  expect(calls.filter((c) => c[0] === 'sign')).toHaveLength(2);
});

test('une URL demandée pendant un changement d’espace n’entre pas dans le cache du suivant', async () => {
  const path = photoPath('swimmers', ID);
  let release;
  bucket.createSignedUrl.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: { signedUrl: 'https://old' }, error: null }); }));
  const pending = photoUrl(path);
  resetStore({ save: false });
  loadCache('A', TEAM);
  release();
  await pending;
  await photoUrl(path);
  expect(bucket.createSignedUrl).toHaveBeenCalledTimes(2);
});

test('deletePhoto retire l\'objet et oublie son URL', async () => {
  const path = photoPath('swimmers', ID);
  await photoUrl(path);
  await deletePhoto(path);
  expect(calls).toContainEqual(['remove', [path]]);
  await photoUrl(path);
  expect(calls.filter((c) => c[0] === 'sign')).toHaveLength(2);
});
