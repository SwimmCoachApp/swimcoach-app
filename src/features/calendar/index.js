/**
 * Écran Calendrier : mois, panneau du jour, feuille de lecture et feuille de modification d'une séance.
 *
 * Présence (tâche 13) : la feuille de modification contient `#session-presence-slot`. Pour y monter l'appel,
 * enregistrer `onSessionFormOpen((slot, {id, date, isNew}) => …)` (appelé à chaque ouverture du formulaire,
 * `id` est déjà celui que la séance aura, même pour une nouvelle) et `onSessionSaved(({session, isNew}) => …)`.
 */
import { on } from '../../app/actions.js';
import { registerScreen, openModal, closeModal } from '../../app/shell.js';
import { toast } from '../../app/toast.js';
import { db, subscribe, onReset } from '../../core/store.js';
import { todayKey } from '../../core/dates.js';
import { photoUrl, resizeImage } from '../../core/photos.js';
import { sessionsByDay, planMarksForMonth, planEventsOn, sessionsOn, saveSessionWithStatus, deleteSession, dayTitle, SESSION_TYPES } from './logic.js';
import { screenHtml, monthLabelHtml, gridHtml, dayPanelHtml, noDayHtml, sessionViewHtml, sessionFormHtml, deleteSessionDialogHtml } from './view.js';

const REOPEN_MS = 350; // iOS PWA : laisser la feuille précédente se fermer
const NO_PHOTO = 'La photo nécessite une connexion';
const PHOTO_SIDE = 1600; // une feuille de papier ou un tableau doit rester lisible

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

/** Mois affiché et jour choisi : gardés d'un affichage à l'autre, remis à zéro à la fermeture de l'espace. */
let nav = null;
onReset(() => { nav = null; });

const ui = {
  root: null,
  unsubs: [],
  /** @type {{id: string, isNew: boolean, date: string, type: string, photo: Blob|null, removePhoto: boolean, existingPath: string|null, previewUrl: string|null, saving: boolean, picking?: Promise<Blob>}|null} */
  form: null,
};
const openHooks = new Set();
const savedHooks = new Set();

/**
 * @param {(slot: HTMLElement, info: {id: string, date: string, isNew: boolean}) => void} cb appelé à chaque ouverture du formulaire
 * @returns {() => void} désabonnement
 */
export function onSessionFormOpen(cb) {
  openHooks.add(cb);
  return () => openHooks.delete(cb);
}

/**
 * @param {(info: {session: object, isNew: boolean}) => void} cb appelé après l'enregistrement d'une séance
 * @returns {() => void} désabonnement
 */
export function onSessionSaved(cb) {
  savedHooks.add(cb);
  return () => savedHooks.delete(cb);
}

const el = (id) => ui.root?.querySelector(`#${id}`) ?? null;
const alive = () => !!ui.root;

function state() {
  if (!nav) {
    const t = todayKey();
    nav = { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) - 1, selected: null };
  }
  return nav;
}

/** Charge les photos : l'URL signée arrive en différé, l'image reste cachée en attendant. */
function hydratePhotos(scope) {
  for (const img of scope.querySelectorAll('img[data-photo]')) {
    img.addEventListener('load', () => { img.hidden = false; }, { once: true });
    photoUrl(img.dataset.photo).then((url) => { if (img.isConnected) img.src = url; }).catch(() => { /* hors ligne : photo non affichée */ });
  }
}

function refreshGrid() {
  const { year, month, selected } = state();
  el('cal-month-label').innerHTML = monthLabelHtml(year, month);
  el('cal-grid').innerHTML = gridHtml(year, month, { selected, today: todayKey(), marks: planMarksForMonth(year, month), byDay: sessionsByDay(year, month) });
}

function refreshPanel() {
  const { selected } = state();
  el('day-panel-title').textContent = selected ? dayTitle(selected) : 'Sélectionne un jour';
  el('sessions-list').innerHTML = selected ? dayPanelHtml(planEventsOn(selected), sessionsOn(selected)) : noDayHtml();
}

function refresh() {
  if (!alive()) return;
  refreshGrid();
  refreshPanel();
}

function render(root) {
  for (const off of ui.unsubs) off();
  ui.root = root;
  closeFormState();
  root.innerHTML = screenHtml();
  refresh();
  const onStore = () => {
    if (ui.root !== root) return;
    if (!root.isConnected) { // l'écran a été remplacé : on se désabonne
      for (const off of ui.unsubs) off();
      return;
    }
    refresh();
  };
  ui.unsubs = ['sessions', 'plan_events', 'presence'].map((t) => subscribe(t, onStore));
}

// ── Navigation dans le calendrier ──
function shiftMonth(delta) {
  const s = state();
  const d = new Date(s.year, s.month + delta, 1);
  s.year = d.getFullYear();
  s.month = d.getMonth();
  refreshGrid();
}
on('cal-prev', () => shiftMonth(-1));
on('cal-next', () => shiftMonth(1));
on('cal-today', () => {
  const key = todayKey();
  const s = state();
  s.year = Number(key.slice(0, 4));
  s.month = Number(key.slice(5, 7)) - 1;
  s.selected = key;
  refresh();
});
on('select-day', (cell) => {
  state().selected = cell.dataset.key;
  refresh();
});

// ── Lecture d'une séance ──
function openView(id) {
  const s = db.sessions.get(id);
  const sheet = el('session-view-sheet');
  if (!s || !sheet) return;
  sheet.innerHTML = sessionViewHtml(s);
  hydratePhotos(sheet);
  openModal('modal-session-view');
}
on('open-session', (card) => openView(card.dataset.id));
on('open-photo', (img) => {
  if (!img.src) return;
  const shown = document.createElement('img');
  shown.id = 'photo-fullscreen-img';
  shown.alt = 'Photo de la séance';
  shown.src = img.src;
  el('photo-fullscreen').querySelector('img')?.remove();
  el('photo-fullscreen').append(shown);
  el('photo-fullscreen').classList.add('open');
});
on('close-photo', () => {
  el('photo-fullscreen').classList.remove('open');
  setTimeout(() => { if (!el('photo-fullscreen')?.classList.contains('open')) el('photo-fullscreen')?.querySelector('img')?.remove(); }, 200);
});

// ── Formulaire ──
function closeFormState() {
  if (ui.form?.previewUrl) URL.revokeObjectURL(ui.form.previewUrl);
  ui.form = null;
}

function setPhotoUI(url) {
  const img = el('sess-photo-img');
  if (!img) return;
  if (url) img.src = url;
  else img.removeAttribute('src');
  el('sess-photo-empty').hidden = !!url;
  el('sess-photo-preview').hidden = !url;
  el('sess-photo-zone').classList.toggle('has-photo', !!url);
}

function openForm(id, date) {
  const s = id ? db.sessions.get(id) : null;
  if (id && !s) return;
  closeFormState();
  const type = s?.type ?? 'nat';
  ui.form = { id: s?.id ?? crypto.randomUUID(), isNew: !s, date: s?.date ?? date, type, photo: null, removePhoto: false, existingPath: s?.photo_path ?? null, previewUrl: null, saving: false };
  const form = ui.form;
  el('session-sheet').innerHTML = sessionFormHtml(s, { type });
  const toolbar = el('editor-toolbar');
  toolbar.addEventListener('mousedown', (e) => e.preventDefault()); // garde la sélection du texte dans l'éditeur
  el('editor-content').addEventListener('paste', (e) => { // collage en texte brut : pas de mise en forme venue d'ailleurs
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  });
  if (s?.photo_path) {
    photoUrl(s.photo_path).then((url) => { if (ui.form === form && !form.photo && !form.removePhoto) setPhotoUI(url); }).catch(() => { /* hors ligne */ });
  }
  const info = { id: form.id, date: form.date, isNew: form.isNew };
  for (const cb of [...openHooks]) cb(el('session-presence-slot'), info);
  openModal('modal-session');
}

on('add-session', () => {
  const { selected } = state();
  if (!selected) {
    toast("Sélectionne un jour d'abord");
    return;
  }
  openForm(null, selected);
});
on('edit-session', (btn) => {
  closeModal('modal-session-view');
  setTimeout(() => { if (alive()) openForm(btn.dataset.id); }, REOPEN_MS);
});
on('pick-type', (btn) => {
  const form = ui.form;
  if (!form || !SESSION_TYPES.includes(btn.dataset.key)) return;
  form.type = btn.dataset.key;
  for (const pill of ui.root.querySelectorAll('#session-sheet .type-pill')) {
    const active = pill.dataset.key === form.type;
    pill.className = `type-pill${active ? ` selected-${pill.dataset.key}` : ''}`;
    pill.setAttribute('aria-pressed', String(active));
  }
  // Le km n'a de sens qu'en eau : masqué et vidé pour la muscu (club4)
  el('sess-km-row').hidden = form.type === 'musc';
  if (form.type === 'musc') el('sess-km').value = '';
});
on('fmt', (btn) => {
  el('editor-content').focus();
  document.execCommand(btn.dataset.cmd, false, null);
});

on('photo-camera', () => el('sess-photo-input-cam')?.click());
on('photo-gallery', () => el('sess-photo-input-file')?.click());
on('pick-session-photo', async (input) => {
  const file = input.files?.[0];
  input.value = '';
  const form = ui.form;
  if (!file || !form) return;
  form.picking = resizeImage(file, PHOTO_SIDE);
  try {
    const blob = await form.picking;
    if (ui.form !== form) return;
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    form.photo = blob;
    form.removePhoto = false;
    form.previewUrl = URL.createObjectURL(blob);
    setPhotoUI(form.previewUrl);
  } catch {
    toast('Image illisible');
  }
}, 'change');
on('photo-remove', () => {
  const form = ui.form;
  if (!form) return;
  form.photo = null;
  form.removePhoto = !!form.existingPath;
  setPhotoUI(null);
});

async function submitForm() {
  const form = ui.form;
  if (!form || form.saving) return;
  form.saving = true;
  await form.picking?.catch(() => {}); // une photo en cours de réduction est attendue
  const online = navigator.onLine;
  const wantsPhotoChange = !!form.photo || form.removePhoto;
  try {
    const { session, photoFailed } = await saveSessionWithStatus({
      id: form.id,
      date: form.date,
      title: el('sess-title').value,
      type: form.type,
      time: el('sess-time').value,
      content: el('editor-content').innerHTML,
      km: el('sess-km').value,
      photoBlob: online ? form.photo : null,
      removePhoto: online && form.removePhoto,
    });
    toast(photoFailed || (wantsPhotoChange && !online) ? NO_PHOTO : 'Séance enregistrée');
    if (ui.form === form) {
      closeModal('modal-session');
      closeFormState();
    }
    for (const cb of [...savedHooks]) cb({ session, isNew: form.isNew });
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Enregistrement impossible');
  } finally {
    form.saving = false;
  }
}
on('save-session', submitForm);

// ── Suppression ──
on('ask-delete-session', (btn) => {
  const s = db.sessions.get(btn.dataset.id);
  if (!s) return;
  el('dialog-session-box').innerHTML = deleteSessionDialogHtml(s);
  openModal('dialog-session');
});
on('do-delete-session', async (btn) => {
  closeModal('dialog-session');
  try {
    await deleteSession(btn.dataset.id);
    closeModal('modal-session');
    closeFormState();
    toast('Séance supprimée');
  } catch (e) {
    toast(e?.photo && e.network ? 'La suppression de la photo nécessite une connexion' : 'Suppression impossible');
  }
});

/** Enregistre l'écran Calendrier (remplace l'écran provisoire). */
export function registerCalendarScreen() {
  registerScreen('calendar', { title: 'Calendrier', icon: ICON, render });
}
