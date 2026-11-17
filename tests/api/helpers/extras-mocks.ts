import { FakeDb, type Row } from './extras-fake';
import { ApiError } from '@/lib/api/errors';

export const USER = '11111111-1111-4111-8111-111111111111';
export const ctx: { db: FakeDb } = { db: new FakeDb() };
export const resetDb = () => { ctx.db = new FakeDb(); };

export const authMock = () => ({
  requireUser: async () => ({ supabase: ctx.db.client(), userId: USER, email: null }),
});
export const adminMock = () => ({ createAdminClient: () => ctx.db.client() });
export const settingsMock = () => ({
  getSettings: async () => ({ timezone: 'America/Hermosillo', program_start_date: null, strong_default_unit: 'lb', appearance: 'system' }),
});
export const weeksMock = () => ({
  ensureWeek: async (_c: unknown, userId: string, weekStart: string) => {
    const rows = ctx.db.rows('weekly_checkins');
    let w = rows.find((r) => r.user_id === userId && r.week_start_date === weekStart);
    if (!w) {
      w = { id: 'w-' + weekStart, user_id: userId, week_start_date: weekStart, goals_snapshot: {}, closed_at: null, photo_front_path: null, photo_side_path: null, photo_back_path: null };
      rows.push(w);
    }
    return { ...w };
  },
  assertWeekOpen: (w: Row) => {
    if (w.closed_at) throw new ApiError('week_closed', 'This week is closed. Reopen it to make changes.');
  },
});
