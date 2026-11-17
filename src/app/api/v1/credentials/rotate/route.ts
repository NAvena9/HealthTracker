import { NextResponse } from 'next/server';
import { handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { rotateSecret } from '@/lib/services/credentials';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const { userId } = await requireUser(req);
  const out = await rotateSecret(userId, new URL(req.url).origin);
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
});
