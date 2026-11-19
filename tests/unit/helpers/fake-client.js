// Faux client Supabase écrit à la main pour les tests unitaires (aucun réseau).
// Gère : from(t).select().eq().order().range(), upsert(row, {onConflict}), delete().eq(),
// channel().on().subscribe(), removeChannel(). `failWith(call)` peut renvoyer une erreur.

export function makeFakeClient(tables = {}) {
  const calls = [];
  const channels = [];
  const client = {
    tables,
    calls,
    channels,
    /** @type {null | ((call: object) => object|null|undefined)} */
    failWith: null,
    /** @type {null | ((call: object) => boolean)} lecture retenue : instantané pris tout de suite, livré par release() */
    hold: null,
    /** @type {{call: object, release: () => void}[]} */
    held: [],
    from: (table) => builder(table),
    channel(name) {
      const ch = {
        name,
        handlers: [],
        on(type, filter, cb) {
          ch.handlers.push({ type, filter, cb });
          return ch;
        },
        subscribe() {
          ch.subscribed = true;
          return ch;
        },
        removed: false,
        /** Simule un événement postgres_changes. */
        emit(table, event, payload = {}) {
          for (const h of ch.handlers) {
            const f = h.filter;
            if (f.table === table && (f.event === '*' || f.event === event)) h.cb({ eventType: event, ...payload });
          }
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      ch.removed = true;
      return Promise.resolve('ok');
    },
  };

  function builder(table) {
    const call = { table, op: 'select', filters: [], order: [], range: null, row: null, options: null };
    const b = {
      select() { return b; },
      eq(col, val) { call.filters.push([col, val]); return b; },
      order(col) { call.order.push(col); return b; },
      range(from, to) { call.range = [from, to]; return b; },
      upsert(row, options) { call.op = 'upsert'; call.row = row; call.options = options; return b; },
      delete() { call.op = 'delete'; return b; },
      then(resolve, reject) {
        if ((call.op === 'select' ? client.hold : client.holdWrites)?.(call)) {
          const result = run(call);
          return new Promise((r) => client.held.push({ call, release: () => r(result) })).then(resolve, reject);
        }
        return Promise.resolve().then(() => run(call)).then(resolve, reject);
      },
    };
    return b;
  }

  const matches = (row, filters) => filters.every(([c, v]) => String(row[c]) === String(v));

  function run(call) {
    calls.push(call);
    const err = client.failWith?.(call);
    if (err) return { data: null, error: err, status: err.status ?? 400 };
    const rows = (tables[call.table] ??= []);
    if (call.op === 'select') {
      let out = rows.filter((r) => matches(r, call.filters));
      if (call.range) out = out.slice(call.range[0], call.range[1] + 1);
      return { data: out.map((r) => ({ ...r })), error: null, status: 200 };
    }
    if (call.op === 'upsert') {
      const cols = (call.options?.onConflict || 'id').split(',');
      const i = rows.findIndex((r) => cols.every((c) => String(r[c]) === String(call.row[c])));
      if (i >= 0) rows[i] = { ...rows[i], ...call.row };
      else rows.push({ ...call.row });
      return { data: null, error: null, status: 201 };
    }
    if (call.op === 'delete') {
      tables[call.table] = rows.filter((r) => !matches(r, call.filters));
      return { data: null, error: null, status: 204 };
    }
    throw new Error(`fake: op inconnue ${call.op}`);
  }

  return client;
}

/** Erreur réseau telle que la renvoie supabase-js (fetch échoué). */
export const networkError = () => ({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '', status: 0 });
/** Refus RLS. */
export const rlsError = () => ({ message: 'new row violates row-level security policy', code: '42501', status: 403 });
/** Erreur Postgres définitive (contrainte, etc.). */
export const pgError = (code, status = 409) => ({ message: `pg ${code}`, code, status });
