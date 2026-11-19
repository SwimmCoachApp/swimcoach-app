// Proxy liveffn : enveloppe Deno de _shared/liveffn.js (JWT vérifié par la plateforme).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleLiveffn } from '../_shared/liveffn.js';

const url = Deno.env.get('SUPABASE_URL')!;
const publicKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

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
