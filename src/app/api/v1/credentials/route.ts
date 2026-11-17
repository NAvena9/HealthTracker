import { NextResponse } from 'next/server';
import { handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { getCredentialStatus } from '@/lib/services/credentials';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { userId } = await requireUser(req);
  return NextResponse.json(await getCredentialStatus(userId, new URL(req.url).origin));
});
