'use client';
import type {
  DailyLog,
  DayType,
  GoalsSnapshot,
  PoseKey,
  StrongParseResult,
  WeeklyCheckin,
  Workout,
  WorkoutCategory,
} from '@/lib/domain';

/* ------------------------------------------------------------------ types (doc 02 section 6, snake_case) */

export interface ApiIssue {
  path: (string | number)[];
  message: string;
}

/** Thrown by every `api.*` call on a non-2xx answer (status 0 = network failure). */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: ApiIssue[],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export type DayRow = DailyLog & { persisted: boolean };
export interface DayResponse {
  day: DayRow;
  workouts: Workout[];
  week: { week_start_date: string; closed: boolean; goals_snapshot: GoalsSnapshot };
}
export type DayPatch = Partial<
  Pick<
    DailyLog,
    'day_type' | 'weight_kg' | 'steps' | 'protein_g' | 'carbs_g' | 'fat_g' | 'calories_kcal' | 'resting_kcal' | 'active_kcal_total'
  >
>;

export interface PhaseRef {
  id: string;
  name: string;
  start_date: string;
  start_weight_kg: number | null;
  target_weight_kg: number | null;
}
export interface WeekResponse {
  checkin: WeeklyCheckin;
  days: (DailyLog | null)[]; // 7 entries Mon..Sun
  workouts: Workout[];
  phase: PhaseRef | null;
  week_number: number | null;
}
export interface WeeksResponse {
  weeks: { checkin: WeeklyCheckin; days: (DailyLog | null)[]; workouts: Workout[] }[];
}
export type WeekPatch = Partial<
  Pick<
    WeeklyCheckin,
    | 'waist_cm'
    | 'hip_cm'
    | 'chest_cm'
    | 'arm_cm'
    | 'leg_cm'
    | 'photo_front_path'
    | 'photo_side_path'
    | 'photo_back_path'
    | 'external_folder_url'
    | 'reflection_highlights'
    | 'reflection_hard'
    | 'reflection_next_goals'
  >
>;

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
/** Editable phase fields. */
export type PhaseInput = Partial<Omit<Phase, 'id' | 'created_at' | 'updated_at'>>;
export type PhaseCreate = PhaseInput & { name: string; start_date: string };

export interface WorkoutInput {
  log_date: string;
  category: WorkoutCategory;
  type_label: string;
  active_kcal?: number | null;
  duration_min?: number | null;
  started_at?: string | null;
  volume_kg?: number | null;
}
export type WorkoutPatch = Partial<WorkoutInput>;

export interface StrongApplyResponse {
  workout: Workout;
  parsed: StrongParseResult;
}

export interface PhotoUrl {
  path: string;
  url: string;
  expires_in: number;
}
export type PhotoUrls = Record<PoseKey, PhotoUrl | null>;
export interface PhotoUploadUrl {
  path: string;
  token: string;
  signed_url: string;
}

export interface UserSettings {
  timezone: string;
  program_start_date: string | null;
  strong_default_unit: 'kg' | 'lb';
  appearance: 'system' | 'light' | 'dark';
}
export interface CredentialStatus {
  has_secret: boolean;
  last4: string | null;
  rotated_at: string | null;
  created_at: string | null;
  webhook_url: string;
}
export interface RotatedCredential {
  secret: string;
  last4: string;
  webhook_url: string;
}
export interface SyncStatus {
  last_sync_at: string | null;
  last_synced_dates: string[];
  has_secret: boolean;
}

export type { DayType };

/* ------------------------------------------------------------------ fetch wrapper */

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError(0, 'network_error', 'Network error. Check your connection.');
  }
  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') window.location.assign('/login');
    throw new ApiClientError(401, 'unauthorized', 'Sign in required');
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; issues?: ApiIssue[] } } | null)?.error;
    throw new ApiClientError(res.status, e?.code ?? 'internal_error', e?.message ?? `Request failed (${res.status})`, e?.issues);
  }
  return json as T;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** Typed calls for every /api/v1 endpoint. All reject with ApiClientError. */
export const api = {
  getDay: (date: string) => request<DayResponse>('GET', `/days/${date}`),
  /** Partial update. `null` clears a field; absent key leaves it unchanged. */
  putDay: (date: string, patch: DayPatch) => request<DayResponse>('PUT', `/days/${date}`, patch),

  getWeek: (weekStart: string) => request<WeekResponse>('GET', `/weeks/${weekStart}`),
  listWeeks: (from: string, to: string) => request<WeeksResponse>('GET', `/weeks?${q({ from, to })}`),
  putWeek: (weekStart: string, patch: WeekPatch) => request<WeekResponse>('PUT', `/weeks/${weekStart}`, patch),
  closeWeek: (weekStart: string) => request<WeekResponse>('POST', `/weeks/${weekStart}/close`, {}),
  reopenWeek: (weekStart: string, body: { confirm: boolean; refresh_goals?: boolean }) =>
    request<WeekResponse>('POST', `/weeks/${weekStart}/reopen`, body),

  listPhases: () => request<{ phases: Phase[] }>('GET', '/phases'),
  getPhase: (id: string) => request<{ phase: Phase } | Phase>('GET', `/phases/${id}`),
  createPhase: (body: PhaseCreate) => request<{ phase: Phase } | Phase>('POST', '/phases', body),
  patchPhase: (id: string, body: PhaseInput) => request<{ phase: Phase } | Phase>('PATCH', `/phases/${id}`, body),
  startNewPhase: (body: PhaseCreate) => request<{ phase: Phase; previous: Phase }>('POST', '/phases/start-new', body),
  deletePhase: (id: string, confirm?: boolean) =>
    request<unknown>('DELETE', `/phases/${id}${confirm ? '?confirm=true' : ''}`),

  listWorkouts: (from: string, to: string) => request<{ workouts: Workout[] }>('GET', `/workouts?${q({ from, to })}`),
  createWorkout: (body: WorkoutInput) => request<{ workout: Workout } | Workout>('POST', '/workouts', body),
  patchWorkout: (id: string, body: WorkoutPatch) => request<{ workout: Workout } | Workout>('PATCH', `/workouts/${id}`, body),
  deleteWorkout: (id: string) => request<unknown>('DELETE', `/workouts/${id}`),

  applyStrong: (body: { log_date: string; raw_text: string; attach_to: string | null }) =>
    request<StrongApplyResponse>('POST', '/strong/apply', body),

  getPhotoUrls: (weekStart: string) => request<PhotoUrls>('GET', `/weeks/${weekStart}/photos`),
  createPhotoUploadUrl: (weekStart: string, pose: PoseKey) =>
    request<PhotoUploadUrl>('POST', `/weeks/${weekStart}/photos/${pose}/upload-url`, {}),
  deletePhoto: (weekStart: string, pose: PoseKey) => request<unknown>('DELETE', `/weeks/${weekStart}/photos/${pose}`),

  getSettings: async (): Promise<UserSettings> => {
    const r = await request<UserSettings | { settings: UserSettings }>('GET', '/settings');
    return 'settings' in r ? r.settings : r;
  },
  putSettings: async (patch: Partial<UserSettings>): Promise<UserSettings> => {
    const r = await request<UserSettings | { settings: UserSettings }>('PUT', '/settings', patch);
    return 'settings' in r ? r.settings : r;
  },

  getCredentials: () => request<CredentialStatus>('GET', '/credentials'),
  /** The ONLY time the secret is returned. */
  rotateCredentials: () => request<RotatedCredential>('POST', '/credentials/rotate', {}),
  getSyncStatus: () => request<SyncStatus>('GET', '/sync/status'),

  /** URL for a plain <a href download>. */
  exportUrl: (format: 'json' | 'csv', table?: 'daily_logs' | 'workouts' | 'weekly_checkins') =>
    format === 'json' ? '/api/v1/export?format=json' : `/api/v1/export?${q({ format: 'csv', table: table ?? 'daily_logs' })}`,
};

/** Unwrap `{ phase }` / `{ workout }` envelopes or bare rows: `unwrap<Phase>(res, 'phase')`. */
export function unwrap<T extends object>(r: T | Record<string, T>, key: string): T {
  const o = r as Record<string, unknown>;
  return (o && typeof o[key] === 'object' && o[key] !== null ? o[key] : r) as T;
}
