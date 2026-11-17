import { NextResponse } from 'next/server';
import { handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { getSyncStatus } from '@/lib/services/sync';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  return NextResponse.json(await getSyncStatus(supabase, userId));
});
