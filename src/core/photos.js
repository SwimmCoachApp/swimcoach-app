/**
 * Photos privées (bucket `photos`) : réduction avant envoi, envoi, URL signées, suppression.
 * Noms d'objets imposés par la base : `<teamId>/(swimmers|sessions)/<uuid>.jpg`, jpeg, 2 Mo au plus.
 * Les URL signées ne sont gardées qu'en mémoire (jamais dans le stockage du navigateur) et sont
 * oubliées à la fermeture de l'espace.
 */
import { supabase } from './supabase.js';
import { getContext, onReset } from './store.js';

const BUCKET = 'photos';
/** Durée de validité d'une URL signée, en secondes. */
export const URL_TTL_S = 3600;
/** Une URL est renouvelée un peu avant son expiration. */
const URL_MARGIN_MS = 60_000;

/** @type {Map<string, {url: string, until: number}>} */
const urls = new Map();
let generation = 0;

onReset(() => {
  generation += 1;
  urls.clear();
});

/**
 * Réduit une image (côté le plus long ≤ maxSide) et la convertit en jpeg.
 * @param {Blob} file
 * @param {number} [maxSide]
 * @param {number} [quality]
 * @returns {Promise<Blob>} image/jpeg
 */
export async function resizeImage(file, maxSide = 800, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // fond opaque : un png transparent ne devient pas noir
  g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Image illisible');
  return blob;
}

/**
 * Chemin d'une photo de l'espace ouvert.
 * @param {'swimmers'|'sessions'} kind
 * @param {string} id uuid
 */
export function photoPath(kind, id) {
  const ctx = getContext();
  if (!ctx) throw new Error('Aucun groupe ouvert');
  return `${ctx.teamId.toLowerCase()}/${kind}/${String(id).toLowerCase()}.jpg`;
}

/**
 * Envoie une photo (remplace celle qui porte le même nom).
 * @param {'swimmers'|'sessions'} kind
 * @param {string} id
 * @param {Blob} blob image/jpeg
 * @returns {Promise<string>} chemin de l'objet
 * @throws {Error} si l'envoi échoue (réseau, refus)
 */
export async function uploadPhoto(kind, id, blob) {
  const path = photoPath(kind, id);
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw new Error(error.message || "Envoi de la photo impossible");
  urls.delete(path); // l'ancienne URL pointait vers l'ancienne image
  return path;
}

/**
 * URL signée d'une photo, d'une heure, gardée en mémoire.
 * @param {string} path
 * @returns {Promise<string>}
 * @throws {Error} si l'URL ne peut pas être créée (hors ligne)
 */
export async function photoUrl(path) {
  const hit = urls.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const gen = generation;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, URL_TTL_S);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Photo indisponible');
  if (gen === generation) urls.set(path, { url: data.signedUrl, until: Date.now() + URL_TTL_S * 1000 - URL_MARGIN_MS });
  return data.signedUrl;
}

/**
 * Supprime une photo.
 * @param {string} path
 * @throws {Error} si la suppression échoue (hors ligne)
 */
export async function deletePhoto(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message || 'Suppression de la photo impossible');
  urls.delete(path);
}
