/**
 * Écrans d'accès : connexion / inscription, code du club, nouveau mot de passe.
 * Chaque écran appelle `done()` quand l'état de la session a changé et que l'application
 * doit reprendre son routage.
 */
import { signIn, signUp, redeemCode, sendPasswordReset, updatePassword, signOut, isReloadPending } from '../../core/session.js';
import { pendingCount } from '../../core/outbox.js';
import { askConfirm } from '../../app/dialog.js';
import { renderCredentials, renderCode, renderRecovery, renderSignupSent, setMessage, setBusy, fieldValue } from './view.js';
import { renderWelcome, markWelcomeSeen, welcomeSeen } from './welcome.js';

/** Exécute une action asynchrone en bloquant le bouton ; l'erreur s'affiche sous le formulaire. */
async function guarded(root, action) {
  setBusy(root, true);
  try {
    await action();
  } catch (e) {
    setMessage(root, e instanceof Error ? e.message : 'Une erreur est survenue, réessaie');
  } finally {
    setBusy(root, false);
  }
}

/**
 * Accueil : présentation de l'app au premier lancement sur cet appareil, connexion directe ensuite.
 * @param {HTMLElement} root
 * @param {() => void} done
 */
export function showStart(root, done = () => {}) {
  if (welcomeSeen()) showCredentials(root, 'login', done);
  else showWelcome(root, done);
}

/**
 * Carrousel de présentation, avec « Se connecter » et « Créer un compte » toujours visibles.
 * @param {HTMLElement} root
 * @param {() => void} done
 */
export function showWelcome(root, done = () => {}) {
  renderWelcome(root, {
    login: () => showCredentials(root, 'login', done),
    signup: () => showCredentials(root, 'signup', done),
  });
}

/**
 * @param {HTMLElement} root
 * @param {'login'|'signup'} [mode]
 * @param {() => void} done
 */
export function showCredentials(root, mode = 'login', done = () => {}) {
  renderCredentials(root, mode, {
    back: () => showWelcome(root, done),
    switchMode: () => showCredentials(root, mode === 'login' ? 'signup' : 'login', done),
    submit: (form) =>
      guarded(root, async () => {
        const email = fieldValue(form, 'email');
        const password = fieldValue(form, 'password');
        if (!email.trim()) return setMessage(root, 'Saisis ton adresse e-mail');
        if (mode === 'signup') {
          const result = await signUp(email, password);
          if (result === 'confirm') {
            renderSignupSent(root, email.trim(), { login: () => showCredentials(root, 'login', done) });
          } else done();
        } else {
          await signIn(email, password);
          markWelcomeSeen(); // appareil déjà utilisé : la connexion s'ouvrira directement la prochaine fois
          done();
        }
      }),
    forgot: (form) =>
      guarded(root, async () => {
        const email = fieldValue(form, 'email');
        if (!email.trim()) return setMessage(root, 'Saisis ton adresse e-mail');
        await sendPasswordReset(email);
        setMessage(root, 'Si ce compte existe, un e-mail de réinitialisation vient de partir', 'info');
      }),
  }, isReloadPending());
}

/**
 * @param {HTMLElement} root
 * @param {{email: string}} coach
 * @param {() => void} done
 * @param {() => void} leave appelé après la déconnexion
 */
export function showCode(root, coach, done, leave) {
  renderCode(root, coach.email, {
    signOut: () => leaveSession(leave),
    submit: (form) =>
      guarded(root, async () => {
        const code = fieldValue(form, 'code').trim();
        if (!code) return setMessage(root, 'Code incorrect');
        const result = await redeemCode(code);
        if (result === 'ok') done();
        else if (result === 'too_many') setMessage(root, "Trop d'essais, réessaie dans une heure");
        else setMessage(root, 'Code incorrect');
      }),
  });
}

/**
 * @param {HTMLElement} root
 * @param {() => void} done
 */
export function showRecovery(root, done) {
  renderRecovery(root, {
    submit: (form) =>
      guarded(root, async () => {
        await updatePassword(fieldValue(form, 'password'));
        done();
      }),
  });
}

/**
 * Texte de l'avertissement de déconnexion, accordé au nombre de modifications non envoyées.
 * @param {number} n
 * @returns {string}
 */
export function pendingText(n) {
  return n > 1 ? `${n} modifications ne sont pas encore envoyées` : `${n} modification n'est pas encore envoyée`;
}

/**
 * Déconnexion demandée par l'entraîneur. S'il reste des écritures non envoyées (après une tentative
 * d'envoi bornée), une fenêtre propose « Attendre le réseau » ou « Se déconnecter quand même ».
 * @param {() => void} [after] appelé une fois déconnecté (pas si l'entraîneur choisit d'attendre)
 * @returns {Promise<boolean>} true si l'entraîneur est déconnecté
 */
export async function leaveSession(after = () => {}) {
  if ((await signOut()) === 'pending') {
    const n = pendingCount();
    const ok = await askConfirm({
      icon: '📡',
      title: 'Modifications non envoyées',
      text: `${pendingText(n)}. ${n > 1 ? 'Si tu te déconnectes maintenant, elles seront perdues.' : 'Si tu te déconnectes maintenant, elle sera perdue.'}`,
      cancel: 'Attendre le réseau',
      confirm: 'Se déconnecter quand même',
      danger: true,
    });
    if (!ok) return false;
    await signOut({ force: true });
  }
  after();
  return true;
}
