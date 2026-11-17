import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, USER_ID, params, req, resetState, seedClosedWeek, state } from './helpers/core-harness';

vi.mock('@/lib/api/auth', async () => {
  const h = await import('./helpers/core-harness');
  return { requireUser: h.mockRequireUser };
});

beforeEach(() => { resetState(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); });

import { GET as weeksGet } from '@/app/api/v1/weeks/route';
import { GET, PUT } from '@/app/api/v1/weeks/[weekStart]/route';
import { POST as close } from '@/app/api/v1/weeks/[weekStart]/close/route';
import { POST as reopen } from '@/app/api/v1/weeks/[weekStart]/reopen/route';

const W = '2026-11-16';
const one = (fn: typeof GET, m: string, ws: string, body?: unknown) => fn(req(m, '/api/v1/weeks/' + ws, body), params({ weekStart: ws }));

describe('weeks', () => {
  it('401 when unauthenticated', async () => {
    state.authed = false;
    expect((await one(GET, 'GET', W)).status).toBe(401);
    expect((await weeksGet(req('GET', '/api/v1/weeks?from=' + W + '&to=' + W))).status).toBe(401);
  });

  it('400 for non-Monday weekStart with issues', async () => {
    const res = await one(GET, 'GET', '2026-11-17');
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.error.issues[0].path).toEqual(['weekStart']);
    expect((await one(close, 'POST', '2026-11-17', {})).status).toBe(400);
  });

  it('GET bundle: 7 days Mon..Sun, week_number null without program start, then set', async () => {
    let j = await (await one(GET, 'GET', W)).json();
    expect(j.days).toHaveLength(7);
    expect(j.days.every((d: unknown) => d === null)).toBe(true);
    expect(j.week_number).toBeNull();
    expect(j.phase).toBeNull();
    state.db.tables.user_settings![0]!.program_start_date = '2026-11-09';
    j = await (await one(GET, 'GET', W)).json();
    expect(j.week_number).toBe(2);
  });

  it('list: bad range 400, >26 weeks 400, only existing weeks', async () => {
    await one(GET, 'GET', W);
    let res = await weeksGet(req('GET', '/api/v1/weeks?from=2026-11-16&to=2026-11-09'));
    expect(res.status).toBe(400);
    res = await weeksGet(req('GET', '/api/v1/weeks?from=2026-01-05&to=2026-11-16'));
    expect(res.status).toBe(400);
    res = await weeksGet(req('GET', '/api/v1/weeks?from=2026-11-02&to=2026-11-23'));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.weeks).toHaveLength(1);
  });

  it('PUT: measurements range, photo prefix, unknown key, closed -> 409', async () => {
    let res = await one(PUT, 'PUT', W, { waist_cm: 5 });
    expect(res.status).toBe(400);
    res = await one(PUT, 'PUT', W, { photo_front_path: 'other/2026-11-16/front.jpg' });
    expect(res.status).toBe(400);
    res = await one(PUT, 'PUT', W, { goals_snapshot: {} });
    expect(res.status).toBe(400);
    res = await one(PUT, 'PUT', W, { waist_cm: 81.5, photo_front_path: USER_ID + '/' + W + '/front.jpg', reflection_hard: '  ' });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.checkin.waist_cm).toBe(81.5);
    expect(j.checkin.reflection_hard).toBeNull();
    seedClosedWeek(state.db, '2026-11-09');
    res = await one(PUT, 'PUT', '2026-11-09', { waist_cm: 80 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('week_closed');
  });

  it('close: ok, then 409 conflict; future week 400', async () => {
    let res = await one(close, 'POST', W, {});
    expect(res.status).toBe(200);
    expect((await res.json()).checkin.closed_at).not.toBeNull();
    res = await one(close, 'POST', W, {});
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('conflict');
    res = await one(close, 'POST', '2026-11-23', {});
    expect(res.status).toBe(400);
  });

  it('reopen without confirm -> 409 confirmation_required; with confirm keeps frozen snapshot', async () => {
    seedClosedWeek(state.db, '2026-11-09');
    let res = await one(reopen, 'POST', '2026-11-09', {});
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('confirmation_required');
    res = await one(reopen, 'POST', '2026-11-09', { confirm: true });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.checkin.closed_at).toBeNull();
    expect(j.checkin.goals_snapshot).toEqual({ frozen: true });
  });

  it('reopen with refresh_goals rebuilds snapshot from defaults/phase', async () => {
    seedClosedWeek(state.db, '2026-11-09');
    const j = await (await one(reopen, 'POST', '2026-11-09', { confirm: true, refresh_goals: true })).json();
    expect(j.checkin.goals_snapshot.active.calories_kcal).toBe(2350);
  });
});
