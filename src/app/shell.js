/**
 * Coque de l'application : barre du haut (nageur blanc sur bleu, nom de l'espace), écrans, navigation
 * du bas et feuilles modales (design Club).
 */
import { html, raw } from '../core/html.js';
import { suspendTeam } from '../core/sync.js';
import { listMyTeams, setCurrentTeam } from '../core/teams.js';
import { leaveSession } from '../features/auth/index.js';
import { on } from './actions.js';
import { SCENE_SVG } from './scene.js';
import { applyTheme, currentTheme } from './theme.js';

/** @type {Map<string, {title: string, render: (root: HTMLElement) => void, icon?: string}>} */
const screens = new Map();
const ORDER = ['calendar', 'contacts', 'stats', 'perfs', 'planning'];
const LABELS = { calendar: 'Calendrier', contacts: 'Nageurs', stats: 'Stats', perfs: 'Perfs', planning: 'Planif.' };
const GEAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';

let ctx = null; // { root, coach, team, leave, current }

/**
 * @param {string} name
 * @param {{title: string, render: (root: HTMLElement) => void, icon?: string}} def
 *   icon : SVG de la navigation du bas ; render remplit l'élément racine de l'écran
 */
export function registerScreen(name, def) {
  screens.set(name, def);
}

/** Nom de l'espace ouvert (pour les écrans). */
export function currentTeamName() {
  return ctx?.team.name ?? '';
}

/** @returns {{id: string, name: string}|null} espace ouvert (ou en cours d'ouverture) */
export function currentTeam() {
  return ctx ? { ...ctx.team } : null;
}

/**
 * Un espace a été renommé (ici ou sur un autre appareil) : met à jour la coque s'il est l'espace ouvert.
 * @param {string} id
 * @param {string} name
 */
export function setCurrentTeamName(id, name) {
  if (!ctx || ctx.team.id !== id || ctx.team.name === name) return;
  ctx.team = { ...ctx.team, name };
  ctx.teams = null;
  const el = ctx.root.querySelector('[data-team-name]');
  if (el) el.textContent = name;
}

/** Balisage de l'attente d'un espace, avec la déconnexion toujours possible (liste des espaces bloquée). */
export const LOADING_HTML = '<div class="screen loading-screen" data-loading role="status"><p>Chargement du groupe…</p><button type="button" class="btn-link" data-action="logout">Se déconnecter</button></div>';

/**
 * Écran d'attente du démarrage (avant la coque) : la liste des espaces peut ne jamais répondre,
 * la déconnexion reste possible.
 * @param {HTMLElement} root
 * @param {() => void} leave appelé après la déconnexion
 */
export function showBootLoading(root, leave) {
  ctx = null;
  bootLeave = leave;
  root.innerHTML = `<main class="auth boot-loading">${LOADING_HTML}</main>`;
}
let bootLeave = null;

/** @param {string} id identifiant d'une feuille `.modal-overlay` */
export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  void el.offsetHeight; // force le rendu (iOS PWA)
}

/** @param {string} id */
export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  requestAnimationFrame(() => requestAnimationFrame(() => void el.offsetHeight));
}

/** Écran à rouvrir après un changement d'espace (switchTeam), consommé par le prochain startApp. */
let resumeScreen = null;

/**
 * Affiche un écran enregistré.
 *
 * RÈGLE pour les écrans de données : ils ne s'affichent qu'à partir du store (core/store.js) et
 * seulement une fois l'ouverture de l'espace terminée (openTeam a chargé le cache de cet espace).
 * Pendant un changement d'espace, la coque n'affiche que « Chargement de l'espace… » : le store de
 * l'ancien espace est déjà vidé (suspendTeam) et aucun écran n'est rendu avant startApp.
 * @param {string} name
 */
export function showScreen(name) {
  const def = screens.get(name);
  if (!ctx || !def || ctx.loading) return; // pendant le chargement d'un espace, aucun écran de données
  ctx.current = name;
  const shell = ctx.root.querySelector('.shell');
  shell.dataset.active = name;
  const view = shell.querySelector('#views');
  const section = document.createElement('section');
  section.className = 'view active';
  section.dataset.screen = name;
  def.render(section);
  view.replaceChildren(section);
  for (const item of shell.querySelectorAll('.nav-item')) item.classList.toggle('active', item.dataset.key === name);
}

function navItem(name) {
  const def = screens.get(name);
  return html`<button type="button" class="nav-item" data-action="nav" data-key="${name}">
    <span class="nav-icon">${raw(def.icon || '')}</span><span class="nav-label">${LABELS[name] || def.title}</span>
  </button>`;
}

function sheet(id, title, body) {
  return html`<div class="modal-overlay" id="${id}" data-action="close-backdrop">
    <div class="modal-sheet" role="dialog" aria-label="${title}">
      <div class="modal-handle"></div>
      <div class="modal-header"><div class="modal-title">${title}</div><button type="button" class="modal-close" data-action="close-modal" data-id="${id}" aria-label="Fermer">✕</button></div>
      ${raw(body)}
    </div>
  </div>`;
}

function teamListHtml(teams, currentId) {
  const items = teams.map((t) => html`<button type="button" class="team-item${t.id === currentId ? ' current' : ''}" data-action="switch-team" data-id="${t.id}"><span>${t.name}</span>${t.id === currentId ? raw('<span aria-hidden="true">✓</span>') : ''}</button>`);
  return `<div class="team-list">${items.join('')}</div>`;
}

/**
 * Démarre la coque pour l'entraîneur et l'espace ouverts.
 * @param {HTMLElement} root
 * @param {{id: string, email: string}} coach
 * @param {{id: string, name: string}} team
 * @param {() => void} leave appelé après la déconnexion ou un changement d'espace (reprend le routage)
 */
export function startApp(root, coach, team, leave) {
  const first = resumeScreen && screens.has(resumeScreen) ? resumeScreen : 'calendar';
  resumeScreen = null;
  ctx = { root, coach, team, leave, current: first, loading: false, teams: null }; // loading : changement d'espace en cours
  const nav = ORDER.filter((n) => screens.has(n));
  root.innerHTML = html`<div class="shell" data-active="${first}">
    <header class="top-bar">
      <div class="top-bar-brand"><div class="top-bar-text"><div class="top-bar-title">SwimCoach <span>App</span></div></div></div>
      <div class="top-bar-actions">
        <button type="button" class="top-bar-team" data-action="open-teams" aria-label="Changer de groupe"><span data-team-name>${team.name}</span><span aria-hidden="true">▾</span></button>
        <button type="button" class="icon-btn" data-action="toggle-theme" aria-label="Changer de thème">${currentTheme() === 'dark' ? '🌙' : '☀️'}</button>
        <button type="button" class="icon-btn" data-action="nav" data-key="settings" aria-label="Réglages">${raw(GEAR)}</button>
      </div>
      ${raw(SCENE_SVG)}
    </header>
    <div id="views"></div>
    <nav class="bottom-nav" aria-label="Navigation">${raw(nav.map(navItem).join(""))}</nav>
    ${raw(sheet('modal-teams', 'Mes groupes', '<div id="teams-body"></div>'))}
  </div>`;
  showScreen(first);
}

let navToken = 0;
// L'onglet touché s'allume tout de suite ; l'écran est dessiné à l'image suivante, pour que le doigt
// voie une réponse immédiate même si l'écran met un peu de temps à se construire. Dernier toucher gagnant.
on('nav', (el) => {
  const key = el.dataset.key;
  if (!ctx || ctx.loading || !screens.has(key) || key === ctx.current) return;
  const token = ++navToken;
  for (const item of ctx.root.querySelectorAll('.nav-item')) item.classList.toggle('active', item.dataset.key === key);
  requestAnimationFrame(() => setTimeout(() => { if (token === navToken) showScreen(key); }, 0));
});
on('close-modal', (el) => closeModal(el.dataset.id));
on('close-backdrop', (el, ev) => { if (ev.target === el) closeModal(el.id); });
on('toggle-theme', (el) => {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  el.textContent = currentTheme() === 'dark' ? '🌙' : '☀️';
});
on('logout', () => {
  resumeScreen = null;
  if (ctx) leaveSession(ctx.leave);
  else if (bootLeave) leaveSession(bootLeave);
});
on('open-teams', async () => {
  if (!ctx) return;
  const body = document.getElementById('teams-body');
  const show = (teams) => { ctx.teams = teams; body.innerHTML = teamListHtml(teams, ctx.team.id); };
  show(ctx.teams ?? [ctx.team]);
  openModal('modal-teams');
  try { show(await listMyTeams()); } catch { /* hors ligne : on garde l'espace ouvert */ }
});
/**
 * Passe sur un autre espace : la coque n'affiche que « Chargement de l'espace… » (avec la déconnexion)
 * jusqu'au prochain startApp ; le store de l'ancien espace est vidé tout de suite.
 * @param {string} id
 * @param {string} name
 */
export function switchTeam(id, name) {
  if (!ctx || id === ctx.team.id) return;
  ctx.loading = true; // la navigation est bloquée jusqu'au prochain startApp
  resumeScreen = ctx.current; // le prochain startApp rouvre le même écran dans le nouvel espace
  ctx.team = { id, name }; // cible en cours : coche de la liste et en-tête restent cohérents
  suspendTeam(); // coupe le temps réel et vide le store de l'ancien espace tout de suite
  setCurrentTeam(id);
  const shell = ctx.root.querySelector('.shell');
  shell.querySelector('[data-team-name]').textContent = name;
  shell.querySelector('#views').innerHTML = LOADING_HTML;
  ctx.leave(); // reprend le routage : charge l'espace choisi puis redessine la coque
}

/** L'espace ouvert a déjà été fermé et oublié (quitté ou supprimé) : attente, puis reprise du routage. */
export function leaveClosedTeam() {
  if (!ctx) return;
  resumeScreen = null; // espace perdu : retour au calendrier
  ctx.loading = true;
  ctx.teams = null;
  ctx.root.querySelector('#views').innerHTML = LOADING_HTML;
  ctx.leave();
}

on('switch-team', (el) => {
  closeModal('modal-teams');
  if (!ctx || el.dataset.id === ctx.team.id) return;
  switchTeam(el.dataset.id, el.querySelector('span')?.textContent ?? '');
});
