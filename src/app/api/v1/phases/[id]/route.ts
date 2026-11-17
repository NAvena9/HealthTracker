import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { parseParam, parseWith, phaseDeleteQuerySchema, phasePatchSchema, queryOf, uuidParam } from '@/lib/api/schemas';
import { deletePhase, getPhase, updatePhase } from '@/lib/services/phases';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const id = parseParam('id', uuidParam, (await ctx.params).id);
  return NextResponse.json(await getPhase(supabase, userId, id));
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const id = parseParam('id', uuidParam, (await ctx.params).id);
  const body = parseWith(phasePatchSchema, await readJson(req));
  return NextResponse.json(await updatePhase(supabase, userId, id, body));
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const id = parseParam('id', uuidParam, (await ctx.params).id);
  const q = parseWith(phaseDeleteQuerySchema, queryOf(req));
  await deletePhase(supabase, userId, id, q.confirm === 'true');
  return NextResponse.json({ ok: true });
});
