/**
 * Session de l'entraîneur : connexion, inscription, activation par code, déconnexion.
 *
 * `getCoach()` renvoie l'état connu de façon synchrone ; `initSession()` doit être attendu une
 * fois au démarrage. `onCoachChange(cb)` n'est appelé que quand l'entraîneur ou son état
 * d'activation change (pas à chaque renouvellement de jeton).
 */
import { supabase } from './supabase.js';
import { coachStore, clearAllCoachData } from './storage.js';

export const MIN_PASSWORD_LENGTH = 10;
export const MSG_PASSWORD_SHORT = 'Le mot de passe doit faire au moins 10 caractères';

/** @type {{id: string, email: string, activated: boolean}|null} */
let coach = null;
let recovering = false;
let started = null;
let getPendingCount = () => 0;
const coachListeners = new Set();
const recoveryListeners = new Set();

/**
 * Branche des dépendances de la session.
 * @param {{getPendingCount?: () => number}} deps
 *   getPendingCount : nombre d'écritures en attente d'envoi. La file d'attente (tâche 8) la branche ;
 *   tant qu'elle n'existe pas, il vaut toujours 0 et signOut ne renvoie jamais 'pending'.
 */
export function configureSession(deps = {}) {
  if (deps.getPendingCount) getPendingCount = deps.getPendingCount;
}

/** @returns {{id: string, email: string, activated: boolean}|null} */
export function getCoach() {
  return coach;
}

/** @param {(coach: {id: string, email: string, activated: boolean}|null) => void} cb @returns {() => void} */
export function onCoachChange(cb) {
  coachListeners.add(cb);
  return () => coachListeners.delete(cb);
}

/** @returns {boolean} true quand l'entraîneur arrive par un lien de réinitialisation de mot de passe */
export function isRecovering() {
  return recovering;
}

/** @param {() => void} cb @returns {() => void} */
export function onPasswordRecovery(cb) {
  recoveryListeners.add(cb);
  return () => recoveryListeners.delete(cb);
}

function setCoach(next) {
  const same = (!coach && !next) || (coach && next && coach.id === next.id && coach.activated === next.activated && coach.email === next.email);
  coach = next;
  if (!same) for (const cb of [...coachListeners]) cb(coach);
}

/** Lit l'état d'activation de l'entraîneur ; hors ligne, reprend la dernière valeur connue. */
async function loadCoach(user) {
  if (!user) {
    setCoach(null);
    return null;
  }
  let activated = false;
  const { data, error } = await supabase.from('coaches').select('id, activated_at').eq('id', user.id).maybeSingle();
  if (!error) {
    activated = !!data?.activated_at;
    coachStore(user.id).set('activated', activated);
  } else {
    activated = coachStore(user.id).get('activated') === true;
  }
  setCoach({ id: user.id, email: user.email ?? '', activated });
  return coach;
}

/** Démarre l'écoute de l'authentification et lit la session retenue. À attendre au démarrage. */
export function initSession() {
  started ??= (async () => {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        for (const cb of [...recoveryListeners]) cb();
      }
      // Pas d'appel supabase directement dans ce rappel (verrou interne) : on diffère.
      if (event === 'SIGNED_OUT') setTimeout(() => setCoach(null), 0);
      else if (session?.user && event !== 'INITIAL_SESSION') setTimeout(() => loadCoach(session.user), 0);
    });
    const { data } = await supabase.auth.getSession();
    await loadCoach(data.session?.user ?? null);
    return coach;
  })();
  return started;
}

/** Traduit une erreur d'authentification en message pour l'entraîneur. */
function authMessage(error) {
  const code = error?.code || '';
  if (code === 'invalid_credentials') return 'E-mail ou mot de passe incorrect';
  if (code === 'email_not_confirmed') return 'Confirme ton adresse e-mail avant de te connecter';
  if (code === 'weak_password') return MSG_PASSWORD_SHORT;
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'Trop de tentatives, réessaie dans quelques minutes';
  if (error?.status === 0 || /fetch|network/i.test(error?.message || '')) return 'Connexion impossible, vérifie ta connexion internet';
  return 'Une erreur est survenue, réessaie';
}

/**
 * @param {string} email
 * @param {string} password
 * @throws {Error} message français prêt à afficher
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(authMessage(error));
  await loadCoach(data.user);
}

/**
 * @param {string} email
 * @param {string} password au moins 10 caractères (refus local sinon)
 * @returns {Promise<'confirm'|'signed-in'>} 'confirm' : un e-mail de confirmation a été envoyé
 * @throws {Error} message français prêt à afficher
 */
export async function signUp(email, password) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(MSG_PASSWORD_SHORT);
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(authMessage(error));
  if (!data.session) return 'confirm';
  await loadCoach(data.session.user);
  return 'signed-in';
}

/**
 * Valide le code du club (active le compte et réclame les invitations en attente).
 * @param {string} code
 * @returns {Promise<'ok'|'bad'|'too_many'>}
 */
export async function redeemCode(code) {
  const { data, error } = await supabase.rpc('redeem_invite_code', { code });
  if (error) {
    if (/too_many_attempts/.test(error.message || '')) return 'too_many';
    throw new Error(authMessage(error));
  }
  if (data !== true) return 'bad';
  if (coach) {
    coachStore(coach.id).set('activated', true);
    setCoach({ ...coach, activated: true });
  }
  return 'ok';
}

/** @param {string} email @throws {Error} */
export async function sendPasswordReset(email) {
  const redirectTo = location.origin + location.pathname;
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw new Error(authMessage(error));
}

/**
 * Enregistre un nouveau mot de passe (après le lien de réinitialisation).
 * @param {string} password au moins 10 caractères
 * @throws {Error}
 */
export async function updatePassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(MSG_PASSWORD_SHORT);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(authMessage(error));
  recovering = false;
}

/**
 * Déconnecte l'entraîneur et efface ses données locales (jamais celles de l'ancienne app).
 * @param {{force?: boolean}} [opts] force : déconnecte même s'il reste des écritures en attente
 * @returns {Promise<'done'|'pending'>} 'pending' si des écritures attendent d'être envoyées et que force est faux
 */
export async function signOut({ force = false } = {}) {
  if (!force && getPendingCount() > 0) return 'pending';
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // hors ligne : la session locale est quand même supprimée ci-dessous
  }
  recovering = false;
  clearAllCoachData();
  setCoach(null);
  return 'done';
}
