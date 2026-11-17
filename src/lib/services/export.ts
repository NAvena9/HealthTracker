import type { SupabaseClient } from '@supabase/supabase-js';
import { throwDbError, validationError } from '@/lib/api/errors';

export type CsvTable = 'daily_logs' | 'workouts' | 'weekly_checkins';

export const CSV_COLUMNS: Record<CsvTable, readonly string[]> = {
  daily_logs: [
    'log_date', 'week_start_date', 'day_type', 'weight_kg', 'steps', 'protein_g', 'carbs_g', 'fat_g',
    'calories_kcal', 'resting_kcal', 'active_kcal_total', 'edited_fields', 'apple_health_synced_at',
  ],
  workouts: [
    'log_date', 'week_start_date', 'category', 'type_label', 'active_kcal', 'duration_min', 'started_at',
    'source', 'volume_kg', 'strong_title',
  ],
  weekly_checkins: [
    'week_start_date', 'phase_id', 'waist_cm', 'hip_cm', 'chest_cm', 'arm_cm', 'leg_cm', 'photo_front_path',
    'photo_side_path', 'photo_back_path', 'external_folder_url', 'reflection_highlights', 'reflection_hard',
    'reflection_next_goals', 'closed_at', 'goals_snapshot',
  ],
};

export function parseCsvTable(t: string | null): CsvTable {
  if (t === 'daily_logs' || t === 'workouts' || t === 'weekly_checkins') return t;
  throw validationError('Invalid table', [{ path: ['table'], message: 'Must be daily_logs, workouts or weekly_checkins' }]);
}

const ORDER: Record<string, string> = {
  phases: 'start_date',
  weekly_checkins: 'week_start_date',
  daily_logs: 'log_date',
  workouts: 'log_date',
};

type Row = Record<string, unknown>;

async function fetchAll(supabase: SupabaseClient, table: string, userId: string): Promise<Row[]> {
  const out: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .order(ORDER[table]!, { ascending: true })
      .range(from, from + page - 1);
    throwDbError(error, `export.${table}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

const stripUser = (r: Row): Row => {
  const { user_id: _u, ...rest } = r;
  void _u;
  return rest;
};

export async function exportJson(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<Row> {
  const { data: settings, error } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
  throwDbError(error, 'export.user_settings');
  const [phases, weekly, daily, workouts] = await Promise.all([
    fetchAll(supabase, 'phases', userId),
    fetchAll(supabase, 'weekly_checkins', userId),
    fetchAll(supabase, 'daily_logs', userId),
    fetchAll(supabase, 'workouts', userId),
  ]);
  return {
    exported_at: now.toISOString(),
    schema_version: 1,
    user_settings: settings ? stripUser(settings as Row) : null,
    phases: phases.map(stripUser),
    weekly_checkins: weekly.map(stripUser),
    daily_logs: daily.map(stripUser),
    workouts: workouts.map(stripUser),
  };
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.map((x) => String(x)).join('|') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: CsvTable, rows: Row[]): string {
  const cols = CSV_COLUMNS[table];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

export async function exportCsv(supabase: SupabaseClient, userId: string, table: CsvTable): Promise<string> {
  return toCsv(table, await fetchAll(supabase, table, userId));
}

/** Date (YYYY-MM-DD) in the user's timezone, for filenames. */
export async function exportDate(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<string> {
  const { data } = await supabase.from('user_settings').select('timezone').eq('user_id', userId).maybeSingle();
  const tz = (data?.timezone as string | undefined) || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
