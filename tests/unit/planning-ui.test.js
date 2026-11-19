import { vi } from 'vitest';

vi.mock('../../src/core/supabase.js', () => ({
  supabase: { from: () => ({ upsert: async () => { throw new Error('network'); }, delete: () => ({ eq: () => ({ eq: async () => { throw new Error('network'); } }) }) }) },
}));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));
const screens = new Map();
vi.mock('../../src/app/shell.js', () => ({
  registerScreen: (name, def) => screens.set(name, def),
  openModal: (id) => document.getElementById(id)?.classList.add('open'),
  closeModal: (id) => document.getElementById(id)?.classList.remove('open'),
  currentTeamName: () => 'TOAC Natation',
}));
const toasts = [];
vi.mock('../../src/app/toast.js', () => ({ toast: (m) => toasts.push(m) }));

const { registerPlanningScreen } = await import('../../src/features/planning/index.js');
const { db, loadCache, resetStore, upsertLocal } = await import('../../src/core/store.js');
const { teamStore } = await import('../../src/core/storage.js');

const TEAM = '55555555-5555-4555-8555-555555555555';
registerPlanningScreen();
let root;
const $ = (sel) => root.querySelector(sel);
const $$ = (sel) => [...root.querySelectorAll(sel)];
const ops = () => (teamStore('A', TEAM).get('outbox') ?? []).map((o) => `${o.kind} ${o.table}`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 20, 9) });
  localStorage.clear();
  toasts.length = 0;
  resetStore({ save: false });
  loadCache('A', TEAM);
  root = document.createElement('section');
  document.body.replaceChildren(root);
  screens.get('planning').render(root);
});
afterEach(() => vi.useRealTimers());

/** Les champs de la semaine W36 (à cheval août/septembre) : un exemplaire par mois qui l'affiche. */
const fieldsOf = (week, field) => $$(`[data-week="${week}"][data-field="${field}"]`);
const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };

test('saison courante, mois en cours déplié, 12 mois', () => {
  expect($('#plan-year-label').textContent).toBe('2026–27');
  expect($$('.plan-month-block')).toHaveLength(12);
  expect($$('.plan-month-block.open').map((b) => b.dataset.month)).toEqual(['2026-11']);
});

test('modifier un champ enregistre ce champ seul', () => {
  const zone = fieldsOf('2026-W47', 'zone')[0];
  const km = fieldsOf('2026-W47', 'km')[0];
  type(zone, ' seuil ');
  type(km, '42.5'); // un champ nombre rend toujours un point
  expect(db.plan_weeks.get('2026-W47')).toMatchObject({ zone: 'seuil', km_target: 42.5, content: '', season_start: 2026 });
  expect(ops()).toEqual(['upsert plan_weeks', 'upsert plan_weeks']);
  expect(km.value).toBe('42.5');
});

test('un champ en cours de saisie n\'est pas écrasé par une mise à jour distante ; les autres le sont', () => {
  const theme = fieldsOf('2026-W47', 'theme')[0];
  const zone = fieldsOf('2026-W47', 'zone')[0];
  theme.focus();
  theme.value = 'Ma saisie en cours'; // pas encore validée (pas de change)
  // un autre entraîneur change la zone, le thème et l'objectif de la même semaine
  upsertLocal('plan_weeks', { week_key: '2026-W47', season_start: 2026, content: 'Thème distant', zone: 'vitesse', km_target: 30 });
  expect(document.activeElement).toBe(theme);
  expect(theme.value).toBe('Ma saisie en cours');
  expect(zone.value).toBe('vitesse');
  expect(fieldsOf('2026-W47', 'km')[0].value).toBe('30');
  // elle valide : seul le thème part, les autres champs restent ceux du serveur
  theme.dispatchEvent(new Event('change', { bubbles: true }));
  expect(db.plan_weeks.get('2026-W47')).toMatchObject({ content: 'Ma saisie en cours', zone: 'vitesse', km_target: 30 });
});

test('semaine à cheval sur deux mois (W53 : décembre 2026 et janvier 2027) : les deux exemplaires partagent le contenu', () => {
  const [dec, jan] = fieldsOf('2026-W53', 'zone');
  expect([dec.closest('.plan-month-block').dataset.month, jan.closest('.plan-month-block').dataset.month]).toEqual(['2026-12', '2027-01']);
  type(dec, 'aérobie');
  expect(db.plan_weeks.get('2026-W53').zone).toBe('aérobie');
  expect(jan.value).toBe('aérobie');
  expect(db.plan_weeks.size).toBe(1);
});

test('événement : créer un stage de 3 jours, le retrouver dans le mois et la semaine, le supprimer après confirmation', () => {
  $('[data-action="plan-add-event"][data-key="2026-11"]').click();
  expect($('#modal-plan-event').classList.contains('open')).toBe(true);
  expect($('#plan-ev-start').value).toBe('2026-11-01');
  $('[data-action="plan-pick-type"][data-key="stage"]').click();
  $('#plan-ev-title').value = '<b>Stage</b> d\'automne';
  $('#plan-ev-start').value = '2026-11-10';
  $('#plan-ev-end').value = '2026-11-12';
  $('[data-action="plan-save-event"]').click();
  const [ev] = [...db.plan_events.values()];
  expect(ev).toMatchObject({ type: 'stage', title: "<b>Stage</b> d'automne", month_key: '2026-11', start_date: '2026-11-10', end_date: '2026-11-12' });
  expect($('[data-events-slot="2026-11"] .plan-event-title').textContent).toBe("<b>Stage</b> d'automne"); // texte, pas du HTML
  expect($('[data-events-slot="2026-11"] b')).toBeNull();
  expect($('[data-week-block="2026-W46"] .plan-week-event-stage')).not.toBeNull();
  expect($('[data-badges-of="2026-11"] .plan-badge-stage')).not.toBeNull();
  $('[data-action="plan-ask-delete-event"]').click();
  expect($('#dialog-plan-event').classList.contains('open')).toBe(true);
  expect(db.plan_events.size).toBe(1); // pas encore supprimé
  $('[data-action="plan-do-delete-event"]').click();
  expect(db.plan_events.size).toBe(0);
  expect($('[data-events-slot="2026-11"]').innerHTML).toBe('');
});

test('événement sans titre : refusé sauf pour une note ; fin avant début : message', () => {
  $('[data-action="plan-add-event"][data-key="2026-11"]').click();
  $('[data-action="plan-save-event"]').click();
  expect(toasts.at(-1)).toBe('Titre requis');
  $('#plan-ev-title').value = 'X';
  $('#plan-ev-end').value = '2026-10-01';
  $('[data-action="plan-save-event"]').click();
  expect(toasts.at(-1)).toBe('La date de fin précède le début');
  expect(db.plan_events.size).toBe(0);
  $('[data-action="plan-pick-type"][data-key="note"]').click();
  $('#plan-ev-title').value = '';
  $('#plan-ev-end').value = '';
  $('[data-action="plan-save-event"]').click();
  expect([...db.plan_events.values()][0]).toMatchObject({ type: 'note', title: 'Note' });
});

test('les km réalisés suivent les séances (natation et compétition) et colorent la case', () => {
  fieldsOf('2026-W47', 'km')[0].value = '20';
  fieldsOf('2026-W47', 'km')[0].dispatchEvent(new Event('change', { bubbles: true }));
  const real = () => $('[data-week-block="2026-W47"] .plan-week-km-real');
  expect(real().className).toContain('week-km-under');
  upsertLocal('sessions', { id: 's1', date: '2026-11-17', type: 'nat', km: 17 });
  expect(real().className).toContain('week-km-close');
  expect(real().textContent).toContain('85%');
  upsertLocal('sessions', { id: 's2', date: '2026-11-22', type: 'comp', km: 3 });
  expect(real().className).toContain('week-km-ok');
  expect(real().querySelector('.plan-week-km-real-val').textContent).toBe('20.0');
});
