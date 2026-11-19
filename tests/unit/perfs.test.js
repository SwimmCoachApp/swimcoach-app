import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

let session = { access_token: 'jwt-123' };
vi.mock('../../src/core/supabase.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session } }) },
    from: () => ({ upsert: async () => { throw new Error('network'); } }),
  },
}));
vi.mock('../../src/core/session.js', () => ({ getCoach: () => ({ id: 'A' }), onCoachChange: () => () => {} }));
vi.mock('../../src/app/toast.js', () => ({ toast: () => {} }));

const { fetchLiveFFN, importCompetition, buildPerfRows, FETCH_ERRORS, progressionInfo, bestTimes } = await import('../../src/features/perfs/logic.js');
const { bilanPdfHtml, importPreviewHtml } = await import('../../src/features/perfs/view.js');
const { db, loadCache, resetStore, upsertLocal } = await import('../../src/core/store.js');
const { teamStore } = await import('../../src/core/storage.js');
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = await import('../../src/core/config.js');

const FIXTURE = readFileSync(resolve(process.cwd(), 'tests/fixtures/liveffn-sample.html'), 'utf8');
const TEAM = '55555555-5555-4555-8555-555555555555';
const sw = (id, firstname, lastname, joined, left = null) => ({ id, firstname, lastname, joined_season: joined, left_season: left, group_id: null });
const okResponse = (body) => ({ ok: true, status: 200, text: async () => body });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 20, 9) });
  localStorage.clear();
  session = { access_token: 'jwt-123' };
  resetStore({ save: false });
  loadCache('A', TEAM);
  upsertLocal('swimmers', sw('leo', 'Léo', 'Martin', 2024));
  upsertLocal('swimmers', sw('me', 'Marie-Ève', 'De La Fontaine', 2025));
  upsertLocal('swimmers', sw('hugo', 'Hugo', 'Petit', 2023, 2025));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchLiveFFN', () => {
  it('GET sur le proxy avec le jeton et la clé publique ; renvoie le HTML', async () => {
    const fetchMock = vi.fn(async () => okResponse('<html>ok</html>'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchLiveFFN('92968')).resolves.toBe('<html>ok</html>');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/liveffn-proxy?competition=92968&structure=39`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer jwt-123', apikey: SUPABASE_PUBLISHABLE_KEY });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, FETCH_ERRORS.session], [403, FETCH_ERRORS.activation], [400, FETCH_ERRORS.invalid],
    [502, FETCH_ERRORS.down], [504, FETCH_ERRORS.down], [500, FETCH_ERRORS.down],
  ])('statut %i → « %s »', async (status, message) => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status, text: async () => '{}' }));
    await expect(fetchLiveFFN('92968')).rejects.toThrow(message);
  });

  it('réseau coupé → liveffn ne répond pas ; sans session → session expirée (aucun appel)', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(fetchLiveFFN('1')).rejects.toThrow('liveffn ne répond pas, réessaie plus tard');
    session = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchLiveFFN('1')).rejects.toThrow('Session expirée, reconnecte-toi');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('délai dépassé : la requête est interrompue (AbortController)', async () => {
    vi.stubGlobal('fetch', (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(fetchLiveFFN('1', { timeoutMs: 10 })).rejects.toThrow(FETCH_ERRORS.down);
  });
});

describe('importCompetition', () => {
  it('aperçu : 7 perfs pour 2 nageurs, Hugo (archivé) ignoré ; texte de l\'aperçu', async () => {
    vi.stubGlobal('fetch', async () => okResponse(FIXTURE));
    const preview = await importCompetition('92968');
    expect(preview.perfCount).toBe(7);
    expect(preview.matches.map((m) => m.swimmer.id)).toEqual(['leo', 'me']);
    expect(preview.ignoredArchived.map((s) => s.id)).toEqual(['hugo']);
    expect(db.performances.size).toBe(0); // rien d'enregistré avant confirmation
    const text = new DOMParser().parseFromString(importPreviewHtml(preview), 'text/html').body.textContent;
    expect(text).toContain('7 perfs, 📦 1 archivé ignoré');
    expect(text).toContain('📦 1 nageur archivé ignoré : Hugo Petit');
    expect(text).toContain("Meeting Régional d'Hiver");
    expect(text).toContain('Bassin 25m');
  });

  it('confirmation : lignes complètes, une écriture par perf ; un 2e import ne crée pas de doublon', async () => {
    vi.stubGlobal('fetch', async () => okResponse(FIXTURE));
    const first = await importCompetition('92968');
    expect(first.confirm()).toBe(7);
    expect(db.performances.size).toBe(7);
    const row = [...db.performances.values()].find((p) => p.swimmer_id === 'leo' && p.event_code === '52');
    expect(row).toMatchObject({
      team_id: TEAM, competition_id: '92968', competition_name: "Meeting Régional d'Hiver", competition_date: '2026-11-15',
      pool: '25m', event_label: '100 Nage Libre Messieurs - Séries', distance: 100, stroke: 'nl', phase: 'series',
      time_ms: 65320, time_display: '01:05.32', rank: 1, points: 812, status: 'ok', source: 'liveffn',
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.splits).toHaveLength(2);
    const ids = [...db.performances.keys()].sort();
    const second = await importCompetition('92968');
    second.confirm();
    expect(db.performances.size).toBe(7);
    expect([...db.performances.keys()].sort()).toEqual(ids); // ids locaux gardés
    const outbox = teamStore('A', TEAM).get('outbox') ?? [];
    expect(outbox.filter((o) => o.table === 'performances' && o.kind === 'upsert')).toHaveLength(14);
  });

  it('page sans nageur : erreur claire', async () => {
    vi.stubGlobal('fetch', async () => okResponse('<html><div class="titre">Vide - 25 m</div></html>'));
    await expect(importCompetition('1')).rejects.toThrow('Aucun nageur TOAC trouvé pour cette compétition');
  });

  it('dernier garde-fou : un nageur devenu inéligible n\'est pas écrit', async () => {
    vi.stubGlobal('fetch', async () => okResponse(FIXTURE));
    const preview = await importCompetition('92968');
    preview.matches[1].swimmer = { ...preview.matches[1].swimmer, left_season: 2025 };
    expect(buildPerfRows(preview).every((r) => r.swimmer_id === 'leo')).toBe(true);
  });
});

describe('calculs de la fiche', () => {
  it('meilleurs temps par épreuve × bassin ; progression', () => {
    const p = (id, code, pool, ms, date, status = 'ok') => ({ id, swimmer_id: 'leo', event_code: code, pool, time_ms: ms, time_display: String(ms), competition_date: date, status });
    const list = [p('a', '51', '25m', 29000, '2026-10-01'), p('b', '51', '25m', 28450, '2026-11-15'), p('c', '51', '50m', 30000, '2026-06-01'), p('d', '52', '25m', null, '2026-11-15', 'dsq')];
    expect(bestTimes(list).map((x) => x.id)).toEqual(['b', 'c']);
    expect(progressionInfo([list[0], list[1]])).toBe('2 chronos — Progression : -0.55s 🔥');
    expect(progressionInfo([list[1], list[0]])).toBe('2 chronos — Régression : +0.55s');
    expect(progressionInfo([list[0]])).toContain('Un seul chrono');
    expect(progressionInfo([])).toBe('Aucune donnée');
  });
});

describe('bilanPdfHtml', () => {
  it('fiche Club : nom, meilleur temps, points ; données échappées ; sans script ni Google Fonts', async () => {
    upsertLocal('swimmers', sw('x', '<img src=x onerror=alert(1)>', 'Durand', 2024));
    vi.stubGlobal('fetch', async () => okResponse(FIXTURE));
    (await importCompetition('92968')).confirm();
    upsertLocal('performances', { id: 'p-x', swimmer_id: 'x', competition_id: '1', competition_name: '<script>alert(1)</script>', competition_date: '2026-10-10', pool: '25m', event_code: '1', phase: 'series', time_ms: 31000, time_display: '00:31.00', status: 'ok', points: 600 });
    const doc = bilanPdfHtml('leo', { teamName: 'TOAC Natation', now: new Date(2026, 10, 20) });
    expect(doc).toContain('Léo Martin');
    expect(doc).toContain('00:28.45'); // meilleur 50 NL 25 m
    expect(doc).toContain('RECORDS PERSO');
    expect(doc).toContain('Points saison 2026–27');
    expect(doc).toContain('id="pdf-print"');
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toContain('fonts.googleapis.com');
    const evil = bilanPdfHtml('x', { now: new Date(2026, 10, 20) });
    expect(evil).not.toMatch(/<script/i);
    expect(evil).not.toContain('<img src=x');
    expect(evil).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(bilanPdfHtml('inconnu')).toBeNull();
  });
});
