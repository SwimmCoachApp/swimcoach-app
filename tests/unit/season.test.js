import { seasonOfDateKey, currentSeason, swimmerIsActive, swimmerInSeason, swimmerEligibleForComp } from '../../src/core/season.js';

test('la saison court du 1er septembre au 31 août', () => {
  expect(seasonOfDateKey('2026-08-31')).toBe(2025);
  expect(seasonOfDateKey('2026-09-01')).toBe(2026);
  expect(seasonOfDateKey('2027-01-15')).toBe(2026);
});

test('currentSeason utilise la date locale', () => {
  expect(currentSeason(new Date(2026, 7, 31))).toBe(2025);
  expect(currentSeason(new Date(2026, 8, 1))).toBe(2026);
  expect(currentSeason(new Date(2026, 10, 19))).toBe(2026);
});

test('swimmerIsActive : actif tant que left_season est vide', () => {
  expect(swimmerIsActive({ left_season: null })).toBe(true);
  expect(swimmerIsActive({})).toBe(true);
  expect(swimmerIsActive({ left_season: 2025 })).toBe(false);
  expect(swimmerIsActive({ left_season: 0 })).toBe(false);
});

test('swimmerInSeason', () => {
  expect(swimmerInSeason({ joined_season: 2024, left_season: 2025 }, 2026)).toBe(false);
  expect(swimmerInSeason({ joined_season: 2024, left_season: 2025 }, 2025)).toBe(true);
  expect(swimmerInSeason({ joined_season: 2024, left_season: null }, 2030)).toBe(true);
  expect(swimmerInSeason({ joined_season: 2026, left_season: null }, 2025)).toBe(false);
  expect(swimmerInSeason({ joined_season: null, left_season: null }, 2025)).toBe(false);
});

test('swimmerEligibleForComp : saison en cours = actifs seulement, saison passée = présents cette saison', () => {
  const now = new Date(2026, 10, 19); // saison 2026
  const archived = { joined_season: 2024, left_season: 2025 };
  const active = { joined_season: 2024, left_season: null };
  expect(swimmerEligibleForComp(archived, 2026, now)).toBe(false);
  expect(swimmerEligibleForComp(active, 2026, now)).toBe(true);
  expect(swimmerEligibleForComp(active, 2027, now)).toBe(true);
  expect(swimmerEligibleForComp({ joined_season: 2027, left_season: null }, 2026, now)).toBe(false);
  expect(swimmerEligibleForComp(archived, 2025, now)).toBe(true);
  expect(swimmerEligibleForComp(archived, 2023, now)).toBe(false);
});
