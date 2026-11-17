import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { dateParam, dayPutSchema, parseParam, parseWith } from '@/lib/api/schemas';
import { getDay, putDay } from '@/lib/services/days';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ date: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const date = parseParam('date', dateParam, (await ctx.params).date);
  return NextResponse.json(await getDay(supabase, userId, date));
});

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const date = parseParam('date', dateParam, (await ctx.params).date);
  const body = parseWith(dayPutSchema, await readJson(req));
  const source = req.headers.get('x-source')?.toLowerCase() === 'sync' ? 'sync' : null;
  return NextResponse.json(await putDay(supabase, userId, date, body, { source }));
});
