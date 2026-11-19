/**
 * Client Supabase unique de l'application.
 * La session est retenue sous la clé `swimcoach2_auth`, via l'adaptateur de storage.js.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { authStorageAdapter } from './storage.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: 'swimcoach2_auth',
    storage: authStorageAdapter,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
