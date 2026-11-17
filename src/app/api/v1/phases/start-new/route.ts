import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { parseWith, phaseStartNewSchema } from '@/lib/api/schemas';
import { startNewPhase } from '@/lib/services/phases';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const body = parseWith(phaseStartNewSchema, await readJson(req));
  return NextResponse.json(await startNewPhase(supabase, userId, body), { status: 201 });
});
