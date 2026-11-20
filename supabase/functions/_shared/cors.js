// En-têtes CORS des fonctions : l'origine n'est reprise que si elle figure dans la liste.
// Sinon, pas d'Access-Control-Allow-Origin : le navigateur bloque la réponse.

export const ALLOWED_ORIGINS = Object.freeze([
  'https://swimmcoachapp.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]);

/**
 * @param {string|null|undefined} origin en-tête Origin de la requête
 * @returns {Record<string,string>}
 */
export function corsHeaders(origin) {
  const headers = {
    // x-client-info : envoyé par supabase-js (functions.invoke), sinon le préflight échoue.
    'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/** Réponse JSON avec les en-têtes CORS de la requête. */
export function jsonResponse(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request.headers.get('Origin')), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Réponse au préflight OPTIONS (avant toute authentification). */
export function preflightResponse(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin')) });
}

/** Jeton « Bearer » de l'en-tête Authorization, ou null. */
export function bearerToken(request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  return m ? m[1] : null;
}
