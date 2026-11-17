import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ApiError, notFound, throwDbError } from '@/lib/api/errors';
import { parseStrongExport, weekStartOf, type StrongParseResult, type Workout } from '@/lib/domain';
import { toWorkout } from './mappers';
import { getSettings } from './settings';
import { assertWeekOpen, ensureWeek } from './weeks';

export const STRONG_MAX_BYTES = 100 * 1024;

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Must be a valid date');

const applySchema = z.object({
  log_date: dateStr,
  raw_text: z.string(),
  attach_to: z.string().uuid().nullable().optional(),
});

export async function applyStrong(
  supabase: SupabaseClient,
  userId: string,
  input: unknown,
): Promise<{ workout: Workout; parsed: StrongParseResult }> {
  const { log_date, raw_text, attach_to } = applySchema.parse(input);
  if (new TextEncoder().encode(raw_text).length > STRONG_MAX_BYTES) throw new ApiError('payload_too_large', 'Strong text is over 100 KB');

  const settings = await getSettings(supabase, userId);
  const parsed = parseStrongExport(raw_text, { defaultUnit: settings.strong_default_unit });
  if (parsed.totalSets === 0 && parsed.totalVolumeKg === 0) {
    throw new ApiError(
      'validation_error',
      'No sets found in the Strong export',
      [{ path: ['raw_text'], message: 'No sets found' }],
      undefined,
      { warnings: parsed.warnings },
    );
  }

  const weekStart = weekStartOf(log_date);
  assertWeekOpen(await ensureWeek(supabase, userId, weekStart));

  let targetId: string | null = null;
  if (attach_to) {
    const { data, error } = await supabase.from('workouts').select('id, week_start_date').eq('user_id', userId).eq('id', attach_to).maybeSingle();
    throwDbError(error, 'strong.attach');
    if (!data) throw notFound('Workout not found');
    const targetWeek = data.week_start_date as string;
    if (targetWeek !== weekStart) assertWeekOpen(await ensureWeek(supabase, userId, targetWeek));
    targetId = data.id as string;
  } else {
    const { data, error } = await supabase
      .from('workouts')
      .select('id')
      .eq('user_id', userId)
      .eq('log_date', log_date)
      .eq('category', 'STRENGTH')
      .eq('source', 'apple_health');
    throwDbError(error, 'strong.find');
    if (data && data.length === 1) targetId = data[0]!.id as string; // keeps source = apple_health
  }

  const strongFields = {
    volume_kg: parsed.totalVolumeKg,
    strong_title: parsed.workoutTitle,
    strong_raw_txt: raw_text,
    strong_parsed: parsed,
  };

  if (targetId) {
    const { data, error } = await supabase.from('workouts').update(strongFields).eq('id', targetId).eq('user_id', userId).select('*').single();
    throwDbError(error, 'strong.update');
    return { workout: toWorkout(data), parsed };
  }
  const { data, error } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      log_date,
      week_start_date: weekStart,
      category: 'STRENGTH',
      type_label: 'Strength Training',
      source: 'strong',
      ...strongFields,
    })
    .select('*')
    .single();
  throwDbError(error, 'strong.insert');
  return { workout: toWorkout(data), parsed };
}
