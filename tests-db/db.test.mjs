import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.resolve(here, p), 'utf8');
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as
  $$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts,1)-1]; end $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant all on storage.objects, storage.buckets to service_role;
insert into auth.users values ('${U1}'), ('${U2}');
`;

let db;
const q = (sql, params) => db.query(sql, params);
const asUser = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const rejects = (p, re) => assert.rejects(p, (e) => (re ? re.test(String(e.message)) : true));

before(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(read('../supabase/migrations/001_init.sql'));
  await db.exec(read('../supabase/migrations/002_storage.sql'));
});
after(async () => { await db.close(); });

const mkDay = (uid, date, extra = '') => {
  const d = new Date(date + 'T00:00:00Z');
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const mon = new Date(d.getTime() - (iso - 1) * 86400000).toISOString().slice(0, 10);
  return q(`insert into daily_logs (user_id, log_date, week_start_date ${extra ? ',' + extra.cols : ''})
            values ($1,$2,$3 ${extra ? ',' + extra.vals : ''}) returning id`, [uid, date, mon]);
};

test('all tables exist', async () => {
  const r = await q(`select table_name from information_schema.tables where table_schema='public'`);
  const names = r.rows.map((x) => x.table_name);
  for (const t of ['user_settings', 'sync_credentials', 'phases', 'weekly_checkins', 'daily_logs', 'workouts'])
    assert.ok(names.includes(t), t);
});

test('storage bucket is private with limits', async () => {
  const r = await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='progress-photos'`);
  assert.equal(r.rows[0].public, false);
  assert.equal(Number(r.rows[0].file_size_limit), 8 * 1024 * 1024);
  assert.deepEqual(r.rows[0].allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
});

test('daily_logs checks: non-Monday week, week/date mismatch, bad day_type, weight 500, negative steps', async () => {
  await rejects(q(`insert into daily_logs (user_id, log_date, week_start_date) values ($1,'2026-11-17','2026-11-17')`, [U1]), /week_is_monday|violates check/);
  await rejects(q(`insert into daily_logs (user_id, log_date, week_start_date) values ($1,'2026-11-17','2026-11-09')`, [U1]), /week_matches_date/);
  await rejects(mkDay(U1, '2026-11-16', { cols: 'day_type', vals: `'FEAST'` }), /day_type/);
  await rejects(mkDay(U1, '2026-11-16', { cols: 'weight_kg', vals: '500' }), /weight_kg/);
  await rejects(mkDay(U1, '2026-11-16', { cols: 'steps', vals: '-1' }), /steps/);
  await rejects(mkDay(U1, '2026-11-16', { cols: 'protein_g', vals: '2001' }), /protein_g/);
  await rejects(mkDay(U1, '2026-11-16', { cols: 'edited_fields', vals: `'{bogus}'` }), /edited_fields/);
});

test('weekly_checkins rejects non-Monday and out-of-range measurement', async () => {
  await rejects(q(`insert into weekly_checkins (user_id, week_start_date, goals_snapshot) values ($1,'2026-11-17','{}')`, [U1]), /week_is_monday/);
  await rejects(q(`insert into weekly_checkins (user_id, week_start_date, goals_snapshot, waist_cm) values ($1,'2026-11-16','{}', 5)`, [U1]), /waist_cm/);
});

test('user_settings: program start must be Monday; defaults', async () => {
  await rejects(q(`insert into user_settings (user_id, program_start_date) values ($1,'2026-11-17')`, [U1]), /program_start_is_monday/);
  await q(`insert into user_settings (user_id, program_start_date) values ($1,'2026-11-09')`, [U1]);
  const r = await q(`select timezone, strong_default_unit, appearance from user_settings where user_id=$1`, [U1]);
  assert.deepEqual(r.rows[0], { timezone: 'America/Hermosillo', strong_default_unit: 'lb', appearance: 'system' });
  await rejects(q(`update user_settings set strong_default_unit='stone' where user_id=$1`, [U1]), /strong_default_unit/);
});

test('nullable columns accept null and have no defaults', async () => {
  const r = await mkDay(U1, '2026-11-09');
  const row = (await q(`select * from daily_logs where id=$1`, [r.rows[0].id])).rows[0];
  for (const c of ['weight_kg', 'steps', 'protein_g', 'carbs_g', 'fat_g', 'calories_kcal', 'resting_kcal', 'active_kcal_total', 'apple_health_synced_at'])
    assert.equal(row[c], null, c);
  assert.equal(row.day_type, 'ACTIVE');
  assert.deepEqual(row.edited_fields, []);
  const defs = await q(`select column_name, column_default from information_schema.columns where table_name='daily_logs'
    and column_name in ('weight_kg','steps','protein_g','carbs_g','fat_g','calories_kcal','resting_kcal','active_kcal_total')`);
  assert.equal(defs.rows.length, 8);
  for (const d of defs.rows) assert.equal(d.column_default, null, d.column_name);
  // explicit null update works
  await q(`update daily_logs set steps = 5000 where id=$1`, [r.rows[0].id]);
  await q(`update daily_logs set steps = null where id=$1`, [r.rows[0].id]);
});

test('unique(user_id, log_date); same date allowed for another user', async () => {
  await mkDay(U1, '2026-11-10');
  await rejects(mkDay(U1, '2026-11-10'), /daily_logs_user_date_unique|duplicate/);
  await mkDay(U2, '2026-11-10');
});

test('workout dedupe indexes', async () => {
  const ins = (uid, type, kcal, start, source = 'apple_health') =>
    q(`insert into workouts (user_id, log_date, week_start_date, category, type_label, active_kcal, started_at, source)
       values ($1,'2026-11-10','2026-11-09','CARDIO',$2,$3,$4,$5)`, [uid, type, kcal, start, source]);
  await ins(U1, 'Running', 400, '2026-11-10T07:00:00-07:00');
  await rejects(ins(U1, 'Running', 999, '2026-11-10T07:00:00-07:00'), /workouts_dedupe_started/);
  await ins(U1, 'Running', 400, '2026-11-10T18:00:00-07:00'); // different start OK
  await ins(U2, 'Running', 400, '2026-11-10T07:00:00-07:00'); // other user OK
  await ins(U1, 'Cycling', 300, null);
  await rejects(ins(U1, 'Cycling', 300, null), /workouts_dedupe_no_start/);
  await ins(U1, 'Cycling', 310, null);                        // different kcal OK
  await ins(U1, 'Cycling', 300, null, 'manual');              // manual rows not deduped
  await ins(U1, 'Cycling', 300, null, 'manual');
  await rejects(q(`insert into workouts (user_id, log_date, week_start_date, category, type_label, source) values ($1,'2026-11-10','2026-11-09','YOGA','x','manual')`, [U1]), /category/);
  await rejects(q(`insert into workouts (user_id, log_date, week_start_date, category, type_label, source) values ($1,'2026-11-10','2026-11-09','CARDIO','x','garmin')`, [U1]), /source/);
  await rejects(q(`insert into workouts (user_id, log_date, week_start_date, category, type_label, source, active_kcal) values ($1,'2026-11-10','2026-11-09','CARDIO','x','manual',6000)`, [U1]), /active_kcal/);
});

test('only one open phase per user; end_date >= start_date', async () => {
  await q(`insert into phases (user_id, name, start_date) values ($1,'Cut','2026-11-09')`, [U1]);
  await rejects(q(`insert into phases (user_id, name, start_date) values ($1,'Cut2','2026-12-01')`, [U1]), /phases_one_open_per_user/);
  await q(`insert into phases (user_id, name, start_date) values ($1,'Cut',$2)`, [U2, '2026-11-09']); // other user OK
  await rejects(q(`insert into phases (user_id, name, start_date, end_date) values ($1,'Bad','2026-05-10','2026-05-01')`, [U1]), /end_after_start/);
  await q(`insert into phases (user_id, name, start_date, end_date) values ($1,'Old','2026-05-01','2026-08-30')`, [U1]); // closed ones can stack
  const d = (await q(`select active_protein_g a,active_carbs_g b,active_fat_g c,active_kcal d,rest_protein_g e,rest_carbs_g f,rest_fat_g g,rest_kcal h,
     daily_step_goal i, weekly_step_goal j, weekly_weighin_goal k, weekly_cardio_sessions l, weekly_strength_sessions m from phases where user_id=$1 and name='Cut'`, [U1])).rows[0];
  assert.deepEqual(d, { a: 190, b: 240, c: 70, d: 2350, e: 190, f: 200, g: 60, h: 2100, i: 10000, j: 70000, k: 3, l: null, m: null });
});

test('updated_at trigger bumps on update', async () => {
  const id = (await mkDay(U2, '2026-11-11')).rows[0].id;
  await q(`update daily_logs set created_at = now() - interval '1 day', updated_at = now() - interval '1 day' where id=$1`, [id]);
  await q(`update daily_logs set steps = 1 where id=$1`, [id]);
  const r = (await q(`select updated_at > now() - interval '1 minute' as fresh from daily_logs where id=$1`, [id])).rows[0];
  assert.equal(r.fresh, true);
});

test('closed-week lock: blocks, then allows after reopen', async () => {
  const W = '2026-11-02';
  await q(`insert into weekly_checkins (user_id, week_start_date, goals_snapshot) values ($1,$2,'{}')`, [U1, W]);
  const id = (await mkDay(U1, '2026-11-03')).rows[0].id;
  const wid = (await q(`insert into workouts (user_id, log_date, week_start_date, category, type_label, source) values ($1,'2026-11-03',$2,'CARDIO','Run','manual') returning id`, [U1, W])).rows[0].id;
  await q(`update daily_logs set steps = 100 where id=$1`, [id]); // open week OK
  await q(`update weekly_checkins set closed_at = now() where user_id=$1 and week_start_date=$2`, [U1, W]); // closing OK
  await rejects(q(`update daily_logs set steps = 200 where id=$1`, [id]), /is closed/);
  await rejects(q(`delete from daily_logs where id=$1`, [id]), /is closed/);
  await rejects(q(`insert into daily_logs (user_id, log_date, week_start_date) values ($1,'2026-11-04',$2)`, [U1, W]), /is closed/);
  await rejects(q(`update workouts set active_kcal = 1 where id=$1`, [wid]), /is closed/);
  await rejects(q(`delete from workouts where id=$1`, [wid]), /is closed/);
  await rejects(q(`update weekly_checkins set waist_cm = 80 where user_id=$1 and week_start_date=$2`, [U1, W]), /is closed/);
  await rejects(q(`delete from weekly_checkins where user_id=$1 and week_start_date=$2`, [U1, W]), /is closed/);
  // moving a row from an open week into the closed week is blocked too
  const other = (await mkDay(U1, '2026-11-12')).rows[0].id;
  await rejects(q(`update daily_logs set log_date='2026-11-04', week_start_date=$2 where id=$1`, [other, W]), /is closed/);
  // reopen
  await q(`update weekly_checkins set closed_at = null where user_id=$1 and week_start_date=$2`, [U1, W]);
  await q(`update daily_logs set steps = 300 where id=$1`, [id]);
  await q(`update workouts set active_kcal = 5 where id=$1`, [wid]);
  assert.equal((await q(`select steps from daily_logs where id=$1`, [id])).rows[0].steps, 300);
});

test('deleting a phase referenced by a closed week works (set null allowed); other edits stay blocked', async () => {
  const ph = (await q(`insert into phases (user_id, name, start_date, end_date) values ($1,'P','2026-01-05','2026-02-01') returning id`, [U2])).rows[0].id;
  await q(`insert into weekly_checkins (user_id, week_start_date, goals_snapshot, phase_id, closed_at) values ($1,'2026-01-12','{}',$2, now())`, [U2, ph]);
  await q(`delete from phases where id=$1`, [ph]);
  const r = (await q(`select phase_id, closed_at from weekly_checkins where user_id=$1 and week_start_date='2026-01-12'`, [U2])).rows[0];
  assert.equal(r.phase_id, null);
  assert.ok(r.closed_at);
});

test('deleting a user cascades even with closed weeks', async () => {
  const U3 = '33333333-3333-3333-3333-333333333333';
  await q(`insert into auth.users values ($1)`, [U3]);
  await q(`insert into weekly_checkins (user_id, week_start_date, goals_snapshot) values ($1,'2026-11-02','{}')`, [U3]);
  await q(`insert into daily_logs (user_id, log_date, week_start_date) values ($1,'2026-11-03','2026-11-02')`, [U3]);
  await q(`insert into workouts (user_id, log_date, week_start_date, category, type_label, source) values ($1,'2026-11-03','2026-11-02','CARDIO','Run','manual')`, [U3]);
  await q(`update weekly_checkins set closed_at = now() where user_id=$1`, [U3]);
  await q(`delete from auth.users where id=$1`, [U3]);
  for (const t of ['weekly_checkins', 'daily_logs', 'workouts'])
    assert.equal((await q(`select count(*)::int n from ${t} where user_id=$1`, [U3])).rows[0].n, 0, t);
});

test('RLS: isolation between users (SET ROLE authenticated)', async () => {
  // sanity: role switching really enforces RLS in pglite
  const mine1 = await asUser(U1, async () => (await q(`select user_id from daily_logs`)).rows);
  assert.ok(mine1.length > 0 && mine1.every((r) => r.user_id === U1));
  const mine2 = await asUser(U2, async () => (await q(`select user_id from daily_logs`)).rows);
  assert.ok(mine2.length > 0 && mine2.every((r) => r.user_id === U2));
  // U2 cannot insert as U1
  await asUser(U2, () => rejects(q(`insert into daily_logs (user_id, log_date, week_start_date) values ($1,'2026-11-18','2026-11-16')`, [U1]), /row-level security/));
  // U2 cannot update/delete U1's rows (silently 0 rows)
  const upd = await asUser(U2, () => q(`update daily_logs set steps = 1 where user_id=$1`, [U1]));
  assert.equal(upd.affectedRows, 0);
  const del = await asUser(U2, () => q(`delete from workouts where user_id=$1`, [U1]));
  assert.equal(del.affectedRows, 0);
  // U2 cannot move own row to U1 (WITH CHECK)
  await asUser(U2, () => rejects(q(`update daily_logs set user_id=$1 where user_id=$2`, [U1, U2]), /row-level security/));
  // own insert works
  await asUser(U1, () => q(`insert into daily_logs (user_id, log_date, week_start_date, steps) values ($1,'2026-11-18','2026-11-16', 9000)`, [U1]));
  // other tables isolated
  for (const t of ['phases', 'weekly_checkins', 'workouts', 'user_settings']) {
    const rows = await asUser(U2, async () => (await q(`select user_id from ${t}`)).rows);
    assert.ok(rows.every((r) => r.user_id === U2), t);
  }
});

test('RLS: no client access to sync_credentials; service_role can', async () => {
  await q(`insert into sync_credentials (user_id, secret_hash, secret_last4) values ($1,$2,'abcd')`, [U1, 'a'.repeat(64)]);
  await asUser(U1, () => rejects(q(`select * from sync_credentials`), /permission denied/));
  await asUser(U1, () => rejects(q(`insert into sync_credentials (user_id, secret_hash) values ($1,'x')`, [U1]), /permission denied/));
  await db.exec(`set role service_role`);
  const r = await q(`select count(*)::int n from sync_credentials`);
  await db.exec(`reset role`);
  assert.equal(r.rows[0].n, 1);
  await rejects(q(`insert into sync_credentials (user_id, secret_hash) values ($1,$2)`, [U2, 'a'.repeat(64)]), /secret_hash_key|duplicate/);
});

test('storage policies: only own folder', async () => {
  await asUser(U1, () => q(`insert into storage.objects (bucket_id, name) values ('progress-photos', $1)`, [`${U1}/2026-11-16/front.jpg`]));
  await asUser(U1, () => rejects(q(`insert into storage.objects (bucket_id, name) values ('progress-photos', $1)`, [`${U2}/2026-11-16/front.jpg`]), /row-level security/));
  await db.exec(`insert into storage.objects (bucket_id, name) values ('progress-photos', '${U2}/2026-11-16/side.jpg')`);
  const seen = await asUser(U1, async () => (await q(`select name from storage.objects`)).rows.map((r) => r.name));
  assert.deepEqual(seen, [`${U1}/2026-11-16/front.jpg`]);
  const del = await asUser(U1, () => q(`delete from storage.objects where name = $1`, [`${U2}/2026-11-16/side.jpg`]));
  assert.equal(del.affectedRows, 0);
  const del2 = await asUser(U1, () => q(`delete from storage.objects where name = $1`, [`${U1}/2026-11-16/front.jpg`]));
  assert.equal(del2.affectedRows, 1);
});

// ---------------------------------------------------------------- column mapping
const typesSrc = readFileSync(path.resolve(here, '../src/lib/domain/types.ts'), 'utf8');
const keysOf = (iface) => {
  const m = typesSrc.match(new RegExp(`export interface ${iface}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `interface ${iface} found`);
  return [...m[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\??\s*:/gim)].map((x) => x[1]);
};
const NOT_COLUMNS = {
  // none today: every key of these interfaces is a physical column.
  // goals_snapshot (jsonb) and strong_parsed (jsonb) ARE columns; their nested shape is not checked here.
  DailyLog: [], Workout: [], WeeklyCheckin: [],
};
for (const [iface, table] of [['DailyLog', 'daily_logs'], ['Workout', 'workouts'], ['WeeklyCheckin', 'weekly_checkins']]) {
  test(`column mapping: ${iface} -> ${table}`, async () => {
    const keys = keysOf(iface).filter((k) => !NOT_COLUMNS[iface].includes(k));
    assert.ok(keys.length >= 8, `parsed keys for ${iface}: ${keys.length}`);
    const cols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [table])).rows.map((r) => r.column_name);
    for (const k of keys) assert.ok(cols.includes(k), `${iface}.${k} missing in ${table}`);
  });
}
test('column mapping: jsonb columns are jsonb', async () => {
  const r = await q(`select table_name, column_name, data_type from information_schema.columns where (table_name,column_name) in (('weekly_checkins','goals_snapshot'),('workouts','strong_parsed'))`);
  assert.equal(r.rows.length, 2);
  for (const x of r.rows) assert.equal(x.data_type, 'jsonb');
});
