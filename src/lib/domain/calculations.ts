import type {
  ComparisonResult,
  DailyLog,
  GoalsSnapshot,
  MacroAdherence,
  MacroKey,
  MetricDelta,
  Status,
  WeeklyCheckin,
  Workout,
  WeekSummary,
} from './types';
import { weekDates } from './weekUtils';

const MACRO_KEYS: MacroKey[] = ['protein_g', 'carbs_g', 'fat_g', 'calories_kcal'];

/**
 * Round half away from zero to `decimals` places, avoiding binary floating drift
 * (e.g. 86.625 -> 86.63, 1.005 -> 1.01).
 */
export function roundHalfUp(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const snapped = Number(Math.abs(x).toPrecision(15)); // strip representation noise
  const str = String(snapped);
  let r: number;
  if (str.includes('e')) {
    const f = 10 ** decimals;
    r = Math.round((snapped + Number.EPSILON) * f) / f;
  } else {
    r = Number(`${Math.round(Number(`${str}e${decimals}`))}e-${decimals}`);
  }
  const out = sign * r;
  return out === 0 ? 0 : out;
}

const r1 = (x: number) => roundHalfUp(x, 1);
const r2 = (x: number) => roundHalfUp(x, 2);
const r0 = (x: number) => roundHalfUp(x, 0);

function targetsFor(goals: GoalsSnapshot, dayType: DailyLog['day_type']) {
  return dayType === 'ACTIVE' ? goals.active : goals.rest;
}

/** 4 kcal per g protein and carbs, 9 kcal per g fat. */
export function kcalFromMacros(p: number, c: number, f: number): number {
  return 4 * p + 4 * c + 9 * f;
}

/** Daily adherence per macro: actual / target of that day's type, 1 decimal. */
export function dailyAdherence(log: DailyLog, goals: GoalsSnapshot): Record<MacroKey, MacroAdherence> {
  const t = targetsFor(goals, log.day_type);
  const out = {} as Record<MacroKey, MacroAdherence>;
  for (const key of MACRO_KEYS) {
    const actual = log[key];
    const target = t[key];
    out[key] = {
      actual,
      target,
      pct: actual === null || actual === undefined || !(target > 0) ? null : r1((actual / target) * 100),
    };
  }
  return out;
}

export function statusForPercent(kind: 'macro' | 'volume', pct: number | null): Status {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return 'none';
  if (kind === 'macro') {
    if (pct >= 95 && pct <= 105) return 'on_target';
    if ((pct >= 85 && pct < 95) || (pct > 105 && pct <= 115)) return 'near';
    return 'off';
  }
  if (pct >= 100) return 'on_target';
  if (pct >= 80) return 'near';
  return 'off';
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function weeklySummary(input: {
  weekStart: string;
  logs: DailyLog[];
  workouts: Workout[];
  goals: GoalsSnapshot;
}): WeekSummary {
  const { weekStart, goals } = input;
  const dates = new Set(weekDates(weekStart));
  const logs = input.logs.filter((l) => dates.has(l.log_date));
  const workouts = input.workouts.filter((w) => dates.has(w.log_date));

  // days_logged
  const loggedDates = new Set<string>();
  for (const l of logs) {
    if (
      isNum(l.weight_kg) ||
      isNum(l.steps) ||
      MACRO_KEYS.some((k) => isNum(l[k]))
    ) {
      loggedDates.add(l.log_date);
    }
  }
  for (const w of workouts) loggedDates.add(w.log_date);

  // day types over days with any nutrition
  const dayTypes = { active: 0, rest: 0 };
  for (const l of logs) {
    if (MACRO_KEYS.some((k) => isNum(l[k]))) {
      if (l.day_type === 'ACTIVE') dayTypes.active += 1;
      else dayTypes.rest += 1;
    }
  }

  // weight
  const weights = logs.map((l) => l.weight_kg).filter(isNum);
  const weightAvg = weights.length ? r2(weights.reduce((a, b) => a + b, 0) / weights.length) : null;

  // steps
  const stepsLogs = logs.filter((l) => isNum(l.steps));
  const stepsTotal = stepsLogs.reduce((a, l) => a + (l.steps as number), 0);
  const stepsDays = stepsLogs.length;

  // nutrition
  const nutrition = {} as WeekSummary['nutrition'];
  for (const key of MACRO_KEYS) {
    const days = logs.filter((l) => isNum(l[key]));
    if (days.length === 0) {
      nutrition[key] = { actual_avg: null, target_avg: null, achieved_pct: null, days: 0 };
      continue;
    }
    const actualAvg = days.reduce((a, l) => a + (l[key] as number), 0) / days.length;
    const targetAvg = days.reduce((a, l) => a + targetsFor(goals, l.day_type)[key], 0) / days.length;
    nutrition[key] = {
      actual_avg: r1(actualAvg),
      target_avg: r1(targetAvg),
      achieved_pct: targetAvg > 0 ? r1((actualAvg / targetAvg) * 100) : null,
      days: days.length,
    };
  }

  // training
  let cardioKcal = 0;
  let strengthKcal = 0;
  let cardioSessions = 0;
  let strengthSessions = 0;
  let volume = 0;
  for (const w of workouts) {
    const kcal = isNum(w.active_kcal) ? w.active_kcal : 0;
    if (w.category === 'STRENGTH') {
      strengthKcal += kcal;
      strengthSessions += 1;
      volume += isNum(w.volume_kg) ? w.volume_kg : 0;
    } else {
      cardioKcal += kcal;
      cardioSessions += 1;
    }
  }

  // energy
  let eaten = 0;
  let burned = 0;
  let energyDays = 0;
  for (const l of logs) {
    if (isNum(l.calories_kcal) && isNum(l.resting_kcal) && isNum(l.active_kcal_total)) {
      eaten += l.calories_kcal;
      burned += l.resting_kcal + l.active_kcal_total;
      energyDays += 1;
    }
  }
  const net = eaten - burned;

  return {
    week_start_date: weekStart,
    days_logged: loggedDates.size,
    day_types: dayTypes,
    weight: {
      avg_kg: weightAvg,
      count: weights.length,
      goal: goals.weekly_weighin_goal,
      goal_met: weights.length >= goals.weekly_weighin_goal,
    },
    steps: {
      total: r0(stepsTotal),
      avg_per_day: stepsDays ? r1(stepsTotal / stepsDays) : null,
      weekly_goal: goals.weekly_step_goal,
      pct_of_weekly_goal: goals.weekly_step_goal > 0 && stepsDays ? r1((stepsTotal / goals.weekly_step_goal) * 100) : null,
      days_at_goal: stepsLogs.filter((l) => (l.steps as number) >= goals.daily_step_goal).length,
    },
    nutrition,
    training: {
      cardio_kcal: r0(cardioKcal),
      strength_kcal: r0(strengthKcal),
      total_kcal: r0(cardioKcal + strengthKcal),
      cardio_sessions: cardioSessions,
      strength_sessions: strengthSessions,
      cardio_target: goals.weekly_cardio_sessions,
      strength_target: goals.weekly_strength_sessions,
      volume_kg: r0(volume),
    },
    energy: {
      eaten_kcal: r0(eaten),
      burned_kcal: r0(burned),
      net_kcal: r0(net),
      days_counted: energyDays,
      avg_net_per_day: energyDays ? r1(net / energyDays) : null,
    },
  };
}

function metricDelta(a: number | null, b: number | null): MetricDelta {
  if (!isNum(a) || !isNum(b)) return { a: isNum(a) ? a : null, b: isNum(b) ? b : null, delta: null, delta_pct: null };
  const delta = r2(b - a);
  return { a, b, delta, delta_pct: a === 0 ? null : r1(((b - a) / a) * 100) };
}

export function compareWeeks(
  a: { summary: WeekSummary; checkin: WeeklyCheckin },
  b: { summary: WeekSummary; checkin: WeeklyCheckin },
): ComparisonResult {
  const pair = (fa: (x: typeof a) => number | null, fb: (x: typeof b) => number | null = fa) =>
    metricDelta(fa(a), fb(b));
  return {
    results: {
      weight_kg: pair((x) => x.summary.weight.avg_kg),
      waist_cm: pair((x) => x.checkin.waist_cm),
      hip_cm: pair((x) => x.checkin.hip_cm),
      chest_cm: pair((x) => x.checkin.chest_cm),
      arm_cm: pair((x) => x.checkin.arm_cm),
      leg_cm: pair((x) => x.checkin.leg_cm),
    },
    effort: {
      steps_avg_per_day: pair((x) => x.summary.steps.avg_per_day),
      active_burn_per_day: pair((x) => r0(x.summary.training.total_kcal / 7)),
      calorie_adherence_pct: pair((x) => x.summary.nutrition.calories_kcal.achieved_pct),
      strength_volume_kg: pair((x) => x.summary.training.volume_kg),
      cardio_sessions: pair((x) => x.summary.training.cardio_sessions),
      strength_sessions: pair((x) => x.summary.training.strength_sessions),
    },
  };
}
