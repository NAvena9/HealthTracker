import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { mondayParam, parseParam, parseWith, reopenWeekSchema } from '@/lib/api/schemas';
import { reopenWeek } from '@/lib/services/weeks';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ weekStart: string }> }) => {
  const { supabase, userId } = await requireUser(req);
  const weekStart = parseParam('weekStart', mondayParam, (await ctx.params).weekStart);
  const body = parseWith(reopenWeekSchema, await readJson(req));
  return NextResponse.json(await reopenWeek(supabase, userId, weekStart, body));
});
