// Faux serveur Supabase en mémoire pour les tests e2e (auth, PostgREST, RPC, stubs stockage/fonctions).
//
// Usage :
//   const fake = await installFakeSupabase(page, { users, teams, members, tables });
//   fake.state.tables.swimmers   // lignes en mémoire
//   fake.callsTo('/auth/v1/recover')
//
// `target` peut être une page, un contexte ou une liste de pages / contextes : tous partagent alors
// le même état (deux contextes = deux appareils, chacun avec son propre stockage local).
// L'isolation imite la RLS : un entraîneur activé ne lit et n'écrit que les lignes des espaces
// dont il est membre.
import { randomUUID } from 'node:crypto';
import { SUPABASE_PUBLISHABLE_KEY } from '../../src/core/config.js';

const TEAM_TABLES = ['groups', 'swimmers', 'sessions', 'presence', 'plan_weeks', 'plan_events', 'performances'];
const DIRECT_WRITE_FORBIDDEN = ['teams', 'team_members', 'team_invites', 'coaches'];
const DEFAULT_CONFLICT = { presence: 'session_id,swimmer_id', team_members: 'team_id,coach_id', team_invites: 'team_id,email' };
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'and', 'or']);
const MAX_ATTEMPTS = 5;
const TOKEN_TTL = 3600;
/** GoTrue accepte un jeton de rafraîchissement déjà utilisé pendant 10 s (refresh_token_reuse_interval). */
const REFRESH_REUSE_MS = 10_000;

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
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext | Array<import('@playwright/test').Page | import('@playwright/test').BrowserContext>} target
 * @param {{users?: object[], teams?: object[], members?: object[], tables?: object, clubCode?: string,
 *   tooManyAttempts?: boolean, autoConfirm?: boolean, tokenTtl?: number, clock?: Date|number, liveffnPages?: Record<string, string>}} [opts]
 *   users : {email, password, activated?, id?, confirmed?} ; teams : {id?, name} ;
 *   members : {team_id, email} (e-mail inconnu = invitation en attente) ; tables : lignes initiales ;
 *   liveffnPages : HTML renvoyé par la fonction liveffn-proxy, par identifiant de compétition.
 *   clock : heure de la page (page.clock.install) ; les jetons sont émis et vérifiés selon cette horloge.
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
    usedRefreshTokens: new Map(), // jeton déjà utilisé -> {userId, at}
    // Décalage de l'horloge du serveur d'authentification : les tests qui avancent l'horloge de la page
    // (page.clock) passent `clock` pour que les jetons ne paraissent pas expirés côté client.
    clockOffsetMs: opts.clock !== undefined ? new Date(opts.clock).getTime() - Date.now() : 0,
    signedTokens: new Map(),
    offline: false, // vrai : toute requête est coupée comme si le réseau était absent
    storageDown: false, // vrai : le stockage répond 503 (sauf la lecture d'une URL signée)
  };
  const calls = [];
  const T = state.tables;
  state.photos = new Map(); // objets du bucket photos : chemin -> {data, mime, size}

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
  const authNow = () => Date.now() + state.clockOffsetMs;
  function makeToken(u, ttl = state.tokenTtl) {
    const iat = Math.floor(authNow() / 1000);
    const payload = { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat, exp: iat + ttl };
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.fake-signature`;
  }
  function makeSession(u, ttl = state.tokenTtl) {
    const refresh = `rt-${randomUUID()}`;
    state.refreshTokens.set(refresh, u.id);
    return {
      access_token: makeToken(u, ttl), token_type: 'bearer', expires_in: ttl,
      expires_at: Math.floor(authNow() / 1000) + ttl, refresh_token: refresh, user: apiUser(u),
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
    if (payload.exp * 1000 < authNow()) throw pgError(401, 'PGRST303', 'JWT expired');
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
        // Jeton déjà utilisé il y a moins de 10 s (rafraîchissement coupé par un rechargement) : accepté, comme GoTrue.
        const used = state.usedRefreshTokens.get(body.refresh_token);
        const uid = state.refreshTokens.get(body.refresh_token) ?? (used && Date.now() - used.at < REFRESH_REUSE_MS ? used.userId : null);
        const u = uid && userById(uid);
        if (!u) throw authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        if (state.refreshTokens.delete(body.refresh_token)) state.usedRefreshTokens.set(body.refresh_token, { userId: u.id, at: Date.now() });
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
    if (method === 'PATCH' && table === 'coaches') {
      // Droit de colonne : seul display_name, et seulement sur sa propre ligne.
      if (!user || !body || Object.keys(body).some((k) => k !== 'display_name')) throw pgError(403, '42501', 'permission denied for table coaches');
      const own = targets.filter((r) => r.id === user.id);
      for (const r of own) r.display_name = String(body.display_name ?? '');
      return wantRep ? { status: 200, body: shape(project(own, select), headers) } : { status: 204, body: null };
    }
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

  // ------------------------------------------------------------ stockage (bucket privé « photos »)
  // Fidèle à la base : nom <équipe>/(swimmers|sessions)/<uuid>.jpg en minuscules, jpeg seulement, 2 Mo au plus,
  // accès réservé aux membres de l'équipe du chemin. Une URL signée se lit sans clé ni jeton, seulement avec son token.
  const PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(swimmers|sessions)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
  const MAX_PHOTO = 2 * 1024 * 1024;
  const storageError = (status, error, message) => new HttpError(status, { statusCode: String(status), error, message });
  const storageRls = () => storageError(403, 'Unauthorized', 'new row violates row-level security policy');
  const teamOfPath = (path) => path.split('/')[0];
  const decodePath = (p) => decodeURIComponent(p);

  function parseUpload(req) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] || '');
    const buf = req.raw;
    if (!boundary || !buf) {
      return { mime: (req.headers['content-type'] || '').split(';')[0], data: buf ?? Buffer.alloc(0) };
    }
    const sep = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
    let at = buf.indexOf(sep);
    while (at !== -1) {
      const next = buf.indexOf(sep, at + sep.length);
      if (next === -1) break;
      const part = buf.subarray(at + sep.length + 2, next - 2); // sans CRLF autour
      const headEnd = part.indexOf('\r\n\r\n');
      const head = part.subarray(0, headEnd).toString('latin1');
      if (/filename=/i.test(head)) {
        return { mime: (/content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? '').trim(), data: part.subarray(headEnd + 4) };
      }
      at = next;
    }
    return { mime: '', data: Buffer.alloc(0) };
  }

  function handleStorage(req) {
    const { method, headers } = req;
    const sub = req.path.replace(/^\/storage\/v1/, '');
    const signed = method === 'GET' && /^\/object\/sign\/photos\/(.+)$/.exec(sub);
    if (signed) {
      const path = decodePath(signed[1]);
      const token = req.query.get('token') || '';
      const obj = state.photos.get(path);
      const grant = state.signedTokens.get(token);
      if (!grant || grant.path !== path || grant.exp < Date.now() || !obj) throw storageError(400, 'InvalidJWT', 'Invalid token');
      return { status: 200, raw: obj.data, contentType: obj.mime };
    }
    if (state.storageDown) throw storageError(503, 'ServiceUnavailable', 'storage unavailable');
    const user = authedUser(headers, { required: false });
    const mine = user ? teamIdsOf(user.id) : new Set();
    const upload = /^\/object\/photos\/(.+)$/.exec(sub);
    if (upload && (method === 'POST' || method === 'PUT')) {
      const path = decodePath(upload[1]);
      if (!user || !mine.has(teamOfPath(path))) throw storageRls();
      if (!PHOTO_NAME.test(path)) throw storageRls();
      const { mime, data } = parseUpload(req);
      if (mime !== 'image/jpeg') throw storageError(415, 'InvalidMimeType', 'mime type ' + mime + ' is not supported');
      if (data.length > MAX_PHOTO) throw storageError(413, 'Payload too large', 'The object exceeded the maximum allowed size');
      const exists = state.photos.has(path);
      if (exists && !/^true$/i.test(headers['x-upsert'] || '')) throw storageError(409, 'Duplicate', 'The resource already exists');
      state.photos.set(path, { data, mime, size: data.length });
      return { body: { Key: `photos/${path}`, Id: randomUUID() } };
    }
    const sign = /^\/object\/sign\/photos\/(.+)$/.exec(sub);
    if (sign && method === 'POST') {
      const path = decodePath(sign[1]);
      if (!user || !mine.has(teamOfPath(path))) throw storageRls();
      if (!state.photos.has(path)) throw storageError(404, 'not_found', 'Object not found');
      const ttl = Number(req.body?.expiresIn ?? 0);
      if (!(ttl > 0)) throw storageError(400, 'InvalidRequest', 'expiresIn required');
      const token = randomUUID();
      state.signedTokens.set(token, { path, exp: Date.now() + ttl * 1000 });
      return { body: { signedURL: `/object/sign/photos/${path}?token=${token}` } };
    }
    if (method === 'POST' && sub === '/object/list/photos') {
      // Liste d'un « dossier » : sous-dossiers (id null) puis fichiers, triés par nom, paginés (limit / offset).
      if (!user) throw storageRls();
      const prefix = String(req.body?.prefix ?? '').replace(/^\/+|\/+$/g, '');
      const dir = prefix ? `${prefix}/` : '';
      const entries = new Map();
      for (const [path, obj] of state.photos) {
        if (!path.startsWith(dir) || !mine.has(teamOfPath(path))) continue;
        const rest = path.slice(dir.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!entries.has(name)) entries.set(name, slash === -1 ? { name, id: randomUUID(), metadata: { size: obj.size, mimetype: obj.mime } } : { name, id: null, metadata: null });
      }
      const sorted = [...entries.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const offset = Number(req.body?.offset ?? 0);
      const limit = Number(req.body?.limit ?? 100);
      state.storageLists = (state.storageLists ?? 0) + 1;
      return { body: sorted.slice(offset, offset + limit) };
    }
    if (method === 'DELETE' && sub === '/object/photos') {
      if (!user) throw storageRls();
      const removed = [];
      for (const path of req.body?.prefixes ?? []) {
        if (!mine.has(teamOfPath(path))) continue; // la politique ne voit pas les autres équipes
        if (state.photos.delete(path)) removed.push({ name: path, bucket_id: 'photos' });
      }
      return { body: removed };
    }
    throw storageError(404, 'not_found', `fake: route stockage inconnue ${method} ${sub}`);
  }
  // ------------------------------------------------------------ fonctions
  // liveffn-proxy : même contrat que supabase/functions/_shared/liveffn.js (JWT, entraîneur activé,
  // competition = 1 à 7 chiffres) ; la page renvoyée vient de `state.liveffnPages[competition]`.
  // `state.liveffnStatus` force une réponse d'erreur (502, 504…).
  state.liveffnPages = { ...(opts.liveffnPages ?? {}) };
  state.liveffnStatus = null;
  // delete-account : même contrat que supabase/functions/_shared/delete-account.js. Les espaces dont
  // l'entraîneur est le seul membre partent avec leurs photos et leurs données, puis le compte.
  function deleteAccount(req) {
    if (req.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
    let user = null;
    try { user = authedUser(req.headers, { required: false }); } catch { user = null; }
    if (!user) return { status: 401, body: { error: 'unauthorized' } };
    const mine = [...new Set(T.team_members.filter((m) => m.coach_id === user.id).map((m) => m.team_id))];
    const sole = mine.filter((t) => T.team_members.every((m) => m.team_id !== t || m.coach_id === user.id));
    for (const teamId of sole) {
      for (const path of [...state.photos.keys()]) if (teamOfPath(path) === teamId) state.photos.delete(path);
      T.teams = T.teams.filter((t) => t.id !== teamId);
      T.team_invites = T.team_invites.filter((i) => i.team_id !== teamId);
      for (const tn of TEAM_TABLES) T[tn] = T[tn].filter((r) => r.team_id !== teamId);
    }
    T.team_members = T.team_members.filter((m) => m.coach_id !== user.id && !sole.includes(m.team_id));
    T.coaches = T.coaches.filter((c) => c.id !== user.id);
    state.users = state.users.filter((u) => u.id !== user.id);
    for (const [rt, uid] of [...state.refreshTokens]) if (uid === user.id) state.refreshTokens.delete(rt);
    return { body: { ok: true, deletedTeams: sole.length } };
  }
  function handleFunctions(req) {
    const name = req.path.replace(/^\/functions\/v1\//, '');
    if (name === 'delete-account') return deleteAccount(req);
    if (name !== 'liveffn-proxy') return { body: {} };
    if (req.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } };
    let user = null;
    try { user = authedUser(req.headers, { required: false }); } catch { user = null; }
    if (!user) return { status: 401, body: { error: 'unauthorized' } };
    if (!coachRow(user.id)?.activated_at) return { status: 403, body: { error: 'not_activated' } };
    const competition = req.query.get('competition') ?? '';
    if (!/^\d{1,7}$/.test(competition) || req.query.get('structure') !== '39') return { status: 400, body: { error: 'invalid_competition' } };
    if (state.liveffnStatus) return { status: state.liveffnStatus, body: { error: 'upstream_status' } };
    const page = state.liveffnPages[competition];
    if (page == null) return { status: 502, body: { error: 'upstream_status', status: 404 } };
    return { status: 200, raw: page, contentType: 'text/html; charset=utf-8' };
  }

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
    if (state.offline) {
      await route.abort('internetdisconnected');
      return;
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors(headers) });
      return;
    }
    const isSignedRead = request.method() === 'GET' && /\/storage\/v1\/object\/sign\/photos\//.test(request.url());
    if (!isSignedRead && headers.apikey !== SUPABASE_PUBLISHABLE_KEY) {
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
    const req = { method: request.method(), path: url.pathname, query: url.searchParams, search: url.search, body, headers, raw: request.postDataBuffer() };
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
    if (res.raw) {
      await route.fulfill({ status: res.status, headers: { ...cors(headers), 'content-type': res.contentType }, body: res.raw });
      return;
    }
    const payload = res.body === null || res.body === undefined ? '' : JSON.stringify(res.body);
    await route.fulfill({
      status: res.status === 200 && payload === '' ? 204 : res.status,
      headers: { ...cors(headers), 'content-type': 'application/json', ...res.headers },
      body: payload,
    });
  };

  for (const t of Array.isArray(target) ? target : [target]) {
    await t.route('**/auth/v1/**', dispatch('auth'));
    await t.route('**/rest/v1/**', dispatch('rest'));
    await t.route('**/storage/v1/**', dispatch('storage'));
    await t.route('**/functions/v1/**', dispatch('functions'));
    // Temps réel neutralisé : le websocket s'ouvre mais le serveur ne répond jamais.
    if (typeof t.routeWebSocket === 'function') {
      await t.routeWebSocket(/\/realtime\/v1\//, () => {});
    }
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
