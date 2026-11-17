import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors';
import { createBearerClient } from '@/lib/supabase/bearer';
import { createCookieClient } from '@/lib/supabase/server';

export interface AuthContext {
  /** User-scoped client: RLS applies. Pass this to every service function. */
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
}

/** Bearer header if present, otherwise the cookie session. */
export async function getUserClient(req: Request): Promise<{ supabase: SupabaseClient; jwt: string | null }> {
  const header = req.headers.get('authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  if (match) return { supabase: createBearerClient(match[1]!), jwt: match[1]! };
  return { supabase: await createCookieClient(), jwt: null };
}

/** Resolve the caller or throw 401 `unauthorized`. */
export async function requireUser(req: Request): Promise<AuthContext> {
  const { supabase, jwt } = await getUserClient(req);
  const { data, error } = jwt ? await supabase.auth.getUser(jwt) : await supabase.auth.getUser();
  if (error || !data?.user) throw new ApiError('unauthorized', 'Sign in required');
  return { supabase, userId: data.user.id, email: data.user.email ?? null };
}
