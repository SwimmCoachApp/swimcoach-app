// Espaces dont un entraîneur est le seul membre (JS pur, testé par Vitest).

/**
 * @param {{team_id:string, coach_id:string}[]} memberships adhésions des espaces concernés
 * @param {string} uid
 * @returns {string[]} identifiants des espaces où uid est l'unique membre
 */
export function soleMemberTeams(memberships, uid) {
  const byTeam = new Map();
  for (const m of memberships || []) {
    if (!byTeam.has(m.team_id)) byTeam.set(m.team_id, new Set());
    byTeam.get(m.team_id).add(m.coach_id);
  }
  const out = [];
  for (const [teamId, coaches] of byTeam) {
    if (coaches.size === 1 && coaches.has(uid)) out.push(teamId);
  }
  return out;
}
