import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SyncValidationError,
  classifyWorkout,
  mergeSyncPayload,
  normalizeSyncPayload,
} from '../src/lib/domain';
import type { SyncDay } from '../src/lib/domain';
import { log } from './fixtures';

const NOW = new Date('2026-11-16T22:30:00Z');

describe('normalizeSyncPayload', () => {
  it('v1: single day object', () => {
    const v1 = JSON.parse(readFileSync(new URL('../../samples/sync-payload-gemini-v1.json', import.meta.url), 'utf8'));
    const days = normalizeSyncPayload(v1);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2026-11-16');
    expect(days[0].steps).toBe(11420);
    expect(days[0].workouts).toHaveLength(2);
  });
  it('v2: days array', () => {
    const days = normalizeSyncPayload({ schema: 2, days: [{ date: '2026-11-15', steps: 100 }, { date: '2026-11-16', weight_kg: null }] });
    expect(days.map((d) => d.date)).toEqual(['2026-11-15', '2026-11-16']);
    expect(days[1].weight_kg).toBeNull();
    expect('steps' in days[1]).toBe(false); // absent stays absent
  });
  it('invalid date throws SyncValidationError with issues', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '16/11/2026', '2026-1-1', '']) {
      try {
        normalizeSyncPayload({ date: bad });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(SyncValidationError);
        expect((e as SyncValidationError).issues.length).toBeGreaterThan(0);
      }
    }
  });
  it('missing date / non-object / wrong schema throw', () => {
    expect(() => normalizeSyncPayload({ steps: 1 })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload(null)).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload([])).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload('x')).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ schema: 3, days: [] })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ schema: 2, days: [] })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ schema: 2 })).toThrow(SyncValidationError);
  });
  it('14 days ok, 15 days throws', () => {
    const mk = (n: number) => ({
      schema: 2,
      days: Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}` })),
    });
    expect(normalizeSyncPayload(mk(14))).toHaveLength(14);
    expect(() => normalizeSyncPayload(mk(15))).toThrow(SyncValidationError);
  });
  it('numeric types are validated', () => {
    expect(() => normalizeSyncPayload({ date: '2026-11-16', steps: '11420' })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ date: '2026-11-16', weight_kg: NaN })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ date: '2026-11-16', weight_kg: Infinity })).toThrow(SyncValidationError);
  });
  it('workouts shape is validated', () => {
    expect(() => normalizeSyncPayload({ date: '2026-11-16', workouts: 'x' })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ date: '2026-11-16', workouts: [{ type: 'Running' }] })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ date: '2026-11-16', workouts: [{ active_kcal: 100 }] })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ date: '2026-11-16', workouts: [1] })).toThrow(SyncValidationError);
    expect(() => normalizeSyncPayload({ date: '2026-11-16', workouts: [{ type: 'Running', active_kcal: 1, start: 'nope' }] })).toThrow(SyncValidationError);
    const ok = normalizeSyncPayload({ date: '2026-11-16', workouts: [{ type: 'Running', active_kcal: 410, duration_min: 40, start: '2026-11-16T07:00:00-07:00' }] });
    expect(ok[0].workouts?.[0]).toEqual({ type: 'Running', active_kcal: 410, duration_min: 40, start: '2026-11-16T07:00:00-07:00' });
  });
  it('collects several issues', () => {
    try {
      normalizeSyncPayload({ schema: 2, days: [{ date: 'bad' }, { date: '2026-11-16', steps: 'x' }] });
      expect.unreachable();
    } catch (e) {
      expect((e as SyncValidationError).issues).toHaveLength(2);
    }
  });
});

describe('classifyWorkout', () => {
  it.each([
    ['Running', 'CARDIO'],
    ['Cycling', 'CARDIO'],
    ['HIIT', 'CARDIO'],
    ['Traditional Strength Training', 'STRENGTH'],
    ['Core Training', 'STRENGTH'],
    ['Functional Strength Training', 'STRENGTH'],
    ['weight lifting', 'STRENGTH'],
    ['FUNCTIONAL', 'STRENGTH'],
  ] as const)('%s -> %s', (name, cat) => expect(classifyWorkout(name)).toBe(cat));
});

describe('mergeSyncPayload', () => {
  it('vector 5: manual edit protected, zero is empty', () => {
    const existing = log('2026-11-16', 'ACTIVE', { steps: 5000, protein_g: 150, edited_fields: ['protein_g'] });
    const incoming: SyncDay = { date: '2026-11-16', steps: 11420, protein_g: 192, weight_kg: 82.4, fat_g: 0 };
    const r = mergeSyncPayload(existing, incoming, { weekClosed: false, now: NOW });
    expect(r.updated_fields).toEqual(['steps', 'weight_kg']);
    expect(r.skipped).toEqual([
      { field: 'protein_g', reason: 'manual_edit' },
      { field: 'fat_g', reason: 'empty' },
    ]);
    expect(r.patch).toEqual({ steps: 11420, weight_kg: 82.4, apple_health_synced_at: NOW.toISOString() });
    expect(r.workouts).toEqual([]);
  });
  it('absent keys are not reported as skipped; null is', () => {
    const r = mergeSyncPayload(null, { date: '2026-11-16', steps: 100, weight_kg: null }, { weekClosed: false, now: NOW });
    expect(r.skipped).toEqual([{ field: 'weight_kg', reason: 'empty' }]);
    expect(r.updated_fields).toEqual(['steps']);
  });
  it('maps active_kcal -> active_kcal_total, including edit protection by the DB name', () => {
    const r = mergeSyncPayload(null, { date: '2026-11-16', active_kcal: 900, resting_kcal: 1850 }, { weekClosed: false, now: NOW });
    expect(r.patch.active_kcal_total).toBe(900);
    expect(r.updated_fields).toEqual(['resting_kcal', 'active_kcal_total']);
    expect('active_kcal' in r.patch).toBe(false);
    const edited = log('2026-11-16', 'REST', { edited_fields: ['active_kcal_total'] });
    const r2 = mergeSyncPayload(edited, { date: '2026-11-16', active_kcal: 900 }, { weekClosed: false, now: NOW });
    expect(r2.skipped).toEqual([{ field: 'active_kcal_total', reason: 'manual_edit' }]);
    expect(r2.patch).toEqual({});
  });
  it('closed week: empty patch, no workouts, no updated fields', () => {
    const r = mergeSyncPayload(null, { date: '2026-11-16', steps: 100, workouts: [{ type: 'Running', active_kcal: 300 }] }, { weekClosed: true, now: NOW });
    expect(r).toEqual({ patch: {}, updated_fields: [], skipped: [], workouts: [] });
  });
  it('never touches day_type', () => {
    const r = mergeSyncPayload(log('2026-11-16', 'REST'), { date: '2026-11-16', steps: 100 }, { weekClosed: false, now: NOW });
    expect('day_type' in r.patch).toBe(false);
  });
  it('workouts: classified, upserts shaped, zero/negative kcal ignored', () => {
    const r = mergeSyncPayload(
      null,
      {
        date: '2026-11-16',
        workouts: [
          { type: 'Running', active_kcal: 410, duration_min: 40, start: '2026-11-16T07:00:00-07:00' },
          { type: 'Traditional Strength Training', active_kcal: 265 }, // without start
          { type: 'Cycling', active_kcal: 0 },
          { type: 'HIIT', active_kcal: -5 },
        ],
      },
      { weekClosed: false, now: NOW },
    );
    expect(r.workouts).toEqual([
      { log_date: '2026-11-16', category: 'CARDIO', type_label: 'Running', active_kcal: 410, duration_min: 40, started_at: '2026-11-16T07:00:00-07:00', source: 'apple_health' },
      { log_date: '2026-11-16', category: 'STRENGTH', type_label: 'Traditional Strength Training', active_kcal: 265, duration_min: null, started_at: null, source: 'apple_health' },
    ]);
    expect(r.updated_fields).toEqual([]);
    expect(r.patch.apple_health_synced_at).toBe(NOW.toISOString()); // a workout was applied
  });
  it('no synced timestamp when nothing was applied', () => {
    const r = mergeSyncPayload(null, { date: '2026-11-16', steps: 0, workouts: [{ type: 'Running', active_kcal: 0 }] }, { weekClosed: false, now: NOW });
    expect(r.patch).toEqual({});
    expect(r.skipped).toEqual([{ field: 'steps', reason: 'empty' }]);
  });
  it('end to end with the v1 sample', () => {
    const v1 = JSON.parse(readFileSync(new URL('../../samples/sync-payload-gemini-v1.json', import.meta.url), 'utf8'));
    const [day] = normalizeSyncPayload(v1);
    const r = mergeSyncPayload(null, day, { weekClosed: false, now: NOW });
    expect(r.updated_fields).toEqual(['steps', 'weight_kg', 'protein_g', 'carbs_g', 'fat_g', 'calories_kcal']);
    expect(r.workouts.map((w) => w.category)).toEqual(['CARDIO', 'STRENGTH']);
  });
});
