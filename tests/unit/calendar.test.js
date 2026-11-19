import { vi } from 'vitest';

const bucket = {
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
  createSignedUrl: vi.fn(async (p) => ({ data: { signedUrl: `https://x/${p}?token=1` }, error: null })),
};
vi.mock('../../src/core/supabase.js', () => ({
  supabase: { storage: { from: () => bucket }, from: () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) },
}));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));

const { saveSession, deleteSession, sessionsOn, planMarksForMonth, planEventsOn, dayTitle, formatPlanDate } = await import('../../src/features/calendar/logic.js');
const { sessionViewHtml, sessionCardHtml } = await import('../../src/features/calendar/view.js');
const { db, loadCache, resetStore, upsertLocal } = await import('../../src/core/store.js');
const { pendingCount } = await import('../../src/core/outbox.js');

const TEAM = '55555555-5555-4555-8555-555555555555';
const blob = () => new Blob(['x'], { type: 'image/jpeg' });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  resetStore({ save: false });
  loadCache('A', TEAM);
});

const ev = (o) => upsertLocal('plan_events', { id: crypto.randomUUID(), month_key: '2026-11', title: '', description: '', ...o });

describe('planMarksForMonth', () => {
  test('un stage et une compétition le même jour : la compétition gagne (comp > stage > nat > obj > note)', () => {
    ev({ type: 'stage', title: 'Stage', start_date: '2026-11-10', end_date: '2026-11-14' });
    ev({ type: 'comp', title: 'Régionaux', start_date: '2026-11-12', end_date: '2026-11-12' });
    const marks = planMarksForMonth(2026, 10);
    expect(marks.get('2026-11-12')).toMatchObject({ type: 'comp', title: 'Régionaux', isFirst: true, isLast: true });
    expect(marks.get('2026-11-11')).toMatchObject({ type: 'stage', isFirst: false, isLast: false });
    expect(marks.get('2026-11-10').isFirst).toBe(true);
    expect(marks.get('2026-11-14').isLast).toBe(true);
  });

  test("ordre complet des priorités, quel que soit l'ordre d'insertion", () => {
    for (const type of ['note', 'obj', 'nat', 'stage', 'comp']) ev({ type, start_date: '2026-11-05' });
    expect(planMarksForMonth(2026, 10).get('2026-11-05').type).toBe('comp');
    resetStore({ save: false });
    loadCache('A', TEAM);
    for (const type of ['note', 'obj', 'nat']) ev({ type, start_date: '2026-11-05' });
    expect(planMarksForMonth(2026, 10).get('2026-11-05').type).toBe('nat');
  });

  test('un événement à cheval sur deux mois apparaît dans les deux, sans déborder, et le titre par défaut est le libellé du type', () => {
    ev({ type: 'stage', start_date: '2026-10-29', end_date: '2026-11-02' });
    const nov = planMarksForMonth(2026, 10);
    expect([...nov.keys()]).toEqual(['2026-11-01', '2026-11-02']);
    expect(nov.get('2026-11-01')).toMatchObject({ title: 'Stage', isFirst: false });
    const oct = planMarksForMonth(2026, 9);
    expect([...oct.keys()]).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
  });

  test('sans date de fin : un seul jour ; dates absentes ou fin avant début : pas de plantage', () => {
    ev({ type: 'note', title: 'N', start_date: '2026-11-03', end_date: null });
    ev({ type: 'obj', start_date: null, end_date: null });
    ev({ type: 'nat', title: 'Inversé', start_date: '2026-11-08', end_date: '2026-11-06' });
    const marks = planMarksForMonth(2026, 10);
    expect([...marks.keys()]).toEqual(['2026-11-03', '2026-11-08']);
  });

  test('changement d’heure (octobre) : aucun jour sauté ni doublé', () => {
    ev({ type: 'stage', start_date: '2026-10-24', end_date: '2026-10-28' });
    expect([...planMarksForMonth(2026, 9).keys()]).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  });

  test('planEventsOn : tous les événements du jour, le plus prioritaire d’abord', () => {
    ev({ type: 'note', title: 'Note', start_date: '2026-11-12' });
    ev({ type: 'comp', title: 'Comp', start_date: '2026-11-12', end_date: '2026-11-13', description: 'Piscine' });
    const list = planEventsOn('2026-11-12');
    expect(list.map((m) => m.type)).toEqual(['comp', 'note']);
    expect(list[0].desc).toBe('Piscine');
    expect(planEventsOn('2026-11-20')).toEqual([]);
  });
});

describe('saveSession', () => {
  test('une séance muscu enregistrée avec km: 5 donne km === null', async () => {
    const s = await saveSession({ date: '2026-11-20', title: 'Gainage', type: 'musc', time: '18:00', content: '', km: 5 });
    expect(s.km).toBeNull();
    expect(db.sessions.get(s.id).km).toBeNull();
  });

  test('km : natation garde la valeur (virgule acceptée), vide ou nul devient null', async () => {
    expect((await saveSession({ date: '2026-11-20', type: 'nat', km: '2,5' })).km).toBe(2.5);
    expect((await saveSession({ date: '2026-11-20', type: 'comp', km: 0 })).km).toBeNull();
    expect((await saveSession({ date: '2026-11-20', type: 'other', km: '' })).km).toBeNull();
    expect((await saveSession({ date: '2026-11-20', type: 'nat', km: 'abc' })).km).toBeNull();
  });

  test('le contenu est stocké nettoyé : <b>ok</b><img src=x onerror=1> devient <b>ok</b>, et s’affiche ainsi', async () => {
    const s = await saveSession({ date: '2026-11-20', type: 'nat', content: '<b>ok</b><img src=x onerror=1>' });
    expect(db.sessions.get(s.id).content).toBe('<b>ok</b>');
    const view = sessionViewHtml(db.sessions.get(s.id), { photo: false });
    expect(view).toContain('<b>ok</b>');
    expect(view).not.toMatch(/<img|onerror|script/i);
  });

  test('un contenu hostile enregistré en base est nettoyé de nouveau à l’affichage', () => {
    const row = upsertLocal('sessions', { id: 's1', date: '2026-11-20', type: 'nat', title: '<i>t</i>', content: '<script>alert(1)</script><u>x</u><img src=x onerror=alert(1)>', km: null });
    const view = sessionViewHtml(row, { photo: false });
    expect(view).toContain('<u>x</u>');
    expect(view).not.toMatch(/<script|<img|onerror/i);
    expect(view).toContain('&lt;i&gt;t&lt;/i&gt;'); // le titre est du texte
    expect(sessionCardHtml(row)).not.toContain('<i>t</i>');
  });

  test('contenu sans texte ni liste : stocké vide', async () => {
    expect((await saveSession({ date: '2026-11-20', type: 'nat', content: '<div><br></div>' })).content).toBe('');
    expect((await saveSession({ date: '2026-11-20', type: 'nat', content: '<ul><li></li></ul>' })).content).toBe('<ul><li></li></ul>');
  });

  test('date ou type invalide : refusé, rien n’est écrit', async () => {
    await expect(saveSession({ date: '20/11/2026', type: 'nat' })).rejects.toThrow('Date invalide');
    await expect(saveSession({ date: '2026-11-20', type: 'danse' })).rejects.toThrow('Type de séance invalide');
    expect(db.sessions.size).toBe(0);
    expect(pendingCount(TEAM, 'A')).toBe(0);
  });

  test('création puis modification : même ligne, team_id posé', async () => {
    const s = await saveSession({ date: '2026-11-20', title: ' Endurance ', type: 'nat', time: '08:00', km: 3 });
    expect(s).toMatchObject({ title: 'Endurance', team_id: TEAM, time: '08:00', km: 3, photo_path: null });
    const again = await saveSession({ id: s.id, date: '2026-11-21', title: 'Endurance 2', type: 'nat', time: '09:00', km: 4 });
    expect(again.id).toBe(s.id);
    expect(db.sessions.size).toBe(1);
    expect(db.sessions.get(s.id)).toMatchObject({ date: '2026-11-21', title: 'Endurance 2', km: 4 });
  });

  test('photo : envoyée sous <équipe>/sessions/<id>.jpg et gardée dans photo_path ; échec = séance quand même enregistrée', async () => {
    const s = await saveSession({ date: '2026-11-20', type: 'nat', photoBlob: blob() });
    expect(s.photo_path).toBe(`${TEAM}/sessions/${s.id}.jpg`);
    expect(bucket.upload).toHaveBeenCalledWith(s.photo_path, expect.any(Blob), { upsert: true, contentType: 'image/jpeg' });
    bucket.upload.mockRejectedValueOnce(new Error('offline'));
    const t = await saveSession({ date: '2026-11-20', type: 'nat', title: 'sans photo', photoBlob: blob() });
    expect(t.photo_path).toBeNull();
    expect(db.sessions.get(t.id).title).toBe('sans photo');
  });

  test('retirer la photo : supprimée du stockage puis photo_path null ; échec = chemin conservé', async () => {
    const s = await saveSession({ date: '2026-11-20', type: 'nat', photoBlob: blob() });
    bucket.remove.mockResolvedValueOnce({ error: { message: 'offline' } });
    expect((await saveSession({ id: s.id, date: '2026-11-20', type: 'nat', removePhoto: true })).photo_path).toBe(s.photo_path);
    expect((await saveSession({ id: s.id, date: '2026-11-20', type: 'nat', removePhoto: true })).photo_path).toBeNull();
    expect(bucket.remove).toHaveBeenLastCalledWith([`${TEAM}/sessions/${s.id}.jpg`]);
  });

  test('modifier sans toucher à la photo la garde', async () => {
    const s = await saveSession({ date: '2026-11-20', type: 'nat', photoBlob: blob() });
    expect((await saveSession({ id: s.id, date: '2026-11-20', type: 'nat', title: 'x' })).photo_path).toBe(s.photo_path);
  });
});

describe('deleteSession', () => {
  test('supprime la photo puis la ligne, et les présences locales de la séance', async () => {
    const s = await saveSession({ date: '2026-11-20', type: 'nat', photoBlob: blob() });
    upsertLocal('presence', { session_id: s.id, swimmer_id: 'w1' });
    upsertLocal('presence', { session_id: 'autre', swimmer_id: 'w1' });
    await deleteSession(s.id);
    expect(bucket.remove).toHaveBeenCalledWith([s.photo_path]);
    expect(db.sessions.has(s.id)).toBe(false);
    expect([...db.presence.keys()]).toEqual(['autre:w1']);
  });

  test('photo impossible à supprimer : la séance est gardée', async () => {
    const s = await saveSession({ date: '2026-11-20', type: 'nat', photoBlob: blob() });
    bucket.remove.mockResolvedValueOnce({ error: { message: 'fetch failed' } });
    await expect(deleteSession(s.id)).rejects.toMatchObject({ photo: true });
    expect(db.sessions.has(s.id)).toBe(true);
  });

  test('séance sans photo : aucun appel au stockage', async () => {
    const s = await saveSession({ date: '2026-11-20', type: 'nat' });
    await deleteSession(s.id);
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(db.sessions.size).toBe(0);
  });
});

test('sessionsOn : séances du jour seulement, par heure', async () => {
  await saveSession({ date: '2026-11-20', title: 'Soir', type: 'nat', time: '18:00' });
  await saveSession({ date: '2026-11-20', title: 'Matin', type: 'musc', time: '07:30' });
  await saveSession({ date: '2026-11-21', title: 'Autre jour', type: 'nat', time: '08:00' });
  expect(sessionsOn('2026-11-20').map((s) => s.title)).toEqual(['Matin', 'Soir']);
});

test('titres : jour et période en français', () => {
  expect(dayTitle('2026-11-20')).toBe('Vendredi 20 nov');
  expect(dayTitle('2026-03-01')).toBe('Dimanche 1 mar');
  expect(formatPlanDate('2026-11-20', '2026-11-22')).toBe('20 nov. → 22 nov.');
  expect(formatPlanDate('2026-11-20', '2026-11-20')).toBe('20 nov.');
  expect(formatPlanDate('2026-11-20', '')).toBe('20 nov.');
});
