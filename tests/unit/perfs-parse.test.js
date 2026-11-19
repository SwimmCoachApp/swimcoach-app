import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeName as coreNormalizeName } from '../../src/core/names.js';
import { FFN_EVENTS, parseLiveFFNHTML, normalizeName, matchSwimmersToDB, extractCompetitionId, timeToMs, shortEventLabel } from '../../src/features/perfs/parse.js';

const FIXTURE = readFileSync(resolve(process.cwd(), 'tests/fixtures/liveffn-sample.html'), 'utf8');

describe('parseLiveFFNHTML (page synthétique, valeurs relevées à la main)', () => {
  const parsed = parseLiveFFNHTML(FIXTURE);

  it('compétition : nom sans bassin, bassin, date (1re date jour-mois-année trouvée), structure', () => {
    expect(parsed.competition).toEqual({ name: "Meeting Régional d'Hiver", date: '2026-11-15', pool: '25', structName: 'TOAC NATATION' });
  });

  it('nageurs : nom simple, nom composé (repli), ligne de perf avant tout nageur ignorée', () => {
    expect(parsed.swimmers.map((s) => [s.lastname, s.firstname, s.birthYear])).toEqual([
      ['MARTIN', 'Léo', 2012],
      ['DE LA FONTAINE', 'Marie-Ève', 2011],
      ['PETIT', 'Hugo', 2010],
      ['DURAND', 'Camille', 2013],
    ]);
  });

  it('perfs de MARTIN Léo : séries avec temps de passage, finale A, séries, DSQ', () => {
    const [a, b, c, d] = parsed.swimmers[0].performances;
    expect(parsed.swimmers[0].performances).toHaveLength(4);
    expect(a).toEqual({
      event_code: 52, event_label: '100 Nage Libre Messieurs - Séries', phase: 'series',
      time_display: '01:05.32', time_ms: 65320, rank: 1, points: 812, status: 'ok',
      splits: [
        { dist: 50, split_ms: 31100, split_display: '00:31.10', lap_display: '00:31.10' },
        { dist: 100, split_ms: 65320, split_display: '01:05.32', lap_display: '00:34.22' },
      ],
    });
    expect(b).toMatchObject({ event_code: 51, phase: 'finale_a', time_display: '00:28.45', time_ms: 28450, rank: 3, points: 745, status: 'ok', splits: null });
    expect(c).toMatchObject({ event_code: 51, phase: 'series', time_display: '00:28.90', time_ms: 28900, rank: 12, points: 720, status: 'ok' });
    expect(d).toMatchObject({ event_code: 62, phase: 'series', time_display: 'DSQ', time_ms: null, rank: null, points: null, status: 'dsq', splits: null });
  });

  it('perfs de DE LA FONTAINE Marie-Ève : finale B à 4 passages, points hors colonne (repli), DNS', () => {
    const [a, b, c] = parsed.swimmers[1].performances;
    expect(parsed.swimmers[1].performances).toHaveLength(3);
    expect(a).toMatchObject({ event_code: 41, phase: 'finale_b', time_display: '02:41.07', time_ms: 161070, rank: 2, points: 598, status: 'ok' });
    expect(a.splits.map((s) => [s.dist, s.split_ms, s.lap_display])).toEqual([[50, 35800, '00:35.80'], [100, 77420, '00:41.62'], [150, 124900, '00:47.48'], [200, 161070, '00:36.17']]);
    expect(b).toMatchObject({ event_code: 22, phase: 'series', time_display: '01:22.04', time_ms: 82040, rank: 5, points: 654, status: 'ok' });
    expect(c).toMatchObject({ event_code: 23, time_display: 'DNS', time_ms: null, status: 'dns', rank: null, points: null });
  });

  it('PETIT Hugo : DNF en finale ; relais, ligne sans lien et ligne trop courte ignorés', () => {
    expect(parsed.swimmers[2].performances).toEqual([
      { event_code: 55, event_label: '800 Nage Libre Messieurs - Finale', phase: 'finale', time_display: 'DNF', time_ms: null, rank: null, points: null, status: 'dnf', splits: null },
    ]);
    expect(FFN_EVENTS[101]).toBeUndefined();
  });

  it('page sans tableau : compétition seule, aucun nageur', () => {
    const out = parseLiveFFNHTML('<div class="titre">Open - 50 m</div><div class="date">Samedi 4 Avril 2026</div>');
    expect(out).toEqual({ competition: { name: 'Open', date: '2026-04-04', pool: '50', structName: '' }, swimmers: [] });
  });
});

describe('outils de parsing', () => {
  it('timeToMs : ss.cc, mm:ss.cc, h:mm:ss.cc, millièmes ; null si illisible', () => {
    expect(timeToMs('43.64')).toBe(43640);
    expect(timeToMs('01:23.58')).toBe(83580);
    expect(timeToMs('2:31.84')).toBe(151840);
    expect(timeToMs('00:16:45.20')).toBe(1005200);
    expect(timeToMs('31.105')).toBe(31105);
    expect(timeToMs('DSQ')).toBeNull();
    expect(timeToMs(null)).toBeNull();
  });

  it('normalizeName : la même que core/names.js (club4 identique)', () => {
    expect(normalizeName).toBe(coreNormalizeName);
    expect(normalizeName('De La Fontaine')).toBe('DELAFONTAINE');
    expect(normalizeName('Marie-Ève')).toBe('MARIEEVE');
  });

  it('shortEventLabel', () => {
    expect(shortEventLabel(52)).toBe('100 Nage libre');
    expect(shortEventLabel('41')).toBe('200 4 Nages');
    expect(shortEventLabel(999)).toBe('Épreuve #999');
  });

  it('extractCompetitionId : URL liveffn, ID seul, texte avec un nombre ; null sinon', () => {
    expect(extractCompetitionId('https://www.liveffn.com/cgi-bin/resultats.php?competition=92968&langue=fra&go=detail&action=structure&structure=39')).toBe('92968');
    expect(extractCompetitionId(' 92968 ')).toBe('92968');
    expect(extractCompetitionId('compétition numéro 81234 du site')).toBe('81234');
    expect(extractCompetitionId('liveffn')).toBeNull();
    expect(extractCompetitionId('')).toBeNull();
  });
});

describe('matchSwimmersToDB', () => {
  const parsed = parseLiveFFNHTML(FIXTURE);
  const sw = (id, firstname, lastname, joined, left = null) => ({ id, firstname, lastname, joined_season: joined, left_season: left });
  const NOW = new Date(2026, 10, 20);

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
  afterEach(() => vi.useRealTimers());

  it('« MARTIN Léo » trouve Léo Martin ; nom composé ; archivé ignoré pour une compétition de la saison en cours', () => {
    const swimmers = [
      sw('leo', 'Léo', 'Martin', 2024),
      sw('me', 'Marie-Ève', 'De La Fontaine', 2025),
      sw('hugo', 'Hugo', 'Petit', 2023, 2025),
    ];
    const { matched, unmatched, ignoredArchived } = matchSwimmersToDB(parsed.swimmers, parsed.competition.date, swimmers);
    expect(matched.map((m) => [m.swimmer.id, m.perfs.length])).toEqual([['leo', 4], ['me', 3]]);
    expect(matched[0].parsed.lastname).toBe('MARTIN');
    expect(ignoredArchived.map((s) => s.id)).toEqual(['hugo']);
    expect(unmatched.map((p) => p.lastname)).toEqual(['DURAND']);
  });

  it('prénom et nom saisis à l\'envers dans le groupe : trouvé quand même', () => {
    const { matched } = matchSwimmersToDB(parsed.swimmers, '2026-11-15', [sw('inv', 'Martin', 'Léo', 2024)]);
    expect(matched.map((m) => m.swimmer.id)).toEqual(['inv']);
  });

  it('compétition d\'une saison passée : l\'archivé de cette saison-là reçoit ses perfs', () => {
    const { matched, ignoredArchived } = matchSwimmersToDB(parsed.swimmers, '2025-03-10', [sw('hugo', 'Hugo', 'Petit', 2023, 2025)]);
    expect(matched.map((m) => m.swimmer.id)).toEqual(['hugo']);
    expect(ignoredArchived).toEqual([]);
  });

  it('un homonyme archivé ne prend jamais la place du nageur actif', () => {
    const { matched, ignoredArchived } = matchSwimmersToDB(parsed.swimmers, '2026-11-15', [sw('active', 'Léo', 'Martin', 2026), sw('old', 'Léo', 'Martin', 2020, 2022)]);
    expect(matched.map((m) => m.swimmer.id)).toEqual(['active']);
    expect(ignoredArchived).toEqual([]);
  });

  it('sans date de compétition : saison en cours', () => {
    const { matched, ignoredArchived } = matchSwimmersToDB(parsed.swimmers, null, [sw('hugo', 'Hugo', 'Petit', 2023, 2025)]);
    expect(matched).toEqual([]);
    expect(ignoredArchived.map((s) => s.id)).toEqual(['hugo']);
  });
});
