import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ctx, resetDb, USER } from './helpers/extras-mocks';

vi.mock('@/lib/api/auth', async () => (await import('./helpers/extras-mocks')).authMock());
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/extras-mocks')).adminMock());
vi.mock('@/lib/services/settings', async () => (await import('./helpers/extras-mocks')).settingsMock());
vi.mock('@/lib/services/weeks', async () => (await import('./helpers/extras-mocks')).weeksMock());

import { POST } from '@/app/api/v1/strong/apply/route';

const TEXT = readFileSync(new URL('../../../samples/strong-export-sample.txt', import.meta.url), 'utf8');
const apply = (body: unknown) =>
  POST(new Request('http://localhost/api/v1/strong/apply', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(resetDb);

describe('strong apply', () => {
  it('Vector 6: creates a strong STRENGTH workout', async () => {
    const r = await apply({ log_date: '2026-11-14', raw_text: TEXT });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.parsed.exercises).toHaveLength(8);
    expect(b.parsed.totalSets).toBe(25);
    expect(b.parsed.totalVolumeKg).toBe(8981);
    expect(b.workout).toMatchObject({ category: 'STRENGTH', source: 'strong', type_label: 'Strength Training', volume_kg: 8981, strong_title: 'S- PULL B (Back + Biceps + Core) Copy' });
    expect(b.workout.strong_raw_txt).toBe(TEXT);
    expect(b.workout.user_id).toBeUndefined();
    expect(ctx.db.rows('workouts')).toHaveLength(1);
  });

  it('attaches to the single apple_health STRENGTH session and keeps its source', async () => {
    ctx.db.insertRow('workouts', { user_id: USER, log_date: '2026-11-14', week_start_date: '2026-11-09', category: 'STRENGTH', type_label: 'Traditional Strength Training', active_kcal: 300, started_at: '2026-11-14T22:26:00Z', source: 'apple_health' });
    ctx.db.insertRow('workouts', { user_id: USER, log_date: '2026-11-14', week_start_date: '2026-11-09', category: 'CARDIO', type_label: 'Running', active_kcal: 300, started_at: '2026-11-14T10:00:00Z', source: 'apple_health' });
    const b = await (await apply({ log_date: '2026-11-14', raw_text: TEXT })).json();
    expect(ctx.db.rows('workouts')).toHaveLength(2);
    expect(b.workout).toMatchObject({ source: 'apple_health', type_label: 'Traditional Strength Training', volume_kg: 8981, active_kcal: 300 });
  });

  it('two apple_health strength sessions: creates a new one', async () => {
    for (const k of [1, 2]) ctx.db.insertRow('workouts', { user_id: USER, log_date: '2026-11-14', week_start_date: '2026-11-09', category: 'STRENGTH', type_label: 'S' + k, active_kcal: 100 + k, source: 'apple_health' });
    await apply({ log_date: '2026-11-14', raw_text: TEXT });
    expect(ctx.db.rows('workouts')).toHaveLength(3);
  });

  it('attach_to updates that workout; unknown id -> 404', async () => {
    const id = (ctx.db.insertRow('workouts', { user_id: USER, log_date: '2026-11-14', week_start_date: '2026-11-09', category: 'STRENGTH', type_label: 'Manual', source: 'manual' }).data as { id: string }[])[0]!.id;
    const b = await (await apply({ log_date: '2026-11-14', raw_text: TEXT, attach_to: id })).json();
    expect(b.workout.id).toBe(id);
    expect(b.workout.source).toBe('manual');
    const r = await apply({ log_date: '2026-11-14', raw_text: TEXT, attach_to: '22222222-2222-4222-8222-222222222222' });
    expect(r.status).toBe(404);
  });

  it('zero sets -> 400 with warnings', async () => {
    const r = await apply({ log_date: '2026-11-14', raw_text: 'Title\nSet 1: 30 s' });
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error.code).toBe('validation_error');
    expect(b.error.warnings.length).toBeGreaterThan(0);
    expect(ctx.db.rows('workouts')).toHaveLength(0);
  });

  it('bad date 400, over 100 KB 413, closed week 409', async () => {
    expect((await apply({ log_date: '2026-13-40', raw_text: TEXT })).status).toBe(400);
    expect((await apply({ log_date: '2026-11-14', raw_text: 'a'.repeat(101 * 1024) })).status).toBe(413);
    ctx.db.rows('weekly_checkins').push({ user_id: USER, week_start_date: '2026-11-09', closed_at: '2026-11-15T00:00:00Z' });
    const r = await apply({ log_date: '2026-11-14', raw_text: TEXT });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('week_closed');
  });
});
