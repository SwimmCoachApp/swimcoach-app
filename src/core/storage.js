/**
 * Stockage local préfixé par entraîneur.
 *
 * Seul module de src/ autorisé à toucher à `localStorage`.
 * Clés : `swimcoach2_<name>` (application), `swimcoach2_<coachId>_<name>` (entraîneur),
 * `swimcoach2_<coachId>_<teamId>_<name>` (espace d'équipe).
 * Toutes les valeurs sont sérialisées en JSON. Tout accès est protégé par try/catch.
 */

/** Préfixe commun de toutes les clés gérées par ce module. */
export const PREFIX = 'swimcoach2_';

/** Clés de l'application (hors entraîneur) préservées par clearAllCoachData. */
export const APP_KEYS = ['theme'];

/**
 * Liste les clés présentes (copie figée, pour pouvoir supprimer pendant le parcours).
 * @returns {string[]}
 */
function listKeys() {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

/**
 * Lit une clé brute.
 * @param {string} key
 * @returns {string|null}
 */
function rawGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Lit une valeur JSON. Une valeur absente ou corrompue donne null.
 * @param {string} key
 * @returns {any}
 */
function read(key) {
  const raw = rawGet(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Écrit une valeur JSON.
 * @param {string} key
 * @param {any} value
 * @returns {boolean} true si l'écriture a réussi
 */
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Supprime une clé brute.
 * @param {string} key
 */
function rawRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // stockage indisponible : rien à supprimer
  }
}

/**
 * Supprime toutes les clés commençant exactement par `prefix`.
 * @param {string} prefix
 */
function removeWithPrefix(prefix) {
  for (const key of listKeys()) {
    if (key.startsWith(prefix)) rawRemove(key);
  }
}

/**
 * Construit un espace de stockage rattaché à un préfixe.
 * @param {string} prefix
 * @returns {{get: (name: string) => any, set: (name: string, value: any) => boolean, remove: (name: string) => void, clear: () => void}}
 */
function makeStore(prefix) {
  return {
    /** @param {string} name @returns {any} valeur, ou null si absente ou corrompue */
    get: (name) => read(prefix + name),
    /** @param {string} name @param {any} value @returns {boolean} succès de l'écriture */
    set: (name, value) => write(prefix + name, value),
    /** @param {string} name */
    remove: (name) => rawRemove(prefix + name),
    /** Efface toutes les clés de cet espace (sous-espaces inclus). */
    clear: () => removeWithPrefix(prefix),
  };
}

/**
 * Stockage de l'application (clés `swimcoach2_<name>`).
 * @type {{get: (name: string) => any, set: (name: string, value: any) => boolean, remove: (name: string) => void, clear: () => void}}
 */
export const appStore = makeStore(PREFIX);

/**
 * Stockage d'un entraîneur (clés `swimcoach2_<coachId>_<name>`).
 * Son `clear` efface aussi tous ses espaces d'équipe.
 * @param {string} coachId
 * @returns {{get: (name: string) => any, set: (name: string, value: any) => boolean, remove: (name: string) => void, clear: () => void}}
 */
export function coachStore(coachId) {
  return makeStore(`${PREFIX}${coachId}_`);
}

/**
 * Stockage d'un espace d'équipe (clés `swimcoach2_<coachId>_<teamId>_<name>`).
 * Son `clear` n'efface que cet espace.
 * @param {string} coachId
 * @param {string} teamId
 * @returns {{get: (name: string) => any, set: (name: string, value: any) => boolean, remove: (name: string) => void, clear: () => void}}
 */
export function teamStore(coachId, teamId) {
  return makeStore(`${PREFIX}${coachId}_${teamId}_`);
}

/**
 * Efface toutes les données des entraîneurs : toutes les clés `swimcoach2_`
 * sauf celles de l'application listées dans APP_KEYS.
 */
export function clearAllCoachData() {
  const keep = new Set(APP_KEYS.map((name) => PREFIX + name));
  for (const key of listKeys()) {
    if (key.startsWith(PREFIX) && !keep.has(key)) rawRemove(key);
  }
}

/** Vrai pendant une déconnexion et, si elle n'a pas abouti à temps, jusqu'au rechargement de la page. */
let authWritesBlocked = false;

/**
 * Interdit (ou autorise de nouveau) l'écriture de la session d'authentification par supabase-js.
 * Posé par la déconnexion : un renouvellement de jeton tardif ne doit pas réécrire la session.
 * @param {boolean} blocked
 */
export function blockAuthWrites(blocked) {
  authWritesBlocked = blocked;
}

/**
 * Adaptateur de stockage pour supabase-js (session d'authentification).
 * Limité aux clés `swimcoach2_` : toute autre clé est ignorée (lecture : null).
 * @type {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void}}
 */
export const authStorageAdapter = {
  getItem: (key) => (key.startsWith(PREFIX) ? rawGet(key) : null),
  setItem: (key, value) => {
    if (!key.startsWith(PREFIX)) return;
    if (authWritesBlocked && key.startsWith(`${PREFIX}auth`)) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // stockage plein ou indisponible : la session ne sera pas retenue
    }
  },
  removeItem: (key) => {
    if (key.startsWith(PREFIX)) rawRemove(key);
  },
};
