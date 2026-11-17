import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { mondayParam, parseParam, parseWith, weekPutSchema } from '@/lib/api/schemas';
import { getWeekBundle, updateWeek } from '@/lib/services/weeks';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ weekStart: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const weekStart = parseParam('weekStart', mondayParam, (await ctx.params).weekStart);
  return NextResponse.json(await getWeekBundle(supabase, userId, weekStart));
});

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const weekStart = parseParam('weekStart', mondayParam, (await ctx.params).weekStart);
  const body = parseWith(weekPutSchema, await readJson(req));
  return NextResponse.json(await updateWeek(supabase, userId, weekStart, body));
});
