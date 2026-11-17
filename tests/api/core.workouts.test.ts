import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, USER_ID, params, req, resetState, seedClosedWeek, state } from './helpers/core-harness';

vi.mock('@/lib/api/auth', async () => {
  const h = await import('./helpers/core-harness');
  return { requireUser: h.mockRequireUser };
});

beforeEach(() => { resetState(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); });

import { GET, POST } from '@/app/api/v1/workouts/route';
import { PATCH, DELETE } from '@/app/api/v1/workouts/[id]/route';

const body = { log_date: '2026-11-16', category: 'CARDIO', type_label: 'Running', active_kcal: 410, started_at: '2026-11-16T06:45:00-07:00' };
const add = (b: unknown) => POST(req('POST', '/api/v1/workouts', b));

describe('workouts', () => {
  it('401', async () => {
    state.authed = false;
    expect((await add(body)).status).toBe(401);
  });

  it('400 validation: kcal 9000, bad category, bad JSON, source key', async () => {
    let res = await add({ ...body, active_kcal: 9000 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.issues[0].path).toEqual(['active_kcal']);
    expect((await add({ ...body, category: 'YOGA' })).status).toBe(400);
    expect((await add('{bad')).status).toBe(400);
    expect((await add({ ...body, source: 'apple_health' })).status).toBe(400);
  });

  it('create forces source manual; duplicate -> 409 conflict; list by range', async () => {
    const res = await add(body);
    const w = await res.json();
    expect(res.status).toBe(201);
    expect(w.source).toBe('manual');
    expect(w.user_id).toBeUndefined();
    const dup = await add(body);
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('conflict');
    let j = await (await GET(req('GET', '/api/v1/workouts?from=2026-11-16&to=2026-11-22'))).json();
    expect(j.workouts).toHaveLength(1);
    j = await (await GET(req('GET', '/api/v1/workouts?from=2026-11-17&to=2026-11-22'))).json();
    expect(j.workouts).toHaveLength(0);
  });

  it('409 week_closed on create / patch (old or new week) / delete', async () => {
    seedClosedWeek(state.db, '2026-11-09');
    let res = await add({ ...body, log_date: '2026-11-10' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('week_closed');
    const w = await (await add(body)).json();
    res = await PATCH(req('PATCH', '/w', { log_date: '2026-11-10' }), params({ id: w.id }));
    expect(res.status).toBe(409);
    // existing row in closed week
    state.db.tables.weekly_checkins!.find((x) => x.week_start_date === '2026-11-16')!.closed_at = '2026-11-17T00:00:00Z';
    res = await PATCH(req('PATCH', '/w', { active_kcal: 1 }), params({ id: w.id }));
    expect(res.status).toBe(409);
    res = await DELETE(req('DELETE', '/w'), params({ id: w.id }));
    expect(res.status).toBe(409);
  });

  it('patch moves week, null clears; delete removes; 404', async () => {
    const w = await (await add(body)).json();
    let res = await PATCH(req('PATCH', '/w', { log_date: '2026-11-23', active_kcal: null }), params({ id: w.id }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.active_kcal).toBeNull();
    expect(state.db.tables.workouts![0]!.week_start_date).toBe('2026-11-23');
    res = await DELETE(req('DELETE', '/w'), params({ id: w.id }));
    expect(res.status).toBe(200);
    expect(state.db.tables.workouts).toHaveLength(0);
    res = await DELETE(req('DELETE', '/w'), params({ id: w.id }));
    expect(res.status).toBe(404);
  });
});
