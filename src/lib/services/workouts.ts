import type { SupabaseClient } from '@supabase/supabase-js';
import { notFound, throwDbError } from '@/lib/api/errors';
import type { WorkoutCreateBody, WorkoutPatchBody } from '@/lib/api/schemas';
import { weekStartOf, type Workout } from '@/lib/domain';
import { toWorkout, type WorkoutRow } from './mappers';
import { assertWeekOpen, ensureWeek, findWeek } from './weeks';

const definedOnly = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export async function listWorkouts(
  supabase: SupabaseClient,
  userId: string,
  range: { from?: string; to?: string },
): Promise<Workout[]> {
  let q = supabase.from('workouts').select('*').eq('user_id', userId);
  if (range.from) q = q.gte('log_date', range.from);
  if (range.to) q = q.lte('log_date', range.to);
  const { data, error } = await q.order('log_date', { ascending: true });
  throwDbError(error, 'workouts.list');
  return ((data ?? []) as WorkoutRow[]).map(toWorkout);
}

export async function createWorkout(supabase: SupabaseClient, userId: string, body: WorkoutCreateBody): Promise<Workout> {
  const weekStart = weekStartOf(body.log_date);
  assertWeekOpen(await ensureWeek(supabase, userId, weekStart));
  const { data, error } = await supabase
    .from('workouts')
    .insert({
      ...definedOnly(body),
      user_id: userId,
      week_start_date: weekStart,
      source: 'manual',
    })
    .select('*')
    .single();
  throwDbError(error, 'workouts.create');
  return toWorkout(data as WorkoutRow);
}

async function readWorkout(supabase: SupabaseClient, userId: string, id: string): Promise<WorkoutRow> {
  const { data, error } = await supabase.from('workouts').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
  throwDbError(error, 'workouts.read');
  if (!data) throw notFound('Workout not found');
  return data as WorkoutRow;
}

async function assertStoredWeekOpen(supabase: SupabaseClient, userId: string, weekStart: string): Promise<void> {
  const week = await findWeek(supabase, userId, weekStart);
  if (week) assertWeekOpen(week);
}

export async function patchWorkout(supabase: SupabaseClient, userId: string, id: string, body: WorkoutPatchBody): Promise<Workout> {
  const existing = await readWorkout(supabase, userId, id);
  await assertStoredWeekOpen(supabase, userId, existing.week_start_date);
  const patch: Record<string, unknown> = definedOnly(body);
  if (body.log_date && body.log_date !== existing.log_date) {
    const newWeek = weekStartOf(body.log_date);
    assertWeekOpen(await ensureWeek(supabase, userId, newWeek));
    patch.week_start_date = newWeek;
  }
  if (Object.keys(patch).length === 0) return toWorkout(existing);
  const { data, error } = await supabase.from('workouts').update(patch).eq('user_id', userId).eq('id', id).select('*').single();
  throwDbError(error, 'workouts.patch');
  return toWorkout(data as WorkoutRow);
}

export async function deleteWorkout(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const existing = await readWorkout(supabase, userId, id);
  await assertStoredWeekOpen(supabase, userId, existing.week_start_date);
  const { error } = await supabase.from('workouts').delete().eq('user_id', userId).eq('id', id);
  throwDbError(error, 'workouts.delete');
}
