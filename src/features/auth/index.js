/**
 * Écrans d'accès : connexion / inscription, code du club, nouveau mot de passe.
 * Chaque écran appelle `done()` quand l'état de la session a changé et que l'application
 * doit reprendre son routage.
 */
import { signIn, signUp, redeemCode, sendPasswordReset, updatePassword, signOut } from '../../core/session.js';
import { renderCredentials, renderCode, renderRecovery, setMessage, setBusy, fieldValue } from './view.js';

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
 * @param {HTMLElement} root
 * @param {'login'|'signup'} [mode]
 * @param {() => void} done
 */
export function showCredentials(root, mode = 'login', done = () => {}) {
  renderCredentials(root, mode, {
    switchMode: () => showCredentials(root, mode === 'login' ? 'signup' : 'login', done),
    submit: (form) =>
      guarded(root, async () => {
        const email = fieldValue(form, 'email');
        const password = fieldValue(form, 'password');
        if (!email.trim()) return setMessage(root, 'Saisis ton adresse e-mail');
        if (mode === 'signup') {
          const result = await signUp(email, password);
          if (result === 'confirm') setMessage(root, 'Vérifie ta boîte mail pour confirmer ton adresse', 'info');
          else done();
        } else {
          await signIn(email, password);
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
  });
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
 * Déconnexion demandée par l'entraîneur ; demande confirmation s'il reste des écritures non envoyées.
 * @param {() => void} [after]
 */
export async function leaveSession(after = () => {}) {
  let result = await signOut();
  if (result === 'pending') {
    const ok = confirm('Des modifications ne sont pas encore envoyées. Se déconnecter les fera perdre. Continuer ?');
    if (!ok) return;
    result = await signOut({ force: true });
  }
  after();
}
