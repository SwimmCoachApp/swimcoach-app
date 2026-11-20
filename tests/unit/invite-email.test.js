// @vitest-environment node
import { handleInviteEmail, buildInviteMail, FRESH_MS, RESEND_MS, APP_URL } from '../../supabase/functions/_shared/invite-email.js';

const ORIGIN = 'https://swimmcoachapp.github.io';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const T = '55555555-5555-4555-8555-555555555555';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** Client admin en mémoire : select/eq/gte/limit/maybeSingle et upsert, comme supabase-js. */
function fakeAdmin(tables, { users = { tok: A } } = {}) {
  return {
    auth: { getUser: async (t) => (users[t] ? { data: { user: { id: users[t] } }, error: null } : { data: null, error: { message: 'bad' } }) },
    from(name) {
      const filters = [];
      const q = {
        select: () => q,
        eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
        gte: (c, v) => { filters.push((r) => r[c] >= v); return q; },
        limit: () => q,
        maybeSingle: async () => ({ data: (tables[name] ?? []).find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        upsert: async (row) => {
          const list = (tables[name] ??= []);
          const i = list.findIndex((r) => r.team_id === row.team_id && r.email === row.email);
          if (i >= 0) list[i] = row; else list.push(row);
          return { error: null };
        },
      };
      return q;
    },
  };
}

function seed(extra = {}) {
  return {
    coaches: [
      { id: A, email: 'damien@toac.fr', display_name: 'Damien Martins', activated_at: iso(NOW - 1e9) },
      { id: B, email: 'b@toac.fr', display_name: '', activated_at: iso(NOW - 1e9) },
    ],
    team_members: [{ team_id: T, coach_id: A, added_by: null, created_at: iso(NOW - 1e9) }],
    team_invites: [],
    teams: [{ id: T, name: 'Benjamins' }],
    invite_emails: [],
    ...extra,
  };
}

function call(tables, body, { token = 'tok', method = 'POST', now = NOW, sendMail } = {}) {
  const sent = [];
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request('https://x.supabase.co/functions/v1/invite-email', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const deps = { adminClient: fakeAdmin(tables), now: () => now, sendMail: sendMail ?? (async (m) => { sent.push(m); }) };
  return handleInviteEmail(request, deps).then(async (res) => ({ status: res.status, json: res.status === 204 ? null : await res.json(), sent, res }));
}

describe('buildInviteMail', () => {
  test('objet et phrase d’invitation avec le nom de l’entraîneur et du groupe', () => {
    const m = buildInviteMail({ inviter: 'Damien Martins', team: 'Benjamins', to: 'b@toac.fr', kind: 'signup' });
    expect(m.subject).toBe('Damien Martins vous invite sur le groupe « Benjamins » — SwimCoach App');
    expect(m.text).toContain('Damien Martins vous a invité à collaborer sur le groupe « Benjamins » dans SwimCoach App.');
    expect(m.text).toContain('Créez un compte avec cette adresse e-mail (b@toac.fr).');
    expect(m.text).toContain(`Ouvrir SwimCoach App : ${APP_URL}`);
    expect(m.html).toContain(`href="${APP_URL}"`);
  });
  test('compte déjà activé : pas de code ni de création de compte', () => {
    const m = buildInviteMail({ inviter: 'D', team: 'G', to: 'b@x.fr', kind: 'member' });
    expect(m.text).toContain('le groupe apparaît dans « Mes groupes »');
    expect(m.text).not.toContain("code d'accès");
    expect(m.text).not.toContain('Créez un compte');
  });
  test('compte à activer : code d’accès demandé, pas de création de compte', () => {
    const m = buildInviteMail({ inviter: 'D', team: 'G', to: 'b@x.fr', kind: 'activate' });
    expect(m.text).toContain("Saisissez le code d'accès que D vous communiquera.");
    expect(m.text).not.toContain('Créez un compte');
  });
  test('HTML échappé (nom et groupe piégés)', () => {
    const m = buildInviteMail({ inviter: '<b>X</b>', team: 'G"><script>', to: 'b@x.fr', kind: 'signup' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>X</b>');
    expect(m.html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });
});

describe('handleInviteEmail', () => {
  test('OPTIONS : préflight 204 ; GET : 405 ; sans jeton ou jeton invalide : 401', async () => {
    expect((await call(seed(), null, { method: 'OPTIONS' })).status).toBe(204);
    expect((await call(seed(), null, { method: 'GET' })).status).toBe(405);
    expect((await call(seed(), { team: T, email: 'x@y.fr' }, { token: null })).status).toBe(401);
    expect((await call(seed(), { team: T, email: 'x@y.fr' }, { token: 'faux' })).status).toBe(401);
  });

  test('corps invalide : 400', async () => {
    expect((await call(seed(), { team: T, email: 'pas-une-adresse' })).status).toBe(400);
    expect((await call(seed(), { email: 'x@y.fr' })).status).toBe(400);
  });

  test('invitation en attente créée par l’appelant : e-mail « créer un compte », réponse à l’invitant, journal écrit', async () => {
    const t = seed({ team_invites: [{ team_id: T, email: 'new@club.fr', invited_by: A, created_at: iso(NOW - 60_000) }] });
    const r = await call(t, { team: T, email: ' New@Club.fr ' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ sent: true });
    expect(r.res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ to: 'new@club.fr', replyTo: 'damien@toac.fr', subject: 'Damien Martins vous invite sur le groupe « Benjamins » — SwimCoach App' });
    expect(r.sent[0].text).toContain('Créez un compte');
    expect(t.invite_emails).toEqual([{ team_id: T, email: 'new@club.fr', sent_at: iso(NOW) }]);
  });

  test('compte activé ajouté par l’appelant : e-mail « Mes groupes » ; sans nom affiché, l’adresse de l’invitant', async () => {
    const t = seed();
    t.coaches[0].display_name = '';
    t.team_members.push({ team_id: T, coach_id: B, added_by: A, created_at: iso(NOW - 60_000) });
    const r = await call(t, { team: T, email: 'b@toac.fr' });
    expect(r.json).toEqual({ sent: true });
    expect(r.sent[0].subject).toBe('damien@toac.fr vous invite sur le groupe « Benjamins » — SwimCoach App');
    expect(r.sent[0].text).toContain('Connectez-vous : le groupe apparaît dans « Mes groupes »');
  });

  test('compte confirmé mais pas activé : e-mail avec le code d’accès', async () => {
    const t = seed();
    t.coaches[1].activated_at = null;
    t.team_members.push({ team_id: T, coach_id: B, added_by: A, created_at: iso(NOW - 60_000) });
    const r = await call(t, { team: T, email: 'b@toac.fr' });
    expect(r.sent[0].text).toContain("Saisissez le code d'accès");
  });

  test('refus 403 : adresse jamais invitée, invitation d’un autre entraîneur, invitation trop ancienne', async () => {
    expect((await call(seed(), { team: T, email: 'inconnu@x.fr' })).status).toBe(403);
    const other = seed({ team_invites: [{ team_id: T, email: 'n@x.fr', invited_by: B, created_at: iso(NOW - 60_000) }] });
    expect((await call(other, { team: T, email: 'n@x.fr' })).status).toBe(403);
    const old = seed({ team_invites: [{ team_id: T, email: 'n@x.fr', invited_by: A, created_at: iso(NOW - FRESH_MS - 1000) }] });
    const r = await call(old, { team: T, email: 'n@x.fr' });
    expect(r.status).toBe(403);
    expect(r.sent).toEqual([]);
  });

  test('refus 403 : appelant non membre du groupe ou compte non activé', async () => {
    const t = seed({ team_invites: [{ team_id: T, email: 'n@x.fr', invited_by: A, created_at: iso(NOW - 60_000) }] });
    t.team_members = [];
    expect((await call(t, { team: T, email: 'n@x.fr' })).status).toBe(403);
    const t2 = seed({ team_invites: [{ team_id: T, email: 'n@x.fr', invited_by: A, created_at: iso(NOW - 60_000) }] });
    t2.coaches[0].activated_at = null;
    expect((await call(t2, { team: T, email: 'n@x.fr' })).status).toBe(403);
  });

  test('un seul e-mail par jour pour le même groupe et la même adresse', async () => {
    const t = seed({ team_invites: [{ team_id: T, email: 'n@x.fr', invited_by: A, created_at: iso(NOW - 60_000) }] });
    expect((await call(t, { team: T, email: 'n@x.fr' })).json).toEqual({ sent: true });
    const again = await call(t, { team: T, email: 'n@x.fr' }, { now: NOW + 60_000 });
    expect(again.json).toEqual({ sent: false, reason: 'already_sent' });
    expect(again.sent).toEqual([]);
    t.team_invites[0].created_at = iso(NOW + RESEND_MS); // réinvité le lendemain
    expect((await call(t, { team: T, email: 'n@x.fr' }, { now: NOW + RESEND_MS + 1000 })).json).toEqual({ sent: true });
  });

  test('échec SMTP : 502 mail_failed, rien n’est noté au journal', async () => {
    const t = seed({ team_invites: [{ team_id: T, email: 'n@x.fr', invited_by: A, created_at: iso(NOW - 60_000) }] });
    const r = await call(t, { team: T, email: 'n@x.fr' }, { sendMail: async () => { throw new Error('535'); } });
    expect(r.status).toBe(502);
    expect(r.json).toEqual({ error: 'mail_failed' });
    expect(t.invite_emails).toEqual([]);
  });
});
