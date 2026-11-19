/** Dates en clé `AAAA-MM-JJ`, toujours en heure locale (jamais toISOString, qui passe en UTC). */

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {number} y année
 * @param {number} m0 mois à partir de 0
 * @param {number} d jour du mois
 * @returns {string} 'AAAA-MM-JJ'
 */
export function dateKey(y, m0, d) {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}

/** @param {Date} [now] @returns {string} date locale du jour */
export function todayKey(now = new Date()) {
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/** @param {string} key 'AAAA-MM-JJ' @returns {string} 'AAAA-MM' */
export function monthKey(key) {
  return key.slice(0, 7);
}

/**
 * Âge révolu à une date.
 * @param {string} dob 'AAAA-MM-JJ'
 * @param {string} [on] clé de la date de référence (par défaut aujourd'hui)
 * @returns {number|null} null si la date de naissance est vide ou invalide
 */
export function ageOn(dob, on = todayKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob ?? '')) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
