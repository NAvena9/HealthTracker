import { NextResponse } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api/errors';
import { checkRateLimit, clientIp } from '@/lib/api/rateLimit';
import { createAdminClient } from '@/lib/supabase/admin';
import { findUserBySecret } from '@/lib/services/credentials';
import { runSync } from '@/lib/services/sync';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;
const unauthorized = () => new ApiError('unauthorized', 'Unauthorized');

/** Webhook: Authorization: Bearer <pow_...> (never cookies, never the URL). Bodies and the secret are never logged. */
export const POST = handle(async (req: Request) => {
  const rl = checkRateLimit(clientIp(req));
  if (!rl.allowed) {
    throw new ApiError('rate_limited', 'Too many requests', undefined, { 'Retry-After': String(rl.retryAfter) });
  }

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new ApiError('payload_too_large', 'Request body too large');

  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!match) throw unauthorized();
  const admin = createAdminClient();
  const userId = await findUserBySecret(match[1]!, admin);
  if (!userId) throw unauthorized();

  const body = await readJson(req, MAX_BYTES);
  const dp = new URL(req.url).searchParams.get('dry_run');
  const dryRun = dp === '1' || dp === 'true';
  return NextResponse.json(await runSync(admin, userId, body, { dryRun }));
});
