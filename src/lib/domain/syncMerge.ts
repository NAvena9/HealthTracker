import type {
  DailyLog,
  SyncDay,
  SyncMergeResult,
  SyncWorkout,
  WorkoutCategory,
  WorkoutUpsert,
} from './types';

export class SyncValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(`Invalid sync payload: ${issues.join('; ')}`);
    this.name = 'SyncValidationError';
    this.issues = issues;
  }
}

const MAX_DAYS = 14;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC_FIELDS = [
  'steps',
  'weight_kg',
  'protein_g',
  'carbs_g',
  'fat_g',
  'calories_kcal',
  'resting_kcal',
  'active_kcal',
] as const;

function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateDay(raw: unknown, label: string, issues: string[]): SyncDay | null {
  if (!isObject(raw)) {
    issues.push(`${label}: must be an object`);
    return null;
  }
  const before = issues.length;
  const day: Record<string, unknown> = {};

  if (typeof raw.date !== 'string' || !isValidDate(raw.date)) {
    issues.push(`${label}.date: must be a valid date in YYYY-MM-DD format`);
  } else {
    day.date = raw.date;
  }

  for (const f of NUMERIC_FIELDS) {
    if (!(f in raw) || raw[f] === undefined) continue;
    const v = raw[f];
    if (v === null) {
      day[f] = null;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      day[f] = v;
    } else {
      issues.push(`${label}.${f}: must be a finite number or null`);
    }
  }

  if ('workouts' in raw && raw.workouts !== undefined && raw.workouts !== null) {
    if (!Array.isArray(raw.workouts)) {
      issues.push(`${label}.workouts: must be an array`);
    } else {
      const ws: SyncWorkout[] = [];
      raw.workouts.forEach((w: unknown, i: number) => {
        const wl = `${label}.workouts[${i}]`;
        if (!isObject(w)) {
          issues.push(`${wl}: must be an object`);
          return;
        }
        let ok = true;
        if (typeof w.type !== 'string' || w.type.trim() === '') {
          issues.push(`${wl}.type: must be a non-empty string`);
          ok = false;
        }
        if (typeof w.active_kcal !== 'number' || !Number.isFinite(w.active_kcal)) {
          issues.push(`${wl}.active_kcal: must be a finite number`);
          ok = false;
        }
        if (w.duration_min !== undefined && w.duration_min !== null && (typeof w.duration_min !== 'number' || !Number.isFinite(w.duration_min))) {
          issues.push(`${wl}.duration_min: must be a number`);
          ok = false;
        }
        if (w.start !== undefined && w.start !== null && (typeof w.start !== 'string' || Number.isNaN(Date.parse(w.start)))) {
          issues.push(`${wl}.start: must be an ISO timestamp string`);
          ok = false;
        }
        if (ok) {
          const sw: SyncWorkout = { type: w.type as string, active_kcal: w.active_kcal as number };
          if (typeof w.duration_min === 'number') sw.duration_min = w.duration_min;
          if (typeof w.start === 'string') sw.start = w.start;
          ws.push(sw);
        }
      });
      day.workouts = ws;
    }
  }

  return issues.length > before ? null : (day as unknown as SyncDay);
}

/** Accepts v1 (one day object) or v2 ({schema: 2, days: [...]}) and returns a list of validated days. */
export function normalizeSyncPayload(raw: unknown): SyncDay[] {
  if (!isObject(raw)) throw new SyncValidationError(['payload: must be a JSON object']);
  const issues: string[] = [];
  const days: SyncDay[] = [];

  if ('schema' in raw) {
    if (raw.schema !== 2) throw new SyncValidationError([`schema: unsupported version ${String(raw.schema)}`]);
    if (!Array.isArray(raw.days)) throw new SyncValidationError(['days: must be an array']);
    if (raw.days.length === 0) throw new SyncValidationError(['days: must contain at least one day']);
    if (raw.days.length > MAX_DAYS) {
      throw new SyncValidationError([`days: at most ${MAX_DAYS} days per payload (got ${raw.days.length})`]);
    }
    raw.days.forEach((d: unknown, i: number) => {
      const v = validateDay(d, `days[${i}]`, issues);
      if (v) days.push(v);
    });
  } else if ('date' in raw) {
    const v = validateDay(raw, 'payload', issues);
    if (v) days.push(v);
  } else {
    throw new SyncValidationError(['payload: expected a day object with "date" or {schema: 2, days: [...]}']);
  }

  if (issues.length) throw new SyncValidationError(issues);
  return days;
}

/** STRENGTH for names containing Strength, Weight, Core or Functional (case-insensitive); else CARDIO. */
export function classifyWorkout(type: string): WorkoutCategory {
  return /strength|weight|core|functional/i.test(type) ? 'STRENGTH' : 'CARDIO';
}

const FIELD_MAP: { incoming: keyof SyncDay; target: keyof DailyLog }[] = [
  { incoming: 'steps', target: 'steps' },
  { incoming: 'weight_kg', target: 'weight_kg' },
  { incoming: 'protein_g', target: 'protein_g' },
  { incoming: 'carbs_g', target: 'carbs_g' },
  { incoming: 'fat_g', target: 'fat_g' },
  { incoming: 'calories_kcal', target: 'calories_kcal' },
  { incoming: 'resting_kcal', target: 'resting_kcal' },
  { incoming: 'active_kcal', target: 'active_kcal_total' },
];

export function mergeSyncPayload(
  existing: DailyLog | null,
  incoming: SyncDay,
  opts: { weekClosed: boolean; now?: Date },
): SyncMergeResult {
  if (opts.weekClosed) return { patch: {}, updated_fields: [], skipped: [], workouts: [] };

  const edited = new Set(existing?.edited_fields ?? []);
  const patch: Record<string, unknown> = {};
  const updated: string[] = [];
  const skipped: SyncMergeResult['skipped'] = [];

  for (const { incoming: inKey, target } of FIELD_MAP) {
    if (!(inKey in incoming)) continue; // absent: not reported
    const v = incoming[inKey] as number | null | undefined;
    if (v === undefined) continue;
    if (v === null || v === 0) {
      skipped.push({ field: target, reason: 'empty' });
      continue;
    }
    if (edited.has(target)) {
      skipped.push({ field: target, reason: 'manual_edit' });
      continue;
    }
    patch[target] = v;
    updated.push(target);
  }

  const workouts: WorkoutUpsert[] = [];
  for (const w of incoming.workouts ?? []) {
    if (!(w.active_kcal > 0)) continue;
    workouts.push({
      log_date: incoming.date,
      category: classifyWorkout(w.type),
      type_label: w.type,
      active_kcal: w.active_kcal,
      duration_min: w.duration_min ?? null,
      started_at: w.start ?? null,
      source: 'apple_health',
    });
  }

  if (updated.length > 0 || workouts.length > 0) {
    patch.apple_health_synced_at = (opts.now ?? new Date()).toISOString();
  }

  return { patch: patch as Partial<DailyLog>, updated_fields: updated, skipped, workouts };
}
