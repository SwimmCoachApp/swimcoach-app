import { vi } from 'vitest';

vi.mock('../../src/core/supabase.js', () => ({
  supabase: { from: () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) },
}));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));

const { isoWeekKey, weeksOfMonth, savePlanWeek, savePlanEvent, deletePlanEvent, weekRealKm, eventsInWeek, seasonMonths } = await import('../../src/features/planning/logic.js');
const { planningPdfHtml } = await import('../../src/features/planning/view.js');
const { planMarksForMonth } = await import('../../src/features/calendar/logic.js');
const { db, loadCache, resetStore, upsertLocal } = await import('../../src/core/store.js');
const { pendingKeys } = await import('../../src/core/outbox.js');

const TEAM = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  localStorage.clear();
  resetStore({ save: false });
  loadCache('A', TEAM);
});

describe('isoWeekKey', () => {
  test('1er janvier 2026 : 2026-W01 ; 1er janvier 2027 : encore la semaine 53 de 2026', () => {
    expect(isoWeekKey(new Date(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe('2026-W53');
  });

  test('le lundi 29/12/2025 ouvre déjà la semaine 2026-W01 ; un dimanche reste dans sa semaine', () => {
    expect(isoWeekKey(new Date(2025, 11, 28))).toBe('2025-W52');
    expect(isoWeekKey(new Date(2025, 11, 29))).toBe('2026-W01');
    expect(isoWeekKey(new Date(2026, 10, 22))).toBe('2026-W47');
    expect(isoWeekKey(new Date(2026, 10, 23))).toBe('2026-W48');
  });

  test("calculé sur la date locale : minuit local ne glisse pas d'un jour", () => {
    expect(isoWeekKey(new Date(2026, 8, 7, 0, 30))).toBe('2026-W37'); // lundi 7 sept. 00 h 30
    expect(isoWeekKey(new Date(2026, 8, 6, 23, 30))).toBe('2026-W36'); // dimanche 6 sept. 23 h 30
  });
});

describe('weeksOfMonth', () => {
  test('septembre 2026 commence le lundi 31/08, semaine à cheval partagée avec la dernière semaine d\'août', () => {
    const sept = weeksOfMonth(2026, 8);
    const aug = weeksOfMonth(2026, 7);
    expect(sept[0].mondayDate).toEqual(new Date(2026, 7, 31));
    expect(sept[0].sundayDate).toEqual(new Date(2026, 8, 6));
    expect(sept[0].overlapsMonths).toBe(true);
    expect(sept[0].weekKey).toBe(aug.at(-1).weekKey);
    expect(sept[0].weekKey).toBe('2026-W36');
    expect(sept[0].weekLabel).toBe(36);
    expect(aug.at(-1).overlapsMonths).toBe(true);
  });

  test('une semaine entière dans le mois ne chevauche rien ; novembre 2026 : 6 semaines, de W44 à W49', () => {
    const nov = weeksOfMonth(2026, 10);
    expect(nov.map((w) => w.weekKey)).toEqual(['2026-W44', '2026-W45', '2026-W46', '2026-W47', '2026-W48', '2026-W49']);
    expect(nov.map((w) => w.overlapsMonths)).toEqual([true, false, false, false, false, true]);
  });

  test('un mois qui commence un lundi n\'a pas de semaine avant lui (juin 2026) ; décembre 2026 se termine en janvier', () => {
    expect(weeksOfMonth(2026, 5)[0].mondayDate).toEqual(new Date(2026, 5, 1));
    expect(weeksOfMonth(2026, 5)[0].overlapsMonths).toBe(false);
    const dec = weeksOfMonth(2026, 11);
    expect(dec.at(-1).weekKey).toBe('2026-W53');
    expect(weeksOfMonth(2027, 0)[0].weekKey).toBe('2026-W53');
  });

  test('saison : de septembre à août', () => {
    const months = seasonMonths(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ y: 2026, m: 8 });
    expect(months[4]).toEqual({ y: 2027, m: 0 });
    expect(months[11]).toEqual({ y: 2027, m: 7 });
  });
});

describe('savePlanEvent / deletePlanEvent', () => {
  test('month_key vient de la date de début, la ligne part en file', () => {
    const ev = savePlanEvent({ type: 'stage', title: 'Stage Noël', description: 'Camp', start: '2026-12-05', end: '2026-12-07' });
    expect(ev).toMatchObject({ month_key: '2026-12', type: 'stage', title: 'Stage Noël', description: 'Camp', start_date: '2026-12-05', end_date: '2026-12-07', team_id: TEAM });
    expect(ev.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.plan_events.get(ev.id)).toEqual(ev);
    expect(pendingKeys('plan_events').has(ev.id)).toBe(true);
  });

  test('modifier avec une autre date change le mois, garde l\'id ; fin vide devient null', () => {
    const ev = savePlanEvent({ type: 'comp', title: 'Régionaux', start: '2026-12-05', end: '' });
    expect(ev.end_date).toBeNull();
    const moved = savePlanEvent({ id: ev.id, type: 'comp', title: 'Régionaux', start: '2027-01-10', end: '' });
    expect(moved.id).toBe(ev.id);
    expect(moved.month_key).toBe('2027-01');
    expect(db.plan_events.size).toBe(1);
  });

  test('titre vide : le libellé du type (club4) ; date invalide, type inconnu ou fin avant début : erreur', () => {
    expect(savePlanEvent({ type: 'note', title: '  ', start: '2026-11-03' }).title).toBe('Note');
    expect(() => savePlanEvent({ type: 'comp', title: 'x', start: '' })).toThrow('Date');
    expect(() => savePlanEvent({ type: 'zzz', title: 'x', start: '2026-11-03' })).toThrow('Type');
    expect(() => savePlanEvent({ type: 'comp', title: 'x', start: '2026-11-03', end: '2026-11-01' })).toThrow('fin');
  });

  test('un stage de 3 jours apparaît sur le calendrier (planMarksForMonth)', () => {
    savePlanEvent({ type: 'stage', title: 'Stage', start: '2026-11-10', end: '2026-11-12' });
    const marks = planMarksForMonth(2026, 10);
    expect([...marks.keys()]).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(marks.get('2026-11-10')).toMatchObject({ type: 'stage', title: 'Stage', isFirst: true });
  });

  test('suppression : ligne retirée du store et file', () => {
    const ev = savePlanEvent({ type: 'obj', title: 'Prépa', start: '2026-11-03' });
    deletePlanEvent(ev.id);
    expect(db.plan_events.size).toBe(0);
    expect(pendingKeys('plan_events').has(ev.id)).toBe(true); // la suppression part en file
  });
});

describe('savePlanWeek', () => {
  test('crée la ligne de la semaine (clé week_key) et l\'envoie ; km décimal à virgule accepté', () => {
    const w = savePlanWeek('2026-W47', 2026, 'Aérobie', '42,5', 'seuil');
    expect(w).toMatchObject({ week_key: '2026-W47', season_start: 2026, content: 'Aérobie', km_target: 42.5, zone: 'seuil', team_id: TEAM });
    expect(db.plan_weeks.get('2026-W47')).toEqual(w);
    expect(pendingKeys('plan_weeks').has('2026-W47')).toBe(true);
    expect('updated_at' in w).toBe(false); // posé par le serveur
  });

  test('null = champ inchangé (club4) : on ne réécrit que ce qui a été modifié', () => {
    savePlanWeek('2026-W47', 2026, 'Aérobie', 30, 'seuil');
    const w = savePlanWeek('2026-W47', 2026, null, '35', null);
    expect(w).toMatchObject({ content: 'Aérobie', km_target: 35, zone: 'seuil' });
    expect(db.plan_weeks.size).toBe(1);
  });

  test('km négatif, vide ou illisible : 0', () => {
    expect(savePlanWeek('2026-W47', 2026, '', '-4', '').km_target).toBe(0);
    expect(savePlanWeek('2026-W47', 2026, null, 'abc', null).km_target).toBe(0);
  });

  test('clé de semaine invalide : erreur', () => {
    expect(() => savePlanWeek('2026-47', 2026, 'x', 0, '')).toThrow('Semaine');
  });
});

describe('km réalisés et événements d\'une semaine', () => {
  const sess = (id, date, type, km) => upsertLocal('sessions', { id, date, type, title: '', km });
  const [mon, sun] = [new Date(2026, 10, 16), new Date(2026, 10, 22)];

  test('natation et compétition comptent, muscu et autre non ; bornes lundi et dimanche incluses', () => {
    sess('a', '2026-11-16', 'nat', 3);
    sess('b', '2026-11-22', 'comp', 2.5);
    sess('c', '2026-11-18', 'musc', 9);
    sess('d', '2026-11-19', 'other', 4);
    sess('e', '2026-11-15', 'nat', 7);
    sess('f', '2026-11-23', 'nat', 7);
    sess('g', '2026-11-20', 'nat', null);
    expect(weekRealKm(mon, sun)).toBe(5.5);
  });

  test('événements qui chevauchent la semaine, triés par début, sans doublon', () => {
    const a = savePlanEvent({ type: 'stage', title: 'A', start: '2026-11-20', end: '2026-11-25' });
    const b = savePlanEvent({ type: 'comp', title: 'B', start: '2026-11-10', end: '2026-11-16' });
    savePlanEvent({ type: 'note', title: 'C', start: '2026-11-23' });
    savePlanEvent({ type: 'note', title: 'D', start: '2026-11-15' });
    expect(eventsInWeek(mon, sun).map((e) => e.id)).toEqual([b.id, a.id]);
  });
});

describe('planningPdfHtml', () => {
  const now = new Date(2026, 10, 20);

  test('Club : bandeau, KPI, mois de septembre à août, semaine partagée marquée, totaux dédoublonnés', () => {
    savePlanWeek('2026-W36', 2026, 'Reprise', 20, 'aérobie');
    savePlanWeek('2026-W47', 2026, 'Ligne 1\nLigne 2', 40, '');
    upsertLocal('sessions', { id: 's1', date: '2026-09-01', type: 'nat', title: '', km: 10 });
    upsertLocal('sessions', { id: 's2', date: '2026-11-17', type: 'nat', title: '', km: 40 });
    savePlanEvent({ type: 'comp', title: 'Régionaux', description: 'Bassin de 50 m', start: '2026-11-21', end: '2026-11-22' });
    const doc = planningPdfHtml(2026, { teamName: 'TOAC Natation', now });
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(doc).toContain('Planification saison 2026–27');
    expect(doc).toContain('TOAC Natation');
    expect(doc).toContain('Septembre 2026');
    expect(doc).toContain('Août 2027');
    expect(doc.indexOf('Septembre 2026')).toBeLessThan(doc.indexOf('Janvier 2027'));
    expect(doc).toContain('Ligne 1<br>Ligne 2');
    expect(doc).toContain('Régionaux');
    expect(doc).toContain('Bassin de 50 m');
    expect(doc).toContain('21 nov. → 22 nov.');
    expect(doc).toContain('id="pdf-print"');
    // la semaine W36 (à cheval août/septembre 2026) apparaît dans Août 2026? non : août 2026 est de la saison précédente
    expect(doc.match(/S36/g)).toHaveLength(1);
    expect(doc).toContain('édité le 20 novembre 2026');
    // 20 + 40 d'objectif ; 10 + 40 réalisés (W36 : 1er sept. ; W47 : 17 nov.), 2 semaines planifiées, 1 événement
    expect(doc).toContain('50<small> km</small>');
    expect(doc).toContain('sur 60 km d\'objectif · 83%');
  });

  test('tout est échappé et aucun script ; texte riche ou balises saisies ne passent pas', () => {
    savePlanWeek('2026-W47', 2026, '<img src=x onerror=alert(1)>\n<script>alert(2)</script>', 10, '<b>zone</b>');
    savePlanEvent({ type: 'stage', title: '<script>alert(3)</script>', description: '"><svg onload=1>', start: '2026-11-02' });
    const doc = planningPdfHtml(2026, { teamName: '<i>Club</i>', now });
    expect(doc).not.toContain('<script');
    expect(doc).not.toContain('<img');
    expect(doc).not.toContain('<svg onload');
    expect(doc).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i); // aucun gestionnaire dans une balise
    expect(doc).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(doc).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
    expect(doc).toContain('&lt;i&gt;Club&lt;/i&gt;');
    expect(doc).not.toContain('fonts.googleapis.com');
  });

  test('saison vide : document complet, 0 semaine planifiée', () => {
    const doc = planningPdfHtml(2026, { now });
    expect(doc).toContain('Semaines planifiées');
    expect(doc).toContain('<b>0</b>');
    expect(doc.match(/class="pdf-month"/g)).toHaveLength(12);
  });
});
