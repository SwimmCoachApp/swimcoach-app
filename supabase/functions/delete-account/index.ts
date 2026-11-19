// Suppression de compte : enveloppe Deno de _shared/delete-account.js (JWT vérifié par la plateforme).
// La clé serveur vient de l'environnement fourni par Supabase, jamais du dépôt.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleDeleteAccount } from '../_shared/delete-account.js';
import { resolveKeys } from '../_shared/keys.js';

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  resolveKeys((name: string) => Deno.env.get(name)).secretKey!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve((request: Request) => handleDeleteAccount(request, { adminClient }));
