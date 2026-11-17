import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { throwDbError } from '@/lib/api/errors';
import { createAdminClient } from '@/lib/supabase/admin';

export interface CredentialStatus {
  has_secret: boolean;
  last4: string | null;
  rotated_at: string | null;
  created_at: string | null;
  webhook_url: string;
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export function webhookUrl(origin: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || origin || '').replace(/\/+$/, '');
  return `${base}/api/sync/apple-health`;
}

export async function getCredentialStatus(userId: string, origin: string, admin: SupabaseClient = createAdminClient()): Promise<CredentialStatus> {
  const { data, error } = await admin
    .from('sync_credentials')
    .select('secret_last4, created_at, rotated_at')
    .eq('user_id', userId)
    .maybeSingle();
  throwDbError(error, 'credentials.status');
  return {
    has_secret: !!data,
    last4: (data?.secret_last4 as string | null | undefined) ?? null,
    rotated_at: (data?.rotated_at as string | null | undefined) ?? null,
    created_at: (data?.created_at as string | null | undefined) ?? null,
    webhook_url: webhookUrl(origin),
  };
}

export async function hasSecret(userId: string, admin: SupabaseClient = createAdminClient()): Promise<boolean> {
  const { data, error } = await admin.from('sync_credentials').select('user_id').eq('user_id', userId).maybeSingle();
  throwDbError(error, 'credentials.has_secret');
  return !!data;
}

/** Generate a new secret. Returned once; only sha256 hex + last4 are stored. The old secret stops working. */
export async function rotateSecret(
  userId: string,
  origin: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<{ secret: string; last4: string; webhook_url: string }> {
  const secret = `pow_${randomBytes(32).toString('base64url')}`;
  const last4 = secret.slice(-4);
  const { error } = await admin
    .from('sync_credentials')
    .upsert(
      { user_id: userId, secret_hash: sha256Hex(secret), secret_last4: last4, rotated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  throwDbError(error, 'credentials.rotate');
  return { secret, last4, webhook_url: webhookUrl(origin) };
}

/** Hash lookup. Returns the owning user id, or null when the secret is unknown. */
export async function findUserBySecret(secret: string, admin: SupabaseClient = createAdminClient()): Promise<string | null> {
  if (!secret) return null;
  const { data, error } = await admin
    .from('sync_credentials')
    .select('user_id')
    .eq('secret_hash', sha256Hex(secret))
    .maybeSingle();
  throwDbError(error, 'credentials.lookup');
  return (data?.user_id as string | undefined) ?? null;
}
