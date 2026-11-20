import { computeStats, periodLabel, shiftPeriod } from '../../src/features/stats/logic.js';
import { statsPdfHtml } from '../../src/features/stats/view.js';
import { db, loadCache, resetStore, upsertLocal } from '../../src/core/store.js';

const TEAM = '55555555-5555-4555-8555-555555555555';
const sess = (id, date, type, km) => upsertLocal('sessions', { id, date, type, title: '', km });
const sw = (id, o = {}) => upsertLocal('swimmers', { id, firstname: id, lastname: `N${id}`, joined_season: 2026, left_season: null, group_id: null, ...o });
const here = (sessionId, swimmerId) => upsertLocal('presence', { session_id: sessionId, swimmer_id: swimmerId });

beforeEach(() => {
  localStorage.clear();
  resetStore({ save: false });
  loadCache('A', TEAM);
  sess('s1', '2026-11-03', 'nat', 3);
  sess('s2', '2026-11-05', 'nat', null);
  sess('s3', '2026-11-10', 'other', 2);
  sess('s4', '2026-11-12', 'comp', 8);
  sess('s5', '2026-11-14', 'musc', 4);
  sess('old', '2026-10-30', 'nat', 9); // hors du mois
  sw('A');
  sw('B');
  for (const s of ['s1', 's3', 's4']) here(s, 'A');
  here('s5', 'A');
  here('s1', 'B');
});

test('mois : other compte comme natation, comp à part, km de natation seulement', () => {
  const st = computeStats({ scope: 'month', y: 2026, m0: 10 });
  expect(st.sessions).toEqual({ nat: 3, musc: 1, comp: 1 });
  expect(st.km).toBe(5);
});

test('pourcentages et km par nageur (arrondi comme club4), tri par natPct décroissant', () => {
  const st = computeStats({ scope: 'month', y: 2026, m0: 10 });
  const [a, b] = st.perSwimmer;
  expect(a.swimmer.id).toBe('A');
  expect(a).toMatchObject({ natPres: 2, muscPres: 1, compPres: 1, natPct: 67, muscPct: 100, compPct: 100, natKm: 5 });
  expect(b).toMatchObject({ natPres: 1, muscPres: 0, compPres: 0, natPct: 33, muscPct: 0, compPct: 0, natKm: 3 });
});

test('aucune séance d\'un type : pourcentage 0, pas de division par zéro', () => {
  const st = computeStats({ scope: 'month', y: 2026, m0: 0 });
  expect(st.sessions).toEqual({ nat: 0, musc: 0, comp: 0 });
  expect(st.km).toBe(0);
  expect(st.perSwimmer).toEqual([]); // personne n'est dans le groupe en janvier 2026 (saison 2025)
});

test('saison : de septembre à août, une séance de juin y est, celle d\'août suivant non', () => {
  sess('jun', '2027-06-02', 'nat', 1);
  sess('aug', '2027-08-31', 'musc', 0);
  sess('sep', '2027-09-01', 'nat', 7);
  const st = computeStats({ scope: 'season', y: 2026 });
  expect(st.sessions).toEqual({ nat: 5, musc: 2, comp: 1 }); // 3 de novembre + octobre + juin ; musc nov + août
  expect(st.km).toBe(5 + 9 + 1);
});

test('mois : la saison du nageur est celle qui couvre le mois (archivé en 2025 absent de nov. 2026, présent en mars 2026)', () => {
  sw('Z', { joined_season: 2023, left_season: 2025 });
  expect(computeStats({ scope: 'month', y: 2026, m0: 10 }).perSwimmer.map((r) => r.swimmer.id)).not.toContain('Z');
  sess('mar', '2026-03-03', 'nat', 1);
  here('mar', 'Z');
  const st = computeStats({ scope: 'month', y: 2026, m0: 2 });
  expect(st.perSwimmer.map((r) => r.swimmer.id)).toEqual(['Z']);
  expect(st.perSwimmer[0].natPct).toBe(100);
});

test('une présence d\'un nageur qui n\'existe plus ne fait pas planter', () => {
  here('s1', 'ghost');
  expect(computeStats({ scope: 'month', y: 2026, m0: 10 }).perSwimmer).toHaveLength(2);
});

test('PDF : contient le nom (échappé), les chiffres et aucune balise injectée', () => {
  sw('X', { firstname: '<img src=x>', lastname: 'O\'Neil & Co' });
  const out = statsPdfHtml(computeStats({ scope: 'month', y: 2026, m0: 10 }), { teamName: 'TOAC <b>', now: new Date(2026, 10, 20) });
  expect(out).toContain('&lt;img src=x&gt; O&#39;Neil &amp; Co');
  expect(out).not.toContain('<img src=x>');
  expect(out).toContain('TOAC &lt;b&gt;');
  expect(out).toContain('5,0');
  expect(out).toContain('Novembre 2026');
  expect(out).not.toMatch(/\son[a-z]+\s*=/i);
});

test('libellés de période', () => {
  expect(periodLabel({ scope: 'season', y: 2026 })).toBe('Saison 2026–27');
  expect(periodLabel({ scope: 'month', y: 2026, m0: 10 })).toBe('Novembre 2026');
});

test('shiftPeriod : décembre → janvier et janvier → décembre, saisons', () => {
  expect(shiftPeriod({ scope: 'month', y: 2026, m0: 11 }, 1)).toEqual({ scope: 'month', y: 2027, m0: 0 });
  expect(shiftPeriod({ scope: 'month', y: 2027, m0: 0 }, -1)).toEqual({ scope: 'month', y: 2026, m0: 11 });
  expect(shiftPeriod({ scope: 'season', y: 2026 }, -1)).toEqual({ scope: 'season', y: 2025 });
});

test('un nageur arrivé après la saison de la période est absent', () => {
  sw('Late', { joined_season: 2027 });
  expect(computeStats({ scope: 'month', y: 2026, m0: 10 }).perSwimmer.map((r) => r.swimmer.id)).not.toContain('Late');
  expect(computeStats({ scope: 'season', y: 2027 }).perSwimmer.map((r) => r.swimmer.id)).toContain('Late');
});

test('aucune séance de natation : « 0 km / séance »', async () => {
  const { heroTexts } = await import('../../src/features/stats/view.js');
  expect(heroTexts(computeStats({ scope: 'month', y: 2026, m0: 0 })).sub).toContain('0 km / séance');
});
