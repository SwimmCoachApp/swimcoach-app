/** Saisons sportives : la saison N court du 1er septembre N au 31 août N+1 (reprise de club4). */

/**
 * @param {string} key 'AAAA-MM-JJ'
 * @returns {number} année de début de la saison
 */
export function seasonOfDateKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m >= 9 ? y : y - 1;
}

/** @param {Date} [now] @returns {number} année de début de la saison en cours */
export function currentSeason(now = new Date()) {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

/** @param {{left_season?: number|null}} sw @returns {boolean} true tant qu'il n'a pas de dernière saison */
export function swimmerIsActive(sw) {
  return sw.left_season == null;
}

/**
 * Le nageur fait-il partie du groupe pendant la saison S ?
 * @param {{joined_season?: number|null, left_season?: number|null}} sw
 * @param {number} S
 */
export function swimmerInSeason(sw, S) {
  const joined = sw.joined_season;
  if (joined == null || joined > S) return false;
  if (swimmerIsActive(sw)) return true;
  return sw.left_season >= S;
}

/**
 * Un nageur peut-il recevoir des perfs d'une compétition de la saison compSeason ?
 * Saison en cours ou future : actifs seulement ; saison passée : ceux qui étaient là cette saison-là.
 * @param {object} sw
 * @param {number} compSeason
 * @param {Date} [now]
 */
export function swimmerEligibleForComp(sw, compSeason, now = new Date()) {
  if (compSeason >= currentSeason(now)) {
    return swimmerIsActive(sw) && (sw.joined_season == null || sw.joined_season <= compSeason);
  }
  return swimmerInSeason(sw, compSeason);
}
