import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { applyStrong } from '@/lib/services/strong';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const body = await readJson(req, 256 * 1024);
  return NextResponse.json(await applyStrong(supabase, userId, body));
});
