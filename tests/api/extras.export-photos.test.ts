import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ctx, resetDb, USER } from './helpers/extras-mocks';

vi.mock('@/lib/api/auth', async () => (await import('./helpers/extras-mocks')).authMock());
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/extras-mocks')).adminMock());
vi.mock('@/lib/services/settings', async () => (await import('./helpers/extras-mocks')).settingsMock());
vi.mock('@/lib/services/weeks', async () => (await import('./helpers/extras-mocks')).weeksMock());

import { GET as exportGet } from '@/app/api/v1/export/route';
import { GET as photosGet } from '@/app/api/v1/weeks/[weekStart]/photos/route';
import { POST as uploadUrl } from '@/app/api/v1/weeks/[weekStart]/photos/[pose]/upload-url/route';
import { DELETE as photoDelete } from '@/app/api/v1/weeks/[weekStart]/photos/[pose]/route';

const WEEK = '2026-11-16';
const p = (weekStart: string, pose?: string) => ({ params: Promise.resolve({ weekStart, pose: pose as string }) });

beforeEach(() => {
  resetDb();
  const db = ctx.db;
  db.rows('user_settings').push({ user_id: USER, timezone: 'America/Hermosillo', strong_default_unit: 'lb' });
  db.rows('phases').push({ id: 'p1', user_id: USER, name: 'Cut', start_date: '2026-11-09' });
  db.rows('weekly_checkins').push({ id: 'w1', user_id: USER, week_start_date: WEEK, phase_id: 'p1', goals_snapshot: { a: 1, b: [1, 2] }, reflection_hard: 'Hard, "very"\nhard', closed_at: null, photo_front_path: null, photo_side_path: null, photo_back_path: null });
  db.rows('daily_logs').push({ id: 'd1', user_id: USER, log_date: WEEK, week_start_date: WEEK, day_type: 'ACTIVE', weight_kg: 82.4, steps: null, edited_fields: ['weight_kg', 'steps'], apple_health_synced_at: null });
  db.rows('workouts').push({ id: 'k1', user_id: USER, log_date: WEEK, week_start_date: WEEK, category: 'CARDIO', type_label: 'Running, easy', active_kcal: 400, source: 'apple_health', strong_raw_txt: 'raw', volume_kg: null });
});

const get = (qs: string) => exportGet(new Request('http://localhost/api/v1/export' + qs));

describe('export', () => {
  it('json has all five tables, no user_id, raw text kept', async () => {
    const r = await get('?format=json');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="proof-of-work-\d{4}-\d{2}-\d{2}\.json"$/);
    const b = await r.json();
    expect(Object.keys(b)).toEqual(['exported_at', 'schema_version', 'user_settings', 'phases', 'weekly_checkins', 'daily_logs', 'workouts']);
    expect(b.schema_version).toBe(1);
    expect(b.workouts[0].strong_raw_txt).toBe('raw');
    expect(JSON.stringify(b)).not.toContain('user_id');
    expect(b.daily_logs).toHaveLength(1);
  });

  it('csv headers match doc 02 exactly, quoting and joins', async () => {
    const headers = {
      daily_logs: 'log_date,week_start_date,day_type,weight_kg,steps,protein_g,carbs_g,fat_g,calories_kcal,resting_kcal,active_kcal_total,edited_fields,apple_health_synced_at',
      workouts: 'log_date,week_start_date,category,type_label,active_kcal,duration_min,started_at,source,volume_kg,strong_title',
      weekly_checkins: 'week_start_date,phase_id,waist_cm,hip_cm,chest_cm,arm_cm,leg_cm,photo_front_path,photo_side_path,photo_back_path,external_folder_url,reflection_highlights,reflection_hard,reflection_next_goals,closed_at,goals_snapshot',
    };
    for (const [t, h] of Object.entries(headers)) {
      const r = await get(`?format=csv&table=${t}`);
      expect(r.headers.get('content-type')).toContain('text/csv');
      expect((await r.text()).split('\n')[0]).toBe(h);
    }
    const daily = (await (await get('?format=csv&table=daily_logs')).text()).split('\n')[1];
    expect(daily).toBe('2026-11-16,2026-11-16,ACTIVE,82.4,,,,,,,,weight_kg|steps,');
    const wk = (await (await get('?format=csv&table=workouts')).text()).split('\n')[1];
    expect(wk!.startsWith('2026-11-16,2026-11-16,CARDIO,"Running, easy",400,')).toBe(true);
    const ck = await (await get('?format=csv&table=weekly_checkins')).text();
    expect(ck).toContain('"Hard, ""very""\nhard"');
    expect(ck).toContain('"{""a"":1,""b"":[1,2]}"');
    expect(ck).not.toContain(USER);
  });

  it('bad format/table -> 400', async () => {
    expect((await get('?format=xml')).status).toBe(400);
    expect((await get('?format=csv')).status).toBe(400);
    expect((await get('?format=csv&table=phases')).status).toBe(400);
  });
});

describe('photos', () => {
  const up = (w: string, pose: string) => uploadUrl(new Request('http://localhost/x', { method: 'POST' }), p(w, pose));

  it('upload-url: path, token, signed_url', async () => {
    const r = await up(WEEK, 'front');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ path: `${USER}/${WEEK}/front.jpg`, token: 'tok', signed_url: expect.stringContaining('token=tok') });
  });
  it('closed week -> 409 week_closed', async () => {
    ctx.db.rows('weekly_checkins')[0]!.closed_at = '2026-11-20T00:00:00Z';
    const r = await up(WEEK, 'front');
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('week_closed');
    const d = await photoDelete(new Request('http://localhost/x', { method: 'DELETE' }), p(WEEK, 'front'));
    expect(d.status).toBe(409);
  });
  it('bad pose / non-Monday -> 400', async () => {
    expect((await up(WEEK, 'left')).status).toBe(400);
    expect((await up('2026-11-17', 'front')).status).toBe(400);
  });
  it('list signs 3600s urls; delete removes object and nulls column', async () => {
    ctx.db.rows('weekly_checkins')[0]!.photo_front_path = `${USER}/${WEEK}/front.jpg`;
    const b = await (await photosGet(new Request('http://localhost/x'), p(WEEK))).json();
    expect(b.front).toMatchObject({ path: `${USER}/${WEEK}/front.jpg`, expires_in: 3600 });
    expect(b.side).toBeNull();
    expect(b.back).toBeNull();
    const d = await photoDelete(new Request('http://localhost/x', { method: 'DELETE' }), p(WEEK, 'front'));
    expect(d.status).toBe(200);
    expect(ctx.db.rows('weekly_checkins')[0]!.photo_front_path).toBeNull();
    expect(ctx.db.storageCalls.some((c) => c.op.startsWith('remove:progress-photos'))).toBe(true);
    const again = await photoDelete(new Request('http://localhost/x', { method: 'DELETE' }), p(WEEK, 'front'));
    expect(again.status).toBe(404);
  });
});
