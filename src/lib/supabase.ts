import { createClient } from '@supabase/supabase-js';
import { env, isConfigured } from './env';

/**
 * Cliente único do Supabase. Usa somente a chave pública (anon/publishable);
 * toda autorização acontece no banco via RLS.
 */
export const supabase = createClient(
  isConfigured ? env.supabaseUrl : 'http://localhost:54321',
  isConfigured ? env.supabaseAnonKey : 'public-anon-key-not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'fos.auth',
    },
    global: { headers: { 'x-client-info': `finance-os/${env.version}` } },
  },
);
