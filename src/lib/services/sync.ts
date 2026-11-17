import type { SupabaseClient } from '@supabase/supabase-js';
import { throwDbError, validationError, type ApiIssue } from '@/lib/api/errors';
import {
  SyncValidationError,
  addDays,
  mergeSyncPayload,
  normalizeSyncPayload,
  todayInTz,
  weekStartOf,
  type DailyLog,
  type SyncDay,
  type WorkoutUpsert,
} from '@/lib/domain';
import { hasSecret } from './credentials';
import { toDailyLog } from './mappers';
import { ensureWeek } from './weeks';
import { getSettings } from './settings';

export interface SyncDayResult {
  date: string;
  updated_fields: string[];
  skipped: { field: string; reason: 'manual_edit' | 'empty' }[];
  workouts_upserted: number;
  skipped_closed_week: boolean;
}
export interface SyncResponse {
  status: 'ok';
  dry_run?: true;
  days: SyncDayResult[];
}

const MAX_SYNC_DAYS = 7;
const MAX_WORKOUTS_PER_DAY = 20;
const PAST_DAYS = 14;
const FUTURE_DAYS = 1;
const RANGES: Record<string, [number, number]> = {
  steps: [0, 100_000],
  weight_kg: [30, 300],
  protein_g: [0, 2000],
  carbs_g: [0, 2000],
  fat_g: [0, 2000],
  calories_kcal: [0, 10_000],
  resting_kcal: [0, 10_000],
  active_kcal: [0, 10_000],
};
const OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Limits from doc 03 that normalizeSyncPayload does not enforce. 0 and null mean "no data" and are not range-checked. */
function checkLimits(days: SyncDay[], today: string): void {
  const issues: string[] = [];
  if (days.length < 1 || days.length > MAX_SYNC_DAYS) issues.push(`days: must contain 1 to ${MAX_SYNC_DAYS} days (got ${days.length})`);
  const min = addDays(today, -PAST_DAYS);
  const max = addDays(today, FUTURE_DAYS);
  const seen = new Set<string>();
  days.forEach((d, i) => {
    const label = days.length === 1 ? 'payload' : `days[${i}]`;
    if (d.date < min || d.date > max) issues.push(`${label}.date: must be between ${min} and ${max}`);
    if (seen.has(d.date)) issues.push(`${label}.date: duplicate date ${d.date}`);
    seen.add(d.date);
    for (const [field, [lo, hi]] of Object.entries(RANGES)) {
      const v = (d as unknown as Record<string, unknown>)[field];
      if (typeof v === 'number' && v !== 0 && (v < lo || v > hi)) issues.push(`${label}.${field}: must be between ${lo} and ${hi}`);
    }
    const ws = d.workouts ?? [];
    if (ws.length > MAX_WORKOUTS_PER_DAY) issues.push(`${label}.workouts: at most ${MAX_WORKOUTS_PER_DAY} per day`);
    ws.forEach((w, j) => {
      const wl = `${label}.workouts[${j}]`;
      if (w.active_kcal < 0 || w.active_kcal > 5000) issues.push(`${wl}.active_kcal: must be between 0 and 5000`);
      if (w.duration_min !== undefined && (w.duration_min < 0 || w.duration_min > 10_000)) issues.push(`${wl}.duration_min: must be between 0 and 10000`);
      if (w.start !== undefined && !OFFSET_RE.test(w.start)) issues.push(`${wl}.start: must be ISO 8601 with a timezone offset`);
    });
  });
  if (issues.length) throw new SyncValidationError(issues);
}

/** 'days[0].steps: must be ...' -> { path: ['days', 0, 'steps'], message } */
export function syncIssuesToApi(issues: string[]): ApiIssue[] {
  return issues.map((s) => {
    const idx = s.indexOf(': ');
    const head = idx >= 0 ? s.slice(0, idx) : '';
    const message = idx >= 0 ? s.slice(idx + 2) : s;
    const path = head
      .split(/[.[\]]+/)
      .filter(Boolean)
      .map((t) => (/^\d+$/.test(t) ? Number(t) : t));
    return { path, message };
  });
}

type WorkoutRow = { id: string };

async function upsertWorkout(admin: SupabaseClient, userId: string, weekStart: string, w: WorkoutUpsert): Promise<void> {
  const find = async (): Promise<WorkoutRow | null> => {
    let q = admin.from('workouts').select('id').eq('user_id', userId).eq('log_date', w.log_date).eq('type_label', w.type_label);
    q = w.started_at
      ? q.eq('started_at', w.started_at)
      : q.is('started_at', null).eq('source', 'apple_health').eq('active_kcal', w.active_kcal);
    const { data, error } = await q.limit(1).maybeSingle();
    throwDbError(error, 'sync.workout.find');
    return (data as WorkoutRow | null) ?? null;
  };
  // Never touch volume_kg / strong_*: only these three columns change on update.
  const update = async (id: string): Promise<void> => {
    const { error } = await admin
      .from('workouts')
      .update({ category: w.category, active_kcal: w.active_kcal, duration_min: w.duration_min })
      .eq('id', id)
      .eq('user_id', userId);
    throwDbError(error, 'sync.workout.update');
  };

  const existing = await find();
  if (existing) return update(existing.id);

  const { error } = await admin.from('workouts').insert({
    user_id: userId,
    log_date: w.log_date,
    week_start_date: weekStart,
    category: w.category,
    type_label: w.type_label,
    active_kcal: w.active_kcal,
    duration_min: w.duration_min,
    started_at: w.started_at,
    source: 'apple_health',
  });
  if (error?.code === '23505') {
    const again = await find();
    if (again) return update(again.id);
  }
  throwDbError(error, 'sync.workout.insert');
}

async function weekIsClosed(admin: SupabaseClient, userId: string, weekStart: string, dryRun: boolean): Promise<boolean> {
  if (!dryRun) return !!(await ensureWeek(admin, userId, weekStart)).closed_at;
  // dry run must not create the week row
  const { data, error } = await admin
    .from('weekly_checkins')
    .select('closed_at')
    .eq('user_id', userId)
    .eq('week_start_date', weekStart)
    .maybeSingle();
  throwDbError(error, 'sync.week');
  return !!data?.closed_at;
}

export async function runSync(
  admin: SupabaseClient,
  userId: string,
  rawPayload: unknown,
  opts: { dryRun: boolean; now?: Date },
): Promise<SyncResponse> {
  const now = opts.now ?? new Date();
  const settings = await getSettings(admin, userId);
  const tz = settings?.timezone || 'America/Hermosillo';

  let days: SyncDay[];
  try {
    days = normalizeSyncPayload(rawPayload);
    checkLimits(days, todayInTz(tz, now));
  } catch (e) {
    if (e instanceof SyncValidationError) throw validationError('Invalid sync payload', syncIssuesToApi(e.issues));
    throw e;
  }
  days = [...days].sort((a, b) => a.date.localeCompare(b.date));

  const results: SyncDayResult[] = [];
  for (const day of days) {
    const weekStart = weekStartOf(day.date);
    if (await weekIsClosed(admin, userId, weekStart, opts.dryRun)) {
      results.push({ date: day.date, updated_fields: [], skipped: [], workouts_upserted: 0, skipped_closed_week: true });
      continue;
    }

    const { data: row, error: rowErr } = await admin
      .from('daily_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('log_date', day.date)
      .maybeSingle();
    throwDbError(rowErr, 'sync.day.load');
    const existing: DailyLog | null = row ? toDailyLog(row) : null;

    const merge = mergeSyncPayload(existing, day, { weekClosed: false, now });

    if (!opts.dryRun) {
      if (Object.keys(merge.patch).length > 0) {
        const record: Record<string, unknown> = { ...merge.patch, user_id: userId, log_date: day.date, week_start_date: weekStart };
        delete record.day_type; // never touch an existing day's type
        if (!existing) {
          const { data: prev, error: prevErr } = await admin
            .from('daily_logs')
            .select('day_type')
            .eq('user_id', userId)
            .lt('log_date', day.date)
            .order('log_date', { ascending: false })
            .limit(1)
            .maybeSingle();
          throwDbError(prevErr, 'sync.day.prev');
          record.day_type = (prev?.day_type as string | undefined) ?? 'ACTIVE';
        }
        const { error } = await admin.from('daily_logs').upsert(record, { onConflict: 'user_id,log_date' });
        throwDbError(error, 'sync.day.upsert');
      }
      for (const w of merge.workouts) await upsertWorkout(admin, userId, weekStart, w);
    }

    results.push({
      date: day.date,
      updated_fields: merge.updated_fields,
      skipped: merge.skipped,
      workouts_upserted: merge.workouts.length,
      skipped_closed_week: false,
    });
  }

  return opts.dryRun ? { status: 'ok', dry_run: true, days: results } : { status: 'ok', days: results };
}

export interface SyncStatus {
  last_sync_at: string | null;
  last_synced_dates: string[];
  has_secret: boolean;
}

/** last_synced_dates = days touched by the most recent run (same apple_health_synced_at as the max). */
export async function getSyncStatus(supabase: SupabaseClient, userId: string): Promise<SyncStatus> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('log_date, apple_health_synced_at')
    .eq('user_id', userId)
    .not('apple_health_synced_at', 'is', null)
    .order('apple_health_synced_at', { ascending: false })
    .limit(14);
  throwDbError(error, 'sync.status');
  const rows = (data ?? []) as { log_date: string; apple_health_synced_at: string }[];
  const top = rows[0] ? Date.parse(rows[0].apple_health_synced_at) : null;
  const dates = top === null ? [] : rows.filter((r) => Date.parse(r.apple_health_synced_at) === top).map((r) => r.log_date).sort();
  const secret = await hasSecret(userId);
  return { last_sync_at: rows[0]?.apple_health_synced_at ?? null, last_synced_dates: dates, has_secret: secret };
}
