import type { DailyLog, DayType, GoalsSnapshot, Workout, WeeklyCheckin } from '../src/lib/domain';

export const GOALS: GoalsSnapshot = {
  active: { protein_g: 190, carbs_g: 240, fat_g: 70, calories_kcal: 2350 },
  rest: { protein_g: 190, carbs_g: 200, fat_g: 60, calories_kcal: 2100 },
  daily_step_goal: 10000,
  weekly_step_goal: 70000,
  weekly_weighin_goal: 3,
  weekly_cardio_sessions: 3,
  weekly_strength_sessions: 4,
  target_weight_kg: 80,
};

export function log(date: string, day_type: DayType, over: Partial<DailyLog> = {}): DailyLog {
  return {
    log_date: date,
    week_start_date: '2026-11-09',
    day_type,
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
    ...over,
  };
}

export function workout(date: string, category: 'CARDIO' | 'STRENGTH', kcal: number | null, over: Partial<Workout> = {}): Workout {
  return {
    id: `${date}-${category}-${kcal}`,
    log_date: date,
    category,
    type_label: category === 'CARDIO' ? 'Running' : 'Traditional Strength Training',
    active_kcal: kcal,
    duration_min: null,
    started_at: null,
    source: 'apple_health',
    volume_kg: null,
    strong_title: null,
    strong_raw_txt: null,
    strong_parsed: null,
    ...over,
  };
}

export function checkin(over: Partial<WeeklyCheckin> = {}): WeeklyCheckin {
  return {
    week_start_date: '2026-11-09',
    phase_id: null,
    goals_snapshot: GOALS,
    waist_cm: null,
    hip_cm: null,
    chest_cm: null,
    arm_cm: null,
    leg_cm: null,
    photo_front_path: null,
    photo_side_path: null,
    photo_back_path: null,
    external_folder_url: null,
    reflection_highlights: null,
    reflection_hard: null,
    reflection_next_goals: null,
    closed_at: null,
    ...over,
  };
}

// Monday 2026-11-09 .. Sunday 2026-11-15
export const WEEK = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
