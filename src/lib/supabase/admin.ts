import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl } from './env';

/**
 * Service-role client. Bypasses RLS. Use ONLY in the sync webhook and the credentials service.
 * Never import this from client components.
 */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
