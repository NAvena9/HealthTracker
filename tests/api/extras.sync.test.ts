import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ctx, resetDb, USER } from './helpers/extras-mocks';

vi.mock('@/lib/api/auth', async () => (await import('./helpers/extras-mocks')).authMock());
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/extras-mocks')).adminMock());
vi.mock('@/lib/services/settings', async () => (await import('./helpers/extras-mocks')).settingsMock());
vi.mock('@/lib/services/weeks', async () => (await import('./helpers/extras-mocks')).weeksMock());

import { POST as webhook } from '@/app/api/sync/apple-health/route';
import { POST as rotate } from '@/app/api/v1/credentials/rotate/route';
import { GET as credStatus } from '@/app/api/v1/credentials/route';
import { GET as syncStatus } from '@/app/api/v1/sync/status/route';
import { resetRateLimit } from '@/lib/api/rateLimit';

const sample = (n: string) => JSON.parse(readFileSync(new URL(`../../../samples/${n}`, import.meta.url), 'utf8'));
const URL0 = 'http://localhost/api/sync/apple-health';

let secret = '';
const call = (body: unknown, opts: { auth?: string | null; qs?: string; raw?: string; ip?: string } = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': opts.ip ?? '1.1.1.1' };
  const auth = opts.auth === undefined ? `Bearer ${secret}` : opts.auth;
  if (auth) headers.authorization = auth;
  return webhook(new Request(URL0 + (opts.qs ?? ''), { method: 'POST', headers, body: opts.raw ?? JSON.stringify(body) }));
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T20:00:00Z'));
  resetDb();
  resetRateLimit();
  delete process.env.SYNC_RATE_LIMIT_PER_MIN;
  const r = await rotate(new Request('http://localhost/api/v1/credentials/rotate', { method: 'POST' }));
  secret = ((await r.json()) as { secret: string }).secret;
});
afterEach(() => vi.useRealTimers());

describe('credentials', () => {
  it('rotate returns secret once, stores only 64-char hex hash; old secret fails', async () => {
    const old = secret;
    expect(old).toMatch(/^pow_[A-Za-z0-9_-]{43}$/);
    const row = ctx.db.rows('sync_credentials')[0]!;
    expect(row.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(old);
    expect(row.secret_last4).toBe(old.slice(-4));
    const st = await (await credStatus(new Request('http://localhost/api/v1/credentials'))).json();
    expect(st).toMatchObject({ has_secret: true, last4: old.slice(-4), webhook_url: 'http://localhost/api/sync/apple-health' });
    expect(JSON.stringify(st)).not.toContain(old);
    expect((await call(sample('sync-payload-v2.json'))).status).toBe(200);
    await rotate(new Request('http://localhost/api/v1/credentials/rotate', { method: 'POST' }));
    expect(ctx.db.rows('sync_credentials')).toHaveLength(1);
    expect((await call(sample('sync-payload-v2.json'), { auth: `Bearer ${old}` })).status).toBe(401);
    expect((await call(sample('sync-payload-v2.json'))).status).toBe(401);
  });
});

describe('webhook errors', () => {
  it('401 missing / wrong / malformed with identical body', async () => {
    const bodies = [];
    for (const auth of [null, 'Bearer wrong', 'Basic abc', `Token ${secret}`]) {
      const r = await call({ date: '2026-11-16' }, { auth });
      expect(r.status).toBe(401);
      bodies.push(await r.json());
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0].error.code).toBe('unauthorized');
  });
  it('400 invalid payload, with issues and nothing written', async () => {
    const r = await call({ date: '2026-11-16', steps: -5 });
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error.code).toBe('validation_error');
    expect(b.error.issues.length).toBeGreaterThan(0);
    expect((await call(null, { raw: '{nope' })).status).toBe(400);
    expect((await call({ schema: 2, days: [{ date: '2026-11-16' }, { date: '2026-11-16' }] })).status).toBe(400);
    expect((await call({ date: '2026-10-01' })).status).toBe(400);
    expect((await call({ schema: 2, days: [{ date: '2026-11-16', steps: 10 }, { date: '2026-11-15', steps: -1 }] })).status).toBe(400);
    expect(ctx.db.rows('daily_logs')).toHaveLength(0);
  });
  it('413 over 64 KB', async () => {
    const r = await call(null, { raw: 'a'.repeat(70000) });
    expect(r.status).toBe(413);
    expect((await r.json()).error.code).toBe('payload_too_large');
  });
  it('429 with Retry-After', async () => {
    process.env.SYNC_RATE_LIMIT_PER_MIN = '2';
    expect((await call({ date: '2026-11-16' }, { ip: '9.9.9.9' })).status).toBe(200);
    expect((await call({ date: '2026-11-16' }, { ip: '9.9.9.9' })).status).toBe(200);
    const r = await call({ date: '2026-11-16' }, { ip: '9.9.9.9' });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await r.json()).error.code).toBe('rate_limited');
    expect((await call({ date: '2026-11-16' }, { ip: '8.8.8.8' })).status).toBe(200);
  });
});

describe('webhook merge', () => {
  it('v2 sample: three days, response shape, synced_at set', async () => {
    const r = await call(sample('sync-payload-v2.json'));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.status).toBe('ok');
    expect(b.dry_run).toBeUndefined();
    expect(b.days.map((d: { date: string }) => d.date)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16']);
    expect(b.days[0]).toEqual({
      date: '2026-11-14',
      updated_fields: ['steps', 'weight_kg', 'protein_g', 'carbs_g', 'fat_g', 'calories_kcal', 'resting_kcal', 'active_kcal_total'],
      skipped: [],
      workouts_upserted: 1,
      skipped_closed_week: false,
    });
    expect(b.days[1].skipped).toEqual([{ field: 'weight_kg', reason: 'empty' }]);
    const logs = ctx.db.rows('daily_logs');
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.user_id === USER && l.apple_health_synced_at)).toBe(true);
    expect(logs.find((l) => l.log_date === '2026-11-14')!.week_start_date).toBe('2026-11-09');
    expect(ctx.db.rows('workouts')).toHaveLength(2);
    const st = await (await syncStatus(new Request('http://localhost/api/v1/sync/status'))).json();
    expect(st.has_secret).toBe(true);
    expect(st.last_synced_dates).toEqual(['2026-11-14', '2026-11-15', '2026-11-16']);
    expect(st.last_sync_at).toBeTruthy();
  });

  it('v1 sample works, categories classified', async () => {
    const r = await call(sample('sync-payload-gemini-v1.json'));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.days).toHaveLength(1);
    expect(b.days[0].workouts_upserted).toBe(2);
    const cats = Object.fromEntries(ctx.db.rows('workouts').map((w) => [w.type_label, w.category]));
    expect(cats).toEqual({ Running: 'CARDIO', 'Traditional Strength Training': 'STRENGTH' });
  });

  it('Vector 5: protein manual, steps+weight updated, fat 0 empty', async () => {
    ctx.db.rows('daily_logs').push({
      id: 'd1', user_id: USER, log_date: '2026-11-16', week_start_date: '2026-11-16', day_type: 'REST',
      steps: 5000, protein_g: 150, edited_fields: ['protein_g'], weight_kg: null, carbs_g: null, fat_g: null,
      calories_kcal: null, resting_kcal: null, active_kcal_total: null, apple_health_synced_at: null,
    });
    const b = await (await call({ date: '2026-11-16', steps: 11420, protein_g: 192, weight_kg: 82.4, fat_g: 0 })).json();
    expect(b.days[0].updated_fields).toEqual(['steps', 'weight_kg']);
    expect(b.days[0].skipped).toEqual([{ field: 'protein_g', reason: 'manual_edit' }, { field: 'fat_g', reason: 'empty' }]);
    const row = ctx.db.rows('daily_logs')[0]!;
    expect(row).toMatchObject({ steps: 11420, weight_kg: 82.4, protein_g: 150, day_type: 'REST', edited_fields: ['protein_g'] });
    expect(row.fat_g).toBeNull();
  });

  it('new day inherits previous day type', async () => {
    ctx.db.rows('daily_logs').push({ id: 'd0', user_id: USER, log_date: '2026-11-15', week_start_date: '2026-11-09', day_type: 'REST', steps: 1, edited_fields: [] });
    await call({ date: '2026-11-16', steps: 100 });
    expect(ctx.db.rows('daily_logs').find((l) => l.log_date === '2026-11-16')!.day_type).toBe('REST');
  });

  it('second identical run creates no duplicate workouts', async () => {
    await call(sample('sync-payload-v2.json'));
    const r = await call(sample('sync-payload-v2.json'));
    expect(r.status).toBe(200);
    expect(ctx.db.rows('workouts')).toHaveLength(2);
    expect(ctx.db.rows('daily_logs')).toHaveLength(3);
    // no-start workouts dedupe by kcal too
    const v1 = sample('sync-payload-gemini-v1.json');
    await call(v1);
    await call(v1);
    expect(ctx.db.rows('workouts')).toHaveLength(4);
  });

  it('never overwrites strong data; updates kcal/duration only', async () => {
    await call(sample('sync-payload-v2.json'));
    const w = ctx.db.rows('workouts').find((x) => x.type_label === 'Running')!;
    w.volume_kg = 123;
    w.strong_title = 'T';
    const p = sample('sync-payload-v2.json');
    p.days[2].workouts[0].active_kcal = 450;
    await call(p);
    expect(ctx.db.rows('workouts')).toHaveLength(2);
    expect(w).toMatchObject({ active_kcal: 450, volume_kg: 123, strong_title: 'T' });
  });

  it('23505 race: re-select and update', async () => {
    const p = { date: '2026-11-16', workouts: [{ type: 'Running', active_kcal: 300, start: '2026-11-16T06:45:00-07:00' }] };
    ctx.db.raceOnNextWorkoutInsert = { user_id: USER, log_date: '2026-11-16', week_start_date: '2026-11-16', category: 'CARDIO', type_label: 'Running', active_kcal: 100, started_at: '2026-11-16T13:45:00Z', source: 'apple_health' };
    expect((await call(p)).status).toBe(200);
    expect(ctx.db.rows('workouts')).toHaveLength(1);
    expect(ctx.db.rows('workouts')[0]!.active_kcal).toBe(300);
  });

  it('closed week skipped, nothing written', async () => {
    ctx.db.rows('weekly_checkins').push({ user_id: USER, week_start_date: '2026-11-09', closed_at: '2026-11-15T00:00:00Z', goals_snapshot: {} });
    const b = await (await call(sample('sync-payload-v2.json'))).json();
    expect(b.days[0]).toEqual({ date: '2026-11-14', updated_fields: [], skipped: [], workouts_upserted: 0, skipped_closed_week: true });
    expect(b.days[1].skipped_closed_week).toBe(true);
    expect(b.days[2].skipped_closed_week).toBe(false);
    const logs = ctx.db.rows('daily_logs');
    expect(logs.map((l) => l.log_date)).toEqual(['2026-11-16']);
    expect(ctx.db.rows('workouts').every((w) => w.log_date === '2026-11-16')).toBe(true);
  });

  it('dry_run writes nothing (not even week rows) but reports', async () => {
    const before = ctx.db.writes;
    const r = await call(sample('sync-payload-v2.json'), { qs: '?dry_run=1' });
    const b = await r.json();
    expect(b.dry_run).toBe(true);
    expect(b.days[0].updated_fields).toContain('steps');
    expect(b.days[0].workouts_upserted).toBe(1);
    expect(ctx.db.writes).toBe(before);
    expect(ctx.db.rows('daily_logs')).toHaveLength(0);
    expect(ctx.db.rows('workouts')).toHaveLength(0);
    expect(ctx.db.rows('weekly_checkins')).toHaveLength(0);
  });
});
