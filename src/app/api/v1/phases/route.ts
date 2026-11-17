import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { parseWith, phaseCreateSchema } from '@/lib/api/schemas';
import { createPhase, listPhases } from '@/lib/services/phases';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  return NextResponse.json({ phases: await listPhases(supabase, userId) });
});

export const POST = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const body = parseWith(phaseCreateSchema, await readJson(req));
  return NextResponse.json(await createPhase(supabase, userId, body), { status: 201 });
});
