// Canonical domain types. Pure TypeScript, no DOM or framework imports.
// DB row types use snake_case and mirror supabase/migrations/001_init.sql exactly.
// Dates are 'YYYY-MM-DD' strings in the user's timezone. Timestamps are ISO 8601 strings.

export type DayType = 'ACTIVE' | 'REST'; // 'REFEED' reserved, not built
export type WorkoutCategory = 'CARDIO' | 'STRENGTH';
export type MacroKey = 'protein_g' | 'carbs_g' | 'fat_g' | 'calories_kcal';
export type PoseKey = 'front' | 'side' | 'back';
export type Status = 'on_target' | 'near' | 'off' | 'none'; // UI maps on_target=green, near=amber, off=neutral, none=grey

export interface MacroTargets {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calories_kcal: number;
}

export interface GoalsSnapshot {
  active: MacroTargets;
  rest: MacroTargets;
  daily_step_goal: number; // 10000
  weekly_step_goal: number; // 70000
  weekly_weighin_goal: number; // 3
  weekly_cardio_sessions: number | null; // optional target
  weekly_strength_sessions: number | null; // optional target
  target_weight_kg: number | null;
}

export interface DailyLog {
  log_date: string;
  week_start_date: string; // Monday of log_date
  day_type: DayType;
  weight_kg: number | null;
  steps: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  calories_kcal: number | null;
  resting_kcal: number | null; // Apple Health Resting Energy
  active_kcal_total: number | null; // Apple Health Active Energy (whole day)
  edited_fields: string[]; // fields typed by hand; sync must not overwrite them
  apple_health_synced_at: string | null;
}

export type WorkoutSource = 'apple_health' | 'manual' | 'strong';

export interface Workout {
  id: string;
  log_date: string;
  category: WorkoutCategory;
  type_label: string; // e.g. 'Running', 'Traditional Strength Training'
  active_kcal: number | null;
  duration_min: number | null;
  started_at: string | null; // ISO, used with type_label to dedupe synced sessions
  source: WorkoutSource;
  volume_kg: number | null; // strength only, from Strong
  strong_title: string | null;
  strong_raw_txt: string | null;
  strong_parsed: StrongParseResult | null;
}

export interface WeeklyCheckin {
  week_start_date: string;
  phase_id: string | null;
  goals_snapshot: GoalsSnapshot;
  waist_cm: number | null;
  hip_cm: number | null;
  chest_cm: number | null;
  arm_cm: number | null;
  leg_cm: number | null;
  photo_front_path: string | null;
  photo_side_path: string | null;
  photo_back_path: string | null;
  external_folder_url: string | null;
  reflection_highlights: string | null;
  reflection_hard: string | null;
  reflection_next_goals: string | null;
  closed_at: string | null; // non-null = locked
}

// ---------- Strong parser ----------
export interface ParsedSet {
  setNumber: number;
  weightKg: number; // converted from lb when needed
  reps: number;
  volumeKg: number;
}
export interface ParsedExercise {
  name: string;
  sets: ParsedSet[];
  exerciseVolumeKg: number;
}
export interface StrongParseResult {
  workoutTitle: string;
  performedAt: string | null; // 'YYYY-MM-DDTHH:mm' local, from the date line if present
  shareUrl: string | null; // link.strong.app URL if present
  totalVolumeKg: number; // rounded to whole kg
  totalSets: number;
  exercises: ParsedExercise[];
  rawText: string;
  warnings: string[]; // e.g. unparsed lines
}

// ---------- Sync ----------
export interface SyncWorkout {
  type: string;
  active_kcal: number;
  duration_min?: number;
  start?: string; // ISO timestamp, strongly recommended (dedupe key)
}
export interface SyncDay {
  date: string;
  steps?: number | null;
  weight_kg?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  calories_kcal?: number | null;
  resting_kcal?: number | null;
  active_kcal?: number | null;
  workouts?: SyncWorkout[];
}
// v1 = one SyncDay object (Gemini draft). v2 = { schema: 2, days: SyncDay[] }.
export type SyncPayload = SyncDay | { schema: 2; days: SyncDay[] };

export interface WorkoutUpsert {
  log_date: string;
  category: WorkoutCategory;
  type_label: string;
  active_kcal: number;
  duration_min: number | null;
  started_at: string | null;
  source: 'apple_health';
}
export interface SyncMergeResult {
  patch: Partial<DailyLog>;
  updated_fields: string[];
  skipped: { field: string; reason: 'manual_edit' | 'empty' }[];
  workouts: WorkoutUpsert[];
}

// ---------- Calculation outputs ----------
export interface MacroAdherence {
  actual: number | null;
  target: number;
  pct: number | null; // 1 decimal
}

export interface WeekSummary {
  week_start_date: string;
  days_logged: number; // days with any nutrition, weight, steps or workouts
  day_types: { active: number; rest: number }; // over logged-nutrition days
  weight: { avg_kg: number | null; count: number; goal: number; goal_met: boolean };
  steps: {
    total: number;
    avg_per_day: number | null;
    weekly_goal: number;
    pct_of_weekly_goal: number | null;
    days_at_goal: number;
  };
  nutrition: Record<
    MacroKey,
    { actual_avg: number | null; target_avg: number | null; achieved_pct: number | null; days: number }
  >;
  training: {
    cardio_kcal: number;
    strength_kcal: number;
    total_kcal: number;
    cardio_sessions: number;
    strength_sessions: number;
    cardio_target: number | null;
    strength_target: number | null;
    volume_kg: number;
  };
  energy: {
    eaten_kcal: number;
    burned_kcal: number; // resting + active
    net_kcal: number; // eaten - burned, negative = deficit
    days_counted: number; // days having eaten, resting and active
    avg_net_per_day: number | null;
  };
}

export interface MetricDelta {
  a: number | null;
  b: number | null;
  delta: number | null; // b - a
  delta_pct: number | null; // relative to a, 1 decimal
}
export interface ComparisonResult {
  results: Record<'weight_kg' | 'waist_cm' | 'hip_cm' | 'chest_cm' | 'arm_cm' | 'leg_cm', MetricDelta>;
  effort: Record<
    | 'steps_avg_per_day'
    | 'active_burn_per_day'
    | 'calorie_adherence_pct'
    | 'strength_volume_kg'
    | 'cardio_sessions'
    | 'strength_sessions',
    MetricDelta
  >;
}
