/** Noms de personnes : clé de comparaison sans accents, casse, espaces ni ponctuation (reprise de club4). */

/**
 * @param {unknown} str
 * @returns {string} lettres et chiffres en majuscules sans accents ('' si vide)
 */
export function normalizeName(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}
