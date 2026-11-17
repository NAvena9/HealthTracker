import type { DailyLog, DayType, GoalsSnapshot, StrongParseResult, WeeklyCheckin, Workout, WorkoutCategory, WorkoutSource } from '@/lib/domain';

/** Postgres `numeric` columns may arrive as strings through PostgREST. */
type Numeric = number | string | null;

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

// ---------------------------------------------------------------------------
// Row types (mirror supabase/migrations/001_init.sql)
// ---------------------------------------------------------------------------

export interface DailyLogRow {
  id: string;
  user_id: string;
  log_date: string;
  week_start_date: string;
  day_type: DayType;
  weight_kg: Numeric;
  steps: number | null;
  protein_g: Numeric;
  carbs_g: Numeric;
  fat_g: Numeric;
  calories_kcal: number | null;
  resting_kcal: number | null;
  active_kcal_total: number | null;
  edited_fields: string[] | null;
  apple_health_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutRow {
  id: string;
  user_id: string;
  log_date: string;
  week_start_date: string;
  category: WorkoutCategory;
  type_label: string;
  active_kcal: number | null;
  duration_min: Numeric;
  started_at: string | null;
  source: WorkoutSource;
  volume_kg: Numeric;
  strong_title: string | null;
  strong_raw_txt: string | null;
  strong_parsed: StrongParseResult | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyCheckinRow {
  id: string;
  user_id: string;
  week_start_date: string;
  phase_id: string | null;
  goals_snapshot: GoalsSnapshot;
  waist_cm: Numeric;
  hip_cm: Numeric;
  chest_cm: Numeric;
  arm_cm: Numeric;
  leg_cm: Numeric;
  photo_front_path: string | null;
  photo_side_path: string | null;
  photo_back_path: string | null;
  external_folder_url: string | null;
  reflection_highlights: string | null;
  reflection_hard: string | null;
  reflection_next_goals: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Phase as returned by the API (user_id stripped, numerics as numbers). */
export interface Phase {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  start_weight_kg: number | null;
  target_weight_kg: number | null;
  active_protein_g: number;
  active_carbs_g: number;
  active_fat_g: number;
  active_kcal: number;
  rest_protein_g: number;
  rest_carbs_g: number;
  rest_fat_g: number;
  rest_kcal: number;
  daily_step_goal: number;
  weekly_step_goal: number;
  weekly_weighin_goal: number;
  weekly_cardio_sessions: number | null;
  weekly_strength_sessions: number | null;
  created_at: string;
  updated_at: string;
}
export type PhaseRow = Omit<Phase, 'start_weight_kg' | 'target_weight_kg'> & {
  user_id: string;
  start_weight_kg: Numeric;
  target_weight_kg: Numeric;
};

export interface UserSettings {
  timezone: string;
  program_start_date: string | null;
  strong_default_unit: 'kg' | 'lb';
  appearance: 'system' | 'light' | 'dark';
  created_at: string;
  updated_at: string;
}
export type UserSettingsRow = UserSettings & { user_id: string };

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function toDailyLog(row: DailyLogRow): DailyLog {
  return {
    log_date: row.log_date,
    week_start_date: row.week_start_date,
    day_type: row.day_type,
    weight_kg: numOrNull(row.weight_kg),
    steps: numOrNull(row.steps),
    protein_g: numOrNull(row.protein_g),
    carbs_g: numOrNull(row.carbs_g),
    fat_g: numOrNull(row.fat_g),
    calories_kcal: numOrNull(row.calories_kcal),
    resting_kcal: numOrNull(row.resting_kcal),
    active_kcal_total: numOrNull(row.active_kcal_total),
    edited_fields: row.edited_fields ?? [],
    apple_health_synced_at: row.apple_health_synced_at ?? null,
  };
}

export function toWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    log_date: row.log_date,
    category: row.category,
    type_label: row.type_label,
    active_kcal: numOrNull(row.active_kcal),
    duration_min: numOrNull(row.duration_min),
    started_at: row.started_at ?? null,
    source: row.source,
    volume_kg: numOrNull(row.volume_kg),
    strong_title: row.strong_title ?? null,
    strong_raw_txt: row.strong_raw_txt ?? null,
    strong_parsed: row.strong_parsed ?? null,
  };
}

export function toWeeklyCheckin(row: WeeklyCheckinRow): WeeklyCheckin {
  return {
    week_start_date: row.week_start_date,
    phase_id: row.phase_id ?? null,
    goals_snapshot: row.goals_snapshot,
    waist_cm: numOrNull(row.waist_cm),
    hip_cm: numOrNull(row.hip_cm),
    chest_cm: numOrNull(row.chest_cm),
    arm_cm: numOrNull(row.arm_cm),
    leg_cm: numOrNull(row.leg_cm),
    photo_front_path: row.photo_front_path ?? null,
    photo_side_path: row.photo_side_path ?? null,
    photo_back_path: row.photo_back_path ?? null,
    external_folder_url: row.external_folder_url ?? null,
    reflection_highlights: row.reflection_highlights ?? null,
    reflection_hard: row.reflection_hard ?? null,
    reflection_next_goals: row.reflection_next_goals ?? null,
    closed_at: row.closed_at ?? null,
  };
}

export function toPhase(row: PhaseRow): Phase {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user_id: _userId, ...rest } = row;
  return {
    ...rest,
    start_weight_kg: numOrNull(row.start_weight_kg),
    target_weight_kg: numOrNull(row.target_weight_kg),
  };
}

export function toUserSettings(row: UserSettingsRow): UserSettings {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user_id: _userId, ...rest } = row;
  return rest;
}
