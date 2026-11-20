/**
 * Écran d'accueil : carrousel de présentation (défile seul, se fait glisser au doigt), avec les boutons
 * « Se connecter » et « Créer un compte » toujours visibles en bas. Affiché tant que l'appareil n'a jamais
 * servi à se connecter (appStore 'welcome_seen') ; ensuite l'app ouvre directement la connexion, qui garde
 * un lien vers cette présentation.
 */
import { appStore } from '../../core/storage.js';

/** Délai entre deux diapositives quand le carrousel défile seul. */
export const AUTO_MS = 4500;
/** Pause du défilement automatique après un geste de l'utilisateur. */
export const PAUSE_MS = 9000;

const LOGO = `<svg class="welcome-logo" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#38D1F0"/>
  <path d="M7 26 q6.5 -5 13 0 t13 0" stroke="#071327" stroke-width="3.2" fill="none" stroke-linecap="round"/><circle cx="20" cy="14.5" r="4.3" fill="#071327"/></svg>`;

/** Diapositives : vraies captures de l'app (public/welcome, données fictives, régénérées par tests/e2e/zz-welcome-shots.spec.js). */
export const SLIDES = [
  { shot: 'calendrier', alt: 'Écran Calendrier : le mois de novembre et la séance du jour', title: 'Ton groupe dans la poche', text: 'Séances, kilomètres et planification de la saison, même sans réseau au bord du bassin.' },
  { shot: 'appel', alt: 'Appel d’une séance : 9 présents sur 12, cochés un par un', title: "L'appel en un geste", text: 'Coche les présents, suis l’assiduité de chaque nageur dans les statistiques.' },
  { shot: 'perfs', alt: 'Perfs d’une nageuse : meilleurs temps et temps de passage d’un 200 nage libre', title: 'Suis la progression', text: 'Résultats liveFFN, temps de passage et bilans PDF en un clic.' },
  { shot: 'groupe', alt: 'Réglages, Mon groupe : deux entraîneurs membres et une invitation en attente', title: 'À plusieurs entraîneurs', text: 'Partage ton groupe avec tes collègues : tout le monde voit les mêmes informations.' },
];

/** Marque l'appareil comme déjà utilisé : la prochaine fois, la connexion s'ouvre directement. */
export function markWelcomeSeen() {
  appStore.set('welcome_seen', true);
}

/** @returns {boolean} true si cet appareil a déjà servi à se connecter */
export function welcomeSeen() {
  return appStore.get('welcome_seen') === true;
}

/**
 * @param {HTMLElement} root
 * @param {{login: () => void, signup: () => void}} h
 */
export function renderWelcome(root, h) {
  root.innerHTML = `<main class="welcome" data-screen="welcome">
    <header class="welcome-brand">${LOGO}<div><div class="welcome-name">SwimCoach <span>App</span></div>
      <div class="welcome-tag">Le carnet de l'entraîneur de natation</div></div></header>
    <section class="welcome-carousel" aria-roledescription="carrousel" aria-label="Présentation de l'application">
      <div class="welcome-track" data-track tabindex="0">
        ${SLIDES.map((s, i) => `<article class="welcome-slide" aria-roledescription="diapositive" aria-label="${i + 1} sur ${SLIDES.length}">
          <div class="welcome-shot"><img src="./welcome/${s.shot}.webp" alt="${s.alt}" width="540" height="1169" decoding="async"${i === 0 ? '' : ' loading="lazy"'}></div>
          <h2 class="welcome-title">${s.title}</h2>
          <p class="welcome-text">${s.text}</p>
        </article>`).join('')}
      </div>
      <div class="welcome-dots">${SLIDES.map((s, i) => `<button type="button" class="welcome-dot" data-dot="${i}" aria-label="Diapositive ${i + 1} : ${s.title}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('')}</div>
    </section>
    <footer class="welcome-actions">
      <button type="button" class="welcome-btn welcome-btn-primary" data-action="login">Se connecter</button>
      <button type="button" class="welcome-btn welcome-btn-ghost" data-action="signup">Créer un compte</button>
      <a class="welcome-privacy" href="./privacy.html">Confidentialité</a>
    </footer>
  </main>`;
  const main = root.firstElementChild;
  const track = main.querySelector('[data-track]');
  const dots = [...main.querySelectorAll('[data-dot]')];
  let index = 0;
  let pausedUntil = 0;

  const go = (i, smooth = true) => {
    index = (i + SLIDES.length) % SLIDES.length;
    track.scrollTo({ left: index * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  };
  const pause = () => { pausedUntil = Date.now() + PAUSE_MS; };

  track.addEventListener('scroll', () => {
    const w = track.clientWidth || 1;
    index = Math.round(track.scrollLeft / w);
    dots.forEach((d, i) => (i === index ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
  }, { passive: true });
  for (const ev of ['pointerdown', 'touchstart', 'wheel', 'keydown']) track.addEventListener(ev, pause, { passive: true });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
  });

  main.addEventListener('click', (event) => {
    const el = event.target.closest('[data-dot], [data-action]');
    if (!el) return;
    if (el.dataset.dot != null) {
      pause();
      go(Number(el.dataset.dot));
    } else if (el.dataset.action === 'login') h.login();
    else if (el.dataset.action === 'signup') h.signup();
  });

  // Défilement automatique : arrêté dès que l'écran est remplacé, en pause après un geste,
  // absent si l'utilisateur a demandé moins d'animations.
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    const timer = setInterval(() => {
      if (!main.isConnected) return clearInterval(timer);
      if (document.hidden || Date.now() < pausedUntil) return;
      go(index + 1);
    }, AUTO_MS);
  }
}
