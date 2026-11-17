import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, USER_ID, params, req, resetState, seedClosedWeek, state } from './helpers/core-harness';

vi.mock('@/lib/api/auth', async () => {
  const h = await import('./helpers/core-harness');
  return { requireUser: h.mockRequireUser };
});

beforeEach(() => { resetState(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); });

import { GET, PUT } from '@/app/api/v1/settings/route';

describe('settings', () => {
  it('401', async () => {
    state.authed = false;
    expect((await GET(req('GET', '/s'))).status).toBe(401);
  });

  it('GET creates defaults row', async () => {
    const res = await GET(req('GET', '/s'));
    const j = await res.json();
    expect(j).toMatchObject({ timezone: 'America/Hermosillo', program_start_date: null, strong_default_unit: 'lb', appearance: 'system' });
    expect(j.user_id).toBeUndefined();
    expect(state.db.tables.user_settings).toHaveLength(1);
  });

  it('PUT: non-Monday 400, bad tz 400, ok, null clears', async () => {
    let res = await PUT(req('PUT', '/s', { program_start_date: '2026-11-10' }));
    expect(res.status).toBe(400);
    res = await PUT(req('PUT', '/s', { timezone: 'Mars/Base' }));
    expect(res.status).toBe(400);
    res = await PUT(req('PUT', '/s', { program_start_date: '2026-11-09', appearance: 'dark' }));
    expect((await res.json()).program_start_date).toBe('2026-11-09');
    res = await PUT(req('PUT', '/s', { program_start_date: null }));
    expect((await res.json()).program_start_date).toBeNull();
    res = await PUT(req('PUT', '/s', { nope: 1 }));
    expect(res.status).toBe(400);
  });
});
