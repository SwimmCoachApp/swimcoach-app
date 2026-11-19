// Proxy liveffn : enveloppe Deno de _shared/liveffn.js (JWT vérifié par la plateforme).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleLiveffn } from '../_shared/liveffn.js';
import { resolveKeys } from '../_shared/keys.js';

const url = Deno.env.get('SUPABASE_URL')!;
const publicKey = resolveKeys((name: string) => Deno.env.get(name)).publishableKey!;

Deno.serve((request: Request) =>
  handleLiveffn(request, {
    fetch,
    createUserClient: (token: string) =>
      createClient(url, publicKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  })
);
