// Suppression de compte (JS pur). L'utilisateur est identifié uniquement par son jeton.
// Ordre : photos des espaces dont il est le seul membre → ces espaces → le compte auth.
// Les adhésions aux espaces partagés partent en cascade ; leurs données restent.
import { bearerToken, jsonResponse, preflightResponse } from './cors.js';
import { soleMemberTeams } from './teams.js';

export const PHOTOS_BUCKET = 'photos';
export const LIST_PAGE = 100;

/**
 * Chemins de tous les fichiers sous `prefix` (récursif, list paginé).
 * Les dossiers sont les entrées sans id.
 */
export async function listAllObjects(storage, prefix, page = LIST_PAGE) {
  const files = [];
  const folders = [prefix];
  while (folders.length) {
    const dir = folders.shift();
    for (let offset = 0; ; offset += page) {
      const { data, error } = await storage.from(PHOTOS_BUCKET).list(dir, { limit: page, offset });
      if (error) throw new Error(`list ${dir}: ${error.message}`);
      for (const e of data || []) {
        const path = `${dir}/${e.name}`;
        if (e.id == null) folders.push(path);
        else files.push(path);
      }
      if (!data || data.length < page) break;
    }
  }
  return files;
}

/**
 * @param {Request} request
 * @param {{ adminClient: any, page?: number }} deps client avec la clé serveur (hors dépôt)
 * @returns {Promise<Response>}
 */
export async function handleDeleteAccount(request, deps) {
  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (request.method !== 'POST') return jsonResponse(request, 405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  if (!token) return jsonResponse(request, 401, { error: 'unauthorized' });
  const admin = deps.adminClient;
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (userError || !uid) return jsonResponse(request, 401, { error: 'unauthorized' });

  try {
    const mine = await admin.from('team_members').select('team_id').eq('coach_id', uid);
    if (mine.error) throw new Error(`team_members: ${mine.error.message}`);
    const teamIds = [...new Set((mine.data || []).map((r) => r.team_id))];

    let sole = [];
    if (teamIds.length) {
      const all = await admin.from('team_members').select('team_id, coach_id').in('team_id', teamIds);
      if (all.error) throw new Error(`team_members: ${all.error.message}`);
      sole = soleMemberTeams(all.data, uid);
    }

    for (const teamId of sole) {
      const paths = await listAllObjects(admin.storage, teamId, deps.page ?? LIST_PAGE);
      for (let i = 0; i < paths.length; i += LIST_PAGE) {
        const { error } = await admin.storage.from(PHOTOS_BUCKET).remove(paths.slice(i, i + LIST_PAGE));
        if (error) throw new Error(`remove: ${error.message}`);
      }
    }

    if (sole.length) {
      const del = await admin.from('teams').delete().in('id', sole);
      if (del.error) throw new Error(`teams: ${del.error.message}`);
    }

    const { error: delUserError } = await admin.auth.admin.deleteUser(uid);
    if (delUserError) throw new Error(`deleteUser: ${delUserError.message}`);

    return jsonResponse(request, 200, { ok: true, deletedTeams: sole.length });
  } catch (e) {
    console.error('delete-account', e?.message || e);
    return jsonResponse(request, 500, { error: 'delete_failed' });
  }
}
