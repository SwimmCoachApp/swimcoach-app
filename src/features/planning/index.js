/**
 * Écran Planification : saison de septembre à août, événements du plan, semaines (zone, thème, objectif km), PDF.
 *
 * Plusieurs entraîneurs peuvent modifier la même semaine : chaque champ enregistre sa propre valeur (savePlanWeek
 * laisse les autres telles qu'elles sont dans le store). Les rafraîchissements du store (temps réel, séances)
 * ne reconstruisent jamais les champs : ils ne remplacent que la valeur d'un champ qui n'a pas le focus, donc
 * ce qu'un entraîneur est en train de taper n'est jamais écrasé. La feuille d'événement est hors de la liste.
 */
import { on } from '../../app/actions.js';
import { registerScreen, openModal, closeModal, currentTeamName } from '../../app/shell.js';
import { toast } from '../../app/toast.js';
import { db, subscribe, onReset } from '../../core/store.js';
import { currentSeason } from '../../core/season.js';
import { exportPdf } from '../pdf/index.js';
import { savePlanWeek, savePlanEvent, deletePlanEvent, seasonLabel, weekData, weekIsFilled, eventsOfMonth, EVENT_TYPES } from './logic.js';
import { screenHtml, timelineHtml, planningPdfHtml, monthBadgesHtml, monthEventsHtml, weekEventsHtml, weekRealHtml, eventFormHtml, deleteEventDialogHtml } from './view.js';


const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>';

/** Saison affichée et mois dépliés : gardés d'un affichage à l'autre, remis à zéro à la fermeture de l'espace. */
let nav = null;
const ui = { root: null, unsubs: [], form: null };
onReset(() => { nav = null; stop(); });

function state() {
  if (!nav) {
    const now = new Date();
    const season = currentSeason(now);
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    nav = { season, open: new Set([key]) }; // le mois en cours est déplié au départ
  }
  return nav;
}

const el = (id) => ui.root?.querySelector(`#${id}`) ?? null;
const dateOf = (key) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

function stop() {
  for (const off of ui.unsubs) off();
  ui.unsubs = [];
  ui.root = null;
  ui.form = null;
}

function renderTimeline() {
  const s = state();
  el('plan-year-label').textContent = seasonLabel(s.season);
  el('plan-timeline').innerHTML = timelineHtml(s.season, s.open);
}

const setHtml = (node, value) => { if (node.innerHTML !== value) node.innerHTML = value; };

/** Met à jour ce qui dépend du store sans toucher aux champs qu'un entraîneur est en train de remplir. */
function refresh() {
  if (!ui.root) return;
  if (!ui.root.isConnected) {
    stop();
    return;
  }
  const active = document.activeElement;
  for (const slot of ui.root.querySelectorAll('[data-events-slot]')) setHtml(slot, monthEventsHtml(slot.dataset.eventsSlot));
  for (const badges of ui.root.querySelectorAll('[data-badges-of]')) setHtml(badges, monthBadgesHtml(eventsOfMonth(badges.dataset.badgesOf)));
  for (const block of ui.root.querySelectorAll('[data-week-block]')) {
    const [monday, sunday] = [dateOf(block.dataset.monday), dateOf(block.dataset.sunday)];
    const wd = weekData(block.dataset.weekBlock);
    const target = parseFloat(wd.km_target) || 0;
    setHtml(block.querySelector('[data-week-events]'), weekEventsHtml(monday, sunday));
    setHtml(block.querySelector('[data-week-km]'), weekRealHtml(monday, sunday, target));
    block.classList.toggle('has-content', weekIsFilled(wd));
    const values = { zone: wd.zone || '', theme: wd.content || '', km: target || '' };
    for (const field of block.querySelectorAll('[data-field]')) {
      if (field === active) continue; // en cours de saisie : jamais écrasé
      const next = String(values[field.dataset.field]);
      if (field.value !== next) field.value = next;
    }
  }
}

function render(root) {
  stop();
  ui.root = root;
  root.innerHTML = screenHtml();
  renderTimeline();
  ui.unsubs = ['plan_weeks', 'plan_events', 'sessions'].map((t) => subscribe(t, refresh));
}

// ── Saison et mois ──
function shiftSeason(delta) {
  if (!ui.root) return;
  state().season += delta;
  renderTimeline();
}
on('plan-prev', () => shiftSeason(-1));
on('plan-next', () => shiftSeason(1));
on('plan-toggle-month', (btn) => {
  const block = btn.closest('.plan-month-block');
  const open = block.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(open));
  const { open: set } = state();
  if (open) set.add(btn.dataset.key);
  else set.delete(btn.dataset.key);
});

// ── Semaines : un champ modifié = une écriture de ce champ seul ──
on('plan-week-change', (input) => {
  const { week, season, field } = input.dataset;
  const value = input.value;
  try {
    const saved = savePlanWeek(week, Number(season), field === 'theme' ? value : null, field === 'km' ? value : null, field === 'zone' ? value : null);
    if (field === 'km') input.value = saved.km_target || ''; // valeur normalisée (virgule, négatif)
  } catch {
    toast('Enregistrement impossible');
  }
}, 'change');

// ── Événements ──
function openEventForm(id, mKey) {
  const ev = id ? db.plan_events.get(id) : null;
  if (id && !ev) return;
  ui.form = { id: ev?.id ?? null, type: ev?.type ?? 'comp' };
  el('plan-event-sheet').innerHTML = eventFormHtml(ev, { type: ui.form.type, start: `${mKey}-01` });
  openModal('modal-plan-event');
}
on('plan-add-event', (btn) => openEventForm(null, btn.dataset.key));
on('plan-edit-event', (btn) => openEventForm(btn.dataset.id, null));
on('plan-pick-type', (btn) => {
  if (!ui.form || !EVENT_TYPES.includes(btn.dataset.key)) return;
  ui.form.type = btn.dataset.key;
  for (const pill of ui.root.querySelectorAll('#plan-event-sheet .event-type-pill')) {
    const active = pill.dataset.key === ui.form.type;
    pill.className = `event-type-pill${active ? ` sel-${pill.dataset.key}` : ''}`;
    pill.setAttribute('aria-pressed', String(active));
  }
});
on('plan-save-event', () => {
  const form = ui.form;
  if (!form) return;
  const title = el('plan-ev-title').value.trim();
  if (!title && form.type !== 'note') {
    toast('Titre requis');
    return;
  }
  try {
    savePlanEvent({
      id: form.id ?? undefined,
      type: form.type,
      title,
      description: el('plan-ev-desc').value,
      start: el('plan-ev-start').value,
      end: el('plan-ev-end').value,
    });
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Enregistrement impossible');
    return;
  }
  closeModal('modal-plan-event');
  ui.form = null;
  toast('Événement enregistré');
});
on('plan-ask-delete-event', (btn) => {
  const ev = db.plan_events.get(btn.dataset.id);
  if (!ev) return;
  el('dialog-plan-event-box').innerHTML = deleteEventDialogHtml(ev);
  openModal('dialog-plan-event');
});
on('plan-do-delete-event', (btn) => {
  deletePlanEvent(btn.dataset.id);
  closeModal('dialog-plan-event');
  closeModal('modal-plan-event');
  ui.form = null;
  toast('Événement supprimé');
});

// ── PDF ──
on('plan-pdf', () => {
  if (!ui.root) return;
  const season = state().season;
  const swimmerSvg = document.querySelector('.top-bar-scene g[transform]')?.outerHTML ?? '';
  exportPdf(planningPdfHtml(season, { teamName: currentTeamName(), swimmerSvg }), `Planification saison ${seasonLabel(season)}`);
});

/** Enregistre l'écran Planification (remplace l'écran provisoire). */
export function registerPlanningScreen() {
  registerScreen('planning', { title: 'Planification', icon: ICON, render });
}
