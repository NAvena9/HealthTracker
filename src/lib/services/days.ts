import type { SupabaseClient } from '@supabase/supabase-js';
import { throwDbError } from '@/lib/api/errors';
import { DAY_DATA_FIELDS, type DayPutBody } from '@/lib/api/schemas';
import { weekStartOf, type DailyLog, type DayType, type GoalsSnapshot, type Workout } from '@/lib/domain';
import { toDailyLog, toWorkout, type DailyLogRow, type WorkoutRow } from './mappers';
import { assertWeekOpen, ensureWeek } from './weeks';

export interface DayResponse {
  day: DailyLog & { persisted: boolean };
  workouts: Workout[];
  week: { week_start_date: string; closed: boolean; goals_snapshot: GoalsSnapshot };
}

async function inheritedDayType(supabase: SupabaseClient, userId: string, date: string): Promise<DayType> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('day_type')
    .eq('user_id', userId)
    .lt('log_date', date)
    .order('log_date', { ascending: false })
    .limit(1);
  throwDbError(error, 'days.inherit');
  const row = (data ?? [])[0] as { day_type: DayType } | undefined;
  return row?.day_type ?? 'ACTIVE';
}

async function readDay(supabase: SupabaseClient, userId: string, date: string): Promise<DailyLogRow | null> {
  const { data, error } = await supabase.from('daily_logs').select('*').eq('user_id', userId).eq('log_date', date).maybeSingle();
  throwDbError(error, 'days.read');
  return (data as DailyLogRow | null) ?? null;
}

async function buildResponse(supabase: SupabaseClient, userId: string, date: string, row: DailyLogRow | null): Promise<DayResponse> {
  const week = await ensureWeek(supabase, userId, weekStartOf(date));
  const wk = await supabase.from('workouts').select('*').eq('user_id', userId).eq('log_date', date).order('started_at', { ascending: true });
  throwDbError(wk.error, 'days.workouts');
  let day: DailyLog & { persisted: boolean };
  if (row) {
    day = { ...toDailyLog(row), persisted: true };
  } else {
    day = {
      log_date: date,
      week_start_date: week.week_start_date,
      day_type: await inheritedDayType(supabase, userId, date),
      weight_kg: null,
      steps: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      calories_kcal: null,
      resting_kcal: null,
      active_kcal_total: null,
      edited_fields: [],
      apple_health_synced_at: null,
      persisted: false,
    };
  }
  return {
    day,
    workouts: ((wk.data ?? []) as WorkoutRow[]).map(toWorkout),
    week: { week_start_date: week.week_start_date, closed: week.closed_at !== null, goals_snapshot: week.goals_snapshot },
  };
}

export async function getDay(supabase: SupabaseClient, userId: string, date: string): Promise<DayResponse> {
  return buildResponse(supabase, userId, date, await readDay(supabase, userId, date));
}

/** PUT /days/{date}. `source: 'sync'` applies values but leaves edited_fields untouched. */
export async function putDay(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  body: DayPutBody,
  opts: { source?: 'sync' | null } = {},
): Promise<DayResponse> {
  const weekStart = weekStartOf(date); // never trust a client week_start_date
  const week = await ensureWeek(supabase, userId, weekStart);
  assertWeekOpen(week);
  const existing = await readDay(supabase, userId, date);

  const row: Record<string, unknown> = { user_id: userId, log_date: date, week_start_date: weekStart };
  if (body.day_type !== undefined) row.day_type = body.day_type;
  else if (!existing) row.day_type = await inheritedDayType(supabase, userId, date);

  const edited = new Set<string>(existing?.edited_fields ?? []);
  for (const f of DAY_DATA_FIELDS) {
    const v = body[f];
    if (v === undefined) continue;
    row[f] = v;
    if (v === null) edited.delete(f);
    else edited.add(f);
  }
  if (opts.source !== 'sync') row.edited_fields = DAY_DATA_FIELDS.filter((f) => edited.has(f));

  const { data, error } = await supabase
    .from('daily_logs')
    .upsert(row, { onConflict: 'user_id,log_date' })
    .select('*')
    .single();
  throwDbError(error, 'days.put');
  return buildResponse(supabase, userId, date, data as DailyLogRow);
}
