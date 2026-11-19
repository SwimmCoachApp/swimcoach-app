/**
 * Statistiques d'un mois ou d'une saison (règles de club4) : calcul pur sur le store de l'espace ouvert.
 *
 * `other` compte comme natation, `comp` est une catégorie à part, `musc` aussi ; seuls les km de natation
 * comptent. Un nageur apparaît s'il fait partie du groupe pendant la saison de la période (archivés compris).
 */
import { db } from '../../core/store.js';
import { dateKey } from '../../core/dates.js';
import { seasonOfDateKey, swimmerInSeason, currentSeason } from '../../core/season.js';
import { monthName } from '../calendar/logic.js';

const km = (s) => parseFloat(s.km) || 0;
const byName = (a, b) => (a.lastname || '').localeCompare(b.lastname || '', 'fr') || (a.firstname || '').localeCompare(b.firstname || '', 'fr');
const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** @param {'nat'|'musc'|'comp'|string} type @returns {'nat'|'musc'|'comp'} catégorie de club4 */
export function categoryOf(type) {
  return type === 'musc' ? 'musc' : type === 'comp' ? 'comp' : 'nat';
}

/** @param {{scope: 'month'|'season', y: number, m0?: number}} p @returns {number} année de début de la saison de la période */
export function seasonOfPeriod({ scope, y, m0 }) {
  return scope === 'season' ? y : m0 >= 8 ? y : y - 1;
}

/** @param {{scope: 'month'|'season', y: number, m0?: number}} p @returns {string} « Novembre 2026 » ou « Saison 2026–27 » */
export function periodLabel({ scope, y, m0 }) {
  return scope === 'season' ? `Saison ${y}–${String(y + 1).slice(2)}` : `${monthName(m0)} ${y}`;
}

/** @param {{scope: string, y: number, m0?: number}} p @returns {{scope: string, y: number, m0?: number}} période précédente */
export function shiftPeriod(p, delta) {
  if (p.scope === 'season') return { scope: 'season', y: p.y + delta };
  const idx = p.y * 12 + p.m0 + delta;
  return { scope: 'month', y: Math.floor(idx / 12), m0: ((idx % 12) + 12) % 12 };
}

/** @param {Date} [now] @returns {{scope: 'month', y: number, m0: number}} le mois en cours */
export function currentMonth(now = new Date()) {
  return { scope: 'month', y: now.getFullYear(), m0: now.getMonth() };
}

/** @param {Date} [now] */
export function currentSeasonPeriod(now = new Date()) {
  return { scope: 'season', y: currentSeason(now) };
}

function inPeriod(date, { scope, y, m0 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return false;
  return scope === 'season' ? seasonOfDateKey(date) === y : date.startsWith(dateKey(y, m0, 1).slice(0, 7));
}

/**
 * @param {{scope: 'month'|'season', y: number, m0?: number}} period y : année du mois, ou année de début de saison
 * @returns {{sessions: {nat: number, musc: number, comp: number}, km: number,
 *   perSwimmer: Array<{swimmer: object, natPres: number, muscPres: number, compPres: number, natPct: number, muscPct: number, compPct: number, natKm: number}>}}
 */
export function computeStats(period) {
  const sessions = [...db.sessions.values()].filter((s) => inPeriod(s.date, period));
  const groups = { nat: [], musc: [], comp: [] };
  for (const s of sessions) groups[categoryOf(s.type)].push(s);
  const total = groups.nat.reduce((sum, s) => sum + km(s), 0);

  const season = seasonOfPeriod(period);
  const attended = (list, id) => list.filter((s) => db.presence.has(`${s.id}:${id}`));
  const perSwimmer = [...db.swimmers.values()]
    .filter((sw) => swimmerInSeason(sw, season))
    .sort(byName)
    .map((swimmer) => {
      const nat = attended(groups.nat, swimmer.id);
      const natPres = nat.length;
      const muscPres = attended(groups.musc, swimmer.id).length;
      const compPres = attended(groups.comp, swimmer.id).length;
      return {
        swimmer,
        natPres,
        muscPres,
        compPres,
        natPct: pct(natPres, groups.nat.length),
        muscPct: pct(muscPres, groups.musc.length),
        compPct: pct(compPres, groups.comp.length),
        natKm: nat.reduce((sum, s) => sum + km(s), 0),
      };
    })
    .sort((a, b) => b.natPct - a.natPct); // tri stable : à égalité, l'ordre par nom reste

  return {
    period,
    sessions: { nat: groups.nat.length, musc: groups.musc.length, comp: groups.comp.length },
    km: total,
    perSwimmer,
  };
}
