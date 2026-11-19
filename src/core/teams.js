/**
 * Espaces d'équipe de l'entraîneur connecté : liste, espace courant, création.
 * Le dernier espace ouvert est retenu dans `coachStore(coachId).set('team')`.
 */
import { supabase } from './supabase.js';
import { getCoach, onCoachChange } from './session.js';
import { coachStore } from './storage.js';

/** @type {{coachId: string, teams: {id: string, name: string}[]}|null} */
let cache = null;
const listeners = new Set();

onCoachChange((c) => {
  if (!c || cache?.coachId !== c.id) cache = null;
});

function notify() {
  const team = getCurrentTeam();
  for (const cb of [...listeners]) cb(team);
}

/** Message français pour une erreur de fonction serveur. */
function teamError(error) {
  const m = error?.message || '';
  if (/not_allowed/.test(m)) return "Tu n'as pas accès à cette action";
  if (/invalid_name/.test(m)) return "Le nom de l'espace doit faire entre 1 et 60 caractères";
  return 'Une erreur est survenue, réessaie';
}

/**
 * Liste les espaces dont l'entraîneur est membre, après avoir réclamé ses invitations.
 * Hors ligne : renvoie la dernière liste connue.
 * @returns {Promise<{id: string, name: string}[]>}
 */
export async function listMyTeams() {
  const coach = getCoach();
  if (!coach) return [];
  const store = coachStore(coach.id);
  await supabase.rpc('claim_my_invites'); // sans effet bloquant : une erreur n'empêche pas la liste
  const { data, error } = await supabase.from('teams').select('id, name').order('name');
  const teams = error ? store.get('teams') ?? [] : data.map((t) => ({ id: t.id, name: t.name }));
  if (!error) store.set('teams', teams);
  cache = { coachId: coach.id, teams };
  return teams;
}

/**
 * Espace courant : le dernier ouvert s'il existe encore, sinon le premier.
 * Utilise la liste lue par listMyTeams.
 * @returns {{id: string, name: string}|null}
 */
export function getCurrentTeam() {
  const coach = getCoach();
  if (!coach || !cache || cache.coachId !== coach.id) return null;
  const last = coachStore(coach.id).get('team');
  return cache.teams.find((t) => t.id === last) ?? cache.teams[0] ?? null;
}

/** @param {string} id identifiant d'un espace de la liste */
export function setCurrentTeam(id) {
  const coach = getCoach();
  if (!coach || !cache?.teams.some((t) => t.id === id)) return;
  coachStore(coach.id).set('team', id);
  notify();
}

/** @param {(team: {id: string, name: string}|null) => void} cb @returns {() => void} */
export function onTeamChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Crée un espace dont l'entraîneur devient membre, et l'ouvre.
 * @param {string} name
 * @returns {Promise<string>} identifiant de l'espace
 * @throws {Error} message français prêt à afficher
 */
export async function createTeam(name) {
  const coach = getCoach();
  const clean = name.trim();
  if (!coach) throw new Error('Connecte-toi pour créer un espace');
  if (!clean) throw new Error("Donne un nom à l'espace");
  const { data, error } = await supabase.rpc('create_team', { name: clean });
  if (error) throw new Error(teamError(error));
  const teams = [...(cache?.coachId === coach.id ? cache.teams : []), { id: data, name: clean }];
  cache = { coachId: coach.id, teams };
  coachStore(coach.id).set('teams', teams);
  coachStore(coach.id).set('team', data);
  notify();
  return data;
}
