/**
 * Session de l'entraîneur : connexion, inscription, activation par code, déconnexion.
 *
 * `getCoach()` renvoie l'état connu de façon synchrone ; `initSession()` doit être attendu une
 * fois au démarrage. `onCoachChange(cb)` n'est appelé que quand l'entraîneur ou son état
 * d'activation change (pas à chaque renouvellement de jeton).
 */
import { supabase } from './supabase.js';
import { coachStore, clearAllCoachData, appStore, blockAuthWrites, storedCoachIds } from './storage.js';

export const MIN_PASSWORD_LENGTH = 10;
export const MSG_PASSWORD_SHORT = 'Le mot de passe doit faire au moins 10 caractères';

/** @type {{id: string, email: string, activated: boolean}|null} */
let coach = null;
let recovering = false;
let started = null;
let getPendingCount = () => 0;
/**
 * Entraîneur déconnecté alors que supabase-js renouvelait encore son jeton (attente dépassée) : jusqu'au
 * rechargement de la page, aucun événement de session à son nom n'est accepté et sa session réécrite est effacée.
 */
let signedOutId = null;
/** Vrai quand une déconnexion forcée attend le rechargement de la page (jusque-là, plus de connexion possible). */
let reloadPending = false;
/**
 * Recharge la page. Hors ligne sans service worker, le rechargement échouerait (page d'erreur du
 * navigateur) : il attend alors le retour du réseau ; d'ici là, signedOutId écarte la session tardive.
 */
let reloadPage = () => {
  if (navigator.onLine || navigator.serviceWorker?.controller) location.reload();
  else window.addEventListener('online', () => location.reload(), { once: true });
};
let flushPending = async () => {};

/** Attente maximale de l'envoi de la file avant une déconnexion. */
export const FLUSH_WAIT_MS = 3000;
const coachListeners = new Set();
const recoveryListeners = new Set();

/**
 * Branche des dépendances de la session.
 * @param {{getPendingCount?: (coachId?: string) => number, flushPending?: (coachId: string) => Promise<void>}} deps
 *   getPendingCount : nombre d'écritures en attente d'envoi de l'entraîneur donné (par défaut le
 *   connecté), tous espaces confondus. flushPending : envoie la file de cet entraîneur (tous espaces).
 *   Branchées sur la file d'attente par main.js.
 */
export function configureSession(deps = {}) {
  if (deps.getPendingCount) getPendingCount = deps.getPendingCount;
  if (deps.flushPending) flushPending = deps.flushPending;
  if (deps.reloadPage) reloadPage = deps.reloadPage;
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

/** @returns {boolean} true tant que la page doit se recharger (déconnexion forcée, éventuellement au retour du réseau) */
export function isReloadPending() {
  return reloadPending;
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

/**
 * Un entraîneur arrive (connexion, session retrouvée) : les données laissées par d'autres entraîneurs
 * sur cet appareil (déconnexion subie, compte supprimé ailleurs) sont effacées, sauf celles d'un
 * entraîneur qui a encore des écritures en attente ou refusées : elles restent sous son préfixe,
 * jamais envoyées sous un autre jeton.
 * @param {string} keepId entraîneur qui arrive
 */
function purgeOtherCoaches(keepId) {
  for (const id of storedCoachIds()) {
    if (id === keepId) continue;
    const pending = coachStore(id).get('outboxTeams');
    if (Array.isArray(pending) && pending.length) continue;
    coachStore(id).clear();
  }
}

function setCoach(next) {
  const same = (!coach && !next) || (coach && next && coach.id === next.id && coach.activated === next.activated && coach.email === next.email);
  // Un autre entraîneur prend la place sans déconnexion : les écritures en attente de l'ancien ne
  // doivent jamais partir sous le nouveau. On efface les données de l'ancien seulement (pas la
  // session d'authentification ni les données du nouveau, que clearAllCoachData effacerait).
  if (coach && next && coach.id !== next.id && getPendingCount(coach.id) > 0) coachStore(coach.id).clear();
  if (next && coach?.id !== next.id) purgeOtherCoaches(next.id);
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
      else if (signedOutId && session?.user?.id === signedOutId && event !== 'INITIAL_SESSION') setTimeout(forgetLateSession, 0);
      else if (session?.user && event !== 'INITIAL_SESSION') setTimeout(() => loadCoach(session.user), 0);
    });
    const { data } = await supabase.auth.getSession();
    await loadCoach(data.session?.user ?? null);
    return coach;
  })();
  return started;
}

/**
 * Un renouvellement de jeton commencé avant une déconnexion (hors ligne, il réessaie en boucle) vient
 * d'aboutir et a réécrit la session de l'entraîneur déconnecté : on l'efface sans le reconnecter.
 */
function forgetLateSession() {
  const stored = appStore.get('auth');
  if (stored?.user?.id && stored.user.id === signedOutId) appStore.remove('auth');
}

/** Traduit une erreur d'authentification en message pour l'entraîneur. */
function authMessage(error) {
  const code = error?.code || '';
  if (code === 'invalid_credentials') return 'E-mail ou mot de passe incorrect';
  if (code === 'email_not_confirmed') return 'Confirme ton adresse e-mail avant de te connecter';
  if (code === 'weak_password') return MSG_PASSWORD_SHORT;
  if (code === 'over_email_send_rate_limit') {
    return 'Un e-mail de confirmation vient déjà de partir : vérifie ta boîte mail (et les spams). Tu pourras en redemander un dans une minute.';
  }
  if (code === 'over_request_rate_limit') return 'Trop de tentatives, réessaie dans quelques minutes';
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
  // Le lien de l'e-mail revient vers l'app, quelle que soit l'« URL du site » réglée dans Supabase
  // (l'adresse doit figurer dans les Redirect URLs autorisées).
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
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

/** Tente d'envoyer la file de l'entraîneur (en ligne seulement), sans attendre plus de FLUSH_WAIT_MS. */
async function tryFlush(coachId) {
  if (!coachId || !navigator.onLine) return;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, FLUSH_WAIT_MS); });
  try {
    await Promise.race([Promise.resolve().then(() => flushPending(coachId)).catch(() => {}), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Déconnecte l'entraîneur et efface ses données locales (jamais celles de l'ancienne app).
 * S'il reste des écritures en attente et que le réseau est là, la file part d'abord (attente bornée
 * à FLUSH_WAIT_MS) ; on recompte ensuite.
 * @param {{force?: boolean}} [opts] force : déconnecte même s'il reste des écritures en attente
 * @returns {Promise<'done'|'pending'>} 'pending' si des écritures attendent encore d'être envoyées et que force est faux
 */
export async function signOut({ force = false } = {}) {
  if (!force && getPendingCount(coach?.id) > 0) {
    await tryFlush(coach?.id);
    if (getPendingCount(coach?.id) > 0) return 'pending';
  }
  const leaving = coach?.id ?? null;
  // Aucun renouvellement de jeton ne doit réécrire la session pendant qu'on la ferme.
  blockAuthWrites(true);
  // Jeton expiré sans réseau fiable : supabase-js tente de le renouveler (en boucle, jusqu'à 30 s, verrou
  // pris) avant de déconnecter. On n'attend pas plus de FLUSH_WAIT_MS ; si l'attente est dépassée, ce
  // renouvellement vit encore et pourrait réécrire la session (même par-dessus celle d'un autre
  // entraîneur) : les données locales effacées, la page est rechargée pour tuer ce client.
  let timer;
  const timedOut = await Promise.race([
    Promise.resolve().then(() => supabase.auth.signOut({ scope: 'local' })).catch(() => {}).then(() => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(true), FLUSH_WAIT_MS); }),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    signedOutId = leaving;
    reloadPending = true; // avant setCoach(null) : l'écran de connexion doit déjà le savoir
  } else blockAuthWrites(false);
  recovering = false;
  clearAllCoachData();
  setCoach(null);
  if (timedOut) reloadPage();
  return 'done';
}

/**
 * Supprime le compte de l'entraîneur connecté (fonction serveur `delete-account` : les espaces dont il
 * est le seul membre partent avec leurs photos et leurs données), puis efface toutes ses données
 * locales et le déconnecte. Les écritures encore en attente sont abandonnées.
 * @returns {Promise<number>} nombre d'espaces supprimés avec le compte
 * @throws {Error} message français prêt à afficher (rien n'est effacé localement)
 */
export async function deleteAccount() {
  if (!coach) throw new Error('Connecte-toi pour supprimer ton compte');
  const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error || data?.ok !== true) throw new Error('Suppression du compte impossible, vérifie ta connexion et réessaie');
  await signOut({ force: true });
  return Number(data.deletedTeams) || 0;
}
