/** Écran Nageurs : carnet d'adresses (liste, fiche, formulaire), groupes, archivage, photos. */
import { on } from '../../app/actions.js';
import { registerScreen, openModal, closeModal } from '../../app/shell.js';
import { toast } from '../../app/toast.js';
import { db, subscribe } from '../../core/store.js';
import { currentSeason } from '../../core/season.js';
import { photoUrl, resizeImage } from '../../core/photos.js';
import {
  listSwimmers, listGroups, countSwimmers, saveSwimmer, archiveSwimmer, restoreSwimmer, deleteSwimmer, addGroup, deleteGroup, mailGroups, groupMail,
} from './logic.js';
import { currentTeamName } from '../../app/shell.js';
import { parseImportFile, planImport, runImport, loadExcelReader, downloadTemplate, groupsToCreate } from './import.js';
import { screenHtml, importChooseHtml, importPreviewHtml, listHtml, mailOptionsHtml, ficheHtml, formHtml, groupBlockHtml, deleteDialogHtml, archiveDialogHtml } from './view.js';
import { FEATURES } from '../../core/features.js';

const SEARCH_DELAY_MS = 150;
const REOPEN_FICHE_MS = 350; // iOS PWA : laisser la feuille précédente se fermer
const NO_PHOTO = 'La photo nécessite une connexion';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.5 0 4 1.8 4 4.5"/></svg>';

/** État de l'écran (le store garde les données, ici seulement l'affichage et le formulaire en cours). */
const ui = {
  root: null,
  filter: 'actifs',
  search: '',
  timer: null,
  unsubs: [],
  /** @type {{id: string|null, photo: Blob|null, removePhoto: boolean, previewUrl: string|null, saving: boolean}|null} */
  form: null,
};

const el = (id) => ui.root?.querySelector(`#${id}`) ?? null;
/** Écran affiché (la section n'est rattachée au document qu'après render : on ne teste pas isConnected ici). */
const alive = () => !!ui.root;

/** Charge les photos des pastilles : l'URL signée arrive en différé, les initiales restent en attendant. */
function hydratePhotos(scope) {
  for (const img of scope.querySelectorAll('img[data-photo]')) {
    const path = img.dataset.photo;
    img.addEventListener('load', () => { img.hidden = false; }, { once: true });
    photoUrl(path).then((url) => { if (img.isConnected) img.src = url; }).catch(() => { /* hors ligne : initiales */ });
  }
}

function refreshList() {
  if (!alive()) return;
  const swimmers = listSwimmers({ search: ui.search, filter: ui.filter });
  const list = el('contacts-list');
  list.innerHTML = listHtml(swimmers, { filter: ui.filter, search: ui.search.trim() });
  hydratePhotos(list);
  const counts = countSwimmers();
  for (const key of ['actifs', 'archives']) ui.root.querySelector(`[data-count="${key}"]`).textContent = `(${counts[key]})`;
  refreshMail();
  for (const btn of ui.root.querySelectorAll('.contacts-mode-btn')) btn.classList.toggle('active', btn.dataset.key === ui.filter);
}

/** Options du « Mail groupe » et lien prêt à ouvrir le client de messagerie. */
function refreshMail() {
  const select = el('group-mail-select'); // absent quand les groupes sont masqués : mail à tous les actifs
  const link = el('group-mail-link');
  if (!link) return;
  let keep = 'all';
  if (select) {
    const groups = mailGroups();
    keep = groups.some((g) => g.id === select.value) ? select.value : 'all';
    select.innerHTML = mailOptionsHtml(groups, keep);
  }
  const { href } = groupMail(keep, currentTeamName());
  link.setAttribute('href', href || '#');
}

function refreshGroupBlock() {
  const block = el('sw-group-block');
  if (!alive() || !block || !ui.form) return;
  block.innerHTML = groupBlockHtml(listGroups(), el('sw-group')?.value ?? '');
}

function render(root) {
  for (const off of ui.unsubs) off();
  ui.root = root;
  ui.filter = 'actifs';
  ui.search = '';
  ui.form = null;
  clearTimeout(ui.timer);
  root.innerHTML = screenHtml();
  refreshList();
  const refreshAll = () => {
    if (ui.root !== root) return;
    if (!root.isConnected) { // l'écran a été remplacé : on se désabonne
      for (const off of ui.unsubs) off();
      return;
    }
    refreshList();
    refreshGroupBlock();
  };
  ui.unsubs = [subscribe('swimmers', refreshAll), subscribe('groups', refreshAll)];
  initSwipe(el('contacts-list'));
}

// ── Glisser vers la gauche pour faire apparaître « supprimer » ──
function initSwipe(list) {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let moved = false;
  list.addEventListener('touchstart', (e) => {
    for (const w of list.querySelectorAll('.swiped')) if (!w.contains(e.target)) w.classList.remove('swiped');
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = false;
    moved = false;
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!dragging && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) dragging = true;
    if (!dragging) return;
    moved = true;
    e.target.closest('.contact-row-wrap')?.classList.toggle('swiped', dx < 0);
  }, { passive: true });
  list.addEventListener('touchend', (e) => { if (moved) e.preventDefault(); });
}

// ── Fiche ──
function openFiche(id) {
  const sw = db.swimmers.get(id);
  const box = el('contact-popup');
  if (!sw || !box) return;
  box.innerHTML = ficheHtml(sw);
  hydratePhotos(box);
  openModal('modal-contact');
}

// ── Formulaire ──
function setPhotoPreview(url) {
  const holder = el('sw-photo-preview');
  if (!holder) return;
  holder.querySelector('img')?.remove();
  el('sw-photo-placeholder').hidden = !!url;
  el('sw-photo-remove').hidden = !url;
  if (url) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    holder.append(img);
  }
}

function openForm(id) {
  const sw = id ? db.swimmers.get(id) : null;
  if (id && !sw) return;
  if (ui.form?.previewUrl) URL.revokeObjectURL(ui.form.previewUrl);
  ui.form = { id: sw?.id ?? null, photo: null, removePhoto: false, previewUrl: null, saving: false };
  el('swimmer-sheet').innerHTML = formHtml(sw, listGroups());
  if (sw?.photo_path) photoUrl(sw.photo_path).then((url) => { if (ui.form?.id === sw.id && !ui.form.photo && !ui.form.removePhoto) setPhotoPreview(url); }).catch(() => {});
  openModal('modal-swimmer');
}

const valueOf = (id) => el(id)?.value ?? '';

async function submitForm() {
  const form = ui.form;
  if (!form || form.saving) return;
  if (!valueOf('sw-firstname').trim()) {
    toast('Prénom requis');
    return;
  }
  form.saving = true;
  const online = navigator.onLine;
  const wantsPhotoChange = !!form.photo || form.removePhoto;
  try {
    const { id, photoFailed } = await saveSwimmer({
      id: form.id ?? undefined,
      firstname: valueOf('sw-firstname'),
      lastname: valueOf('sw-lastname'),
      dob: valueOf('sw-dob'),
      group_id: FEATURES.groups ? valueOf('sw-group') || null : undefined, // masqués : le nageur garde son groupe
      phone: valueOf('sw-phone'),
      email: valueOf('sw-email'),
      photo: online ? form.photo : null,
      removePhoto: online && form.removePhoto,
    });
    toast(photoFailed || (wantsPhotoChange && !online) ? NO_PHOTO : 'Nageur enregistré');
    const editing = !!form.id;
    if (ui.form === form) closeForm();
    if (editing && alive()) setTimeout(() => { if (alive()) openFiche(id); }, REOPEN_FICHE_MS);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Enregistrement impossible');
  } finally {
    form.saving = false;
  }
}

function closeForm() {
  if (ui.form?.previewUrl) URL.revokeObjectURL(ui.form.previewUrl);
  ui.form = null;
  closeModal('modal-swimmer');
}

// ── Actions ──
on('search', (input) => {
  clearTimeout(ui.timer);
  ui.timer = setTimeout(() => {
    ui.search = input.value;
    refreshList();
  }, SEARCH_DELAY_MS);
}, 'input');
on('mail-group', refreshMail, 'change');
on('group-mail', (link, ev) => {
  const target = el('group-mail-select')?.value ?? 'all';
  const { count } = groupMail(target, currentTeamName());
  if (count === 0) {
    ev.preventDefault();
    toast(target === 'all' ? 'Aucun nageur actif avec un email' : 'Aucun email dans ce groupe');
    return;
  }
  toast(`${count} destinataire${count > 1 ? 's' : ''}`);
});
on('call-choose', (btn) => {
  const box = el('call-choices');
  if (!box) return;
  box.hidden = !box.hidden;
  btn.setAttribute('aria-expanded', String(!box.hidden));
});
on('mode', (btn) => {
  if (btn.dataset.key === ui.filter) return;
  ui.filter = btn.dataset.key;
  refreshList();
});
on('open-contact', (row) => {
  const wrap = row.closest('.contact-row-wrap');
  if (wrap?.classList.contains('swiped')) {
    wrap.classList.remove('swiped');
    return;
  }
  openFiche(row.dataset.id);
});
on('add-swimmer', () => openForm(null));
on('edit-swimmer', (btn) => {
  closeModal('modal-contact');
  setTimeout(() => { if (alive()) openForm(btn.dataset.id); }, REOPEN_FICHE_MS);
});
on('save-swimmer', submitForm);
on('choose-photo', () => el('sw-photo-input')?.click());
on('pick-photo', async (input) => {
  const file = input.files?.[0];
  input.value = '';
  const form = ui.form;
  if (!file || !form) return;
  try {
    const blob = await resizeImage(file);
    if (ui.form !== form) return;
    if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
    form.photo = blob;
    form.removePhoto = false;
    form.previewUrl = URL.createObjectURL(blob);
    setPhotoPreview(form.previewUrl);
  } catch {
    toast('Image illisible');
  }
}, 'change');
on('remove-photo', () => {
  if (!ui.form) return;
  ui.form.photo = null;
  ui.form.removePhoto = true;
  setPhotoPreview(null);
});
on('add-group', () => {
  const input = el('group-add-input');
  const res = addGroup(input.value);
  if (!res.ok) {
    toast(res.error);
    return;
  }
  input.value = '';
  const block = el('sw-group-block');
  block.innerHTML = groupBlockHtml(listGroups(), res.id);
  toast('Groupe ajouté');
});
on('del-group', (btn) => {
  const res = deleteGroup(btn.dataset.id);
  toast(res.ok ? 'Groupe supprimé' : res.error);
});

function openDialog(content) {
  el('dialog-box').innerHTML = content;
  openModal('dialog-contact');
}
on('ask-delete', (btn) => {
  const sw = db.swimmers.get(btn.dataset.id);
  if (!sw) return;
  btn.closest('.contact-row-wrap')?.classList.remove('swiped');
  openDialog(deleteDialogHtml(sw));
});
on('do-delete', async (btn) => {
  const id = btn.dataset.id;
  closeModal('dialog-contact');
  try {
    await deleteSwimmer(id);
    closeModal('modal-swimmer');
    closeModal('modal-contact');
    toast('Nageur supprimé');
  } catch (e) {
    toast(e?.photo && e.network ? 'La suppression de la photo nécessite une connexion' : 'Suppression impossible');
  }
});
on('ask-archive', (btn) => {
  const sw = db.swimmers.get(btn.dataset.id);
  if (!sw) return;
  const curr = currentSeason();
  const seasons = [curr - 1, curr, curr + 1].filter((s) => sw.joined_season == null || s >= sw.joined_season);
  openDialog(archiveDialogHtml(sw, seasons, curr));
});
on('do-archive', (btn) => {
  const sw = db.swimmers.get(btn.dataset.id);
  closeModal('dialog-contact');
  closeModal('modal-contact');
  if (!sw) return;
  archiveSwimmer(sw.id, Number(btn.dataset.season));
  toast(`${sw.firstname} archivé·e`);
});
on('restore', (btn) => {
  const sw = db.swimmers.get(btn.dataset.id);
  closeModal('modal-contact');
  if (!sw) return;
  restoreSwimmer(sw.id);
  toast(`${sw.firstname} restauré·e`);
});

// ── Import Excel / CSV ──
/** @type {{token: number, plan: object|null, selected: Set<number>, newGroups: string[], warnings: string[], busy: boolean}} */
const imp = { token: 0, plan: null, selected: new Set(), newGroups: [], warnings: [], busy: false };

function renderImport() {
  const sheet = el('import-sheet');
  if (!sheet) return;
  if (imp.plan) imp.newGroups = groupsToCreate(imp.plan.toCreate.filter((_, i) => imp.selected.has(i)), listGroups());
  sheet.innerHTML = imp.plan
    ? importPreviewHtml(imp.plan, { selected: imp.selected, newGroups: imp.newGroups, warnings: imp.warnings, busy: imp.busy })
    : importChooseHtml({ errors: imp.warnings, busy: imp.busy });
}

on('import-open', () => {
  imp.token += 1;
  Object.assign(imp, { plan: null, selected: new Set(), newGroups: [], warnings: [], busy: false });
  renderImport();
  openModal('modal-import');
  loadExcelReader().catch(() => { /* rechargé à la lecture du fichier */ });
});
on('import-choose', () => el('import-file')?.click());
on('import-template', downloadTemplate);
on('import-file', async (input) => {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const token = ++imp.token;
  Object.assign(imp, { plan: null, warnings: [], busy: true });
  renderImport();
  const { rows, errors } = await parseImportFile(file);
  if (token !== imp.token || !alive()) return;
  imp.busy = false;
  if (rows.length === 0) {
    imp.warnings = errors;
    renderImport();
    return;
  }
  imp.plan = planImport(rows, [...db.swimmers.values()]);
  imp.selected = new Set(imp.plan.toCreate.map((_, i) => i));
  imp.warnings = errors;
  renderImport();
}, 'change');
on('import-toggle', (btn) => {
  const i = Number(btn.dataset.i);
  if (imp.selected.has(i)) imp.selected.delete(i);
  else imp.selected.add(i);
  renderImport();
});
on('import-cancel', () => {
  imp.token += 1;
  closeModal('modal-import');
});
on('import-confirm', async () => {
  if (!imp.plan || imp.busy) return;
  const rows = imp.plan.toCreate.filter((_, i) => imp.selected.has(i));
  if (rows.length === 0) {
    toast('❗ Aucun nageur sélectionné');
    return;
  }
  imp.busy = true;
  renderImport();
  const skipped = imp.plan.duplicates.length;
  const { created, failed } = await runImport(rows);
  imp.token += 1;
  imp.busy = false;
  closeModal('modal-import');
  const tail = `${skipped ? ` · ${skipped} déjà présent${skipped > 1 ? 's' : ''}` : ''}${failed ? ` · ${failed} en échec` : ''}`;
  toast(created > 0
    ? `${failed ? '⚠️' : '✅'} Vous avez transféré ${created} nageur${created > 1 ? 's' : ''}${tail}`
    : `⚠️ Aucun nouveau nageur transféré${tail}`);
});

/** Enregistre l'écran Nageurs (remplace l'écran provisoire). */
export function registerContactsScreen() {
  registerScreen('contacts', { title: 'Nageurs', icon: ICON, render });
}
