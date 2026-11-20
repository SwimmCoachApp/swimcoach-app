// E-mail « tu es invité dans un groupe » (JS pur, testé sans Deno).
// Appelé par l'app juste après add_team_member. N'envoie que pour une adhésion ou une invitation
// que l'appelant vient lui-même de créer dans ce groupe : la fonction ne peut pas servir à écrire
// à une adresse quelconque. Un même couple (groupe, adresse) reçoit au plus un e-mail par jour.
import { bearerToken, jsonResponse, preflightResponse } from './cors.js';

export const APP_URL = 'https://swimmcoachapp.github.io/swimcoach-app/';
/** Délai pendant lequel l'adhésion ou l'invitation compte comme « juste créée ». */
export const FRESH_MS = 15 * 60 * 1000;
/** Délai minimal entre deux e-mails pour le même groupe et la même adresse. */
export const RESEND_MS = 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Contenu de l'e-mail.
 * @param {{inviter: string, team: string, to: string, kind: 'member'|'activate'|'signup', appUrl?: string}} p
 *   kind : 'member' compte activé (déjà membre), 'activate' compte à activer avec le code, 'signup' pas encore de compte
 * @returns {{subject: string, text: string, html: string}}
 */
export function buildInviteMail({ inviter, team, to, kind, appUrl = APP_URL }) {
  const subject = `${inviter} vous invite sur le groupe « ${team} » — SwimCoach App`;
  const intro = `${inviter} vous a invité à collaborer sur le groupe « ${team} » dans SwimCoach App.`;
  const shared = 'Vous partagerez les nageurs, les séances, les présences, le planning et les performances de ce groupe.';
  const steps = {
    member: ['Connectez-vous : le groupe apparaît dans « Mes groupes », en haut de l\'écran.'],
    activate: [
      'Connectez-vous avec cette adresse.',
      `Saisissez le code d'accès que ${inviter} vous communiquera.`,
      'Le groupe apparaît ensuite dans « Mes groupes ».',
    ],
    signup: [
      `Créez un compte avec cette adresse e-mail (${to}).`,
      'Confirmez votre adresse avec le lien reçu par e-mail.',
      `Saisissez le code d'accès que ${inviter} vous communiquera.`,
      'Le groupe apparaît ensuite dans « Mes groupes ».',
    ],
  }[kind];
  const reply = `Vous pouvez répondre à ce message pour écrire directement à ${inviter}.`;
  const text = [
    'Bonjour,', '', intro, shared, '', 'Pour rejoindre le groupe :',
    ...steps.map((s, i) => `${i + 1}. ${s}`), '', `Ouvrir SwimCoach App : ${appUrl}`, '', reply,
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#0f2044">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#071327">SwimCoach App</p>
<p>Bonjour,</p>
<p><strong>${esc(inviter)}</strong> vous a invité à collaborer sur le groupe <strong>« ${esc(team)} »</strong> dans SwimCoach App.</p>
<p>${esc(shared)}</p>
<p>Pour rejoindre le groupe :</p>
<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<p style="margin:24px 0"><a href="${esc(appUrl)}" style="background:#0ea5c6;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Ouvrir SwimCoach App</a></p>
<p style="color:#5b6b8a;font-size:13px">${esc(reply)}</p>
</div></body></html>`;
  return { subject, text, html };
}

/**
 * @param {Request} request corps JSON {team, email}
 * @param {{ adminClient: any, sendMail: (m: {to: string, replyTo?: string, subject: string, text: string, html: string}) => Promise<void>,
 *   now?: () => number, appUrl?: string }} deps
 * @returns {Promise<Response>} 200 {sent: true} ou {sent: false, reason: 'already_sent'} ; 400 ; 401 ; 403 ; 502 mail_failed ; 500
 */
export async function handleInviteEmail(request, deps) {
  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (request.method !== 'POST') return jsonResponse(request, 405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  if (!token) return jsonResponse(request, 401, { error: 'unauthorized' });
  const admin = deps.adminClient;
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (userError || !uid) return jsonResponse(request, 401, { error: 'unauthorized' });

  let body;
  try { body = await request.json(); } catch { body = null; }
  const team = typeof body?.team === 'string' ? body.team : '';
  const to = String(body?.email ?? '').trim().toLowerCase();
  if (!team || !EMAIL_RE.test(to) || to.length > 254) return jsonResponse(request, 400, { error: 'bad_request' });

  const now = deps.now ? deps.now() : Date.now();
  const since = new Date(now - FRESH_MS).toISOString();
  const one = async (q, what) => {
    const { data, error } = await q;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };

  try {
    // L'appelant : compte activé et membre du groupe.
    const me = await one(admin.from('coaches').select('email, display_name, activated_at').eq('id', uid).maybeSingle(), 'coaches');
    const mine = await one(admin.from('team_members').select('coach_id').eq('team_id', team).eq('coach_id', uid).maybeSingle(), 'team_members');
    if (!me?.activated_at || !mine) return jsonResponse(request, 403, { error: 'not_allowed' });

    // La cible : invitation ou adhésion créée par l'appelant il y a moins de FRESH_MS.
    let kind = null;
    const invite = await one(admin.from('team_invites').select('email')
      .eq('team_id', team).eq('email', to).eq('invited_by', uid).gte('created_at', since).maybeSingle(), 'team_invites');
    if (invite) {
      kind = 'signup';
    } else {
      const target = await one(admin.from('coaches').select('id, activated_at').eq('email', to).limit(1).maybeSingle(), 'coaches');
      const added = target && await one(admin.from('team_members').select('coach_id')
        .eq('team_id', team).eq('coach_id', target.id).eq('added_by', uid).gte('created_at', since).maybeSingle(), 'team_members');
      if (added) kind = target.activated_at ? 'member' : 'activate';
    }
    if (!kind) return jsonResponse(request, 403, { error: 'not_allowed' });

    // Au plus un e-mail par jour pour ce groupe et cette adresse.
    const last = await one(admin.from('invite_emails').select('sent_at').eq('team_id', team).eq('email', to).maybeSingle(), 'invite_emails');
    if (last && now - new Date(last.sent_at).getTime() < RESEND_MS) {
      return jsonResponse(request, 200, { sent: false, reason: 'already_sent' });
    }

    const teamRow = await one(admin.from('teams').select('name').eq('id', team).maybeSingle(), 'teams');
    if (!teamRow) return jsonResponse(request, 403, { error: 'not_allowed' });
    const inviter = (me.display_name || '').trim() || me.email;
    const mail = buildInviteMail({ inviter, team: teamRow.name, to, kind, appUrl: deps.appUrl });

    try {
      await deps.sendMail({ to, replyTo: me.email, ...mail });
    } catch (e) {
      console.error('invite-email smtp', e?.message || e);
      return jsonResponse(request, 502, { error: 'mail_failed' });
    }
    await one(admin.from('invite_emails').upsert({ team_id: team, email: to, sent_at: new Date(now).toISOString() }), 'invite_emails');
    return jsonResponse(request, 200, { sent: true });
  } catch (e) {
    console.error('invite-email', e?.message || e);
    return jsonResponse(request, 500, { error: 'invite_email_failed' });
  }
}
