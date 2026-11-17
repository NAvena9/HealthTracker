import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
interface DbError {
  code: string;
  message: string;
  hint?: string | null;
}
interface Result {
  data: unknown;
  error: DbError | null;
}

const NULL_COLS: Record<string, string[]> = {
  daily_logs: [
    'weight_kg', 'steps', 'protein_g', 'carbs_g', 'fat_g', 'calories_kcal', 'resting_kcal', 'active_kcal_total',
    'apple_health_synced_at',
  ],
  workouts: [
    'active_kcal', 'duration_min', 'started_at', 'volume_kg', 'strong_title', 'strong_raw_txt', 'strong_parsed',
  ],
};

const ts = (v: unknown): unknown => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : v);
const same = (a: unknown, b: unknown): boolean => {
  const x = ts(a);
  const y = ts(b);
  return x === y || (x == null && y == null);
};

/** Minimal in-memory stand-in for the parts of supabase-js the services use. */
export class FakeDb {
  tables: Record<string, Row[]> = {};
  storageCalls: { op: string; path: string }[] = [];
  /** Test hook: throw this 23505 once on the next workouts insert (simulates a race). */
  raceOnNextWorkoutInsert: Row | null = null;
  writes = 0;

  rows(t: string): Row[] {
    return (this.tables[t] ??= []);
  }

  private weekClosed(user: unknown, week: unknown): boolean {
    return this.rows('weekly_checkins').some((w) => w.user_id === user && w.week_start_date === week && w.closed_at);
  }

  private checkWrite(table: string, row: Row): DbError | null {
    if ((table === 'daily_logs' || table === 'workouts') && this.weekClosed(row.user_id, row.week_start_date)) {
      return { code: 'P0001', message: `week ${String(row.week_start_date)} is closed`, hint: 'closed_week' };
    }
    return null;
  }

  private unique(table: string, row: Row, selfIdx: number): DbError | null {
    const dup = (pred: (o: Row) => boolean) => this.rows(table).some((o, i) => i !== selfIdx && pred(o));
    const err = { code: '23505', message: 'duplicate key' };
    if (table === 'daily_logs' && dup((o) => o.user_id === row.user_id && o.log_date === row.log_date)) return err;
    if (table === 'sync_credentials' && dup((o) => o.secret_hash === row.secret_hash)) return err;
    if (table === 'workouts') {
      if (row.started_at != null && dup((o) => o.user_id === row.user_id && o.log_date === row.log_date && o.type_label === row.type_label && o.started_at != null && same(o.started_at, row.started_at))) return err;
      if (row.started_at == null && row.source === 'apple_health' && dup((o) => o.user_id === row.user_id && o.log_date === row.log_date && o.type_label === row.type_label && o.started_at == null && o.source === 'apple_health' && o.active_kcal === row.active_kcal)) return err;
    }
    return null;
  }

  private fill(table: string, row: Row): Row {
    const out: Row = { ...row };
    if (table === 'daily_logs') {
      out.day_type ??= 'ACTIVE';
      out.edited_fields ??= [];
    }
    if (table === 'daily_logs' || table === 'workouts' || table === 'weekly_checkins') out.id ??= randomUUID();
    for (const c of NULL_COLS[table] ?? []) out[c] ??= null;
    out.created_at ??= new Date().toISOString();
    return out;
  }

  insertRow(table: string, row: Row): Result {
    if (table === 'workouts' && this.raceOnNextWorkoutInsert) {
      const racer = this.raceOnNextWorkoutInsert;
      this.raceOnNextWorkoutInsert = null;
      this.rows(table).push(this.fill(table, racer));
      return { data: null, error: { code: '23505', message: 'duplicate key' } };
    }
    const full = this.fill(table, row);
    const e = this.checkWrite(table, full) ?? this.unique(table, full, -1);
    if (e) return { data: null, error: e };
    this.rows(table).push(full);
    this.writes++;
    return { data: [full], error: null };
  }

  from(table: string): Builder {
    return new Builder(this, table);
  }

  storage = {
    from: (bucket: string) => ({
      createSignedUploadUrl: async (path: string) => {
        this.storageCalls.push({ op: `uploadUrl:${bucket}`, path });
        return { data: { signedUrl: `https://fake.supabase.co/upload/${path}?token=tok`, token: 'tok', path }, error: null };
      },
      createSignedUrl: async (path: string, ttl: number) => {
        this.storageCalls.push({ op: `signed:${bucket}:${ttl}`, path });
        return { data: { signedUrl: `https://fake.supabase.co/object/${path}?exp=${ttl}` }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) this.storageCalls.push({ op: `remove:${bucket}`, path: p });
        return { data: [], error: null };
      },
    }),
  };

  client(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

type Filter = (r: Row) => boolean;

class Builder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private filters: Filter[] = [];
  private payload: Row | Row[] = {};
  private upsertKey: string[] = [];
  private cols: string | null = null;
  private returning = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(private db: FakeDb, private table: string) {}

  select(cols = '*'): this {
    if (this.op === 'select') this.cols = cols;
    this.returning = true;
    return this;
  }
  insert(p: Row | Row[]): this { this.op = 'insert'; this.payload = p; return this; }
  update(p: Row): this { this.op = 'update'; this.payload = p; return this; }
  upsert(p: Row | Row[], o?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = p;
    this.upsertKey = (o?.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this;
  }
  delete(): this { this.op = 'delete'; return this; }
  eq(c: string, v: unknown): this { this.filters.push((r) => same(r[c], v)); return this; }
  is(c: string, v: unknown): this { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, _op: string, v: unknown): this { this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return this; }
  lt(c: string, v: unknown): this { this.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return this; }
  gte(c: string, v: unknown): this { this.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return this; }
  lte(c: string, v: unknown): this { this.filters.push((r) => r[c] != null && String(r[c]) <= String(v)); return this; }
  in(c: string, vs: unknown[]): this { this.filters.push((r) => vs.includes(r[c])); return this; }
  order(col: string, o?: { ascending?: boolean }): this { this.orderBy = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number): this { this.lim = n; return this; }
  range(a: number, b: number): this { this.rng = [a, b]; return this; }
  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybe'; return this; }

  private pick(r: Row): Row {
    if (!this.cols || this.cols === '*') return { ...r };
    const out: Row = {};
    for (const c of this.cols.split(',').map((s) => s.trim())) out[c] = r[c];
    return out;
  }

  private finish(rows: Row[], error: DbError | null): Result {
    if (error) return { data: null, error };
    if (this.mode === 'many') return { data: rows, error: null };
    if (rows.length === 0) return this.mode === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    return { data: rows[0], error: null };
  }

  private run(): Result {
    const t = this.db.rows(this.table);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === 'select') {
      let rows = t.filter(match);
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim !== null) rows = rows.slice(0, this.lim);
      return this.finish(rows.map((r) => this.pick(r)), null);
    }
    if (this.op === 'insert') {
      const out: Row[] = [];
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const res = this.db.insertRow(this.table, p);
        if (res.error) return this.finish([], res.error);
        out.push(...(res.data as Row[]));
      }
      return this.finish(this.returning ? out : [], null);
    }
    if (this.op === 'upsert') {
      const p = this.payload as Row;
      const idx = t.findIndex((r) => this.upsertKey.every((k) => same(r[k], p[k])));
      if (idx >= 0) {
        const merged = { ...t[idx]!, ...p };
        const e = this.db['checkWrite' as never] ? null : null;
        void e;
        t[idx] = merged;
        this.db.writes++;
        return this.finish(this.returning ? [merged] : [], null);
      }
      const res = this.db.insertRow(this.table, p);
      return this.finish(this.returning ? ((res.data as Row[] | null) ?? []) : [], res.error);
    }
    if (this.op === 'update') {
      const hit = t.filter(match);
      for (const r of hit) {
        const next = { ...r, ...(this.payload as Row) };
        const e = (this.db as unknown as { checkWrite(t: string, r: Row): DbError | null }).checkWrite(this.table, next);
        if (e) return this.finish([], e);
      }
      for (const r of hit) Object.assign(r, this.payload);
      this.db.writes += hit.length;
      return this.finish(this.returning ? hit.map((r) => this.pick(r)) : [], null);
    }
    const keep = t.filter((r) => !match(r));
    const removed = t.length - keep.length;
    this.db.tables[this.table] = keep;
    this.db.writes += removed;
    return this.finish([], null);
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
}
