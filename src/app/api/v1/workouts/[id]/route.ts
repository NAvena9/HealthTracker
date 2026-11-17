import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { parseParam, parseWith, uuidParam, workoutPatchSchema } from '@/lib/api/schemas';
import { deleteWorkout, patchWorkout } from '@/lib/services/workouts';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const id = parseParam('id', uuidParam, (await ctx.params).id);
  const body = parseWith(workoutPatchSchema, await readJson(req));
  return NextResponse.json(await patchWorkout(supabase, userId, id, body));
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { supabase, userId } = await requireUser(req);
  const id = parseParam('id', uuidParam, (await ctx.params).id);
  await deleteWorkout(supabase, userId, id);
  return NextResponse.json({ ok: true });
});
