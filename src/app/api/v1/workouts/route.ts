import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { parseWith, queryOf, workoutCreateSchema, workoutsQuerySchema } from '@/lib/api/schemas';
import { createWorkout, listWorkouts } from '@/lib/services/workouts';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const range = parseWith(workoutsQuerySchema, queryOf(req));
  return NextResponse.json({ workouts: await listWorkouts(supabase, userId, range) });
});

export const POST = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const body = parseWith(workoutCreateSchema, await readJson(req));
  return NextResponse.json(await createWorkout(supabase, userId, body), { status: 201 });
});
