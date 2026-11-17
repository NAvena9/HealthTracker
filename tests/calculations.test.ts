import { describe, expect, it } from 'vitest';
import {
  compareWeeks,
  dailyAdherence,
  kcalFromMacros,
  roundHalfUp,
  statusForPercent,
  weeklySummary,
} from '../src/lib/domain';
import { GOALS, WEEK, checkin, log, workout } from './fixtures';

const types = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'REST', 'REST', 'REST'] as const;

describe('vector 1: full week', () => {
  const kcal = [2300, 2400, 2350, 2250, 2100, 2000, 2150];
  const logs = WEEK.map((d, i) => log(d, types[i], { calories_kcal: kcal[i] }));
  const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
  it('target avg, actual avg, achieved %', () => {
    expect(s.nutrition.calories_kcal.target_avg).toBeCloseTo(2242.857, 0);
    expect(s.nutrition.calories_kcal.target_avg).toBe(2242.9);
    expect(s.nutrition.calories_kcal.actual_avg).toBeCloseTo(2221.43, 0);
    expect(s.nutrition.calories_kcal.achieved_pct).toBe(99.0);
    expect(s.nutrition.calories_kcal.days).toBe(7);
    expect(s.day_types).toEqual({ active: 4, rest: 3 });
    expect(s.days_logged).toBe(7);
  });
  it('macros never logged are null, not zero', () => {
    expect(s.nutrition.protein_g).toEqual({ actual_avg: null, target_avg: null, achieved_pct: null, days: 0 });
  });
});

describe('vector 2: partial week is not skewed', () => {
  it('target avg uses only logged days', () => {
    const logs = [
      log(WEEK[0], 'ACTIVE', { calories_kcal: 2350 }),
      log(WEEK[1], 'ACTIVE', { calories_kcal: 2350 }),
      log(WEEK[2], 'ACTIVE'), // not logged
      log(WEEK[4], 'REST', { calories_kcal: 2100 }),
    ];
    const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
    expect(s.nutrition.calories_kcal.target_avg).toBeCloseTo(2266.67, 1);
    expect(s.nutrition.calories_kcal.days).toBe(3);
    expect(s.nutrition.calories_kcal.achieved_pct).toBeCloseTo(((2350 + 2350 + 2100) / 3 / ((2350 + 2350 + 2100) / 3)) * 100, 1);
  });
  it('each metric uses its own logged days', () => {
    const logs = [
      log(WEEK[0], 'ACTIVE', { calories_kcal: 2350, protein_g: 190 }),
      log(WEEK[4], 'REST', { calories_kcal: 2100 }),
    ];
    const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
    expect(s.nutrition.protein_g.days).toBe(1);
    expect(s.nutrition.protein_g.target_avg).toBe(190);
    expect(s.nutrition.calories_kcal.target_avg).toBe(2225);
  });
});

describe('vector 3: net balance', () => {
  it('2300 - (1850 + 900) = -450', () => {
    const logs = [log(WEEK[0], 'ACTIVE', { calories_kcal: 2300, resting_kcal: 1850, active_kcal_total: 900 })];
    const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
    expect(s.energy).toEqual({ eaten_kcal: 2300, burned_kcal: 2750, net_kcal: -450, days_counted: 1, avg_net_per_day: -450 });
  });
  it('only counts days with calories, resting and active all present', () => {
    const logs = [
      log(WEEK[0], 'ACTIVE', { calories_kcal: 2300, resting_kcal: 1850, active_kcal_total: 900 }),
      log(WEEK[1], 'ACTIVE', { calories_kcal: 2300, resting_kcal: 1850 }), // no active
      log(WEEK[2], 'ACTIVE', { resting_kcal: 1850, active_kcal_total: 500 }), // no calories
      log(WEEK[3], 'ACTIVE', { calories_kcal: 2000, resting_kcal: 1800, active_kcal_total: 600 }), // -400
    ];
    const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
    expect(s.energy.days_counted).toBe(2);
    expect(s.energy.net_kcal).toBe(-850);
    expect(s.energy.avg_net_per_day).toBe(-425);
  });
});

describe('vector 4: steps', () => {
  it('72,480 against 70,000 = 103.5%', () => {
    const steps = [10000, 11000, 10480, 9000, 12000, 10000, 10000];
    expect(steps.reduce((a, b) => a + b)).toBe(72480);
    const logs = WEEK.map((d, i) => log(d, types[i], { steps: steps[i] }));
    const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
    expect(s.steps.total).toBe(72480);
    expect(s.steps.pct_of_weekly_goal).toBe(103.5);
    expect(s.steps.days_at_goal).toBe(6);
    expect(s.steps.avg_per_day).toBe(10354.3);
  });
  it('null steps are not zero: average only over days with steps', () => {
    const logs = [log(WEEK[0], 'ACTIVE', { steps: 10000 }), log(WEEK[1], 'ACTIVE', { steps: null }), log(WEEK[2], 'ACTIVE', { steps: 0 })];
    const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
    expect(s.steps.avg_per_day).toBe(5000); // 0 is a real logged zero
    expect(s.steps.total).toBe(10000);
  });
});

describe('vector 8: weigh-ins', () => {
  const w = (vals: number[]) =>
    weeklySummary({
      weekStart: '2026-11-09',
      logs: vals.map((v, i) => log(WEEK[i], 'ACTIVE', { weight_kg: v })),
      workouts: [],
      goals: GOALS,
    });
  it('3 days -> goal met', () => expect(w([87, 86.8, 86.5]).weight.goal_met).toBe(true));
  it('2 days -> goal not met', () => expect(w([87, 86.8]).weight.goal_met).toBe(false));
  it('4 days avg 86.625 -> 86.63 (half-up)', () => {
    const s = w([87.0, 86.8, 86.5, 86.2]);
    expect(s.weight.avg_kg).toBe(86.63);
    expect(s.weight.count).toBe(4);
    expect(s.weight.goal).toBe(3);
  });
  it('no weights -> null avg, count 0, goal not met', () => {
    const s = w([]);
    expect(s.weight).toEqual({ avg_kg: null, count: 0, goal: 3, goal_met: false });
  });
});

describe('training from workouts', () => {
  it('sums by category, sessions, volume; ignores workouts outside the week', () => {
    const workouts = [
      workout(WEEK[0], 'CARDIO', 410),
      workout(WEEK[1], 'CARDIO', 300.4),
      workout(WEEK[1], 'STRENGTH', 265, { volume_kg: 8981 }),
      workout(WEEK[2], 'STRENGTH', null, { volume_kg: 1000.4 }),
      workout('2026-11-16', 'CARDIO', 999), // next week
    ];
    const s = weeklySummary({ weekStart: '2026-11-09', logs: [], workouts, goals: GOALS });
    expect(s.training).toEqual({
      cardio_kcal: 710,
      strength_kcal: 265,
      total_kcal: 975,
      cardio_sessions: 2,
      strength_sessions: 2,
      cardio_target: 3,
      strength_target: 4,
      volume_kg: 9981,
    });
    expect(s.days_logged).toBe(3); // workouts count as logged days
  });
});

describe('all-null week', () => {
  it('returns nulls and zeros, never NaN', () => {
    const logs = WEEK.map((d, i) => log(d, types[i]));
    const s = weeklySummary({ weekStart: '2026-11-09', logs, workouts: [], goals: GOALS });
    expect(s.days_logged).toBe(0);
    expect(s.weight.avg_kg).toBeNull();
    expect(s.steps).toMatchObject({ total: 0, avg_per_day: null, pct_of_weekly_goal: null, days_at_goal: 0 });
    for (const k of ['protein_g', 'carbs_g', 'fat_g', 'calories_kcal'] as const) {
      expect(s.nutrition[k]).toEqual({ actual_avg: null, target_avg: null, achieved_pct: null, days: 0 });
    }
    expect(s.energy).toEqual({ eaten_kcal: 0, burned_kcal: 0, net_kcal: 0, days_counted: 0, avg_net_per_day: null });
    expect(JSON.stringify(s)).not.toContain('NaN');
  });
  it('empty logs list works too', () => {
    const s = weeklySummary({ weekStart: '2026-11-09', logs: [], workouts: [], goals: GOALS });
    expect(s.day_types).toEqual({ active: 0, rest: 0 });
  });
});

describe('dailyAdherence', () => {
  it('uses the target of the day type, 1 decimal, null for empty', () => {
    const a = dailyAdherence(log(WEEK[0], 'REST', { protein_g: 171, calories_kcal: 2205, carbs_g: null }), GOALS);
    expect(a.protein_g).toEqual({ actual: 171, target: 190, pct: 90 });
    expect(a.calories_kcal).toEqual({ actual: 2205, target: 2100, pct: 105 });
    expect(a.carbs_g).toEqual({ actual: null, target: 200, pct: null });
    const b = dailyAdherence(log(WEEK[0], 'ACTIVE', { fat_g: 100 }), GOALS);
    expect(b.fat_g.target).toBe(70);
    expect(b.fat_g.pct).toBe(142.9);
  });
  it('a real 0 is 0%, not null', () => {
    expect(dailyAdherence(log(WEEK[0], 'ACTIVE', { fat_g: 0 }), GOALS).fat_g.pct).toBe(0);
  });
});

describe('statusForPercent', () => {
  it('macro boundaries', () => {
    expect(statusForPercent('macro', 95)).toBe('on_target');
    expect(statusForPercent('macro', 105)).toBe('on_target');
    expect(statusForPercent('macro', 100)).toBe('on_target');
    expect(statusForPercent('macro', 94.9)).toBe('near');
    expect(statusForPercent('macro', 85)).toBe('near');
    expect(statusForPercent('macro', 84.9)).toBe('off');
    expect(statusForPercent('macro', 105.1)).toBe('near');
    expect(statusForPercent('macro', 115)).toBe('near');
    expect(statusForPercent('macro', 115.1)).toBe('off');
    expect(statusForPercent('macro', 0)).toBe('off');
    expect(statusForPercent('macro', null)).toBe('none');
  });
  it('volume boundaries', () => {
    expect(statusForPercent('volume', 100)).toBe('on_target');
    expect(statusForPercent('volume', 150)).toBe('on_target');
    expect(statusForPercent('volume', 99.9)).toBe('near');
    expect(statusForPercent('volume', 80)).toBe('near');
    expect(statusForPercent('volume', 79.9)).toBe('off');
    expect(statusForPercent('volume', null)).toBe('none');
  });
});

describe('kcalFromMacros / roundHalfUp', () => {
  it('4P + 4C + 9F', () => expect(kcalFromMacros(190, 240, 70)).toBe(2350));
  it('rounds half up without float drift', () => {
    expect(roundHalfUp(86.625, 2)).toBe(86.63);
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.5, 0)).toBe(3);
    expect(roundHalfUp(-2.5, 0)).toBe(-3);
    expect(roundHalfUp(-0.04, 1)).toBe(0);
    expect(Object.is(roundHalfUp(-0.04, 1), -0)).toBe(false);
  });
});

describe('compareWeeks', () => {
  const mk = (over: { w?: number[]; steps?: number[]; kcal?: number[]; workouts?: ReturnType<typeof workout>[]; ck?: Partial<ReturnType<typeof checkin>> }) => {
    const logs = WEEK.map((d, i) =>
      log(d, types[i], {
        weight_kg: over.w?.[i] ?? null,
        steps: over.steps?.[i] ?? null,
        calories_kcal: over.kcal?.[i] ?? null,
      }),
    );
    return {
      summary: weeklySummary({ weekStart: '2026-11-09', logs, workouts: over.workouts ?? [], goals: GOALS }),
      checkin: checkin(over.ck),
    };
  };
  it('computes b - a and relative % with 1 decimal', () => {
    const a = mk({ w: [90, 90], steps: [8000, 8000], ck: { waist_cm: 100 }, workouts: [workout(WEEK[0], 'CARDIO', 700), workout(WEEK[1], 'STRENGTH', 700, { volume_kg: 5000 })] });
    const b = mk({ w: [88.5, 88.5], steps: [10000, 10000], ck: { waist_cm: 97.5 }, workouts: [workout(WEEK[0], 'CARDIO', 1400), workout(WEEK[1], 'CARDIO', 700), workout(WEEK[2], 'STRENGTH', 700, { volume_kg: 6000 })] });
    const r = compareWeeks(a, b);
    expect(r.results.weight_kg).toEqual({ a: 90, b: 88.5, delta: -1.5, delta_pct: -1.7 });
    expect(r.results.waist_cm).toEqual({ a: 100, b: 97.5, delta: -2.5, delta_pct: -2.5 });
    expect(r.effort.steps_avg_per_day).toEqual({ a: 8000, b: 10000, delta: 2000, delta_pct: 25 });
    expect(r.effort.active_burn_per_day).toEqual({ a: 200, b: 400, delta: 200, delta_pct: 100 });
    expect(r.effort.strength_volume_kg).toEqual({ a: 5000, b: 6000, delta: 1000, delta_pct: 20 });
    expect(r.effort.cardio_sessions).toEqual({ a: 1, b: 2, delta: 1, delta_pct: 100 });
    expect(r.effort.strength_sessions.delta).toBe(0);
  });
  it('null when either side is null; pct null when a is 0', () => {
    const a = mk({ w: [90], ck: { waist_cm: 100, hip_cm: 0 } });
    const b = mk({ ck: { waist_cm: 98, hip_cm: 5, chest_cm: 100 } });
    const r = compareWeeks(a, b);
    expect(r.results.weight_kg).toEqual({ a: 90, b: null, delta: null, delta_pct: null });
    expect(r.results.chest_cm).toEqual({ a: null, b: 100, delta: null, delta_pct: null });
    expect(r.results.hip_cm).toEqual({ a: 0, b: 5, delta: 5, delta_pct: null });
    expect(r.results.arm_cm.delta).toBeNull();
    expect(r.effort.calorie_adherence_pct.delta).toBeNull();
    expect(r.effort.steps_avg_per_day.delta_pct).toBeNull();
  });
  it('calorie adherence comes from nutrition.calories_kcal.achieved_pct', () => {
    const a = mk({ kcal: [2350] }); // 100%
    const b = mk({ kcal: [2115] }); // 90%
    const r = compareWeeks(a, b);
    expect(r.effort.calorie_adherence_pct).toEqual({ a: 100, b: 90, delta: -10, delta_pct: -10 });
  });
});
