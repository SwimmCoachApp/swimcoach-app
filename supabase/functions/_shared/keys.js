// Clés d'API des fonctions. Le runtime hébergé fournit SUPABASE_SECRET_KEYS et
// SUPABASE_PUBLISHABLE_KEYS (objets JSON par nom, « default ») ; repli sur les anciennes
// variables SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY. Aucune clé n'est dans le dépôt.

function defaultFrom(json) {
  if (!json) return undefined;
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && typeof v.default === 'string' && v.default ? v.default : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {(name: string) => string | undefined} getEnv
 * @returns {{ secretKey: string | undefined, publishableKey: string | undefined }}
 */
export function resolveKeys(getEnv) {
  return {
    secretKey: defaultFrom(getEnv('SUPABASE_SECRET_KEYS')) ?? getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    publishableKey: defaultFrom(getEnv('SUPABASE_PUBLISHABLE_KEYS')) ?? getEnv('SUPABASE_ANON_KEY'),
  };
}
