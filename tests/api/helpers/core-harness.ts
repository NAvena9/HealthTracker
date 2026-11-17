import { ApiError } from '@/lib/api/errors';
import { FakeDb } from './core-fake';

export const USER_ID = '11111111-1111-4111-8111-111111111111';

export const state: { db: FakeDb; authed: boolean } = { db: new FakeDb(), authed: true };

export function resetState(): FakeDb {
  state.db = new FakeDb();
  state.authed = true;
  return state.db;
}

export async function mockRequireUser(_req: Request) {
  if (!state.authed) throw new ApiError('unauthorized', 'Sign in required');
  return { supabase: state.db.client(), userId: USER_ID, email: 'nico@example.com' };
}

export function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export const NOW = '2026-11-18T18:00:00Z'; // Wednesday, week of 2026-11-16

export function seedClosedWeek(db: FakeDb, weekStart: string) {
  db.tables.weekly_checkins!.push({
    id: 'w-' + weekStart, user_id: USER_ID, week_start_date: weekStart, phase_id: null,
    goals_snapshot: { frozen: true }, closed_at: '2026-11-10T00:00:00Z',
    waist_cm: null, hip_cm: null, chest_cm: null, arm_cm: null, leg_cm: null,
    photo_front_path: null, photo_side_path: null, photo_back_path: null, external_folder_url: null,
    reflection_highlights: null, reflection_hard: null, reflection_next_goals: null,
  });
}
