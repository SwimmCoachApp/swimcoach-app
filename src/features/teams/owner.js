/**
 * Propriétaire d'un groupe : son créateur (teams.created_by), tant qu'il en est membre.
 *
 * Même règle que le serveur (migration owner_only_delete_team) : seul le propriétaire supprime le groupe,
 * et il ne peut être retiré que par lui-même. Sans propriétaire membre (il est parti, ou son compte a été
 * supprimé), tout membre peut supprimer le groupe : il ne reste jamais bloqué.
 * Le serveur reste juge ; ces fonctions servent seulement à n'afficher que ce qui est permis.
 */

/**
 * @param {{ownerId: string|null, members: {id: string}[]}|null} data membres chargés du groupe
 * @returns {string|null} identifiant du propriétaire, ou null s'il n'est plus membre (ou inconnu)
 */
export function ownerOf(data) {
  if (!data?.ownerId) return null;
  return data.members.some((m) => m.id === data.ownerId) ? data.ownerId : null;
}

/**
 * @param {{ownerId: string|null, members: {id: string}[]}|null} data
 * @param {string} meId entraîneur connecté
 * @returns {boolean} vrai si le groupe a un propriétaire membre autre que moi (je ne peux pas le supprimer)
 */
export function deletionBlocked(data, meId) {
  const owner = ownerOf(data);
  return owner !== null && owner !== meId;
}

/**
 * @param {{ownerId: string|null, members: {id: string}[]}|null} data
 * @param {string} memberId membre qu'on voudrait retirer
 * @param {string} meId entraîneur connecté
 * @returns {boolean} vrai si ce membre est le propriétaire et que je ne suis pas lui
 */
export function ownerMayNotBeRemoved(data, memberId, meId) {
  return ownerOf(data) === memberId && memberId !== meId;
}
