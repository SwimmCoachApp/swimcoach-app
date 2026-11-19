// @vitest-environment node
import { buildLiveffnUrl, charsetOf, handleLiveffn, LIVEFFN_TIMEOUT_MS } from '../../supabase/functions/_shared/liveffn.js';
import { corsHeaders } from '../../supabase/functions/_shared/cors.js';
import { soleMemberTeams } from '../../supabase/functions/_shared/teams.js';
import { handleDeleteAccount } from '../../supabase/functions/_shared/delete-account.js';

const ORIGIN = 'https://swimmcoachapp.github.io';
const UID = '11111111-1111-4111-8111-111111111111';

function req(path, { method = 'GET', token = 'tok', origin = ORIGIN } = {}) {
  const headers = { Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://x.supabase.co/functions/v1/${path}`, { method, headers });
}

// ------------------------------------------------------------------ buildLiveffnUrl
describe('buildLiveffnUrl', () => {
  test('id valide : URL liveffn avec competition et structure', () => {
    const u = buildLiveffnUrl('12345', 39);
    expect(u).toBe('https://www.liveffn.com/cgi-bin/resultats.php?competition=12345&langue=fra&go=detail&action=structure&structure=39');
    expect(u).toContain('competition=12345');
    expect(u).toContain('structure=39');
  });
  test.each(['1;rm', '', 'https://evil', '12345678', ' 123', '12a', '1&structure=1'])('id invalide %j → null', (id) => {
    expect(buildLiveffnUrl(id, 39)).toBeNull();
  });
  test('id non chaîne → null', () => {
    expect(buildLiveffnUrl(12345, 39)).toBeNull();
    expect(buildLiveffnUrl(null, 39)).toBeNull();
  });
  test('charsetOf : en-tête, meta, défaut', () => {
    expect(charsetOf('text/html; charset=ISO-8859-1')).toBe('iso-8859-1');
    expect(charsetOf('text/html', '<meta charset="windows-1252">')).toBe('windows-1252');
    expect(charsetOf(null)).toBe('utf-8');
    expect(charsetOf('text/html; charset=bidon')).toBe('utf-8');
  });
});

// ------------------------------------------------------------------ corsHeaders
describe('corsHeaders', () => {
  test.each([ORIGIN, 'http://localhost:5173', 'http://localhost:4173'])('origine autorisée %s reprise', (o) => {
    const h = corsHeaders(o);
    expect(h['Access-Control-Allow-Origin']).toBe(o);
    expect(h['Access-Control-Allow-Headers']).toMatch(/Authorization/);
    expect(h['Access-Control-Allow-Headers']).toMatch(/apikey/);
    expect(h['Access-Control-Allow-Headers']).toMatch(/Content-Type/);
    expect(h.Vary).toBe('Origin');
  });
  test.each(['https://evil.example', 'https://swimmcoachapp.github.io.evil.com', 'null', '', undefined, null])('origine refusée %j : pas d’Allow-Origin', (o) => {
    expect(corsHeaders(o)['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

// ------------------------------------------------------------------ soleMemberTeams
describe('soleMemberTeams', () => {
  test('ne renvoie que les espaces où uid est seul', () => {
    const rows = [
      { team_id: 't1', coach_id: UID },
      { team_id: 't2', coach_id: UID }, { team_id: 't2', coach_id: 'other' },
      { team_id: 't3', coach_id: 'other' },
      { team_id: 't4', coach_id: UID }, { team_id: 't4', coach_id: UID },
    ];
    expect(soleMemberTeams(rows, UID)).toEqual(['t1', 't4']);
    expect(soleMemberTeams([], UID)).toEqual([]);
    expect(soleMemberTeams(null, UID)).toEqual([]);
  });
});

// ------------------------------------------------------------------ handleLiveffn
function userClient({ user = { id: UID }, activated = true, coachError = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async (t) => { calls.push(['getUser', t]); return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; } },
    from(table) {
      calls.push(['from', table]);
      const q = {
        select: () => q,
        eq: (c, v) => { calls.push(['eq', c, v]); return q; },
        maybeSingle: async () => ({ data: coachError ? null : (activated ? { activated_at: '2026-11-01T00:00:00Z' } : { activated_at: null }), error: coachError }),
      };
      return q;
    },
  };
}

function liveDeps(over = {}) {
  const client = over.client ?? userClient();
  const fetchCalls = [];
  const fetchImpl = over.fetch ?? (async (url, init) => {
    fetchCalls.push([url, init]);
    return new Response('<html>Résultats</html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
  return { client, fetchCalls, deps: { fetch: fetchImpl, createUserClient: () => client, ...over.deps } };
}

describe('handleLiveffn', () => {
  test('OPTIONS : préflight 204 sans authentification', async () => {
    const { deps, client } = liveDeps();
    const res = await handleLiveffn(req('liveffn-proxy', { method: 'OPTIONS', token: null }), deps);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(client.calls).toEqual([]);
  });
  test('401 sans jeton', async () => {
    const { deps, fetchCalls } = liveDeps();
    const res = await handleLiveffn(req('liveffn-proxy?competition=123', { token: null }), deps);
    expect(res.status).toBe(401);
    expect(fetchCalls).toEqual([]);
  });
  test('401 jeton refusé par auth.getUser', async () => {
    const { deps } = liveDeps({ client: userClient({ user: null }) });
    expect((await handleLiveffn(req('liveffn-proxy?competition=123'), deps)).status).toBe(401);
  });
  test('403 compte non activé (lu avec le jeton de l’appelant)', async () => {
    const { deps, client, fetchCalls } = liveDeps({ client: userClient({ activated: false }) });
    const res = await handleLiveffn(req('liveffn-proxy?competition=123'), deps);
    expect(res.status).toBe(403);
    expect(client.calls).toContainEqual(['getUser', 'tok']);
    expect(client.calls).toContainEqual(['from', 'coaches']);
    expect(client.calls).toContainEqual(['eq', 'id', UID]);
    expect(fetchCalls).toEqual([]);
  });
  test.each(['liveffn-proxy', 'liveffn-proxy?competition=1;rm', 'liveffn-proxy?competition=https://evil', 'liveffn-proxy?competition='])('400 id invalide (%s)', async (p) => {
    const { deps, fetchCalls } = liveDeps();
    expect((await handleLiveffn(req(p), deps)).status).toBe(400);
    expect(fetchCalls).toEqual([]);
  });
  test('200 : relais du HTML, text/html utf-8, structure 39 forcée, pas de redirection suivie', async () => {
    const { deps, fetchCalls } = liveDeps();
    const res = await handleLiveffn(req('liveffn-proxy?competition=4242&structure=1'), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(await res.text()).toBe('<html>Résultats</html>');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0][0]).toBe(buildLiveffnUrl('4242', 39));
    expect(fetchCalls[0][1].redirect).toBe('manual');
  });
  test('200 : page ISO-8859-1 réencodée en UTF-8', async () => {
    const latin1 = new Uint8Array([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]); // <p>é</p>
    const { deps } = liveDeps({ fetch: async () => new Response(latin1, { status: 200, headers: { 'Content-Type': 'text/html; charset=ISO-8859-1' } }) });
    const res = await handleLiveffn(req('liveffn-proxy?competition=1'), deps);
    expect(await res.text()).toBe('<p>é</p>');
  });
  test('origine non autorisée : pas d’Allow-Origin sur la réponse', async () => {
    const { deps } = liveDeps();
    const res = await handleLiveffn(req('liveffn-proxy?competition=1', { origin: 'https://evil.example' }), deps);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  test('502 sur redirection (même vers un autre hôte)', async () => {
    const { deps } = liveDeps({ fetch: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }) });
    expect((await handleLiveffn(req('liveffn-proxy?competition=1'), deps)).status).toBe(502);
  });
  test('502 sur statut amont en erreur', async () => {
    const { deps } = liveDeps({ fetch: async () => new Response('x', { status: 500 }) });
    expect((await handleLiveffn(req('liveffn-proxy?competition=1'), deps)).status).toBe(502);
  });
  test('504 après 12 s', async () => {
    vi.useFakeTimers();
    try {
      const hang = (url, init) => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      const { deps } = liveDeps({ fetch: hang });
      const p = handleLiveffn(req('liveffn-proxy?competition=1'), deps);
      await vi.advanceTimersByTimeAsync(LIVEFFN_TIMEOUT_MS - 1);
      let settled = false;
      p.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await p;
      expect(res.status).toBe(504);
      expect(LIVEFFN_TIMEOUT_MS).toBe(12000);
    } finally {
      vi.useRealTimers();
    }
  });
  test('405 hors GET', async () => {
    const { deps } = liveDeps();
    expect((await handleLiveffn(req('liveffn-proxy?competition=1', { method: 'POST' }), deps)).status).toBe(405);
  });
});

// ------------------------------------------------------------------ handleDeleteAccount
function adminFake({ user = { id: UID }, memberships, objects = {}, failRemove = false } = {}) {
  const log = [];
  const rows = memberships ?? [];
  const api = {
    log,
    auth: {
      getUser: async (t) => { log.push(['getUser', t]); return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad' } }; },
      admin: { deleteUser: async (id) => { log.push(['deleteUser', id]); return { data: {}, error: null }; } },
    },
    from(table) {
      const st = { table, filters: [], op: 'select' };
      const run = async () => {
        if (st.table === 'team_members') {
          let r = rows;
          for (const [k, c, v] of st.filters) r = r.filter((x) => (k === 'eq' ? x[c] === v : v.includes(x[c])));
          log.push(['select team_members', st.filters.map((f) => f[0]).join(',')]);
          return { data: r, error: null };
        }
        if (st.table === 'teams' && st.op === 'delete') {
          log.push(['delete teams', st.filters[0][2]]);
          return { data: null, error: null };
        }
        throw new Error('unexpected');
      };
      const q = {
        select: () => q,
        delete: () => { st.op = 'delete'; return q; },
        eq: (c, v) => { st.filters.push(['eq', c, v]); return q; },
        in: (c, v) => { st.filters.push(['in', c, v]); return q; },
        then: (ok, ko) => run().then(ok, ko),
      };
      return q;
    },
    storage: {
      from(bucket) {
        return {
          list: async (dir, { limit, offset }) => {
            log.push(['list', bucket, dir, offset]);
            const all = objects[dir] || [];
            return { data: all.slice(offset, offset + limit), error: null };
          },
          remove: async (paths) => {
            log.push(['remove', bucket, paths]);
            return failRemove ? { data: null, error: { message: 'boom' } } : { data: paths, error: null };
          },
        };
      },
    },
  };
  return api;
}

const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('handleDeleteAccount', () => {
  test('401 sans jeton, rien n’est appelé', async () => {
    const admin = adminFake();
    const res = await handleDeleteAccount(req('delete-account', { method: 'POST', token: null }), { adminClient: admin });
    expect(res.status).toBe(401);
    expect(admin.log).toEqual([]);
  });
  test('401 jeton invalide', async () => {
    const admin = adminFake({ user: null });
    const res = await handleDeleteAccount(req('delete-account', { method: 'POST' }), { adminClient: admin });
    expect(res.status).toBe(401);
    expect(admin.log.find((l) => l[0] === 'deleteUser')).toBeUndefined();
  });
  test('OPTIONS 204, GET 405', async () => {
    const admin = adminFake();
    expect((await handleDeleteAccount(req('delete-account', { method: 'OPTIONS', token: null }), { adminClient: admin })).status).toBe(204);
    expect((await handleDeleteAccount(req('delete-account'), { adminClient: admin })).status).toBe(405);
    expect(admin.log).toEqual([]);
  });
  test('ordre : photos (paginées) des espaces solo → espaces solo → compte', async () => {
    const files = (n, pre) => Array.from({ length: n }, (_, i) => ({ id: `${pre}${i}`, name: `${pre}${i}.jpg` }));
    const admin = adminFake({
      memberships: [
        { team_id: T1, coach_id: UID },
        { team_id: T2, coach_id: UID }, { team_id: T2, coach_id: 'other' },
      ],
      objects: {
        [T1]: [{ id: null, name: 'swimmers' }, { id: null, name: 'sessions' }],
        [`${T1}/swimmers`]: files(5, 's'),
        [`${T1}/sessions`]: files(2, 'p'),
      },
    });
    const res = await handleDeleteAccount(req('delete-account', { method: 'POST' }), { adminClient: admin, page: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedTeams: 1 });

    const log = admin.log;
    expect(log[0]).toEqual(['getUser', 'tok']);
    // uniquement l'espace solo est listé, jamais T2
    expect(log.filter((l) => l[0] === 'list').every((l) => l[2].startsWith(T1))).toBe(true);
    // pagination : swimmers lu aux offsets 0, 2, 4
    expect(log.filter((l) => l[0] === 'list' && l[2] === `${T1}/swimmers`).map((l) => l[3])).toEqual([0, 2, 4]);
    const removed = log.filter((l) => l[0] === 'remove').flatMap((l) => l[2]);
    expect(removed).toHaveLength(7);
    expect(removed).toContain(`${T1}/swimmers/s4.jpg`);
    expect(removed).toContain(`${T1}/sessions/p1.jpg`);
    expect(log.filter((l) => l[0] === 'remove').every((l) => l[1] === 'photos')).toBe(true);

    const idx = (name) => log.findIndex((l) => l[0] === name);
    const lastRemove = log.map((l) => l[0]).lastIndexOf('remove');
    expect(lastRemove).toBeLessThan(idx('delete teams'));
    expect(log[idx('delete teams')][1]).toEqual([T1]);
    expect(idx('delete teams')).toBeLessThan(idx('deleteUser'));
    expect(log[idx('deleteUser')][1]).toBe(UID);
    expect(idx('deleteUser')).toBe(log.length - 1);
  });
  test('identifie l’utilisateur par le jeton seulement (corps ignoré)', async () => {
    const admin = adminFake({ memberships: [] });
    const r = new Request('https://x.supabase.co/functions/v1/delete-account', {
      method: 'POST', headers: { Authorization: 'Bearer tok', Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: 'victim', user_id: 'victim' }),
    });
    const res = await handleDeleteAccount(r, { adminClient: admin });
    expect(await res.json()).toEqual({ ok: true, deletedTeams: 0 });
    expect(admin.log.find((l) => l[0] === 'deleteUser')[1]).toBe(UID);
    expect(admin.log.find((l) => l[0] === 'delete teams')).toBeUndefined();
  });
  test('échec de suppression des photos : ni espace ni compte supprimés, 500', async () => {
    const admin = adminFake({
      memberships: [{ team_id: T1, coach_id: UID }],
      objects: { [T1]: [{ id: null, name: 'swimmers' }], [`${T1}/swimmers`]: [{ id: 'x', name: 'x.jpg' }] },
      failRemove: true,
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleDeleteAccount(req('delete-account', { method: 'POST' }), { adminClient: admin });
    err.mockRestore();
    expect(res.status).toBe(500);
    expect(admin.log.find((l) => l[0] === 'delete teams')).toBeUndefined();
    expect(admin.log.find((l) => l[0] === 'deleteUser')).toBeUndefined();
  });
});
