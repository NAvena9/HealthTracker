import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, USER_ID, params, req, resetState, seedClosedWeek, state } from './helpers/core-harness';

vi.mock('@/lib/api/auth', async () => {
  const h = await import('./helpers/core-harness');
  return { requireUser: h.mockRequireUser };
});

beforeEach(() => { resetState(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); });

import { GET as list, POST as create } from '@/app/api/v1/phases/route';
import { POST as startNew } from '@/app/api/v1/phases/start-new/route';
import { GET as getOne, PATCH, DELETE } from '@/app/api/v1/phases/[id]/route';
import { GET as weekGet } from '@/app/api/v1/weeks/[weekStart]/route';

const mk = async (body: unknown) => (await create(req('POST', '/api/v1/phases', body))).json();
const week = async (ws: string) => (await weekGet(req('GET', '/x'), params({ weekStart: ws }))).json();

describe('phases', () => {
  it('401', async () => {
    state.authed = false;
    expect((await list(req('GET', '/api/v1/phases'))).status).toBe(401);
  });

  it('validation: missing name, bad kcal, non-Monday start-new', async () => {
    let res = await create(req('POST', '/p', { start_date: '2026-11-09' }));
    expect(res.status).toBe(400);
    res = await create(req('POST', '/p', { name: 'Cut', start_date: '2026-11-09', active_kcal: 99999 }));
    expect(res.status).toBe(400);
    res = await startNew(req('POST', '/p', { name: 'Bulk', start_date: '2026-11-10' }));
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.error.issues[0].message).toBe('Must be a Monday');
  });

  it('create: second open phase -> 409 conflict', async () => {
    const p = await mk({ name: 'Cut', start_date: '2026-11-09', start_weight_kg: 84 });
    expect(p.start_weight_kg).toBe(84);
    expect(p.user_id).toBeUndefined();
    const res = await create(req('POST', '/p', { name: 'Again', start_date: '2026-11-16' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('conflict');
  });

  it('PATCH refreshes OPEN weeks of the phase only', async () => {
    const p = await mk({ name: 'Cut', start_date: '2026-11-02' });
    await week('2026-11-09'); // open week, snapshot from phase
    await week('2026-11-16');
    state.db.tables.weekly_checkins!.find((w) => w.week_start_date === '2026-11-09')!.closed_at = '2026-11-15T00:00:00Z';
    const res = await PATCH(req('PATCH', '/p', { active_kcal: 2000, target_weight_kg: 78 }), params({ id: p.id }));
    expect(res.status).toBe(200);
    const closed = state.db.tables.weekly_checkins!.find((w) => w.week_start_date === '2026-11-09')!;
    const open = state.db.tables.weekly_checkins!.find((w) => w.week_start_date === '2026-11-16')!;
    expect((closed.goals_snapshot as { active: { calories_kcal: number } }).active.calories_kcal).toBe(2350);
    const snap = open.goals_snapshot as { active: { calories_kcal: number }; target_weight_kg: number };
    expect(snap.active.calories_kcal).toBe(2000);
    expect(snap.target_weight_kg).toBe(78);
  });

  it('start-new: previous end_date = start-1, open weeks repointed', async () => {
    const p = await mk({ name: 'Cut', start_date: '2026-11-02' });
    await week('2026-11-16');
    const res = await startNew(req('POST', '/p', { name: 'Maintain', start_date: '2026-11-16', active_kcal: 2600 }));
    const j = await res.json();
    expect(res.status).toBe(201);
    expect(j.previous.id).toBe(p.id);
    expect(j.previous.end_date).toBe('2026-11-15');
    expect(j.phase.end_date).toBeNull();
    const w = state.db.tables.weekly_checkins![0]!;
    expect(w.phase_id).toBe(j.phase.id);
    expect((w.goals_snapshot as { active: { calories_kcal: number } }).active.calories_kcal).toBe(2600);
  });

  it('start-new: start <= previous start -> 400; insert failure restores end_date', async () => {
    const p = await mk({ name: 'Cut', start_date: '2026-11-16' });
    let res = await startNew(req('POST', '/p', { name: 'X', start_date: '2026-11-16' }));
    expect(res.status).toBe(400);
    state.db.failNextInsert.phases = { code: '23505', message: 'dup' };
    res = await startNew(req('POST', '/p', { name: 'X', start_date: '2026-11-23' }));
    expect(res.status).toBe(409);
    const stored = state.db.tables.phases!.find((x) => x.id === p.id)!;
    expect(stored.end_date).toBeNull();
  });

  it('DELETE: 409 confirmation_required when weeks reference it; confirm nulls phase_id', async () => {
    const p = await mk({ name: 'Cut', start_date: '2026-11-09' });
    await week('2026-11-16');
    let res = await DELETE(req('DELETE', '/p'), params({ id: p.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('confirmation_required');
    res = await DELETE(req('DELETE', '/p?confirm=true'), params({ id: p.id }));
    expect(res.status).toBe(200);
    expect(state.db.tables.phases).toHaveLength(0);
    expect(state.db.tables.weekly_checkins![0]!.phase_id).toBeNull();
  });

  it('GET one: 404 and 400 for non-uuid; list newest first', async () => {
    let res = await getOne(req('GET', '/p'), params({ id: '22222222-2222-4222-8222-222222222222' }));
    expect(res.status).toBe(404);
    res = await getOne(req('GET', '/p'), params({ id: 'abc' }));
    expect(res.status).toBe(400);
    await mk({ name: 'Old', start_date: '2026-01-05', end_date: '2026-02-01' });
    await mk({ name: 'New', start_date: '2026-11-09' });
    const j = await (await list(req('GET', '/p'))).json();
    expect(j.phases.map((x: { name: string }) => x.name)).toEqual(['New', 'Old']);
  });
});
