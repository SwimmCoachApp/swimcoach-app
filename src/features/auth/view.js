/**
 * Écrans de connexion : balisage et écouteurs. La logique est dans index.js.
 * Les textes variables (e-mail) sont toujours échappés ; les messages passent par textContent.
 */
import { esc } from '../../core/html.js';

/** Page publique de confidentialité (servie telle quelle depuis public/). */
const PRIVACY_LINK = '<p class="auth-privacy"><a class="btn-link" href="./privacy.html">Confidentialité</a></p>';
const LOGO = '<div class="auth-logo" aria-hidden="true">SwimCoach</div>';

/**
 * Remplace le contenu de `root` par un écran et branche ses actions.
 * @param {HTMLElement} root
 * @param {string} screen nom de l'écran (attribut data-screen)
 * @param {string} inner balisage du contenu de la carte
 * @param {{submit?: (form: HTMLFormElement) => void, actions?: Record<string, () => void>}} handlers
 * @returns {HTMLElement} l'élément <main>
 */
function mount(root, screen, inner, { submit, actions = {} }) {
  root.innerHTML = `<main class="auth" data-screen="${screen}">${LOGO}<section class="auth-card">${inner}<p class="auth-msg" role="status" data-msg></p></section></main>`;
  const main = root.firstElementChild;
  const form = main.querySelector('form');
  if (form && submit) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit(form);
    });
  }
  main.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    const run = el && actions[el.dataset.action];
    if (run) {
      event.preventDefault();
      run();
    }
  });
  return main;
}

/**
 * Affiche un message sous le formulaire.
 * @param {HTMLElement} root
 * @param {string} text
 * @param {'error'|'info'} [kind]
 */
export function setMessage(root, text, kind = 'error') {
  const el = root.querySelector('[data-msg]');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

/** Active ou désactive le bouton d'envoi pendant un appel. */
export function setBusy(root, busy) {
  for (const b of root.querySelectorAll('button[type="submit"]')) b.disabled = busy;
}

/** @param {HTMLFormElement} form @param {string} name */
export function fieldValue(form, name) {
  return form.elements[name]?.value ?? '';
}

const field = (name, label, type, extra = '') =>
  `<label class="auth-label" for="f-${name}">${label}</label><input class="form-input" id="f-${name}" name="${name}" type="${type}" ${extra}>`;

/**
 * Écran de connexion ou d'inscription.
 * @param {HTMLElement} root
 * @param {'login'|'signup'} mode
 * @param {{submit: (form: HTMLFormElement) => void, switchMode: () => void, forgot: (form: HTMLFormElement) => void}} h
 * @param {boolean} [waiting] déconnexion forcée en attente de rechargement : formulaire désactivé
 */
export function renderCredentials(root, mode, h, waiting = false) {
  const login = mode === 'login';
  const inner = `<form novalidate>
      ${field('email', 'Adresse e-mail', 'email', 'autocomplete="email" autocapitalize="none" inputmode="email"')}
      ${field('password', 'Mot de passe', 'password', `autocomplete="${login ? 'current-password' : 'new-password'}"`)}
      ${login ? '' : '<p class="auth-hint">10 caractères minimum.</p>'}
      <button class="btn btn-primary" type="submit">${login ? 'Se connecter' : 'Créer un compte'}</button>
    </form>
    <div class="auth-links">
      <button class="btn-link" type="button" data-action="switch">${login ? 'Créer un compte' : 'Se connecter'}</button>
      ${login ? '<button class="btn-link" type="button" data-action="forgot">Mot de passe oublié ?</button>' : ''}
    </div>
    ${PRIVACY_LINK}`;
  const main = mount(root, 'auth', inner, {
    submit: h.submit,
    actions: { switch: h.switchMode, forgot: () => h.forgot(main.querySelector('form')) },
  });
  if (waiting) {
    for (const el of main.querySelectorAll('input, button')) el.disabled = true;
    setMessage(root, 'Reconnexion au retour du réseau', 'info');
  }
}

/**
 * Écran affiché après une inscription réussie : le formulaire disparaît pour qu'on ne le renvoie
 * pas par erreur (Supabase n'accepte qu'un e-mail de confirmation par minute).
 * @param {HTMLElement} root
 * @param {string} email
 * @param {{ login: () => void }} h
 */
export function renderSignupSent(root, email, h) {
  const inner = `<p>Un e-mail vient d'être envoyé à <strong>${esc(email)}</strong>. Clique sur le lien qu'il contient,
      puis reviens te connecter. Pense à regarder dans les spams.</p>
    <div class="auth-links">
      <button class="btn btn-primary" type="button" data-action="login">Se connecter</button>
    </div>
    ${PRIVACY_LINK}`;
  mount(root, 'auth', inner, { actions: { login: h.login } });
  setMessage(root, 'Vérifie ta boîte mail pour confirmer ton adresse', 'info');
}

/**
 * Écran « Code du club ».
 * @param {HTMLElement} root
 * @param {string} email
 * @param {{submit: (form: HTMLFormElement) => void, signOut: () => void}} h
 */
export function renderCode(root, email, h) {
  const inner = `<h1 class="auth-title">Active ton compte</h1>
    <p class="auth-hint">Connecté en tant que <strong>${esc(email)}</strong>. Saisis le code donné par le club.</p>
    <form novalidate>
      ${field('code', 'Code du club', 'text', 'autocomplete="off" autocapitalize="characters"')}
      <button class="btn btn-primary" type="submit">Valider</button>
    </form>
    <div class="auth-links"><button class="btn-link" type="button" data-action="signout">Se déconnecter</button></div>`;
  mount(root, 'code', inner, { submit: h.submit, actions: { signout: h.signOut } });
}

/**
 * Écran « Nouveau mot de passe ».
 * @param {HTMLElement} root
 * @param {{submit: (form: HTMLFormElement) => void}} h
 */
export function renderRecovery(root, h) {
  const inner = `<h1 class="auth-title">Nouveau mot de passe</h1>
    <form novalidate>
      ${field('password', 'Nouveau mot de passe', 'password', 'autocomplete="new-password"')}
      <p class="auth-hint">10 caractères minimum.</p>
      <button class="btn btn-primary" type="submit">Enregistrer</button>
    </form>`;
  mount(root, 'recovery', inner, { submit: h.submit });
}

/**
 * Écran « Crée ton espace ».
 * @param {HTMLElement} root
 * @param {string} email
 * @param {{submit: (form: HTMLFormElement) => void, signOut: () => void}} h
 */
export function renderCreateTeam(root, email, h) {
  const inner = `<h1 class="auth-title">Crée ton espace</h1>
    <p class="auth-hint">Un collègue peut aussi t'ajouter à son espace avec ton adresse e-mail.</p>
    <p class="auth-hint">Ton adresse : <strong>${esc(email)}</strong></p>
    <form novalidate>
      ${field('name', "Nom de l'espace", 'text', 'maxlength="60" autocomplete="off"')}
      <button class="btn btn-primary" type="submit">Créer</button>
    </form>
    <div class="auth-links"><button class="btn-link" type="button" data-action="signout">Se déconnecter</button></div>`;
  mount(root, 'create-team', inner, { submit: h.submit, actions: { signout: h.signOut } });
}
