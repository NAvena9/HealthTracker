import { z } from 'zod';
import { validationError, type ApiIssue } from './errors';
import { weekNumber, weekStartOf } from '@/lib/domain';

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** safeParse, throwing the standard 400 envelope (with `issues`) on failure. */
export function parseWith<S extends z.ZodTypeAny>(schema: S, data: unknown, pathPrefix: (string | number)[] = []): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issues: ApiIssue[] = r.error.issues.map((i) => ({ path: [...pathPrefix, ...i.path], message: i.message }));
  throw validationError('Invalid request', issues);
}

/** Validate a single route param (error path = [name]). */
export const parseParam = <S extends z.ZodTypeAny>(name: string, schema: S, value: unknown): z.infer<S> =>
  parseWith(schema, value, [name]);

/** Query string -> plain object (first value of each key). */
export function queryOf(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Valid calendar date, YYYY-MM-DD. */
export const dateParam = z
  .string({ invalid_type_error: 'Must be a date (YYYY-MM-DD)', required_error: 'Required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)')
  .refine(isRealDate, 'Must be a valid calendar date');

/** Valid date that is a Monday. */
export const mondayParam = dateParam.refine((s) => {
  try {
    return isRealDate(s) && weekStartOf(s) === s;
  } catch {
    return false;
  }
}, 'Must be a Monday');

export const uuidParam = z.string().uuid('Must be a UUID');
export const poseParam = z.enum(['front', 'side', 'back']);

const rangeMsg = (min: number, max: number) => `Must be between ${min} and ${max}`;
const numRange = (min: number, max: number) =>
  z
    .number({ invalid_type_error: 'Must be a number', required_error: 'Required' })
    .finite('Must be a number')
    .min(min, rangeMsg(min, max))
    .max(max, rangeMsg(min, max));
const intRange = (min: number, max: number) =>
  z
    .number({ invalid_type_error: 'Must be a number', required_error: 'Required' })
    .int('Must be a whole number')
    .min(min, rangeMsg(min, max))
    .max(max, rangeMsg(min, max));

/** null clears, absent = unchanged. */
const clearable = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

/** Text where '' (blank) is stored as null. Empty is not a value. */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const clearableText = (max: number) => z.preprocess(blankToNull, z.string().max(max, `Max ${max} characters`).nullable().optional());

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export const DAY_DATA_FIELDS = [
  'weight_kg',
  'steps',
  'protein_g',
  'carbs_g',
  'fat_g',
  'calories_kcal',
  'resting_kcal',
  'active_kcal_total',
] as const;
export type DayDataField = (typeof DAY_DATA_FIELDS)[number];

export const dayPutSchema = z
  .object({
    day_type: z.enum(['ACTIVE', 'REST'], { errorMap: () => ({ message: 'Must be ACTIVE or REST' }) }).optional(),
    weight_kg: clearable(numRange(30, 300)),
    steps: clearable(intRange(0, 100000)),
    protein_g: clearable(numRange(0, 2000)),
    carbs_g: clearable(numRange(0, 2000)),
    fat_g: clearable(numRange(0, 2000)),
    calories_kcal: clearable(intRange(0, 10000)),
    resting_kcal: clearable(intRange(0, 10000)),
    active_kcal_total: clearable(intRange(0, 10000)),
  })
  .strict();
export type DayPutBody = z.infer<typeof dayPutSchema>;

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

export const weekPutSchema = z
  .object({
    waist_cm: clearable(numRange(10, 300)),
    hip_cm: clearable(numRange(10, 300)),
    chest_cm: clearable(numRange(10, 300)),
    arm_cm: clearable(numRange(10, 300)),
    leg_cm: clearable(numRange(10, 300)),
    photo_front_path: clearable(z.string().min(1).max(500)),
    photo_side_path: clearable(z.string().min(1).max(500)),
    photo_back_path: clearable(z.string().min(1).max(500)),
    external_folder_url: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(2000, 'Max 2000 characters')
        .url('Must be a valid URL')
        .refine((u) => /^https?:\/\//i.test(u), 'Must start with http:// or https://')
        .nullable()
        .optional(),
    ),
    reflection_highlights: clearableText(4000),
    reflection_hard: clearableText(4000),
    reflection_next_goals: clearableText(4000),
  })
  .strict();
export type WeekPutBody = z.infer<typeof weekPutSchema>;

export const weeksQuerySchema = z
  .object({ from: mondayParam, to: mondayParam })
  .superRefine((v, ctx) => {
    if (v.to < v.from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '`to` must be on or after `from`' });
      return;
    }
    if (weekNumber(v.to, v.from) > 26) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Range is limited to 26 weeks' });
    }
  });

export const closeWeekSchema = z.object({}).strict();
export const reopenWeekSchema = z
  .object({
    confirm: z.boolean({ invalid_type_error: 'Must be true or false' }).optional(),
    refresh_goals: z.boolean({ invalid_type_error: 'Must be true or false' }).optional(),
  })
  .strict();
export type ReopenWeekBody = z.infer<typeof reopenWeekSchema>;

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const phaseName = z.string({ required_error: 'Required' }).trim().min(1, 'Required').max(100, 'Max 100 characters');
const phaseGoalFields = {
  start_weight_kg: clearable(numRange(30, 300)),
  target_weight_kg: clearable(numRange(30, 300)),
  active_protein_g: intRange(0, 2000).optional(),
  active_carbs_g: intRange(0, 2000).optional(),
  active_fat_g: intRange(0, 2000).optional(),
  active_kcal: intRange(0, 10000).optional(),
  rest_protein_g: intRange(0, 2000).optional(),
  rest_carbs_g: intRange(0, 2000).optional(),
  rest_fat_g: intRange(0, 2000).optional(),
  rest_kcal: intRange(0, 10000).optional(),
  daily_step_goal: intRange(0, 100000).optional(),
  weekly_step_goal: intRange(0, 700000).optional(),
  weekly_weighin_goal: intRange(0, 7).optional(),
  weekly_cardio_sessions: clearable(intRange(0, 21)),
  weekly_strength_sessions: clearable(intRange(0, 21)),
};

export const phaseCreateSchema = z
  .object({ name: phaseName, start_date: dateParam, end_date: clearable(dateParam), ...phaseGoalFields })
  .strict();
export type PhaseCreateBody = z.infer<typeof phaseCreateSchema>;

export const phaseStartNewSchema = z.object({ name: phaseName, start_date: mondayParam, ...phaseGoalFields }).strict();
export type PhaseStartNewBody = z.infer<typeof phaseStartNewSchema>;

export const phasePatchSchema = z
  .object({ name: phaseName.optional(), end_date: clearable(dateParam), ...phaseGoalFields })
  .strict();
export type PhasePatchBody = z.infer<typeof phasePatchSchema>;

export const phaseDeleteQuerySchema = z.object({
  confirm: z.enum(['true', 'false'], { errorMap: () => ({ message: 'Must be true or false' }) }).optional(),
});

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

const category = z.enum(['CARDIO', 'STRENGTH'], { errorMap: () => ({ message: 'Must be CARDIO or STRENGTH' }) });
const typeLabel = z.string({ required_error: 'Required' }).trim().min(1, 'Required').max(100, 'Max 100 characters');
const startedAt = z.string().datetime({ offset: true, message: 'Must be an ISO 8601 timestamp' });

export const workoutCreateSchema = z
  .object({
    log_date: dateParam,
    category,
    type_label: typeLabel,
    active_kcal: clearable(intRange(0, 5000)),
    duration_min: clearable(numRange(0, 1440)),
    started_at: clearable(startedAt),
    volume_kg: clearable(numRange(0, 1_000_000)),
  })
  .strict();
export type WorkoutCreateBody = z.infer<typeof workoutCreateSchema>;

export const workoutPatchSchema = z
  .object({
    log_date: dateParam.optional(),
    category: category.optional(),
    type_label: typeLabel.optional(),
    active_kcal: clearable(intRange(0, 5000)),
    duration_min: clearable(numRange(0, 1440)),
    started_at: clearable(startedAt),
    volume_kg: clearable(numRange(0, 1_000_000)),
  })
  .strict();
export type WorkoutPatchBody = z.infer<typeof workoutPatchSchema>;

export const workoutsQuerySchema = z
  .object({ from: dateParam.optional(), to: dateParam.optional() })
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.to < v.from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '`to` must be on or after `from`' });
    }
  });

// ---------------------------------------------------------------------------
// Strong import (implemented by another module)
// ---------------------------------------------------------------------------

export const strongApplySchema = z
  .object({
    log_date: dateParam,
    raw_text: z.string({ required_error: 'Required' }).min(1, 'Required').max(100_000, 'Max 100,000 characters'),
    attach_to: clearable(uuidParam),
  })
  .strict();
export type StrongApplyBody = z.infer<typeof strongApplySchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const timezone = z
  .string()
  .min(1, 'Required')
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid IANA timezone');

export const settingsPutSchema = z
  .object({
    timezone: timezone.optional(),
    program_start_date: clearable(mondayParam),
    strong_default_unit: z.enum(['kg', 'lb'], { errorMap: () => ({ message: 'Must be kg or lb' }) }).optional(),
    appearance: z.enum(['system', 'light', 'dark'], { errorMap: () => ({ message: 'Must be system, light or dark' }) }).optional(),
  })
  .strict();
export type SettingsPutBody = z.infer<typeof settingsPutSchema>;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const exportQuerySchema = z
  .object({
    format: z.enum(['json', 'csv']).default('json'),
    table: z.enum(['daily_logs', 'workouts', 'weekly_checkins']).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.format === 'csv' && !v.table) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['table'], message: 'Required when format=csv' });
    }
  });
export type ExportQuery = z.infer<typeof exportQuerySchema>;
