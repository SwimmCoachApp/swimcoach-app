/** Nageurs et groupes : lectures depuis le store, écritures par core/data.js. */
import { db, deleteLocal } from '../../core/store.js';
import { saveRow, removeRow } from '../../core/data.js';
import { currentSeason, swimmerIsActive } from '../../core/season.js';
import { uploadPhoto, deletePhoto } from '../../core/photos.js';

const uuid = () => crypto.randomUUID();
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Colonnes de `swimmers` écrites par l'app (le reste est posé par le serveur). */
const SWIMMER_COLUMNS = ['id', 'team_id', 'firstname', 'lastname', 'dob', 'group_id', 'phone', 'email', 'photo_path', 'joined_season', 'left_season'];
const swimmerRow = (sw) => Object.fromEntries(SWIMMER_COLUMNS.filter((c) => c in sw).map((c) => [c, sw[c]]));

/** @returns {object[]} groupes de l'espace, dans l'ordre */
export function listGroups() {
  return [...db.groups.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr'));
}

/** @param {object} sw @returns {string} nom du groupe du nageur ('' si aucun) */
export function groupName(sw) {
  return db.groups.get(sw.group_id)?.name ?? '';
}

/** @returns {{actifs: number, archives: number}} */
export function countSwimmers() {
  const all = [...db.swimmers.values()];
  const actifs = all.filter(swimmerIsActive).length;
  return { actifs, archives: all.length - actifs };
}

/**
 * @param {{search?: string, filter?: 'actifs'|'archives'}} [opts]
 * @returns {object[]} nageurs triés par nom puis prénom
 */
export function listSwimmers({ search = '', filter = 'actifs' } = {}) {
  const q = fold(search.trim());
  return [...db.swimmers.values()]
    .filter((sw) => (filter === 'archives' ? !swimmerIsActive(sw) : swimmerIsActive(sw)))
    .filter((sw) => !q || fold(`${sw.firstname} ${sw.lastname}`).includes(q) || fold(groupName(sw)).includes(q))
    .sort((a, b) => (a.lastname || '').localeCompare(b.lastname || '', 'fr') || a.firstname.localeCompare(b.firstname, 'fr'));
}

/**
 * Crée ou modifie un nageur. Une photo qui ne peut pas partir (hors ligne) n'empêche pas l'enregistrement.
 * @param {{id?: string, firstname: string, lastname?: string, dob?: string, group_id?: string|null, phone?: string,
 *   email?: string, photo?: Blob|null, removePhoto?: boolean}} form photo : image jpeg déjà réduite
 * @returns {Promise<{id: string, photoFailed: boolean}>}
 * @throws {Error} 'Prénom requis'
 */
export async function saveSwimmer(form) {
  const firstname = String(form.firstname ?? '').trim();
  if (!firstname) throw new Error('Prénom requis');
  const existing = form.id ? db.swimmers.get(form.id) : null;
  const id = existing?.id ?? form.id ?? uuid();
  let photo_path = existing?.photo_path ?? null;
  let photoFailed = false;
  if (form.photo) {
    try {
      photo_path = await uploadPhoto('swimmers', id, form.photo);
    } catch {
      photoFailed = true;
    }
  } else if (form.removePhoto && photo_path) {
    try {
      await deletePhoto(photo_path);
      photo_path = null;
    } catch {
      photoFailed = true;
    }
  }
  const group = db.groups.has(form.group_id) ? form.group_id : null;
  saveRow('swimmers', swimmerRow({
    ...existing,
    id,
    firstname,
    lastname: String(form.lastname ?? '').trim(),
    dob: form.dob || null,
    group_id: group,
    phone: String(form.phone ?? '').trim() || null,
    email: String(form.email ?? '').trim() || null,
    photo_path,
    joined_season: existing?.joined_season ?? currentSeason(),
    left_season: existing?.left_season ?? null,
  }));
  return { id, photoFailed };
}

/**
 * Archive un nageur : il garde son historique mais quitte les « Actifs ».
 * @param {string} id
 * @param {number} [season] dernière saison faite
 */
export function archiveSwimmer(id, season = currentSeason()) {
  const sw = db.swimmers.get(id);
  if (!sw) return;
  saveRow('swimmers', swimmerRow({ ...sw, left_season: season, joined_season: sw.joined_season ?? season }));
}

/** @param {string} id */
export function restoreSwimmer(id) {
  const sw = db.swimmers.get(id);
  if (!sw) return;
  const curr = currentSeason();
  saveRow('swimmers', swimmerRow({ ...sw, left_season: null, joined_season: sw.joined_season == null || sw.joined_season < curr ? curr : sw.joined_season }));
}

/**
 * Supprime un nageur : sa photo d'abord (jamais d'image d'un mineur orpheline), puis la ligne.
 * Ses présences disparaissent avec lui côté serveur ; on les retire aussi du cache local.
 * @param {string} id
 * @throws {Error} si la photo ne peut pas être supprimée (rien n'est supprimé)
 */
export async function deleteSwimmer(id) {
  const sw = db.swimmers.get(id);
  if (!sw) return;
  if (sw.photo_path) {
    try {
      await deletePhoto(sw.photo_path);
    } catch (e) {
      throw Object.assign(new Error('Photo non supprimée'), { photo: true, network: !navigator.onLine || /fetch|network|failed/i.test(String(e?.message)) });
    }
  }
  removeRow('swimmers', id);
  for (const [key, p] of [...db.presence]) if (p.swimmer_id === id) deleteLocal('presence', key);
}

/**
 * @param {string} name
 * @returns {{ok: true, id: string}|{ok: false, error: string}}
 */
export function addGroup(name) {
  const clean = String(name ?? '').trim();
  if (!clean) return { ok: false, error: 'Nom de groupe requis' };
  const groups = listGroups();
  if (groups.some((g) => g.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: 'Ce groupe existe déjà' };
  const id = uuid();
  saveRow('groups', { id, name: clean, sort_order: groups.reduce((m, g) => Math.max(m, g.sort_order + 1), 0) });
  return { ok: true, id };
}

/**
 * @param {string} id
 * @returns {{ok: true}|{ok: false, error: string}}
 */
export function deleteGroup(id) {
  if (!db.groups.has(id)) return { ok: false, error: 'Groupe introuvable' };
  if ([...db.swimmers.values()].some((s) => s.group_id === id)) return { ok: false, error: 'Des nageurs utilisent ce groupe' };
  removeRow('groups', id);
  return { ok: true };
}

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

/** @returns {object[]} groupes qui ont au moins un nageur actif (liste du « Mail groupe ») */
export function mailGroups() {
  const used = new Set(listSwimmers({ filter: 'actifs' }).map((sw) => sw.group_id));
  return listGroups().filter((g) => used.has(g.id));
}

/**
 * Mail de groupe (club4) : adresses des nageurs actifs, en copie cachée.
 * @param {string} groupId 'all' pour tous les actifs
 * @param {string} teamName nom de l'espace (objet du message)
 * @returns {{count: number, href: string}} href vide s'il n'y a aucune adresse valide
 */
export function groupMail(groupId, teamName) {
  const emails = listSwimmers({ filter: 'actifs' })
    .filter((sw) => groupId === 'all' || sw.group_id === groupId)
    .map((sw) => (sw.email ?? '').trim())
    .filter((e) => EMAIL.test(e));
  if (emails.length === 0) return { count: 0, href: '' };
  const group = groupId === 'all' ? '' : `[${db.groups.get(groupId)?.name ?? ''}] `;
  const subject = encodeURIComponent(`${group}Message de ${teamName}`);
  return { count: emails.length, href: `mailto:?bcc=${emails.map(encodeURIComponent).join(',')}&subject=${subject}` };
}
