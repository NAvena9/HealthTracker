import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './env';

/** User-scoped client for native / curl callers sending `Authorization: Bearer <supabase JWT>`. RLS applies. */
export function createBearerClient(jwt: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
