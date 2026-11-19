// Faux serveur Supabase en mémoire pour les tests e2e (auth, PostgREST, RPC, stubs stockage/fonctions).
//
// Usage :
//   const fake = await installFakeSupabase(page, { users, teams, members, tables });
//   fake.state.tables.swimmers   // lignes en mémoire
//   fake.callsTo('/auth/v1/recover')
//
// `target` peut être une page ou un contexte : avec un contexte, plusieurs pages (plusieurs
// entraîneurs) partagent le même état. L'isolation imite la RLS : un entraîneur activé ne lit
// et n'écrit que les lignes des espaces dont il est membre.
import { randomUUID } from 'node:crypto';
import { SUPABASE_PUBLISHABLE_KEY } from '../../src/core/config.js';

const TEAM_TABLES = ['groups', 'swimmers', 'sessions', 'presence', 'plan_weeks', 'plan_events', 'performances'];
const DIRECT_WRITE_FORBIDDEN = ['teams', 'team_members', 'team_invites', 'coaches'];
const DEFAULT_CONFLICT = { presence: 'session_id,swimmer_id', team_members: 'team_id,coach_id', team_invites: 'team_id,email' };
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'and', 'or']);
const MAX_ATTEMPTS = 5;
const TOKEN_TTL = 3600;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const nowIso = () => new Date().toISOString();
const clone = (v) => structuredClone(v);

class HttpError extends Error {
  constructor(status, body) {
    super(body?.message || body?.msg || String(status));
    this.status = status;
    this.body = body;
  }
}
const pgError = (status, code, message) => new HttpError(status, { code, message, details: null, hint: null });
const rpcError = (message) => pgError(400, 'P0001', message);
const authError = (status, errorCode, msg) => new HttpError(status, { code: status, error_code: errorCode, msg });

/**
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 * @param {{users?: object[], teams?: object[], members?: object[], tables?: object, clubCode?: string,
 *   tooManyAttempts?: boolean, autoConfirm?: boolean, tokenTtl?: number}} [opts]
 *   users : {email, password, activated?, id?, confirmed?} ; teams : {id?, name} ;
 *   members : {team_id, email} (e-mail inconnu = invitation en attente) ; tables : lignes initiales.
 */
export async function installFakeSupabase(target, opts = {}) {
  const state = {
    users: [],
    tables: {
      coaches: [], teams: [], team_members: [], team_invites: [],
      groups: [], swimmers: [], sessions: [], presence: [], plan_weeks: [], plan_events: [], performances: [],
    },
    clubCode: opts.clubCode ?? 'TOAC2026',
    tooManyAttempts: !!opts.tooManyAttempts,
    autoConfirm: !!opts.autoConfirm,
    tokenTtl: opts.tokenTtl ?? TOKEN_TTL,
    attempts: {},
    refreshTokens: new Map(),
  };
  const calls = [];
  const T = state.tables;

  // ------------------------------------------------------------ comptes
  function addUser({ email, password = 'motdepasse-long', activated = false, id = randomUUID(), confirmed = true }) {
    const user = { id, email: email.toLowerCase(), password, confirmed };
    state.users.push(user);
    T.coaches.push({ id, email: user.email, display_name: '', activated_at: activated ? nowIso() : null, created_at: nowIso() });
    return user;
  }
  const userByEmail = (email) => state.users.find((u) => u.email === String(email).toLowerCase());
  const userById = (id) => state.users.find((u) => u.id === id);
  const coachRow = (id) => T.coaches.find((c) => c.id === id);

  function teamIdsOf(userId) {
    const me = coachRow(userId);
    if (!me?.activated_at) return new Set();
    return new Set(T.team_members.filter((m) => m.coach_id === userId).map((m) => m.team_id));
  }
  function addTeam({ id = randomUUID(), name }) {
    T.teams.push({ id, name, created_by: null, created_at: nowIso(), updated_at: nowIso() });
    return id;
  }
  function addMember(teamId, email) {
    const u = userByEmail(email);
    if (u) {
      if (!T.team_members.some((m) => m.team_id === teamId && m.coach_id === u.id)) {
        T.team_members.push({ team_id: teamId, coach_id: u.id, added_by: null, created_at: nowIso() });
      }
    } else if (!T.team_invites.some((i) => i.team_id === teamId && i.email === email.toLowerCase())) {
      T.team_invites.push({ team_id: teamId, email: email.toLowerCase(), invited_by: null, created_at: nowIso() });
    }
  }

  for (const u of opts.users ?? []) addUser(u);
  for (const t of opts.teams ?? []) addTeam(t);
  for (const m of opts.members ?? []) addMember(m.team_id, m.email);
  for (const [name, rows] of Object.entries(opts.tables ?? {})) (T[name] ??= []).push(...clone(rows));

  // ------------------------------------------------------------ jetons
  const apiUser = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.confirmed ? nowIso() : null, phone: '',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id } }],
    created_at: nowIso(), updated_at: nowIso(),
  });
  function makeToken(u, ttl = state.tokenTtl) {
    const iat = Math.floor(Date.now() / 1000);
    const payload = { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat, exp: iat + ttl };
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.fake-signature`;
  }
  function makeSession(u, ttl = state.tokenTtl) {
    const refresh = `rt-${randomUUID()}`;
    state.refreshTokens.set(refresh, u.id);
    return {
      access_token: makeToken(u, ttl), token_type: 'bearer', expires_in: ttl,
      expires_at: Math.floor(Date.now() / 1000) + ttl, refresh_token: refresh, user: apiUser(u),
    };
  }
  function authedUser(headers, { required = true } = {}) {
    const token = (headers.authorization || '').replace(/^Bearer\s+/i, '');
    const parts = token.split('.');
    if (parts.length !== 3) {
      if (required) throw pgError(401, 'PGRST301', 'JWT invalid');
      return null;
    }
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { throw pgError(401, 'PGRST301', 'JWT invalid'); }
    if (payload.exp * 1000 < Date.now()) throw pgError(401, 'PGRST303', 'JWT expired');
    const u = userById(payload.sub);
    if (!u && required) throw pgError(401, 'PGRST301', 'JWT invalid');
    return u ?? null;
  }

  // ------------------------------------------------------------ /auth/v1
  function handleAuth(req) {
    const { method, path, query, body, headers } = req;
    const sub = path.replace(/^\/auth\/v1/, '');
    if (sub === '/signup' && method === 'POST') {
      const email = String(body.email || '').toLowerCase();
      if (!email || !body.password) throw authError(422, 'validation_failed', 'Signup requires a valid password');
      if (String(body.password).length < 10) throw authError(422, 'weak_password', 'Password should be at least 10 characters.');
      const existing = userByEmail(email);
      if (existing) return { body: { ...apiUser(existing), id: randomUUID(), identities: [] } }; // anti-énumération
      const u = addUser({ email, password: body.password, confirmed: state.autoConfirm });
      return { body: state.autoConfirm ? makeSession(u) : apiUser(u) };
    }
    if (sub === '/token' && method === 'POST') {
      if (query.get('grant_type') === 'password') {
        const u = userByEmail(body.email || '');
        if (!u || u.password !== body.password) throw authError(400, 'invalid_credentials', 'Invalid login credentials');
        if (!u.confirmed) throw authError(400, 'email_not_confirmed', 'Email not confirmed');
        return { body: makeSession(u) };
      }
      if (query.get('grant_type') === 'refresh_token') {
        const uid = state.refreshTokens.get(body.refresh_token);
        const u = uid && userById(uid);
        if (!u) throw authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        state.refreshTokens.delete(body.refresh_token);
        return { body: makeSession(u) };
      }
    }
    if (sub === '/user') {
      const u = authedUser(headers, { required: false });
      if (!u) throw authError(401, 'bad_jwt', 'invalid JWT');
      if (method === 'GET') return { body: apiUser(u) };
      if (method === 'PUT') {
        if (body.password) {
          if (String(body.password).length < 10) throw authError(422, 'weak_password', 'Password should be at least 10 characters.');
          u.password = body.password;
        }
        return { body: apiUser(u) };
      }
    }
    if (sub === '/logout' && method === 'POST') return { status: 204, body: null };
    if (sub === '/recover' && method === 'POST') return { body: {} };
    if (sub === '/settings') return { body: { external: { email: true }, disable_signup: false, mailer_autoconfirm: state.autoConfirm } };
    throw authError(404, 'not_found', `fake: route auth inconnue ${method} ${sub}`);
  }

  // ------------------------------------------------------------ RPC
  function claimInvites(user) {
    let n = 0;
    for (const inv of [...T.team_invites]) {
      if (inv.email !== user.email) continue;
      T.team_invites.splice(T.team_invites.indexOf(inv), 1);
      addMember(inv.team_id, user.email);
      n += 1;
    }
    return n;
  }
  function handleRpc(name, args, headers) {
    const user = authedUser(headers);
    const me = coachRow(user.id);
    const active = !!me?.activated_at;
    const mine = () => teamIdsOf(user.id);
    switch (name) {
      case 'redeem_invite_code': {
        if (active) return true;
        const count = (state.attempts[user.id] ??= 0);
        if (state.tooManyAttempts || count >= MAX_ATTEMPTS) throw rpcError('too_many_attempts');
        state.attempts[user.id] = count + 1;
        const ok = typeof args.code === 'string' && args.code.trim().toUpperCase() === state.clubCode.toUpperCase();
        if (!ok) return false;
        me.activated_at = nowIso();
        claimInvites(user);
        return true;
      }
      case 'claim_my_invites':
        if (!active) throw rpcError('not_allowed');
        return claimInvites(user);
      case 'create_team': {
        if (!active) throw rpcError('not_allowed');
        const nm = String(args.name ?? '').trim();
        if (nm.length < 1 || nm.length > 60) throw rpcError('invalid_name');
        const id = addTeam({ name: nm });
        T.teams.find((t) => t.id === id).created_by = user.id;
        addMember(id, user.email);
        return id;
      }
      case 'rename_team': {
        if (!mine().has(args.team)) throw rpcError('not_allowed');
        const t = T.teams.find((x) => x.id === args.team);
        t.name = String(args.name).trim();
        t.updated_at = nowIso();
        return null;
      }
      case 'add_team_member': {
        if (!mine().has(args.team)) throw rpcError('not_allowed');
        const email = String(args.email ?? '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw rpcError('invalid_email');
        const u = userByEmail(email);
        if (u && T.team_members.some((m) => m.team_id === args.team && m.coach_id === u.id)) return 'already_member';
        if (!u && T.team_invites.filter((i) => i.team_id === args.team).length >= 20) throw rpcError('too_many_invites');
        addMember(args.team, email);
        return u ? 'added' : 'invited';
      }
      case 'cancel_invite': {
        if (!mine().has(args.team)) throw rpcError('not_allowed');
        T.team_invites = T.team_invites.filter((i) => !(i.team_id === args.team && i.email === String(args.email).toLowerCase()));
        return null;
      }
      case 'remove_team_member': {
        if (!mine().has(args.team)) throw rpcError('not_allowed');
        const members = T.team_members.filter((m) => m.team_id === args.team);
        if (members.length <= 1) throw rpcError('last_member');
        T.team_members = T.team_members.filter((m) => !(m.team_id === args.team && m.coach_id === args.coach));
        return null;
      }
      case 'delete_team': {
        if (!mine().has(args.team)) throw rpcError('not_allowed');
        T.teams = T.teams.filter((t) => t.id !== args.team);
        T.team_members = T.team_members.filter((m) => m.team_id !== args.team);
        T.team_invites = T.team_invites.filter((i) => i.team_id !== args.team);
        for (const tn of TEAM_TABLES) T[tn] = T[tn].filter((r) => r.team_id !== args.team);
        return null;
      }
      default:
        throw pgError(404, 'PGRST202', `fake: fonction inconnue ${name}`);
    }
  }

  // ------------------------------------------------------------ PostgREST
  function visibleRows(table, user) {
    const rows = T[table] ?? [];
    if (!user) return [];
    const mine = teamIdsOf(user.id);
    if (table === 'coaches') {
      const peers = new Set(T.team_members.filter((m) => mine.has(m.team_id)).map((m) => m.coach_id));
      return rows.filter((c) => c.id === user.id || peers.has(c.id));
    }
    if (table === 'teams') return rows.filter((r) => mine.has(r.id));
    if (table === 'team_members' || table === 'team_invites' || TEAM_TABLES.includes(table)) {
      return rows.filter((r) => mine.has(r.team_id));
    }
    return rows;
  }

  const num = (v) => (v !== null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
  function cmp(a, b) {
    const na = num(a), nb = num(b);
    if (na !== null && nb !== null) return na - nb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }
  const likeRe = (pat, flags) => new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*|%/g, '.*')}$`, flags);
  function parseList(v) {
    return v.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
  function matchOne(cell, expr) {
    let e = expr, neg = false;
    if (e.startsWith('not.')) { neg = true; e = e.slice(4); }
    const dot = e.indexOf('.');
    const op = e.slice(0, dot), val = e.slice(dot + 1);
    let r;
    const has = cell !== null && cell !== undefined;
    switch (op) {
      case 'eq': r = has && String(cell) === val; break;
      case 'neq': r = !has || String(cell) !== val; break;
      case 'gt': r = has && cmp(cell, val) > 0; break;
      case 'gte': r = has && cmp(cell, val) >= 0; break;
      case 'lt': r = has && cmp(cell, val) < 0; break;
      case 'lte': r = has && cmp(cell, val) <= 0; break;
      case 'in': r = has && parseList(val).includes(String(cell)); break;
      case 'is': r = val === 'null' ? !has : has && String(cell) === val; break;
      case 'like': r = has && likeRe(val, '').test(String(cell)); break;
      case 'ilike': r = has && likeRe(val, 'i').test(String(cell)); break;
      default: throw pgError(400, 'PGRST100', `fake: opérateur non géré ${op}`);
    }
    return neg ? !r : r;
  }
  function filterRows(rows, query) {
    const filters = [...query.entries()].filter(([k]) => !RESERVED.has(k));
    return rows.filter((row) => filters.every(([col, expr]) => matchOne(row[col], expr)));
  }
  function orderRows(rows, order) {
    if (!order) return rows;
    const keys = order.split(',').map((s) => {
      const [col, ...mods] = s.split('.');
      const desc = mods.includes('desc');
      const nullsFirst = mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : desc;
      return { col, desc, nullsFirst };
    });
    return [...rows].sort((a, b) => {
      for (const { col, desc, nullsFirst } of keys) {
        const x = a[col], y = b[col];
        const nx = x === null || x === undefined, ny = y === null || y === undefined;
        if (nx || ny) {
          if (nx && ny) continue;
          return (nx ? 1 : -1) * (nullsFirst ? -1 : 1);
        }
        const c = cmp(x, y);
        if (c) return desc ? -c : c;
      }
      return 0;
    });
  }
  function project(rows, select) {
    if (!select || select === '*' || select.includes('(')) return clone(rows);
    const cols = select.split(',').map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, clone(r[c])])));
  }
  const wantsObject = (headers) => /vnd\.pgrst\.object/.test(headers.accept || '');
  const prefer = (headers) => String(headers.prefer || '');
  function shape(rows, headers) {
    if (!wantsObject(headers)) return rows;
    if (rows.length !== 1) {
      throw new HttpError(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
    }
    return rows[0];
  }

  function handleTable(req) {
    const { method, table, query, body, headers } = req;
    const user = authedUser(headers, { required: false });
    const select = query.get('select');
    const pref = prefer(headers);
    const wantRep = /return=representation/.test(pref);

    if (method === 'GET' || method === 'HEAD') {
      let rows = orderRows(filterRows(visibleRows(table, user), query), query.get('order'));
      const total = rows.length;
      let offset = Number(query.get('offset') || 0);
      let limit = query.get('limit') !== null ? Number(query.get('limit')) : Infinity;
      const range = /^(\d+)-(\d*)$/.exec(headers.range || '');
      if (range) {
        offset = Number(range[1]);
        if (range[2] !== '') limit = Math.min(limit, Number(range[2]) - offset + 1);
      }
      rows = rows.slice(offset, offset + limit);
      const end = offset + rows.length - 1;
      const totalTxt = /count=exact/.test(pref) ? String(total) : '*';
      const contentRange = rows.length ? `${offset}-${end}/${totalTxt}` : `*/${totalTxt}`;
      const partial = rows.length < total;
      return { status: range && partial ? 206 : 200, headers: { 'content-range': contentRange }, body: method === 'HEAD' ? null : shape(project(rows, select), headers) };
    }

    const incoming = () => (Array.isArray(body) ? body : [body]);
    const mine = user ? teamIdsOf(user.id) : new Set();
    const rls = () => pgError(403, '42501', `new row violates row-level security policy for table "${table}"`);

    if (method === 'POST') {
      if (!user || DIRECT_WRITE_FORBIDDEN.includes(table)) throw rls();
      const resolution = /resolution=(merge|ignore)-duplicates/.exec(pref)?.[1];
      const conflictCols = (query.get('on_conflict') || DEFAULT_CONFLICT[table] || 'id').split(',');
      const out = [];
      T[table] ??= [];
      for (const row of incoming()) {
        if (TEAM_TABLES.includes(table) && !mine.has(row.team_id)) throw rls();
        const existing = T[table].find((r) => conflictCols.every((c) => r[c] !== undefined && String(r[c]) === String(row[c])));
        if (existing) {
          if (!resolution) throw pgError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
          if (TEAM_TABLES.includes(table) && !mine.has(existing.team_id)) throw rls();
          if (resolution === 'merge') { Object.assign(existing, clone(row)); out.push(existing); }
          continue;
        }
        const created = { ...clone(row) };
        if (!DEFAULT_CONFLICT[table]) created.id ??= randomUUID();
        T[table].push(created);
        out.push(created);
      }
      return wantRep ? { status: 201, body: shape(project(out, select), headers) } : { status: 201, body: null };
    }

    const targets = filterRows(visibleRows(table, user), query);
    if (method === 'PATCH') {
      if (!user || DIRECT_WRITE_FORBIDDEN.includes(table)) throw rls();
      if (TEAM_TABLES.includes(table) && body && 'team_id' in body && !mine.has(body.team_id)) throw rls();
      for (const r of targets) Object.assign(r, clone(body));
      return wantRep ? { status: 200, body: shape(project(targets, select), headers) } : { status: 204, body: null };
    }
    if (method === 'DELETE') {
      if (!user || DIRECT_WRITE_FORBIDDEN.includes(table)) throw rls();
      T[table] = T[table].filter((r) => !targets.includes(r));
      return wantRep ? { status: 200, body: shape(project(targets, select), headers) } : { status: 204, body: null };
    }
    throw pgError(405, 'PGRST117', `fake: méthode ${method} non gérée`);
  }

  function handleRest(req) {
    const sub = req.path.replace(/^\/rest\/v1\/?/, '');
    if (sub.startsWith('rpc/')) {
      const name = sub.slice(4);
      const result = handleRpc(name, req.body ?? {}, req.headers);
      return { body: result === null ? null : result, status: result === null ? 204 : 200 };
    }
    return handleTable({ ...req, table: sub });
  }

  // Stubs : les tâches suivantes étendent le faux (stockage des photos, fonction liveffn-proxy).
  function handleStorage(req) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return { status: 404, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } };
    }
    return { body: {} };
  }
  const handleFunctions = () => ({ body: {} });

  // ------------------------------------------------------------ branchement Playwright
  const cors = (reqHeaders) => ({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'access-control-allow-headers': reqHeaders['access-control-request-headers'] || '*',
    'access-control-expose-headers': '*',
  });
  const dispatch = (kind) => async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors(headers) });
      return;
    }
    if (headers.apikey !== SUPABASE_PUBLISHABLE_KEY) {
      await route.fulfill({
        status: 401,
        headers: { ...cors(headers), 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' }),
      });
      return;
    }
    const url = new URL(request.url());
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    const req = { method: request.method(), path: url.pathname, query: url.searchParams, search: url.search, body, headers };
    let user = null;
    try { user = authedUser(headers, { required: false }); } catch { /* jeton invalide : journalisé sans entraîneur */ }
    calls.push({ method: req.method, path: req.path, search: req.search, body, userId: user?.id ?? null });
    let res;
    try {
      res = { status: 200, headers: {}, ...{ auth: handleAuth, rest: handleRest, storage: handleStorage, functions: handleFunctions }[kind](req) };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res = { status: e.status, headers: {}, body: e.body };
    }
    const payload = res.body === null || res.body === undefined ? '' : JSON.stringify(res.body);
    await route.fulfill({
      status: res.status === 200 && payload === '' ? 204 : res.status,
      headers: { ...cors(headers), 'content-type': 'application/json', ...res.headers },
      body: payload,
    });
  };

  await target.route('**/auth/v1/**', dispatch('auth'));
  await target.route('**/rest/v1/**', dispatch('rest'));
  await target.route('**/storage/v1/**', dispatch('storage'));
  await target.route('**/functions/v1/**', dispatch('functions'));
  // Temps réel neutralisé : le websocket s'ouvre mais le serveur ne répond jamais.
  if (typeof target.routeWebSocket === 'function') {
    await target.routeWebSocket(/\/realtime\/v1\//, () => {});
  }

  return {
    state,
    calls,
    addUser,
    addTeam,
    addMember,
    /** Appels reçus dont le chemin commence par `prefix`. */
    callsTo: (prefix) => calls.filter((c) => c.path.startsWith(prefix)),
    /** Identifiant d'un entraîneur d'après son e-mail. */
    coachId: (email) => userByEmail(email)?.id,
    /** Session prête à être écrite sous `swimcoach2_auth` pour démarrer connecté. */
    sessionFor: (email, ttl) => makeSession(userByEmail(email), ttl),
  };
}
