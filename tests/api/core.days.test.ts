import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, USER_ID, params, req, resetState, seedClosedWeek, state } from './helpers/core-harness';

vi.mock('@/lib/api/auth', async () => {
  const h = await import('./helpers/core-harness');
  return { requireUser: h.mockRequireUser };
});

beforeEach(() => { resetState(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); });

import { GET, PUT } from '@/app/api/v1/days/[date]/route';

const call = (m: 'GET' | 'PUT', date: string, body?: unknown, h?: Record<string, string>) =>
  (m === 'GET' ? GET : PUT)(req(m, '/api/v1/days/' + date, body, h), params({ date }));

describe('days', () => {
  it('401 envelope when unauthenticated', async () => {
    state.authed = false;
    const res = await call('GET', '2026-11-16');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
  });

  it('GET virtual default: persisted false, nulls, ACTIVE, creates only the week', async () => {
    const res = await call('GET', '2026-11-16');
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.day).toMatchObject({ persisted: false, day_type: 'ACTIVE', steps: null, weight_kg: null, week_start_date: '2026-11-16' });
    expect(j.week.closed).toBe(false);
    expect(state.db.tables.daily_logs).toHaveLength(0);
    expect(state.db.tables.weekly_checkins).toHaveLength(1);
  });

  it('400 validation: weight 500, bad date, bad JSON, unknown key', async () => {
    let res = await call('PUT', '2026-11-16', { weight_kg: 500 });
    let j = await res.json();
    expect(res.status).toBe(400);
    expect(j.error.code).toBe('validation_error');
    expect(j.error.issues[0]).toEqual({ path: ['weight_kg'], message: 'Must be between 30 and 300' });
    res = await call('GET', '2026-02-30');
    expect(res.status).toBe(400);
    res = await call('PUT', '2026-11-16', '{nope');
    expect(res.status).toBe(400);
    res = await call('PUT', '2026-11-16', { week_start_date: '2026-01-05' });
    expect(res.status).toBe(400);
    res = await call('PUT', '2026-11-16', { steps: 1.5 });
    expect(res.status).toBe(400);
  });

  it('edited_fields: add on value, remove on null, day_type never added', async () => {
    let j = await (await call('PUT', '2026-11-16', { weight_kg: 82.4, steps: 5000, day_type: 'REST' })).json();
    expect(j.day.edited_fields).toEqual(['weight_kg', 'steps']);
    expect(j.day.persisted).toBe(true);
    expect(j.day.weight_kg).toBe(82.4); // numeric string -> number
    j = await (await call('PUT', '2026-11-16', { steps: null })).json();
    expect(j.day.edited_fields).toEqual(['weight_kg']);
    expect(j.day.steps).toBeNull(); // empty is null, never 0
    expect(j.day.day_type).toBe('REST'); // untouched
  });

  it('X-Source: sync applies values but leaves edited_fields alone', async () => {
    await call('PUT', '2026-11-16', { protein_g: 150 });
    const j = await (await call('PUT', '2026-11-16', { protein_g: 190, steps: 9000 }, { 'x-source': 'sync' })).json();
    expect(j.day.protein_g).toBe(190);
    expect(j.day.steps).toBe(9000);
    expect(j.day.edited_fields).toEqual(['protein_g']);
  });

  it('new day inherits the most recent earlier day type', async () => {
    await call('PUT', '2026-11-16', { day_type: 'REST' });
    const j = await (await call('GET', '2026-11-18')).json();
    expect(j.day.day_type).toBe('REST');
    const p = await (await call('PUT', '2026-11-18', { steps: 100 })).json();
    expect(p.day.day_type).toBe('REST');
  });

  it('409 week_closed on closed week', async () => {
    seedClosedWeek(state.db, '2026-11-09');
    const res = await call('PUT', '2026-11-10', { steps: 1000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('week_closed');
  });

  it('new week snapshot: defaults without phase, phase goals with phase', async () => {
    let j = await (await call('GET', '2026-11-16')).json();
    expect(j.week.goals_snapshot.active.calories_kcal).toBe(2350);
    expect(state.db.tables.weekly_checkins![0]!.phase_id).toBeNull();
    state.db.tables.phases!.push({ id: 'p1', user_id: USER_ID, name: 'Cut', start_date: '2026-11-09', end_date: null, active_kcal: 2000, active_protein_g: 200, active_carbs_g: 180, active_fat_g: 60, rest_kcal: 1800, rest_protein_g: 200, rest_carbs_g: 150, rest_fat_g: 55, daily_step_goal: 8000, weekly_step_goal: 56000, weekly_weighin_goal: 4, weekly_cardio_sessions: 3, weekly_strength_sessions: null, start_weight_kg: 84, target_weight_kg: 78, created_at: 'x', updated_at: 'x' });
    j = await (await call('GET', '2026-11-23')).json();
    expect(j.week.goals_snapshot.active.calories_kcal).toBe(2000);
    expect(j.week.goals_snapshot.target_weight_kg).toBe(78);
    expect(state.db.tables.weekly_checkins!.find((w) => w.week_start_date === '2026-11-23')!.phase_id).toBe('p1');
  });
});
