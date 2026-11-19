import { dateKey, todayKey, monthKey, ageOn } from '../../src/core/dates.js';

test('dateKey complète les zéros (mois à partir de 0)', () => {
  expect(dateKey(2026, 0, 5)).toBe('2026-01-05');
  expect(dateKey(2026, 11, 31)).toBe('2026-12-31');
});

test("todayKey suit la date locale (Europe/Paris), jamais l'UTC", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Paris');
  expect(todayKey(new Date('2026-11-19T23:30:00Z'))).toBe('2026-11-20');
  expect(todayKey(new Date('2026-11-19T10:00:00Z'))).toBe('2026-11-19');
});

test('monthKey garde AAAA-MM', () => {
  expect(monthKey('2026-11-20')).toBe('2026-11');
});

test("ageOn calcule l'âge révolu", () => {
  expect(ageOn('2014-11-20', '2026-11-19')).toBe(11);
  expect(ageOn('2014-11-19', '2026-11-19')).toBe(12);
  expect(ageOn('', '2026-11-19')).toBeNull();
});
