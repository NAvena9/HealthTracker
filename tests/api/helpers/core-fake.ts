import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

const NUMERIC_COLS = new Set(['weight_kg', 'protein_g', 'carbs_g', 'fat_g', 'duration_min', 'volume_kg', 'waist_cm', 'hip_cm', 'chest_cm', 'arm_cm', 'leg_cm', 'start_weight_kg', 'target_weight_kg']);

const DEFAULTS: Record<string, () => Row> = {
  user_settings: () => ({ timezone: 'America/Hermosillo', program_start_date: null, strong_default_unit: 'lb', appearance: 'system' }),
  phases: () => ({
    end_date: null, start_weight_kg: null, target_weight_kg: null,
    active_protein_g: 190, active_carbs_g: 240, active_fat_g: 70, active_kcal: 2350,
    rest_protein_g: 190, rest_carbs_g: 200, rest_fat_g: 60, rest_kcal: 2100,
    daily_step_goal: 10000, weekly_step_goal: 70000, weekly_weighin_goal: 3,
    weekly_cardio_sessions: null, weekly_strength_sessions: null,
  }),
  weekly_checkins: () => ({
    phase_id: null, waist_cm: null, hip_cm: null, chest_cm: null, arm_cm: null, leg_cm: null,
    photo_front_path: null, photo_side_path: null, photo_back_path: null, external_folder_url: null,
    reflection_highlights: null, reflection_hard: null, reflection_next_goals: null, closed_at: null,
  }),
  daily_logs: () => ({
    day_type: 'ACTIVE', weight_kg: null, steps: null, protein_g: null, carbs_g: null, fat_g: null,
    calories_kcal: null, resting_kcal: null, active_kcal_total: null, edited_fields: [], apple_health_synced_at: null,
  }),
  workouts: () => ({
    active_kcal: null, duration_min: null, started_at: null, volume_kg: null,
    strong_title: null, strong_raw_txt: null, strong_parsed: null,
  }),
};

interface DbError { code: string; message: string; hint?: string }

export class FakeDb {
  tables: Record<string, Row[]> = { user_settings: [], phases: [], weekly_checkins: [], daily_logs: [], workouts: [] };
  /** Force an error on the next insert into this table (compensation tests). */
  failNextInsert: Record<string, DbError | undefined> = {};

  client(): SupabaseClient {
    return { from: (t: string) => new Query(this, t) } as unknown as SupabaseClient;
  }

  isClosed(userId: unknown, week: unknown): boolean {
    return this.tables.weekly_checkins!.some((w) => w.user_id === userId && w.week_start_date === week && w.closed_at != null);
  }

  /** Emulates the closed-week triggers of 001_init.sql. */
  checkTriggers(table: string, op: 'insert' | 'update' | 'delete', oldRow: Row | null, newRow: Row | null): DbError | null {
    const err = { code: 'P0001', message: 'week is closed', hint: 'closed_week' };
    if (table === 'daily_logs' || table === 'workouts') {
      if (oldRow && op !== 'insert' && this.isClosed(oldRow.user_id, oldRow.week_start_date)) return err;
      if (newRow && op !== 'delete' && this.isClosed(newRow.user_id, newRow.week_start_date)) return err;
    }
    if (table === 'weekly_checkins' && oldRow && oldRow.closed_at != null && op !== 'insert') {
      if (op === 'delete') return err;
      if (newRow && newRow.closed_at == null) return null;
      return err;
    }
    return null;
  }

  violatesUnique(table: string, row: Row, ignoreIdx?: number): boolean {
    const rows = this.tables[table]!;
    return rows.some((r, i) => {
      if (i === ignoreIdx) return false;
      if (table === 'weekly_checkins') return r.user_id === row.user_id && r.week_start_date === row.week_start_date;
      if (table === 'daily_logs') return r.user_id === row.user_id && r.log_date === row.log_date;
      if (table === 'user_settings') return r.user_id === row.user_id;
      if (table === 'phases') return row.end_date == null && r.user_id === row.user_id && r.end_date == null;
      if (table === 'workouts')
        return row.started_at != null && r.user_id === row.user_id && r.log_date === row.log_date && r.type_label === row.type_label && r.started_at === row.started_at;
      return false;
    });
  }
}

class Query implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private payload: Row | Row[] | null = null;
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private returning = false;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) { if (this.op !== 'select') this.returning = true; return this; }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this; }
  upsert(p: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = 'upsert'; this.payload = p; this.opts = o; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.filters.push((r) => String(r[c]) <= v); return this; }
  lt(c: string, v: string) { this.filters.push((r) => String(r[c]) < v); return this; }
  gt(c: string, v: string) { this.filters.push((r) => String(r[c]) > v); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orderBy = { col, asc: o.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  then<R1 = { data: unknown; error: DbError | null }, R2 = never>(
    ok?: ((v: { data: unknown; error: DbError | null }) => R1 | PromiseLike<R1>) | null,
    bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }

  private out(rows: Row[]) {
    const clone = rows.map((r) => {
      const c: Row = structuredClone(r);
      for (const k of Object.keys(c)) if (NUMERIC_COLS.has(k) && typeof c[k] === 'number') c[k] = String(c[k]); // PostgREST numeric -> string
      return c;
    });
    if (this.mode === 'many') return { data: clone, error: null };
    if (clone.length === 0) {
      return this.mode === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    return { data: clone[0]!, error: null };
  }

  private match(r: Row) { return this.filters.every((f) => f(r)); }

  private run(): { data: unknown; error: DbError | null } {
    const rows = this.db.tables[this.table]!;
    const now = new Date().toISOString();
    if (this.op === 'select') {
      let res = rows.filter((r) => this.match(r));
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        res = [...res].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.limitN !== null) res = res.slice(0, this.limitN);
      return this.out(res);
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const done: Row[] = [];
      for (const p of list) {
        const forced = this.db.failNextInsert[this.table];
        if (forced) { this.db.failNextInsert[this.table] = undefined; return { data: null, error: forced }; }
        let idx = -1;
        if (this.op === 'upsert') {
          const cols = (this.opts.onConflict ?? 'id').split(',').map((s) => s.trim());
          idx = rows.findIndex((r) => cols.every((c) => r[c] === p[c]));
        }
        if (idx >= 0) {
          if (this.opts.ignoreDuplicates) continue;
          const merged = { ...rows[idx]!, ...structuredClone(p), updated_at: now };
          const trg = this.db.checkTriggers(this.table, 'update', rows[idx]!, merged);
          if (trg) return { data: null, error: trg };
          rows[idx] = merged;
          done.push(merged);
          continue;
        }
        const row: Row = { ...(DEFAULTS[this.table]?.() ?? {}), id: randomUUID(), created_at: now, updated_at: now, ...structuredClone(p) };
        const trg = this.db.checkTriggers(this.table, 'insert', null, row);
        if (trg) return { data: null, error: trg };
        if (this.db.violatesUnique(this.table, row)) {
          if (this.opts.ignoreDuplicates) continue;
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows.push(row);
        done.push(row);
      }
      return this.returning ? this.out(done) : { data: null, error: null };
    }
    if (this.op === 'update') {
      const done: Row[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        if (!this.match(r)) continue;
        const next: Row = { ...r, ...structuredClone(this.payload as Row), updated_at: now };
        const trg = this.db.checkTriggers(this.table, 'update', r, next);
        if (trg) return { data: null, error: trg };
        if (this.table === 'phases' && next.end_date == null && this.db.violatesUnique('phases', next, i)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows[i] = next;
        done.push(next);
      }
      return this.returning ? this.out(done) : { data: null, error: null };
    }
    // delete
    for (const r of rows) {
      if (!this.match(r)) continue;
      const trg = this.db.checkTriggers(this.table, 'delete', r, null);
      if (trg) return { data: null, error: trg };
    }
    for (const r of rows) {
      if (this.match(r) && this.table === 'phases') for (const w of this.db.tables.weekly_checkins!) if (w.phase_id === r.id) w.phase_id = null;
    }
    this.db.tables[this.table] = rows.filter((r) => !this.match(r));
    return { data: null, error: null };
  }
}
