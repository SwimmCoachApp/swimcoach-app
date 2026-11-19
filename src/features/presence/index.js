/**
 * Appel d'une séance : monté dans `#session-presence-slot` de la feuille séance (calendrier), pour tous
 * les types de séance (la compétition utilise la même fenêtre, comme club4).
 *
 * La liste se met à jour à chaque changement du store (coches des autres entraîneurs à la relecture),
 * sans être redessinée tant que les nageurs ne changent pas (les photos ne clignotent pas).
 */
import { on } from '../../app/actions.js';
import { db, subscribe } from '../../core/store.js';
import { photoUrl } from '../../core/photos.js';
import { onSessionFormOpen, onSessionSaved } from '../calendar/index.js';
import { groupName } from '../contacts/logic.js';
import { rollCallList, presenceGauge, isPresent, togglePresence, setAllPresence, startDraft, commitDraft, discardDrafts } from './logic.js';
import { rollCallHtml, presenceListHtml } from './view.js';

/** @type {{slot: HTMLElement|null, sessionId: string|null, date: string|null, roster: string, unsubs: Array<() => void>}} */
const ui = { slot: null, sessionId: null, date: null, roster: '', unsubs: [] };

function stop() {
  for (const off of ui.unsubs) off();
  Object.assign(ui, { slot: null, sessionId: null, date: null, roster: '', unsubs: [] });
}

const find = (sel) => ui.slot?.querySelector(sel) ?? null;

function hydratePhotos(scope) {
  for (const img of scope.querySelectorAll('img[data-photo]')) {
    img.addEventListener('load', () => { img.hidden = false; }, { once: true });
    photoUrl(img.dataset.photo).then((url) => { if (img.isConnected) img.src = url; }).catch(() => { /* hors ligne : initiales */ });
  }
}

/** Ce qui change l'affichage d'une ligne en dehors de la coche. */
const rosterOf = (list) => JSON.stringify(list.map((sw) => [sw.id, sw.firstname, sw.lastname, sw.photo_path, sw.left_season, groupName(sw)]));

function refresh() {
  const { slot, sessionId } = ui;
  if (!slot || !sessionId) return;
  const list = rollCallList(db.sessions.get(sessionId) ?? { id: sessionId, date: ui.date });
  const roster = rosterOf(list);
  const box = find('#presence-list');
  if (roster !== ui.roster) {
    ui.roster = roster;
    box.innerHTML = presenceListHtml(list, (id) => isPresent(sessionId, id));
    hydratePhotos(box);
  } else {
    for (const row of box.querySelectorAll('.presence-row')) {
      const checked = isPresent(sessionId, row.dataset.id);
      if (row.classList.contains('checked') === checked) continue;
      row.classList.toggle('checked', checked);
      row.setAttribute('aria-checked', String(checked));
      row.querySelector('.p-check').textContent = checked ? '✓' : '';
    }
  }
  const { present, total } = presenceGauge(sessionId);
  find('#pm-num').textContent = String(present);
  find('#pm-tot').textContent = String(total);
  find('#pm-fill').style.width = `${total ? Math.round((present / total) * 100) : 0}%`;
  const bar = find('.pm-bar');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(present));
}

function onStore() {
  if (!ui.slot?.isConnected) {
    stop(); // la feuille a disparu (autre écran) : on se désabonne
    return;
  }
  refresh();
}

/**
 * Monte l'appel dans la feuille séance qui s'ouvre.
 * @param {HTMLElement|null} slot
 * @param {{id: string, date: string, isNew: boolean}} info
 */
function mount(slot, { id, date, isNew }) {
  stop();
  discardDrafts(); // une feuille fermée sans enregistrer : ses coches sont oubliées
  if (!slot) return;
  if (isNew) startDraft(id, date);
  Object.assign(ui, { slot, sessionId: id, date });
  slot.innerHTML = rollCallHtml();
  refresh();
  ui.unsubs = ['presence', 'swimmers', 'groups', 'sessions'].map((t) => subscribe(t, onStore));
}

on('toggle-presence', (row) => {
  const { sessionId } = ui;
  if (!sessionId) return;
  togglePresence(sessionId, row.dataset.id, !isPresent(sessionId, row.dataset.id));
  refresh(); // un brouillon ne passe pas par le store
});
on('presence-all', () => {
  if (!ui.sessionId) return;
  setAllPresence(ui.sessionId, true);
  refresh();
});
on('presence-none', () => {
  if (!ui.sessionId) return;
  setAllPresence(ui.sessionId, false);
  refresh();
});

/** Branche l'appel sur la feuille séance du calendrier. */
export function registerPresence() {
  onSessionFormOpen(mount);
  onSessionSaved(({ session, isNew }) => {
    if (isNew) commitDraft(session.id); // après la ligne de la séance dans la file
  });
}
