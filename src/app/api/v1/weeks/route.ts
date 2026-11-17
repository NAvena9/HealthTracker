import { NextResponse } from 'next/server';
import { handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { parseWith, queryOf, weeksQuerySchema } from '@/lib/api/schemas';
import { listWeeks } from '@/lib/services/weeks';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const { from, to } = parseWith(weeksQuerySchema, queryOf(req));
  return NextResponse.json(await listWeeks(supabase, userId, from, to));
});
