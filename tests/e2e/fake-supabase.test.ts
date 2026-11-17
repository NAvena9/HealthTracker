import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startFakeSupabase, USER_1, USER_2, type FakeSupabase } from './fake-supabase.mjs';

let fake: FakeSupabase;
const mk = (key: string) => createClient(fake.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(u: { email: string; password: string }): Promise<SupabaseClient> {
  const c = mk(fake.anonKey);
  const { error } = await c.auth.signInWithPassword(u);
  expect(error).toBeNull();
  return c;
}
let c1: SupabaseClient, c2: SupabaseClient, admin: SupabaseClient;

const day = (date: string, extra: Record<string, unknown> = {}) => {
  const d = new Date(date + 'T00:00:00Z');
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const mon = new Date(d.getTime() - (iso - 1) * 86400000).toISOString().slice(0, 10);
  return { user_id: USER_1.id, log_date: date, week_start_date: mon, ...extra };
};

beforeAll(async () => {
  fake = await startFakeSupabase({ port: 0 });
  c1 = await login(USER_1);
  c2 = await login(USER_2);
  admin = mk(fake.serviceRoleKey);
});
afterAll(async () => { await fake.close(); });
beforeEach(async () => { await fetch(`${fake.url}/__test/reset`, { method: 'POST' }); });

describe('auth', () => {
  it('signs in, getUser, refresh, bad password, signup disabled', async () => {
    const c = mk(fake.anonKey);
    const { data, error } = await c.auth.signInWithPassword(USER_1);
    expect(error).toBeNull();
    expect(data.session?.access_token).toBeTruthy();
    expect(data.user?.id).toBe(USER_1.id);
    const u = await c.auth.getUser();
    expect(u.data.user?.email).toBe(USER_1.email);
    const r = await c.auth.refreshSession();
    expect(r.error).toBeNull();
    expect(r.data.session?.user.id).toBe(USER_1.id);
    const bad = await mk(fake.anonKey).auth.signInWithPassword({ email: USER_1.email, password: 'nope' });
    expect(bad.error?.message).toMatch(/Invalid login credentials/);
    const su = await mk(fake.anonKey).auth.signUp({ email: 'x@y.com', password: 'abcdef12' });
    expect(su.error?.status).toBe(422);
    const bt = await mk(fake.anonKey).auth.getUser('garbage');
    expect(bt.error?.status).toBe(401);
  });
});

describe('postgrest', () => {
  it('daily_logs CRUD, filters, ordering', async () => {
    const ins = await c1.from('daily_logs').insert([
      day('2026-11-16', { day_type: 'ACTIVE', weight_kg: 80.5, steps: 9000, protein_g: 150.5, edited_fields: ['weight_kg'] }),
      day('2026-11-17', { day_type: 'REST', weight_kg: null, steps: 12000, protein_g: null, edited_fields: [] }),
      day('2026-11-18', { day_type: 'ACTIVE', weight_kg: null, steps: null, protein_g: null, edited_fields: [] }),
    ]).select();
    expect(ins.error).toBeNull();
    expect(ins.data).toHaveLength(3);
    expect(ins.data![0].weight_kg).toBe(80.5);
    expect(ins.data![0].edited_fields).toEqual(['weight_kg']);
    expect(ins.data![0].log_date).toBe('2026-11-16');
    expect(typeof ins.data![0].created_at).toBe('string');

    const list = await c1.from('daily_logs').select('log_date,steps', { count: 'exact' }).order('log_date', { ascending: false }).limit(2);
    expect(list.count).toBe(3);
    expect(list.data).toEqual([{ log_date: '2026-11-18', steps: null }, { log_date: '2026-11-17', steps: 12000 }]);

    expect((await c1.from('daily_logs').select('log_date').is('steps', null)).data).toEqual([{ log_date: '2026-11-18' }]);
    expect((await c1.from('daily_logs').select('log_date').in('log_date', ['2026-11-16', '2026-11-18']).order('log_date')).data)
      .toEqual([{ log_date: '2026-11-16' }, { log_date: '2026-11-18' }]);
    const orR = await c1.from('daily_logs').select('log_date').or('steps.gte.10000,steps.is.null').order('log_date');
    expect(orR.data).toEqual([{ log_date: '2026-11-17' }, { log_date: '2026-11-18' }]);
    expect((await c1.from('daily_logs').select('log_date').gte('log_date', '2026-11-17').lt('log_date', '2026-11-18')).data).toHaveLength(1);
    expect((await c1.from('daily_logs').select('log_date').not('steps', 'is', null)).data).toHaveLength(2);

    const one = await c1.from('daily_logs').select('*').eq('log_date', '2026-11-16').single();
    expect(one.data?.steps).toBe(9000);
    const none = await c1.from('daily_logs').select('*').eq('log_date', '2030-01-01').maybeSingle();
    expect(none.error).toBeNull();
    expect(none.data).toBeNull();
    const many = await c1.from('daily_logs').select('*').single();
    expect(many.error?.code).toBe('PGRST116');
    expect(many.error?.details).toBe('The result contains 3 rows');
    const zero = await c1.from('daily_logs').select('*').eq('log_date', '2030-01-01').single();
    expect(zero.error?.code).toBe('PGRST116');

    const upd = await c1.from('daily_logs').update({ steps: 1234 }).eq('log_date', '2026-11-18').select().single();
    expect(upd.data?.steps).toBe(1234);
    const ups = await c1.from('daily_logs').upsert(day('2026-11-18', { steps: 5555 }), { onConflict: 'user_id,log_date' }).select().single();
    expect(ups.error).toBeNull();
    expect(ups.data?.steps).toBe(5555);
    const del = await c1.from('daily_logs').delete().eq('log_date', '2026-11-18').select();
    expect(del.data).toHaveLength(1);
    expect((await c1.from('daily_logs').select('*', { count: 'exact', head: true })).count).toBe(2);
  });

  it('check constraint -> 400/23514, bad table -> 404 PGRST205', async () => {
    const r = await c1.from('daily_logs').insert(day('2026-11-16', { weight_kg: 500 }));
    expect(r.error?.code).toBe('23514');
    expect(r.status).toBe(400);
    const t = await c1.from('nope').select('*');
    expect(t.error?.code).toBe('PGRST205');
    expect(t.status).toBe(404);
  });

  it('phases, weekly_checkins (jsonb), workouts, user_settings', async () => {
    const ph = await c1.from('phases').insert({ user_id: USER_1.id, name: 'Cut', start_date: '2026-11-16', target_weight_kg: 75 }).select().single();
    expect(ph.error).toBeNull();
    expect(ph.data?.active_protein_g).toBe(190);
    expect(ph.data?.target_weight_kg).toBe(75);
    const dup = await c1.from('phases').insert({ user_id: USER_1.id, name: 'Cut2', start_date: '2026-12-01' });
    expect(dup.error?.code).toBe('23505'); // one open phase

    const snap = { target_weight_kg: 75, active: { protein_g: 190 }, tags: ['a', 'b'] };
    const wc = await c1.from('weekly_checkins').insert({ user_id: USER_1.id, week_start_date: '2026-11-16', phase_id: ph.data!.id, goals_snapshot: snap, waist_cm: 82.5 }).select().single();
    expect(wc.error).toBeNull();
    expect(wc.data?.goals_snapshot).toEqual(snap);
    expect(wc.data?.closed_at).toBeNull();
    const fk = await c1.from('weekly_checkins').insert({ user_id: USER_1.id, week_start_date: '2026-11-23', phase_id: '99999999-9999-9999-9999-999999999999', goals_snapshot: {} });
    expect(fk.error?.code).toBe('23503');
    expect(fk.status).toBe(409);

    const w = { user_id: USER_1.id, log_date: '2026-11-17', week_start_date: '2026-11-16', category: 'STRENGTH', type_label: 'Push', source: 'strong', strong_parsed: { exercises: [{ name: 'Bench', sets: 3 }] }, volume_kg: 4200.5 };
    const wi = await c1.from('workouts').insert(w).select().single();
    expect(wi.error).toBeNull();
    expect(wi.data?.strong_parsed).toEqual(w.strong_parsed);
    expect(wi.data?.volume_kg).toBe(4200.5);

    const us = await c1.from('user_settings').upsert({ user_id: USER_1.id, program_start_date: '2026-11-16', appearance: 'dark' }, { onConflict: 'user_id' }).select().single();
    expect(us.data?.appearance).toBe('dark');
    const us2 = await c1.from('user_settings').upsert({ user_id: USER_1.id, strong_default_unit: 'kg' }, { onConflict: 'user_id', ignoreDuplicates: true }).select();
    expect(us2.error).toBeNull();
    const bad = await c1.from('user_settings').update({ program_start_date: '2026-11-17' }).eq('user_id', USER_1.id);
    expect(bad.error?.code).toBe('23514');
  });

  it('duplicate workout (partial unique index) -> 23505', async () => {
    const w = { user_id: USER_1.id, log_date: '2026-11-17', week_start_date: '2026-11-16', category: 'CARDIO', type_label: 'Run', source: 'apple_health', started_at: '2026-11-17T10:00:00Z', active_kcal: 300 };
    expect((await c1.from('workouts').insert(w)).error).toBeNull();
    const d = await c1.from('workouts').insert(w);
    expect(d.error?.code).toBe('23505');
    expect(d.status).toBe(409);
    const n1 = { ...w, started_at: null };
    expect((await c1.from('workouts').insert(n1)).error).toBeNull();
    expect((await c1.from('workouts').insert(n1)).error?.code).toBe('23505');
  });

  it('closed-week trigger surfaces P0001 + hint closed_week', async () => {
    await c1.from('daily_logs').insert(day('2026-11-16', { steps: 1 }));
    const closed = await c1.from('weekly_checkins').insert({ user_id: USER_1.id, week_start_date: '2026-11-16', goals_snapshot: {}, closed_at: new Date().toISOString() });
    expect(closed.error).toBeNull();
    const r = await c1.from('daily_logs').update({ steps: 2 }).eq('log_date', '2026-11-16');
    expect(r.error?.code).toBe('P0001');
    expect(r.error?.hint).toBe('closed_week');
    expect(r.status).toBe(400);
    const r2 = await c1.from('daily_logs').insert(day('2026-11-17'));
    expect(r2.error?.hint).toBe('closed_week');
    // service role is locked too, reopen works
    expect((await admin.from('daily_logs').delete().eq('log_date', '2026-11-16')).error?.hint).toBe('closed_week');
    expect((await c1.from('weekly_checkins').update({ closed_at: null }).eq('week_start_date', '2026-11-16')).error).toBeNull();
    expect((await c1.from('daily_logs').update({ steps: 2 }).eq('log_date', '2026-11-16')).error).toBeNull();
  });

  it('RLS isolation and sync_credentials', async () => {
    await c1.from('daily_logs').insert(day('2026-11-16', { steps: 10 }));
    expect((await c2.from('daily_logs').select('*')).data).toEqual([]);
    expect((await c2.from('daily_logs').update({ steps: 99 }).eq('log_date', '2026-11-16').select()).data).toEqual([]);
    expect((await c2.from('daily_logs').delete().eq('log_date', '2026-11-16').select()).data).toEqual([]);
    const spoof = await c2.from('daily_logs').insert(day('2026-11-17'));
    expect(spoof.error?.code).toBe('42501');
    expect(spoof.status).toBe(403);
    expect((await mk(fake.anonKey).from('daily_logs').select('*')).data).toEqual([]);
    expect((await admin.from('daily_logs').select('*')).data).toHaveLength(1);

    const sc = await admin.from('sync_credentials').insert({ user_id: USER_1.id, secret_hash: 'abc', secret_last4: 'abcd' }).select().single();
    expect(sc.error).toBeNull();
    const r1 = await c1.from('sync_credentials').select('*');
    expect(r1.error?.code).toBe('42501');
    expect(r1.status).toBe(403);
    const ra = await mk(fake.anonKey).from('sync_credentials').select('*');
    expect(ra.error?.code).toBe('42501');
    expect(ra.status).toBe(401);
    expect((await admin.from('sync_credentials').select('*')).data).toHaveLength(1);
  });

  it('rpc on SQL function and __test/sql helper', async () => {
    const r = await admin.rpc('week_is_closed', { p_user: USER_1.id, p_week: '2026-11-16' });
    expect(r.error).toBeNull();
    expect(r.data).toBe(false);
    const s = await fetch(`${fake.url}/__test/sql`, { method: 'POST', body: JSON.stringify({ sql: 'select count(*)::int as n from auth.users' }) }).then((x) => x.json());
    expect(s.rows[0].n).toBe(2);
  });
});

describe('storage', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const p1 = `${USER_1.id}/2026-11-16/front.jpg`;

  it('signed upload -> signed url -> fetch bytes; isolation; remove', async () => {
    const st = c1.storage.from('progress-photos');
    const su = await st.createSignedUploadUrl(p1);
    expect(su.error).toBeNull();
    const up = await st.uploadToSignedUrl(p1, su.data!.token, new Blob([bytes], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();
    expect(up.data?.path).toBe(p1);

    const sg = await st.createSignedUrl(p1, 60);
    expect(sg.error).toBeNull();
    const got = await fetch(sg.data!.signedUrl);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    const tampered = await fetch(sg.data!.signedUrl.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a')));
    expect(tampered.status).toBe(400);

    const dl = await st.download(p1);
    expect(dl.error).toBeNull();
    expect(new Uint8Array(await dl.data!.arrayBuffer())).toEqual(bytes);

    // user 2: cannot sign, download, or create signed upload into user 1 folder
    const s2 = c2.storage.from('progress-photos');
    expect((await s2.createSignedUrl(p1, 60)).error).toBeTruthy();
    expect((await s2.download(p1)).error).toBeTruthy();
    expect((await s2.createSignedUploadUrl(`${USER_1.id}/2026-11-16/side.jpg`)).error).toBeTruthy();
    expect((await s2.remove([p1])).data).toEqual([]);
    expect((await mk(fake.anonKey).storage.from('progress-photos').download(p1)).error).toBeTruthy();

    const ls = await st.list(`${USER_1.id}/2026-11-16`);
    expect(ls.data?.map((o) => o.name)).toEqual(['front.jpg']);

    const rm = await st.remove([p1]);
    expect(rm.error).toBeNull();
    expect(rm.data).toHaveLength(1);
    expect((await st.download(p1)).error).toBeTruthy();
    expect((await st.createSignedUrl(p1, 60)).error).toBeTruthy();
  });

  it('direct upload, mime/size rules, duplicate/upsert', async () => {
    const st = c1.storage.from('progress-photos');
    const p = `${USER_1.id}/2026-11-16/back.png`;
    const a = await st.upload(p, new Blob([bytes], { type: 'image/png' }), { contentType: 'image/png' });
    expect(a.error).toBeNull();
    expect((await st.upload(p, bytes, { contentType: 'image/png' })).error).toBeTruthy();
    const b = await st.upload(p, bytes, { contentType: 'image/png', upsert: true });
    expect(b.error).toBeNull();
    expect((await st.upload(`${USER_1.id}/x/evil.txt`, bytes, { contentType: 'text/plain' })).error).toBeTruthy();
    expect((await st.upload(`${USER_2.id}/x/a.png`, bytes, { contentType: 'image/png' })).error).toBeTruthy();
    expect((await admin.storage.from('progress-photos').download(p)).error).toBeNull();
  });
});
