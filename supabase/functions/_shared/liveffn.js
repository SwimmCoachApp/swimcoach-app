// Proxy liveffn (JS pur) : construction de l'URL et traitement de la requête.
// Le point d'entrée Deno (liveffn-proxy/index.ts) ne fait qu'injecter fetch et le client.
import { bearerToken, corsHeaders, jsonResponse, preflightResponse } from './cors.js';

export const LIVEFFN_HOST = 'www.liveffn.com';
export const LIVEFFN_STRUCTURE = 39; // TOAC Natation : configuration, jamais le client
export const LIVEFFN_TIMEOUT_MS = 12000;
export const LIVEFFN_MAX_BYTES = 5 * 1024 * 1024;

/**
 * @param {string} competition identifiant liveffn (1 à 7 chiffres)
 * @param {number} structure
 * @returns {string|null}
 */
export function buildLiveffnUrl(competition, structure) {
  if (typeof competition !== 'string' || !/^\d{1,7}$/.test(competition)) return null;
  if (!Number.isInteger(structure) || structure <= 0) return null;
  return `https://${LIVEFFN_HOST}/cgi-bin/resultats.php?competition=${competition}`
    + `&langue=fra&go=detail&action=structure&structure=${structure}`;
}

/** Jeu de caractères d'un Content-Type (ou d'un <meta charset>), utf-8 par défaut. */
export function charsetOf(contentType, head = '') {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '') || /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  const cs = m ? m[1].toLowerCase() : 'utf-8';
  try {
    new TextDecoder(cs);
    return cs;
  } catch {
    return 'utf-8';
  }
}

/**
 * Corps de la réponse, au plus `max` octets : null si Content-Length ou le flux dépasse
 * (lecture interrompue dès le dépassement, rien n'est mis en mémoire au-delà).
 * @returns {Promise<Uint8Array|null>}
 */
export async function readLimited(res, max) {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * @param {Request} request
 * @param {{ fetch: typeof fetch, createUserClient: (token:string) => any,
 *           timeoutMs?: number, structure?: number }} deps
 * @returns {Promise<Response>}
 */
export async function handleLiveffn(request, deps) {
  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (request.method !== 'GET') return jsonResponse(request, 405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  if (!token) return jsonResponse(request, 401, { error: 'unauthorized' });
  const client = deps.createUserClient(token);
  const { data: userData, error: userError } = await client.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return jsonResponse(request, 401, { error: 'unauthorized' });

  // Lecture avec le jeton de l'appelant : la RLS de coaches s'applique.
  const { data: coach, error: coachError } = await client
    .from('coaches').select('activated_at').eq('id', user.id).maybeSingle();
  if (coachError) return jsonResponse(request, 500, { error: 'coach_lookup_failed' });
  if (!coach?.activated_at) return jsonResponse(request, 403, { error: 'not_activated' });

  const competition = new URL(request.url).searchParams.get('competition');
  const target = buildLiveffnUrl(competition ?? '', deps.structure ?? LIVEFFN_STRUCTURE);
  if (!target) return jsonResponse(request, 400, { error: 'invalid_competition' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? LIVEFFN_TIMEOUT_MS);
  try {
    const res = await deps.fetch(target, {
      method: 'GET',
      redirect: 'manual', // aucune redirection suivie, vers liveffn ou ailleurs
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return jsonResponse(request, 502, { error: 'upstream_redirect' });
    }
    if (!res.ok) return jsonResponse(request, 502, { error: 'upstream_status', status: res.status });
    if (res.url && new URL(res.url).host !== LIVEFFN_HOST) {
      return jsonResponse(request, 502, { error: 'upstream_host' });
    }
    const buf = await readLimited(res, LIVEFFN_MAX_BYTES);
    if (!buf) return jsonResponse(request, 502, { error: 'upstream_too_large' });
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
    const html = new TextDecoder(charsetOf(res.headers.get('Content-Type'), head)).decode(buf);
    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders(request.headers.get('Origin')),
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (controller.signal.aborted || e?.name === 'AbortError') {
      return jsonResponse(request, 504, { error: 'upstream_timeout' });
    }
    return jsonResponse(request, 502, { error: 'upstream_unreachable' });
  } finally {
    clearTimeout(timer);
  }
}
