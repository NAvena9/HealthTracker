import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, conflict, notFound, throwDbError, validationError, weekClosed } from '@/lib/api/errors';
import type { ReopenWeekBody, WeekPutBody } from '@/lib/api/schemas';
import {
  addDays,
  todayInTz,
  weekDates,
  weekNumber,
  weekStartOf,
  type DailyLog,
  type WeeklyCheckin,
  type Workout,
} from '@/lib/domain';
import {
  toDailyLog,
  toWeeklyCheckin,
  toWorkout,
  type DailyLogRow,
  type WeeklyCheckinRow,
  type WorkoutRow,
} from './mappers';
import { defaultGoalsSnapshot, findPhaseForWeek, getPhase, phaseToSnapshot } from './phases';
import { getSettings } from './settings';

export interface PhaseSummary {
  id: string;
  name: string;
  start_date: string;
  start_weight_kg: number | null;
  target_weight_kg: number | null;
}

export interface WeekBundle {
  checkin: WeeklyCheckin;
  days: (DailyLog | null)[]; // 7 entries Mon..Sun
  workouts: Workout[];
  phase: PhaseSummary | null;
  week_number: number | null;
}

function assertMonday(weekStart: string): void {
  if (weekStartOf(weekStart) !== weekStart) {
    throw validationError('Invalid request', [{ path: ['weekStart'], message: 'Must be a Monday' }]);
  }
}

async function readWeekRow(supabase: SupabaseClient, userId: string, weekStart: string): Promise<WeeklyCheckinRow | null> {
  const { data, error } = await supabase
    .from('weekly_checkins')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start_date', weekStart)
    .maybeSingle();
  throwDbError(error, 'weeks.read');
  return (data as WeeklyCheckinRow | null) ?? null;
}

/** Read a week without creating it. */
export async function findWeek(supabase: SupabaseClient, userId: string, weekStart: string): Promise<WeeklyCheckin | null> {
  const row = await readWeekRow(supabase, userId, weekStart);
  return row ? toWeeklyCheckin(row) : null;
}

/**
 * Get-or-create the week row. New rows get a goals snapshot from the phase
 * covering the week, else the open phase, else built-in defaults (doc 02 s.7).
 */
export async function ensureWeek(supabase: SupabaseClient, userId: string, weekStart: string): Promise<WeeklyCheckin> {
  assertMonday(weekStart);
  const existing = await readWeekRow(supabase, userId, weekStart);
  if (existing) return toWeeklyCheckin(existing);

  const phase = await findPhaseForWeek(supabase, userId, weekStart);
  const { error } = await supabase.from('weekly_checkins').upsert(
    {
      user_id: userId,
      week_start_date: weekStart,
      phase_id: phase?.id ?? null,
      goals_snapshot: phase ? phaseToSnapshot(phase) : defaultGoalsSnapshot(),
    },
    { onConflict: 'user_id,week_start_date', ignoreDuplicates: true },
  );
  throwDbError(error, 'weeks.ensure');
  const created = await readWeekRow(supabase, userId, weekStart);
  if (!created) throw new ApiError('internal_error', 'Unexpected error');
  return toWeeklyCheckin(created);
}

export function assertWeekOpen(week: WeeklyCheckin): void {
  if (week.closed_at) throw weekClosed();
}

async function phaseSummary(supabase: SupabaseClient, userId: string, phaseId: string | null): Promise<PhaseSummary | null> {
  if (!phaseId) return null;
  try {
    const p = await getPhase(supabase, userId, phaseId);
    return {
      id: p.id,
      name: p.name,
      start_date: p.start_date,
      start_weight_kg: p.start_weight_kg,
      target_weight_kg: p.target_weight_kg,
    };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'not_found') return null;
    throw e;
  }
}

async function bundleFor(supabase: SupabaseClient, userId: string, checkin: WeeklyCheckin): Promise<WeekBundle> {
  const weekStart = checkin.week_start_date;
  const [daysRes, workoutsRes, settings, phase] = await Promise.all([
    supabase.from('daily_logs').select('*').eq('user_id', userId).eq('week_start_date', weekStart).order('log_date', { ascending: true }),
    supabase.from('workouts').select('*').eq('user_id', userId).eq('week_start_date', weekStart).order('log_date', { ascending: true }),
    getSettings(supabase, userId),
    phaseSummary(supabase, userId, checkin.phase_id),
  ]);
  throwDbError(daysRes.error, 'weeks.days');
  throwDbError(workoutsRes.error, 'weeks.workouts');
  const byDate = new Map(((daysRes.data ?? []) as DailyLogRow[]).map((r) => [r.log_date, toDailyLog(r)]));
  return {
    checkin,
    days: weekDates(weekStart).map((d) => byDate.get(d) ?? null),
    workouts: ((workoutsRes.data ?? []) as WorkoutRow[]).map(toWorkout),
    phase,
    week_number: settings.program_start_date ? weekNumber(weekStart, settings.program_start_date) : null,
  };
}

/** GET /weeks/{weekStart}. Creates the week row if missing. */
export async function getWeekBundle(supabase: SupabaseClient, userId: string, weekStart: string): Promise<WeekBundle> {
  const checkin = await ensureWeek(supabase, userId, weekStart);
  return bundleFor(supabase, userId, checkin);
}

/** GET /weeks?from&to. Existing weeks only; `days` holds only the logged days (no nulls). Max 26 weeks. */
export async function listWeeks(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string,
): Promise<{ weeks: { checkin: WeeklyCheckin; days: DailyLog[]; workouts: Workout[] }[] }> {
  assertMonday(from);
  assertMonday(to);
  if (to < from) throw validationError('Invalid request', [{ path: ['to'], message: '`to` must be on or after `from`' }]);
  if (weekNumber(to, from) > 26) throw validationError('Invalid request', [{ path: ['to'], message: 'Range is limited to 26 weeks' }]);
  const lastDay = addDays(to, 6);

  const [weeksRes, daysRes, workoutsRes] = await Promise.all([
    supabase.from('weekly_checkins').select('*').eq('user_id', userId).gte('week_start_date', from).lte('week_start_date', to).order('week_start_date', { ascending: true }),
    supabase.from('daily_logs').select('*').eq('user_id', userId).gte('log_date', from).lte('log_date', lastDay).order('log_date', { ascending: true }),
    supabase.from('workouts').select('*').eq('user_id', userId).gte('log_date', from).lte('log_date', lastDay).order('log_date', { ascending: true }),
  ]);
  throwDbError(weeksRes.error, 'weeks.list');
  throwDbError(daysRes.error, 'weeks.list.days');
  throwDbError(workoutsRes.error, 'weeks.list.workouts');

  const days = (daysRes.data ?? []) as DailyLogRow[];
  const workouts = (workoutsRes.data ?? []) as WorkoutRow[];
  return {
    weeks: ((weeksRes.data ?? []) as WeeklyCheckinRow[]).map((w) => ({
      checkin: toWeeklyCheckin(w),
      days: days.filter((d) => d.week_start_date === w.week_start_date).map(toDailyLog),
      workouts: workouts.filter((x) => x.week_start_date === w.week_start_date).map(toWorkout),
    })),
  };
}

const PHOTO_KEYS = ['photo_front_path', 'photo_side_path', 'photo_back_path'] as const;

/** PUT /weeks/{weekStart}. Only the whitelisted body keys are written. */
export async function updateWeek(supabase: SupabaseClient, userId: string, weekStart: string, body: WeekPutBody): Promise<WeekBundle> {
  const week = await ensureWeek(supabase, userId, weekStart);
  assertWeekOpen(week);

  const prefix = `${userId}/${weekStart}/`;
  for (const k of PHOTO_KEYS) {
    const v = body[k];
    if (typeof v === 'string' && !v.startsWith(prefix)) {
      throw validationError('Invalid request', [{ path: [k], message: `Must start with ${prefix}` }]);
    }
  }

  const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return bundleFor(supabase, userId, week);

  const { data, error } = await supabase
    .from('weekly_checkins')
    .update(patch)
    .eq('user_id', userId)
    .eq('week_start_date', weekStart)
    .select('*')
    .single();
  throwDbError(error, 'weeks.update');
  return bundleFor(supabase, userId, toWeeklyCheckin(data as WeeklyCheckinRow));
}

/** POST /weeks/{weekStart}/close */
export async function closeWeek(supabase: SupabaseClient, userId: string, weekStart: string): Promise<WeekBundle> {
  assertMonday(weekStart);
  const settings = await getSettings(supabase, userId);
  const currentWeek = weekStartOf(todayInTz(settings.timezone));
  if (weekStart > currentWeek) {
    throw validationError('Cannot close a week that has not started', [
      { path: ['weekStart'], message: 'Must not be after the current week' },
    ]);
  }
  const week = await ensureWeek(supabase, userId, weekStart);
  if (week.closed_at) throw conflict('Week is already closed');
  const { data, error } = await supabase
    .from('weekly_checkins')
    .update({ closed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('week_start_date', weekStart)
    .is('closed_at', null)
    .select('*')
    .maybeSingle();
  throwDbError(error, 'weeks.close');
  if (!data) throw conflict('Week is already closed');
  return bundleFor(supabase, userId, toWeeklyCheckin(data as WeeklyCheckinRow));
}

/** POST /weeks/{weekStart}/reopen. Needs `confirm: true`; `refresh_goals` re-reads the phase. */
export async function reopenWeek(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  opts: ReopenWeekBody,
): Promise<WeekBundle> {
  assertMonday(weekStart);
  if (opts.confirm !== true) {
    throw new ApiError('confirmation_required', 'Reopening a closed week needs { "confirm": true }');
  }
  const week = await findWeek(supabase, userId, weekStart);
  if (!week) throw notFound('Week not found');
  if (!week.closed_at) return bundleFor(supabase, userId, week); // already open: idempotent

  // The lock trigger only allows an update that sets closed_at = null: send just that.
  const re = await supabase
    .from('weekly_checkins')
    .update({ closed_at: null })
    .eq('user_id', userId)
    .eq('week_start_date', weekStart)
    .select('*')
    .single();
  throwDbError(re.error, 'weeks.reopen');
  let row = re.data as WeeklyCheckinRow;

  if (opts.refresh_goals === true) {
    const phase = await findPhaseForWeek(supabase, userId, weekStart);
    const rf = await supabase
      .from('weekly_checkins')
      .update({ phase_id: phase?.id ?? null, goals_snapshot: phase ? phaseToSnapshot(phase) : defaultGoalsSnapshot() })
      .eq('user_id', userId)
      .eq('week_start_date', weekStart)
      .select('*')
      .single();
    throwDbError(rf.error, 'weeks.refreshGoals');
    row = rf.data as WeeklyCheckinRow;
  }
  return bundleFor(supabase, userId, toWeeklyCheckin(row));
}
