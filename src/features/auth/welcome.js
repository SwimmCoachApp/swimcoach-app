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

const ART = {
  seances: `<svg viewBox="0 0 220 150" aria-hidden="true"><rect x="10" y="10" width="200" height="130" rx="18" fill="#0F2044"/>
    <rect x="28" y="28" width="164" height="22" rx="8" fill="#132A55"/><rect x="38" y="35" width="70" height="8" rx="4" fill="#38D1F0"/><rect x="150" y="35" width="32" height="8" rx="4" fill="#FF5A36"/>
    <g fill="#132A55"><rect x="28" y="60" width="38" height="32" rx="8"/><rect x="72" y="60" width="38" height="32" rx="8"/><rect x="116" y="60" width="38" height="32" rx="8"/><rect x="160" y="60" width="32" height="32" rx="8"/>
    <rect x="28" y="98" width="38" height="28" rx="8"/><rect x="72" y="98" width="38" height="28" rx="8"/><rect x="116" y="98" width="38" height="28" rx="8"/><rect x="160" y="98" width="32" height="28" rx="8"/></g>
    <circle cx="47" cy="76" r="5" fill="#38D1F0"/><circle cx="135" cy="76" r="5" fill="#38D1F0"/><circle cx="91" cy="112" r="5" fill="#FF5A36"/><circle cx="176" cy="112" r="5" fill="#4ADE80"/></svg>`,
  presences: `<svg viewBox="0 0 220 150" aria-hidden="true"><rect x="10" y="10" width="200" height="130" rx="18" fill="#0F2044"/>
    ${[0, 1, 2, 3].map((i) => `<g transform="translate(28 ${26 + i * 28})"><rect width="164" height="22" rx="8" fill="#132A55"/>
      <circle cx="13" cy="11" r="7" fill="${i === 2 ? '#1E3560' : '#4ADE80'}"/>${i === 2 ? '' : '<path d="M9.5 11 l2.5 2.5 l4.5 -5" stroke="#071327" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'}
      <rect x="28" y="7" width="${[78, 60, 70, 52][i]}" height="8" rx="4" fill="#A9B8D4" opacity=".55"/></g>`).join('')}</svg>`,
  perfs: `<svg viewBox="0 0 220 150" aria-hidden="true"><rect x="10" y="10" width="200" height="130" rx="18" fill="#0F2044"/>
    <g stroke="#1E3560" stroke-width="1"><line x1="28" y1="48" x2="192" y2="48"/><line x1="28" y1="78" x2="192" y2="78"/><line x1="28" y1="108" x2="192" y2="108"/></g>
    <path d="M30 112 L68 96 L102 100 L140 66 L188 38" stroke="#FF5A36" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <g fill="#FF5A36"><circle cx="68" cy="96" r="5"/><circle cx="140" cy="66" r="5"/><circle cx="188" cy="38" r="6"/></g>
    <rect x="28" y="120" width="54" height="10" rx="5" fill="#38D1F0" opacity=".7"/><rect x="90" y="120" width="40" height="10" rx="5" fill="#38D1F0" opacity=".4"/></svg>`,
  equipe: `<svg viewBox="0 0 220 150" aria-hidden="true"><rect x="10" y="10" width="200" height="130" rx="18" fill="#0F2044"/>
    <circle cx="80" cy="62" r="20" fill="#38D1F0"/><circle cx="140" cy="62" r="20" fill="#FF5A36"/><circle cx="110" cy="52" r="22" fill="#4ADE80"/>
    <g fill="#071327"><circle cx="80" cy="58" r="7"/><circle cx="140" cy="58" r="7"/><circle cx="110" cy="47" r="8"/></g>
    <path d="M30 116 q20 -12 40 0 t40 0 t40 0 t40 0" stroke="#38D1F0" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/></svg>`,
};

export const SLIDES = [
  { art: 'seances', title: 'Ton groupe dans la poche', text: 'Séances, kilomètres et planification de la saison, même sans réseau au bord du bassin.' },
  { art: 'presences', title: "L'appel en un geste", text: 'Coche les présents, suis l’assiduité de chaque nageur dans les statistiques.' },
  { art: 'perfs', title: 'Suis la progression', text: 'Résultats liveFFN, temps de passage et bilans PDF en un clic.' },
  { art: 'equipe', title: 'À plusieurs entraîneurs', text: 'Partage ton groupe avec tes collègues : tout le monde voit les mêmes informations.' },
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
          <div class="welcome-art">${ART[s.art]}</div>
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
