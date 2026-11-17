import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { closeWeekSchema, mondayParam, parseParam, parseWith } from '@/lib/api/schemas';
import { closeWeek } from '@/lib/services/weeks';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ weekStart: string }> }) => {
  const { supabase, userId } = await requireUser(req);
  const weekStart = parseParam('weekStart', mondayParam, (await ctx.params).weekStart);
  parseWith(closeWeekSchema, await readJson(req));
  return NextResponse.json(await closeWeek(supabase, userId, weekStart));
});
