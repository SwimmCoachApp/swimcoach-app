/**
 * Performances : récupération liveffn (proxy), import d'une compétition, calculs de la fiche (club4 5278–6575).
 * Tout vient du store ; les écritures passent par core/data.js.
 */
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, LIVEFFN_STRUCTURE_ID } from '../../core/config.js';
import { supabase } from '../../core/supabase.js';
import { db, getContext, isOpen } from '../../core/store.js';
import { saveRow } from '../../core/data.js';
import { currentSeason, seasonOfDateKey, swimmerEligibleForComp } from '../../core/season.js';
import { FFN_EVENTS, parseLiveFFNHTML, matchSwimmersToDB } from './parse.js';

/** Délai maximal d'une récupération liveffn. */
export const FETCH_TIMEOUT_MS = 15000;

/** Messages d'erreur de la récupération. */
export const FETCH_ERRORS = {
  session: 'Session expirée, reconnecte-toi',
  activation: 'Compte non activé',
  invalid: 'Identifiant de compétition invalide',
  down: 'liveffn ne répond pas, réessaie plus tard',
};

/** Erreur dont le message peut être montré tel quel. */
export class PerfsError extends Error {}

const statusMessage = (status) => (status === 401 ? FETCH_ERRORS.session : status === 403 ? FETCH_ERRORS.activation : status === 400 ? FETCH_ERRORS.invalid : FETCH_ERRORS.down);

/**
 * Page liveffn « résultats par structure » d'une compétition, via la fonction liveffn-proxy (JWT de l'entraîneur).
 * @param {string} competitionId
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<string>} HTML
 * @throws {PerfsError} message en français (FETCH_ERRORS)
 */
export async function fetchLiveFFN(competitionId, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token ?? null;
  } catch {
    token = null;
  }
  if (!token) throw new PerfsError(FETCH_ERRORS.session);
  const url = `${SUPABASE_URL}/functions/v1/liveffn-proxy?competition=${encodeURIComponent(competitionId)}&structure=${LIVEFFN_STRUCTURE_ID}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY }, signal: ctrl.signal });
    if (!res.ok) throw new PerfsError(statusMessage(res.status));
    return await res.text();
  } catch (e) {
    if (e instanceof PerfsError) throw e;
    throw new PerfsError(FETCH_ERRORS.down); // réseau coupé, délai dépassé, passerelle injoignable
  } finally {
    clearTimeout(timer);
  }
}

/** Clé d'unicité d'une perf (contrainte de la table). */
const perfKey = (p) => `${p.swimmer_id}|${p.competition_id}|${p.event_code}|${p.phase ?? ''}`;

/**
 * Lignes `performances` à enregistrer pour un aperçu (club4 confirmImportComp). Une perf déjà connue
 * localement garde son id ; sinon un id neuf (le serveur rapproche par la clé d'unicité).
 * @param {{competitionId: string, parsed: object, matches: object[]}} preview
 * @returns {object[]}
 */
export function buildPerfRows(preview) {
  const comp = preview.parsed.competition;
  const compId = preview.competitionId;
  const compSeason = comp.date ? seasonOfDateKey(comp.date) : currentSeason();
  const known = new Map([...db.performances.values()].map((p) => [perfKey(p), p.id]));
  const rows = [];
  for (const m of preview.matches) {
    // Dernier garde-fou : jamais de perfs pour un nageur archivé / hors saison de la compétition
    if (!swimmerEligibleForComp(m.swimmer, compSeason)) continue;
    for (const p of m.perfs) {
      const evInfo = FFN_EVENTS[p.event_code];
      const row = {
        swimmer_id: m.swimmer.id,
        competition_id: compId,
        competition_name: comp.name,
        competition_date: comp.date,
        pool: comp.pool ? `${comp.pool}m` : null,
        event_code: String(p.event_code),
        event_label: p.event_label,
        distance: evInfo ? evInfo.d : null,
        stroke: evInfo ? evInfo.s : null,
        phase: p.phase,
        time_ms: p.time_ms,
        time_display: p.time_display,
        rank: p.rank,
        points: p.points,
        status: p.status,
        splits: p.splits,
        source: 'liveffn',
      };
      rows.push({ id: known.get(perfKey(row)) ?? crypto.randomUUID(), ...row });
    }
  }
  return rows;
}

/**
 * Récupère et lit une compétition, puis la rapproche des nageurs de l'espace : c'est l'aperçu.
 * `confirm()` enregistre les perfs (une écriture par perf, upsert sur la clé d'unicité).
 * @param {string} compId
 * @returns {Promise<{competitionId: string, parsed: object, matches: object[], ignoredArchived: object[], unmatched: object[], perfCount: number, confirm: () => number}>}
 * @throws {PerfsError}
 */
export async function importCompetition(compId) {
  const ctx = getContext();
  const html = await fetchLiveFFN(compId);
  if (!isOpen(ctx)) throw new PerfsError("L'espace a changé pendant la recherche");
  const parsed = parseLiveFFNHTML(html);
  if (!parsed.swimmers || parsed.swimmers.length === 0) throw new PerfsError('Aucun nageur TOAC trouvé pour cette compétition');
  const { matched, unmatched, ignoredArchived } = matchSwimmersToDB(parsed.swimmers, parsed.competition.date, [...db.swimmers.values()]);
  const preview = { competitionId: String(compId), parsed, matches: matched, ignoredArchived, unmatched, perfCount: 0 };
  preview.perfCount = buildPerfRows(preview).length;
  preview.confirm = () => {
    if (!isOpen(ctx)) throw new PerfsError("L'espace a changé : relance l'import");
    const rows = buildPerfRows(preview);
    for (const row of rows) saveRow('performances', row);
    return rows.length;
  };
  return preview;
}

// ── Lecture ──────────────────────────────────────────────────────────

/** @param {string} swimmerId @returns {object[]} perfs du nageur */
export function perfsOf(swimmerId) {
  return [...db.performances.values()].filter((p) => p.swimmer_id === swimmerId);
}

/** @param {Date} [now] @returns {{start: string, end: string, label: string, year: number}} saison sportive en cours */
export function seasonRange(now = new Date()) {
  const sy = currentSeason(now);
  return { start: `${sy}-09-01`, end: `${sy + 1}-08-31`, label: `${sy}–${String(sy + 1).slice(2)}`, year: sy };
}

const inSeason = (p, s) => p.status === 'ok' && p.competition_date && p.competition_date >= s.start && p.competition_date <= s.end;

/** Points de la saison (perfs chronométrées). */
export function swimmerSeasonPoints(swimmerId, season = seasonRange()) {
  return perfsOf(swimmerId).filter((p) => inSeason(p, season) && p.points).reduce((sum, p) => sum + (parseInt(p.points, 10) || 0), 0);
}

/** Courses chronométrées de la saison. */
export function swimmerSeasonRaces(swimmerId, season = seasonRange()) {
  return perfsOf(swimmerId).filter((p) => inSeason(p, season)).length;
}

/** Comparaison épreuve puis bassin. */
export const byEventPool = (a, b) => (Number(a.event_code) - Number(b.event_code)) || (a.pool || '').localeCompare(b.pool || '');

/**
 * Meilleur temps par épreuve × bassin, perfs chronométrées seulement.
 * @param {object[]} perfs
 * @returns {object[]} triés par épreuve puis bassin
 */
export function bestTimes(perfs) {
  const best = {};
  for (const p of perfs) {
    if (p.status !== 'ok' || p.time_ms == null) continue;
    const k = `${p.event_code}_${p.pool || '?'}`;
    if (!best[k] || p.time_ms < best[k].time_ms) best[k] = p;
  }
  return Object.values(best).sort(byEventPool);
}

/** Plus récentes d'abord. */
export const byDateDesc = (a, b) => (b.competition_date || '').localeCompare(a.competition_date || '');

/**
 * Perfs chronométrées d'une épreuve (et d'un bassin), de la plus ancienne à la plus récente.
 * @param {string} swimmerId
 * @param {string|number} evCode
 * @param {string} pool '25m', '50m' ou '' (tous)
 */
export function progressionSeries(swimmerId, evCode, pool) {
  return perfsOf(swimmerId)
    .filter((p) => String(p.event_code) === String(evCode) && p.status === 'ok' && p.time_ms != null && (!pool || p.pool === pool))
    .sort((a, b) => (a.competition_date || '').localeCompare(b.competition_date || '') || phaseRank(a.phase) - phaseRank(b.phase));
}

/** Ordre des courses d'une même journée (séries le matin, finales le soir) : graphique stable, quel que soit l'ordre du store. */
const PHASE_ORDER = ['series', 'demi', 'finale_b', 'finale_a', 'finale'];
const phaseRank = (phase) => {
  const i = PHASE_ORDER.indexOf(phase);
  return i < 0 ? PHASE_ORDER.length : i;
};

/** Écart de temps « -2.34s » / « +1min05s » (club4 formatDiff). */
export function formatDiff(ms) {
  const absMs = Math.abs(ms);
  if (absMs >= 60000) {
    const totalSec = Math.floor(absMs / 1000);
    const mn = Math.floor(totalSec / 60);
    const sec = totalSec - mn * 60;
    return `${ms < 0 ? '-' : '+'}${mn}min${String(sec).padStart(2, '0')}s`;
  }
  return `${ms < 0 ? '-' : '+'}${(absMs / 1000).toFixed(2)}s`;
}

/** Texte sous le graphique (club4 openChartModal). */
export function progressionInfo(series) {
  if (series.length === 0) return 'Aucune donnée';
  if (series.length === 1) return `Un seul chrono : ${series[0].time_display} — importez d'autres compétitions pour voir l'évolution`;
  const diff = series[series.length - 1].time_ms - series[0].time_ms;
  const label = diff < 0 ? `Progression : ${formatDiff(diff)} 🔥` : diff > 0 ? `Régression : ${formatDiff(diff)}` : 'Stable';
  return `${series.length} chronos — ${label}`;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** 'AAAA-MM-JJ' → « 14 novembre 2026 » ('' si vide). */
export function formatDateFR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MOIS[parseInt(m, 10) - 1]} ${y}`;
}
