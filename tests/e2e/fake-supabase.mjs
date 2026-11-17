// fake-supabase.mjs -- LOCAL FAKE SUPABASE for Proof of Work e2e testing.
//
// Plain Node ESM, zero extra deps (only @electric-sql/pglite, already a devDependency).
// Emulates the subset of GoTrue (/auth/v1), PostgREST (/rest/v1) and Storage (/storage/v1)
// that @supabase/supabase-js v2 and @supabase/ssr call, on top of an in-memory PGlite that has
// the REAL SQL migrations (supabase/migrations/*.sql) applied, so real RLS / triggers / checks run.
//
//   node tests/e2e/fake-supabase.mjs            (port: FAKE_SUPABASE_PORT, default 54321)
//   import { startFakeSupabase } from './fake-supabase.mjs'
//
// TEST USE ONLY. Not secure, not a faithful production emulation (see README.md "known gaps").

import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../supabase/migrations');

// ---------------------------------------------------------------------------
// Constants (deterministic so .env.local never changes between runs)
// ---------------------------------------------------------------------------
export const JWT_SECRET = 'fake-supabase-jwt-secret-for-local-e2e-only-0123456789';
export const USER_1 = { id: '11111111-1111-1111-1111-111111111111', email: 'nico@example.com', password: 'test-password-1' };
export const USER_2 = { id: '22222222-2222-2222-2222-222222222222', email: 'other@example.com', password: 'test-password-2' };
export const BUCKET = 'progress-photos';
const ACCESS_TTL = 3600;
const FAR_FUTURE = 4102444800; // 2100-01-01

const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload, secret = JWT_SECRET) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
/** Returns payload or throws Error with .reason in {'malformed','signature','expired'} */
export function verifyJwt(token, secret = JWT_SECRET) {
  const bad = (reason, msg) => Object.assign(new Error(msg), { reason });
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw bad('malformed', 'token is malformed: token contains an invalid number of segments');
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given;
  try { given = Buffer.from(parts[2], 'base64url'); } catch { throw bad('malformed', 'token is malformed'); }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw bad('signature', 'signature is invalid');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw bad('malformed', 'token is malformed'); }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) throw bad('expired', 'token is expired');
  return payload;
}
export const ANON_KEY = signJwt({ iss: 'supabase-local', ref: 'fake', role: 'anon', iat: 1700000000, exp: FAR_FUTURE });
export const SERVICE_ROLE_KEY = signJwt({ iss: 'supabase-local', ref: 'fake', role: 'service_role', iat: 1700000000, exp: FAR_FUTURE });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, body, headers = {}) { super(body?.message || body?.msg || `HTTP ${status}`); this.status = status; this.body = body; this.headers = headers; }
}
const prestErr = (status, code, message, details = null, hint = null) => new HttpError(status, { code, details, hint, message });
const gotrueErr = (status, error_code, msg) => new HttpError(status, { code: status, error_code, msg });
const storageErr = (status, statusCode, error, message) => new HttpError(status, { statusCode: String(statusCode), error, message });

function pgToPostgrest(e, role) {
  if (e instanceof HttpError) return e;
  const code = e?.code;
  if (!code || !/^[0-9A-Z]{5}$/.test(code)) {
    return new HttpError(500, { code: 'PGRST000', details: null, hint: null, message: String(e?.message || e) });
  }
  let status = 400;
  if (code === '23505' || code === '23503') status = 409;
  else if (code === '42501') status = role === 'anon' ? 401 : 403;
  else if (code === '42P01' || code === '42883') status = 404;
  else if (code === '40001' || code === '40P01') status = 500;
  else if (code.startsWith('53') || code.startsWith('58') || code.startsWith('XX')) status = 500;
  return new HttpError(status, { code, details: e.detail ?? null, hint: e.hint ?? null, message: e.message });
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(hashHex, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

// ---------------------------------------------------------------------------
// Stub schema (what Supabase provides before the app migrations run)
// ---------------------------------------------------------------------------
const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz default now(),
  raw_app_meta_data jsonb default '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_sign_in_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as
  $$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts,1)-1]; end $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
grant select on storage.buckets to anon, authenticated;
grant all on storage.objects, storage.buckets to service_role;
grant select on auth.users to service_role;
-- Like Supabase: new public tables/functions/sequences are granted to all API roles by default
-- (RLS + explicit revokes in the migrations are what restrict access).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

// ---------------------------------------------------------------------------
// Query-string filter parsing (PostgREST subset)
// ---------------------------------------------------------------------------
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const qi = (id) => {
  if (!IDENT_RE.test(id)) throw prestErr(400, 'PGRST100', `"failed to parse identifier" (invalid identifier: ${id})`);
  return `"${id}"`;
};

function splitTop(s) {
  const out = []; let depth = 0, inQ = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) cur += s[++i];
      else if (c === '"') inQ = false;
      continue;
    }
    if (c === '"') { inQ = true; cur += c; continue; }
    if (c === '(' || c === '{') depth++;
    if (c === ')' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur !== '' || out.length) out.push(cur);
  return out;
}
const unquote = (v) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(["\\])/g, '$1') : v);

const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd', 'ov', 'match', 'imatch', 'isdistinct']);

function parseOpVal(rest) {
  let neg = false;
  if (rest.startsWith('not.')) { neg = true; rest = rest.slice(4); }
  const m = rest.match(/^([a-z]+)\.([\s\S]*)$/);
  if (!m || !OPS.has(m[1])) throw prestErr(400, 'PGRST100', `"failed to parse filter (${rest})"`, `unsupported or malformed operator in "${rest}"`);
  return { kind: 'cond', neg, op: m[1], val: m[2] };
}
function parseLogicItem(s) {
  const lm = s.match(/^(not\.)?(and|or)\(([\s\S]*)\)$/);
  if (lm) return { kind: 'logic', neg: !!lm[1], op: lm[2], children: splitTop(lm[3]).map(parseLogicItem) };
  const m = s.match(/^([^.]+)\.([\s\S]*)$/);
  if (!m) throw prestErr(400, 'PGRST100', `"failed to parse logic tree (${s})"`);
  return { ...parseOpVal(m[2]), col: m[1] };
}
function parseTopLogic(op, neg, value) {
  const m = value.match(/^\(([\s\S]*)\)$/);
  if (!m) throw prestErr(400, 'PGRST100', `"failed to parse logic tree (${value})"`);
  return { kind: 'logic', neg, op, children: splitTop(m[1]).map(parseLogicItem) };
}

function compileCond(node, ctx) {
  const { cols, params } = ctx;
  if (node.kind === 'logic') {
    const parts = node.children.map((c) => compileCond(c, ctx));
    const sql = parts.length ? `(${parts.join(node.op === 'and' ? ' and ' : ' or ')})` : 'true';
    return node.neg ? `not ${sql}` : sql;
  }
  if (!cols.has(node.col)) throw new PgLike('42703', `column ${ctx.table}.${node.col} does not exist`);
  const col = `_t.${qi(node.col)}`;
  const push = (v) => { params.push(v); return `$${params.length}`; };
  let sql;
  const val = unquote(node.val);
  switch (node.op) {
    case 'eq': sql = `${col} = ${push(val)}`; break;
    case 'neq': sql = `${col} <> ${push(val)}`; break;
    case 'gt': sql = `${col} > ${push(val)}`; break;
    case 'gte': sql = `${col} >= ${push(val)}`; break;
    case 'lt': sql = `${col} < ${push(val)}`; break;
    case 'lte': sql = `${col} <= ${push(val)}`; break;
    case 'like': sql = `${col} like ${push(val.replace(/\*/g, '%'))}`; break;
    case 'ilike': sql = `${col} ilike ${push(val.replace(/\*/g, '%'))}`; break;
    case 'match': sql = `${col} ~ ${push(val)}`; break;
    case 'imatch': sql = `${col} ~* ${push(val)}`; break;
    case 'isdistinct': sql = `${col} is distinct from ${push(val)}`; break;
    case 'cs': sql = `${col} @> ${push(val)}`; break;
    case 'cd': sql = `${col} <@ ${push(val)}`; break;
    case 'ov': sql = `${col} && ${push(val)}`; break;
    case 'is': {
      const v = val.toLowerCase();
      if (!['null', 'true', 'false', 'unknown'].includes(v)) throw prestErr(400, 'PGRST100', `"failed to parse filter (is.${val})"`, 'is expects null, true, false or unknown');
      sql = `${col} is ${v === 'null' ? 'null' : v === 'unknown' ? 'unknown' : v}`;
      break;
    }
    case 'in': {
      const inner = node.val.match(/^\(([\s\S]*)\)$/);
      if (!inner) throw prestErr(400, 'PGRST100', `"failed to parse filter (in.${node.val})"`);
      const items = inner[1] === '' ? [] : splitTop(inner[1]).map(unquote);
      sql = items.length ? `${col} in (${items.map(push).join(', ')})` : 'false';
      break;
    }
    default: throw prestErr(400, 'PGRST100', `unsupported operator ${node.op}`);
  }
  return node.neg ? `not (${sql})` : `(${sql})`;
}
/** Error that mimics a Postgres error (so it maps through pgToPostgrest). */
class PgLike extends Error { constructor(code, message, detail = null, hint = null) { super(message); this.code = code; this.detail = detail; this.hint = hint; } }

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function buildWhere(searchParams, ctx) {
  const conds = [];
  for (const [key, value] of searchParams) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and') conds.push(compileCond(parseTopLogic(key, false, value), ctx));
    else if (key === 'not.or' || key === 'not.and') conds.push(compileCond(parseTopLogic(key.slice(4), true, value), ctx));
    else if (key.includes('.')) throw prestErr(400, 'PGRST100', `embedded resource filters are not supported by the fake server (${key})`);
    else conds.push(compileCond({ ...parseOpVal(value), col: key }, ctx));
  }
  return conds.length ? conds.join(' and ') : 'true';
}

function buildSelect(selectParam, cols, table) {
  if (selectParam == null || selectParam === '' || selectParam === '*') return '_t.*';
  const items = splitTop(selectParam).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const it of items) {
    if (it.includes('(') || it.includes('!')) {
      throw prestErr(400, 'PGRST200', `Embedded resources are not supported by the fake server ("${it}")`, null, 'Select plain columns only.');
    }
    if (it === '*') { out.push('_t.*'); continue; }
    let alias = null, rest = it;
    const am = it.match(/^([A-Za-z_][A-Za-z0-9_]*):(.+)$/);
    if (am) { alias = am[1]; rest = am[2]; }
    let cast = null;
    const cm = rest.match(/^(.+)::([A-Za-z_][A-Za-z0-9_ ]*)$/);
    if (cm) { rest = cm[1]; cast = cm[2]; }
    if (!cols.has(rest)) throw new PgLike('42703', `column ${table}.${rest} does not exist`);
    let expr = `_t.${qi(rest)}`;
    if (cast) { if (!/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(cast)) throw prestErr(400, 'PGRST100', 'bad cast'); expr = `${expr}::${cast}`; }
    out.push(`${expr} as ${qi(alias || rest)}`);
  }
  return out.join(', ');
}

function buildOrder(orderParam, cols, table) {
  if (!orderParam) return '';
  const parts = [];
  for (const item of splitTop(orderParam)) {
    const [col, ...mods] = item.split('.');
    if (!cols.has(col)) throw new PgLike('42703', `column ${table}.${col} does not exist`);
    let s = `_t.${qi(col)}`;
    for (const m of mods) {
      if (m === 'asc') s += ' asc'; else if (m === 'desc') s += ' desc';
      else if (m === 'nullsfirst') s += ' nulls first'; else if (m === 'nullslast') s += ' nulls last';
      else throw prestErr(400, 'PGRST100', `"failed to parse order (${item})"`);
    }
    parts.push(s);
  }
  return `order by ${parts.join(', ')}`;
}
const intParam = (v, name) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(v)) throw prestErr(400, 'PGRST100', `"failed to parse ${name} (${v})"`);
  return Number(v);
};

const parsePrefer = (h) => {
  const out = {};
  for (const part of String(h || '').split(',')) { const [k, v] = part.trim().split('='); if (k) out[k] = v ?? true; }
  return out;
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
const jsonReplacer = (_k, v) => (typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()) : v);
const toJson = (v) => JSON.stringify(v, jsonReplacer);

function send(res, status, body, headers = {}) {
  const h = { ...headers };
  let payload = null;
  if (body !== undefined && body !== null && status !== 204 && status !== 304) {
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) payload = Buffer.from(body);
    else { payload = Buffer.from(toJson(body)); if (!h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json; charset=utf-8'; }
    h['Content-Length'] = String(payload.length);
  }
  res.writeHead(status, h);
  res.end(res.req?.method === 'HEAD' ? undefined : payload ?? undefined);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const parseJsonBody = (buf) => {
  if (!buf.length) return undefined;
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw prestErr(400, 'PGRST102', 'Empty or invalid json', 'Failed to parse JSON body'); }
};

/** Minimal multipart/form-data parser -> { fields, file: {name, filename, type, data} } */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { fields: {}, file: null };
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const fields = {}; let file = null;
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    let part = buf.subarray(pos + boundary.length, next);
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, part.length - 2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const headers = part.subarray(0, sep).toString('utf8');
      const data = part.subarray(sep + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? '';
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
      if (filename !== undefined || type) { if (!file) file = { name, filename, type: type || 'application/octet-stream', data: Buffer.from(data) }; }
      else fields[name] = data.toString('utf8');
    }
    pos = next;
  }
  return { fields, file };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
export async function startFakeSupabase({ port = 0, host } = {}) {
  const db = new PGlite();
  await db.exec(STUBS);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  }
  await db.query(
    `insert into auth.users (id, email, encrypted_password) values ($1,$2,$3), ($4,$5,$6)`,
    [USER_1.id, USER_1.email, hashPassword(USER_1.password), USER_2.id, USER_2.email, hashPassword(USER_2.password)],
  );

  // ---- single-flight queue -------------------------------------------------
  let tail = Promise.resolve();
  const enqueue = (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
  /** Run fn inside one transaction under a Postgres role (set local => auto reset on commit/rollback). */
  const tx = (ctx, fn) => enqueue(async () => {
    await db.exec('begin');
    try {
      if (ctx && ctx.role !== 'superuser') {
        const claims = ctx.claims || { role: ctx.role, ...(ctx.sub ? { sub: ctx.sub } : {}) };
        await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)`,
          [ctx.sub || '', ctx.role, JSON.stringify(claims)]);
        await db.exec(`set local role ${ctx.role}`);
      }
      const q = async (sql, params = []) => (await db.query(sql, params)).rows;
      const out = await fn(q, db);
      await db.exec('commit');
      return out;
    } catch (e) {
      try { await db.exec('rollback'); } catch { /* ignore */ }
      throw e;
    }
  });
  const superuser = { role: 'superuser' };

  // ---- schema cache --------------------------------------------------------
  let schema = new Map(); // table -> { cols: Map(name->type), pk: string[] }
  let procs = new Map();  // fn name -> [{argnames, argtypes, retset, rettype, rettyp}]
  const loadSchema = () => enqueue(async () => {
    const cols = (await db.query(`
      select c.table_name, c.column_name, c.udt_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' order by c.table_name, c.ordinal_position`)).rows;
    const next = new Map();
    for (const r of cols) {
      if (!next.has(r.table_name)) next.set(r.table_name, { cols: new Map(), pk: [] });
      next.get(r.table_name).cols.set(r.column_name, r.udt_name);
    }
    const pks = (await db.query(`
      select c.relname as t, a.attname as col
      from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
      where n.nspname = 'public' and i.indisprimary order by c.relname, array_position(i.indkey::int2[], a.attnum)`)).rows;
    for (const r of pks) next.get(r.t)?.pk.push(r.col);
    schema = next;
    const pr = (await db.query(`
      select p.proname, p.proargnames, p.proretset, t.typtype, format_type(p.prorettype, null) as rettype,
        (select coalesce(array_agg(format_type(x::oid, null) order by ord), '{}') from unnest(string_to_array(p.proargtypes::text, ' ')) with ordinality as u(x, ord) where x <> '') as argtypes
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.prokind = 'f'`)).rows;
    const np = new Map();
    for (const r of pr) {
      if (!np.has(r.proname)) np.set(r.proname, []);
      np.get(r.proname).push({ argnames: r.proargnames || [], argtypes: r.argtypes || [], retset: r.proretset, typtype: r.typtype, rettype: r.rettype });
    }
    procs = np;
  });
  await loadSchema();

  // ---- auth context --------------------------------------------------------
  function authCtx(req, { style = 'postgrest' } = {}) {
    const authz = req.headers.authorization;
    let token = authz && /^bearer\s+/i.test(authz) ? authz.replace(/^bearer\s+/i, '').trim() : null;
    if (!token && req.headers.apikey) token = String(req.headers.apikey);
    if (!token) return { role: 'anon', sub: null, claims: { role: 'anon' } };
    let claims;
    try { claims = verifyJwt(token); }
    catch (e) {
      if (style === 'gotrue') throw gotrueErr(401, 'bad_jwt', `invalid JWT: unable to parse or verify signature, ${e.message}`);
      if (style === 'storage') throw storageErr(400, 400, 'InvalidJWT', e.reason === 'expired' ? 'jwt expired' : 'invalid JWT');
      if (e.reason === 'expired') throw new HttpError(401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' }, { 'WWW-Authenticate': 'Bearer error="invalid_token", error_description="JWT expired"' });
      throw new HttpError(401, { code: 'PGRST301', details: null, hint: null, message: e.reason === 'signature' ? 'JWSError JWSInvalidSignature' : 'JWSError (CompactDecodeError Invalid number of parts)' });
    }
    const role = ['anon', 'authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon';
    return { role, sub: claims.sub || null, claims, token };
  }

  // =========================================================================
  // GoTrue
  // =========================================================================
  const refreshTokens = new Map(); // token -> { userId, sessionId }
  const userRow = async (where, params) => (await tx(superuser, (q) => q(`select * from auth.users where ${where}`, params)))[0];
  const toUser = (r) => ({
    id: r.id, aud: r.aud || 'authenticated', role: r.role || 'authenticated', email: r.email,
    email_confirmed_at: r.email_confirmed_at, phone: '', confirmed_at: r.email_confirmed_at,
    last_sign_in_at: r.last_sign_in_at, app_metadata: r.raw_app_meta_data || {}, user_metadata: r.raw_user_meta_data || {},
    identities: [], created_at: r.created_at, updated_at: r.updated_at, is_anonymous: false,
  });
  function issueSession(user, sessionId = crypto.randomUUID()) {
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({
      aud: 'authenticated', exp: now + ACCESS_TTL, iat: now, iss: 'http://fake-supabase/auth/v1', sub: user.id, email: user.email,
      phone: '', app_metadata: user.raw_app_meta_data || {}, user_metadata: user.raw_user_meta_data || {},
      role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now }], session_id: sessionId, is_anonymous: false,
    });
    const refresh = crypto.randomBytes(9).toString('base64url');
    refreshTokens.set(refresh, { userId: user.id, sessionId });
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token: refresh, user: toUser(user) };
  }

  async function handleAuth(req, res, url, sub) {
    const m = req.method;
    if (sub === 'health' && m === 'GET') return send(res, 200, { name: 'GoTrue', version: 'fake', description: 'fake-supabase' });
    if (sub === 'settings' && m === 'GET') {
      return send(res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: true, phone_autoconfirm: false, sms_provider: '' });
    }
    if (sub === 'token' && m === 'POST') {
      const grant = url.searchParams.get('grant_type');
      const ct = req.headers['content-type'] || '';
      const raw = await readBody(req);
      let body = {};
      try { body = ct.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw.toString())) : (raw.length ? JSON.parse(raw.toString()) : {}); }
      catch { throw gotrueErr(400, 'bad_json', 'Could not parse request body as JSON'); }
      if (grant === 'password') {
        if (!body.email || !body.password) throw gotrueErr(400, 'validation_failed', 'Invalid login credentials');
        const r = await userRow('lower(email) = lower($1)', [String(body.email)]);
        if (!r || !checkPassword(body.password, r.encrypted_password)) throw gotrueErr(400, 'invalid_credentials', 'Invalid login credentials');
        await tx(superuser, (q) => q('update auth.users set last_sign_in_at = now() where id = $1', [r.id]));
        return send(res, 200, issueSession({ ...r, last_sign_in_at: new Date().toISOString() }));
      }
      if (grant === 'refresh_token') {
        const entry = refreshTokens.get(String(body.refresh_token || ''));
        if (!entry) throw gotrueErr(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        const r = await userRow('id = $1', [entry.userId]);
        if (!r) throw gotrueErr(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        // Rotation without reuse detection: the old token stays valid (parallel refresh from middleware + browser).
        return send(res, 200, issueSession(r, entry.sessionId));
      }
      throw gotrueErr(400, 'unsupported_grant_type', `unsupported grant_type: ${grant}`);
    }
    if (sub === 'user' && m === 'GET') {
      const authz = req.headers.authorization;
      if (!authz) throw gotrueErr(401, 'no_authorization', 'This endpoint requires a Bearer token');
      const ctx = authCtx(req, { style: 'gotrue' });
      if (!ctx.sub) throw gotrueErr(403, 'bad_jwt', 'invalid claim: missing sub claim');
      const r = await userRow('id = $1', [ctx.sub]);
      if (!r) throw gotrueErr(403, 'user_not_found', 'User from sub claim in JWT does not exist');
      return send(res, 200, toUser(r));
    }
    if (sub === 'logout' && m === 'POST') {
      const ctx = authCtx(req, { style: 'gotrue' });
      const scope = url.searchParams.get('scope') || 'global';
      if (ctx.sub) {
        for (const [t, e] of refreshTokens) {
          if (e.userId !== ctx.sub) continue;
          if (scope === 'global' || (scope === 'local' && e.sessionId === ctx.claims.session_id) || (scope === 'others' && e.sessionId !== ctx.claims.session_id)) refreshTokens.delete(t);
        }
      }
      return send(res, 204, null);
    }
    if (sub === 'signup' && m === 'POST') {
      await readBody(req);
      throw gotrueErr(422, 'signup_disabled', 'Signups not allowed for this instance');
    }
    throw gotrueErr(404, 'not_found', 'Path not found');
  }

  // =========================================================================
  // PostgREST
  // =========================================================================
  const wantsObject = (req) => String(req.headers.accept || '').includes('application/vnd.pgrst.object+json');
  const objectHeaders = { 'Content-Type': 'application/vnd.pgrst.object+json; charset=utf-8' };
  const pgrst116 = (n) => prestErr(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${n} rows`, null);

  function tableInfo(name) {
    const info = schema.get(name);
    if (!info) {
      const guess = [...schema.keys()].find((t) => t.startsWith(name.slice(0, 4)));
      throw prestErr(404, 'PGRST205', `Could not find the table 'public.${name}' in the schema cache`, null, guess ? `Perhaps you meant the table 'public.${guess}'` : null);
    }
    return info;
  }
  const rangeHeader = (req) => {
    const m = /^(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
    return m ? { offset: Number(m[1]), limit: m[2] === '' ? null : Number(m[2]) - Number(m[1]) + 1 } : null;
  };
  const contentRange = (offset, len, total) => (len === 0 ? `*/${total ?? '*'}` : `${offset}-${offset + len - 1}/${total ?? '*'}`);

  async function handleRest(req, res, url, sub) {
    const ctx = authCtx(req);
    const m = req.method;
    const segs = sub.split('/').filter(Boolean).map(decodeURIComponent);
    if (segs.length === 0) return send(res, 200, { swagger: '2.0', info: { title: 'fake-supabase' }, paths: {} });
    const prefer = parsePrefer(req.headers.prefer);

    if (segs[0] === 'rpc' && segs[1]) return handleRpc(req, res, url, ctx, segs[1]);

    const table = segs[0];
    const info = tableInfo(table);
    const cols = info.cols;
    const single = wantsObject(req);
    const sp = url.searchParams;
    const tq = `public.${qi(table)}`;

    if (m === 'GET' || m === 'HEAD') {
      const params = [];
      const c = { cols, params, table };
      const where = buildWhere(sp, c);
      const sel = buildSelect(sp.get('select'), cols, table);
      const order = buildOrder(sp.get('order'), cols, table);
      const rh = rangeHeader(req);
      let limit = intParam(sp.get('limit'), 'limit');
      let offset = intParam(sp.get('offset'), 'offset') ?? 0;
      if (rh) { offset = rh.offset; if (rh.limit != null) limit = limit == null ? rh.limit : Math.min(limit, rh.limit); }
      const wantCount = prefer.count === 'exact' || prefer.count === 'planned' || prefer.count === 'estimated';
      const out = await tx(ctx, async (q) => {
        const rows = (await q(
          `select coalesce(json_agg(_s), '[]'::json) as j from (select ${sel} from ${tq} as _t where ${where} ${order}${limit != null ? ` limit ${limit}` : ''} offset ${offset}) _s`,
          params,
        ))[0].j;
        let total = null;
        if (wantCount) total = Number((await q(`select count(*) as n from ${tq} as _t where ${where}`, params))[0].n);
        return { rows, total };
      }).catch((e) => { throw pgToPostgrest(e, ctx.role); });
      const headers = { 'Content-Range': contentRange(offset, out.rows.length, out.total) };
      if (m === 'HEAD') return send(res, 200, null, headers);
      if (single) {
        if (out.rows.length !== 1) throw pgrst116(out.rows.length);
        return send(res, 200, out.rows[0], { ...headers, ...objectHeaders });
      }
      const partial = out.total != null && (offset > 0 || (limit != null && out.rows.length < out.total && out.rows.length > 0)) && (rh != null);
      return send(res, partial ? 206 : 200, out.rows, headers);
    }

    if (m === 'POST') {
      const body = parseJsonBody(await readBody(req));
      if (body === undefined || body === null || typeof body !== 'object') throw prestErr(400, 'PGRST102', 'Empty or invalid json', 'Failed to parse JSON body');
      let rowsIn = Array.isArray(body) ? body : [body];
      const colsParam = sp.get('columns');
      const allowed = colsParam ? new Set(colsParam.split(',').map((s) => unquote(s.trim()))) : null;
      const keys = [];
      for (const r of rowsIn) {
        if (r === null || typeof r !== 'object' || Array.isArray(r)) throw prestErr(400, 'PGRST102', 'All object keys must match', 'Failed to parse JSON body');
        for (const k of Object.keys(r)) {
          if (allowed && !allowed.has(k)) continue;
          if (!cols.has(k)) throw prestErr(400, 'PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`);
          if (!keys.includes(k)) keys.push(k);
        }
      }
      const rep = prefer.return === 'representation';
      const resolution = prefer.resolution;
      const upsert = resolution === 'merge-duplicates' || resolution === 'ignore-duplicates';
      let conflict = '';
      if (upsert) {
        const oc = sp.get('on_conflict');
        const target = oc ? oc.split(',').map((s) => unquote(s.trim())) : info.pk;
        for (const t of target) if (!cols.has(t)) throw new PgLike('42703', `column ${table}.${t} does not exist`);
        if (!target.length) throw prestErr(400, 'PGRST100', 'upsert requires on_conflict or a primary key');
        const tgt = target.map(qi).join(', ');
        conflict = resolution === 'ignore-duplicates' || keys.length === 0
          ? ` on conflict (${tgt}) do nothing`
          : ` on conflict (${tgt}) do update set ${keys.map((k) => `${qi(k)} = excluded.${qi(k)}`).join(', ')}`;
      }
      const sel = buildSelect(sp.get('select'), cols, table);
      const result = await tx(ctx, async (q) => {
        let rows = [];
        const wrap = (cte) => `with _r as (${cte}) select coalesce(json_agg(_s), '[]'::json) as j from (select ${sel} from _r as _t) _s`;
        if (rowsIn.length === 0) rows = [];
        else if (keys.length === 0) {
          for (let i = 0; i < rowsIn.length; i++) rows.push(...(await q(wrap(`insert into ${tq} default values${conflict} returning *`)))[0].j);
        } else {
          const kl = keys.map(qi).join(', ');
          rows = (await q(
            wrap(`insert into ${tq} (${kl}) select ${kl} from json_populate_recordset(null::${tq}, $1::json)${conflict} returning *`),
            [JSON.stringify(rowsIn)],
          ))[0].j;
        }
        if (single && rep && rows.length !== 1) throw pgrst116(rows.length);
        return rows;
      }).catch((e) => { throw pgToPostgrest(e, ctx.role); });
      const headers = { 'Content-Range': `*/${prefer.count ? result.length : '*'}` };
      if (!rep) return send(res, 201, null, headers);
      return single ? send(res, 201, result[0], { ...headers, ...objectHeaders }) : send(res, 201, result, headers);
    }

    if (m === 'PATCH' || m === 'DELETE') {
      const rep = prefer.return === 'representation';
      let patch = null;
      const params = [];
      let setSql = '';
      if (m === 'PATCH') {
        patch = parseJsonBody(await readBody(req));
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw prestErr(400, 'PGRST102', 'Empty or invalid json', 'Failed to parse JSON body');
        const keys = Object.keys(patch);
        if (!keys.length) throw prestErr(400, 'PGRST102', 'Empty or invalid json', 'PATCH body must contain at least one column');
        for (const k of keys) if (!cols.has(k)) throw prestErr(400, 'PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`);
        params.push(JSON.stringify(patch));
        setSql = keys.map((k) => `${qi(k)} = _u.${qi(k)}`).join(', ');
      }
      const c = { cols, params, table };
      const where = buildWhere(sp, c);
      const sel = buildSelect(sp.get('select'), cols, table);
      const cte = m === 'PATCH'
        ? `update ${tq} as _t set ${setSql} from json_populate_record(null::${tq}, $1::json) as _u where ${where} returning _t.*`
        : `delete from ${tq} as _t where ${where} returning _t.*`;
      const result = await tx(ctx, async (q) => {
        const rows = (await q(`with _r as (${cte}) select coalesce(json_agg(_s), '[]'::json) as j from (select ${sel} from _r as _t) _s`, params))[0].j;
        if (single && rep && rows.length !== 1) throw pgrst116(rows.length);
        return rows;
      }).catch((e) => { throw pgToPostgrest(e, ctx.role); });
      const headers = { 'Content-Range': `*/${prefer.count ? result.length : '*'}` };
      if (!rep) return send(res, 204, null, headers);
      return single ? send(res, 200, result[0], { ...headers, ...objectHeaders }) : send(res, 200, result, headers);
    }
    throw prestErr(405, 'PGRST117', `Unsupported HTTP method: ${m}`);
  }

  async function handleRpc(req, res, url, ctx, fn) {
    const cands = procs.get(fn);
    if (!cands) throw prestErr(404, 'PGRST202', `Could not find the function public.${fn} in the schema cache`, null, null);
    let args = {};
    if (req.method === 'POST') { const b = parseJsonBody(await readBody(req)); if (b && typeof b === 'object') args = b; }
    else if (req.method === 'GET' || req.method === 'HEAD') { for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) args[k] = v; }
    else throw prestErr(405, 'PGRST117', `Unsupported HTTP method: ${req.method}`);
    const names = Object.keys(args);
    const proc = cands.find((p) => names.every((n) => p.argnames.includes(n))) || cands[0];
    const params = [];
    const argSql = names.map((n) => {
      const idx = proc.argnames.indexOf(n);
      const type = proc.argtypes[idx];
      if (idx === -1 || !type) throw prestErr(404, 'PGRST202', `Could not find the function public.${fn}(${names.join(', ')}) in the schema cache`);
      let v = args[n];
      if (v === null || v === undefined) params.push(null);
      else if (type.endsWith('[]') && Array.isArray(v)) params.push(`{${v.map((x) => `"${String(x).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`);
      else if (typeof v === 'object') params.push(JSON.stringify(v));
      else params.push(String(v));
      return `${qi(n)} => $${params.length}::${type}`;
    });
    const call = `public.${qi(fn)}(${argSql.join(', ')})`;
    const prefer = parsePrefer(req.headers.prefer);
    const result = await tx(ctx, async (q) => {
      if (proc.rettype === 'void') { await q(`select ${call}`, params); return { void: true }; }
      if (proc.retset || proc.typtype === 'c') {
        const rows = (await q(`select coalesce(json_agg(_s), '[]'::json) as j from (select * from ${call}) _s`, params))[0].j;
        return { value: proc.retset ? rows : (rows[0] ?? null) };
      }
      return { value: (await q(`select to_json(${call}) as j`, params))[0].j };
    }).catch((e) => { throw pgToPostgrest(e, ctx.role); });
    void prefer;
    if (result.void) return send(res, 204, null);
    if (req.method === 'HEAD') return send(res, 200, null);
    if (wantsObject(req) && Array.isArray(result.value)) {
      if (result.value.length !== 1) throw pgrst116(result.value.length);
      return send(res, 200, result.value[0], objectHeaders);
    }
    return send(res, 200, result.value === undefined ? null : result.value);
  }

  // =========================================================================
  // Storage
  // =========================================================================
  const objectBytes = new Map(); // `${bucket}/${name}` -> { data: Buffer, contentType, cacheControl }
  const okey = (b, n) => `${b}/${n}`;
  const encPath = (b, n) => `${b}/${n.split('/').map(encodeURIComponent).join('/')}`;
  const notFound = () => storageErr(400, 404, 'not_found', 'Object not found');

  function pgToStorage(e) {
    if (e instanceof HttpError) return e;
    if (e?.code === '42501') return storageErr(403, 403, 'Unauthorized', 'new row violates row-level security policy');
    if (e?.code === '23505') return storageErr(409, 409, 'Duplicate', 'The resource already exists');
    if (e?.code === '23503') return storageErr(404, 404, 'Bucket not found', 'Bucket not found');
    return storageErr(500, 500, 'InternalError', String(e?.message || e));
  }
  const splitBucketPath = (segs) => ({ bucket: segs[0], name: segs.slice(1).join('/') });

  async function getBucket(q, id) {
    const b = (await q('select * from storage.buckets where id = $1', [id]))[0];
    return b;
  }
  function checkBucketRules(bucketRow, size, mime) {
    if (bucketRow.file_size_limit != null && size > Number(bucketRow.file_size_limit)) {
      throw storageErr(413, 413, 'Payload too large', 'The object exceeded the maximum allowed size');
    }
    const allow = bucketRow.allowed_mime_types;
    if (allow && allow.length) {
      const base = String(mime || '').split(';')[0].trim().toLowerCase();
      if (!allow.some((a) => a.toLowerCase() === base || (a.endsWith('/*') && base.startsWith(a.slice(0, -1))))) {
        throw storageErr(415, 415, 'invalid_mime_type', `mime type ${base} is not supported`);
      }
    }
  }
  const mkMetadata = (size, mimetype, cacheControl) => ({
    eTag: `"${crypto.createHash('md5').update(String(Math.random()) + size).digest('hex')}"`,
    size, mimetype, cacheControl: cacheControl || 'max-age=3600', lastModified: new Date().toISOString(), contentLength: size, httpStatusCode: 200,
  });

  /** Insert/overwrite an object under the caller's role (RLS enforced). Returns {id}. */
  async function putObject(ctx, bucket, name, data, mime, { upsert, cacheControl }) {
    if (!name || name.endsWith('/')) throw storageErr(400, 400, 'InvalidKey', 'Invalid key');
    const owner = ctx.sub || null;
    const id = await tx(ctx, async (q) => {
      const b = await getBucket(q, bucket);
      if (!b) throw storageErr(404, 404, 'Bucket not found', 'Bucket not found');
      checkBucketRules(b, data.length, mime);
      const meta = JSON.stringify(mkMetadata(data.length, mime, cacheControl));
      const onConflict = upsert
        ? ' on conflict (bucket_id, name) do update set owner = excluded.owner, owner_id = excluded.owner_id, metadata = excluded.metadata, updated_at = now(), last_accessed_at = now()'
        : '';
      const rows = await q(
        `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5::jsonb)${onConflict} returning id`,
        [bucket, name, owner, owner, meta],
      );
      return rows[0].id;
    }).catch((e) => { throw pgToStorage(e); });
    objectBytes.set(okey(bucket, name), { data, contentType: mime, cacheControl });
    return id;
  }

  async function lookupObject(ctx, bucket, name) {
    return tx(ctx, async (q) => (await q('select id, metadata, updated_at, created_at from storage.objects where bucket_id = $1 and name = $2', [bucket, name]))[0])
      .catch((e) => { throw pgToStorage(e); });
  }
  function sendObject(req, res, bucket, name, row) {
    const blob = objectBytes.get(okey(bucket, name));
    if (!blob) throw notFound();
    const headers = {
      'Content-Type': blob.contentType || row?.metadata?.mimetype || 'application/octet-stream',
      'Cache-Control': blob.cacheControl ? (/^\d+$/.test(blob.cacheControl) ? `max-age=${blob.cacheControl}` : blob.cacheControl) : 'max-age=3600',
      ETag: row?.metadata?.eTag || '"fake"',
    };
    const dl = req.__download;
    if (dl != null) headers['Content-Disposition'] = `attachment; filename=${dl || path.basename(name)}`;
    return send(res, 200, blob.data, headers);
  }

  const signToken = (claims, ttl) => signJwt({ ...claims, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttl });

  async function handleStorage(req, res, url, sub) {
    const m = req.method;
    const segs = sub.split('/').filter(Boolean).map(decodeURIComponent);
    const [a, b2] = segs;
    const ctxOf = () => authCtx(req, { style: 'storage' });

    // ----- signed upload URL
    if (a === 'object' && b2 === 'upload' && segs[2] === 'sign' && segs.length >= 5) {
      const { bucket, name } = splitBucketPath(segs.slice(3));
      if (m === 'POST') {
        const ctx = ctxOf();
        const upsert = String(req.headers['x-upsert']).toLowerCase() === 'true';
        await readBody(req);
        // Dry-run insert under the caller's role: enforces RLS (and duplicate check) like the real service.
        await tx(ctx, async (q) => {
          const bk = await getBucket(q, bucket);
          if (!bk) throw storageErr(404, 404, 'Bucket not found', 'Bucket not found');
          await q('savepoint dry');
          try {
            await q(`insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3::uuid, $3::text)`, [bucket, name, ctx.sub]);
          } catch (e) {
            await q('rollback to savepoint dry');
            if (!(e.code === '23505' && upsert)) throw e;
          }
          await q('rollback to savepoint dry');
        }).catch((e) => { throw pgToStorage(e); });
        const token = signToken({ url: `${bucket}/${name}`, owner: ctx.sub, role: ctx.role, upsert }, 7200);
        return send(res, 200, { url: `/object/upload/sign/${encPath(bucket, name)}?token=${token}` });
      }
      if (m === 'PUT') {
        const token = url.searchParams.get('token');
        let claims;
        try { claims = verifyJwt(token); } catch (e) { throw storageErr(400, 400, 'InvalidJWT', e.reason === 'expired' ? 'jwt expired' : 'invalid JWT'); }
        if (claims.url !== `${bucket}/${name}`) throw storageErr(400, 400, 'InvalidJWT', 'Invalid token: path mismatch');
        const raw = await readBody(req);
        const { data, mime, cacheControl } = extractUpload(req, raw);
        const upsert = claims.upsert === true || String(req.headers['x-upsert']).toLowerCase() === 'true' && claims.upsert === true;
        const ctx = { role: claims.role === 'service_role' ? 'service_role' : 'authenticated', sub: claims.owner || null };
        await putObject(ctx, bucket, name, data, mime, { upsert, cacheControl });
        return send(res, 200, { Key: `${bucket}/${name}` });
      }
    }

    // ----- sign (read)
    if (a === 'object' && b2 === 'sign' && segs.length >= 3) {
      if (m === 'POST') {
        const ctx = ctxOf();
        const body = parseJsonBody(await readBody(req)) || {};
        if (segs.length === 3 && Array.isArray(body.paths)) { // createSignedUrls
          const bucket = segs[2];
          const out = [];
          for (const p of body.paths) {
            const row = await lookupObject(ctx, bucket, p);
            out.push(row
              ? { error: null, path: p, signedURL: `/object/sign/${encPath(bucket, p)}?token=${signToken({ url: `${bucket}/${p}` }, Number(body.expiresIn) || 60)}` }
              : { error: 'Either the object does not exist or you do not have access to it', path: p, signedURL: null });
          }
          return send(res, 200, out);
        }
        const { bucket, name } = splitBucketPath(segs.slice(2));
        if (!Number.isFinite(Number(body.expiresIn)) || Number(body.expiresIn) <= 0) throw storageErr(400, 400, 'invalid_request', 'expiresIn is required');
        const row = await lookupObject(ctx, bucket, name);
        if (!row) throw notFound();
        return send(res, 200, { signedURL: `/object/sign/${encPath(bucket, name)}?token=${signToken({ url: `${bucket}/${name}` }, Number(body.expiresIn))}` });
      }
      if (m === 'GET' || m === 'HEAD') {
        const { bucket, name } = splitBucketPath(segs.slice(2));
        let claims;
        try { claims = verifyJwt(url.searchParams.get('token')); } catch (e) { throw storageErr(400, 400, 'InvalidJWT', e.reason === 'expired' ? 'jwt expired' : 'invalid signature'); }
        if (claims.url !== `${bucket}/${name}`) throw storageErr(400, 400, 'InvalidJWT', 'Invalid token: path mismatch');
        if (url.searchParams.has('download')) req.__download = url.searchParams.get('download');
        const row = await tx(superuser, (q) => q('select id, metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).then((r) => r[0]);
        if (!row) throw notFound();
        return sendObject(req, res, bucket, name, row);
      }
    }

    // ----- list
    if (a === 'object' && b2 === 'list' && segs.length === 3 && m === 'POST') {
      const ctx = ctxOf();
      const bucket = segs[2];
      const body = parseJsonBody(await readBody(req)) || {};
      let prefix = String(body.prefix || '');
      if (prefix && !prefix.endsWith('/')) prefix += '/';
      const rows = await tx(ctx, (q) => q(
        `select name, id, updated_at, created_at, last_accessed_at, metadata from storage.objects where bucket_id = $1 and left(name, length($2)) = $2 order by name`,
        [bucket, prefix],
      )).catch((e) => { throw pgToStorage(e); });
      const entries = new Map();
      for (const r of rows) {
        const rest = r.name.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf('/');
        if (slash === -1) entries.set(rest, { ...r, name: rest });
        else if (!entries.has(rest.slice(0, slash))) entries.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
      }
      let list = [...entries.values()];
      if (body.search) list = list.filter((e) => e.name.toLowerCase().includes(String(body.search).toLowerCase()));
      const col = body.sortBy?.column || 'name';
      const dir = body.sortBy?.order === 'desc' ? -1 : 1;
      list.sort((x, y) => ((x[col] ?? '') > (y[col] ?? '') ? 1 : (x[col] ?? '') < (y[col] ?? '') ? -1 : 0) * dir);
      const off = Number(body.offset) || 0;
      const lim = body.limit != null ? Number(body.limit) : 100;
      return send(res, 200, list.slice(off, off + lim));
    }

    // ----- bucket info
    if (a === 'bucket' && m === 'GET') {
      const rows = await tx(superuser, (q) => q('select id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at from storage.buckets order by id'));
      if (segs[1]) { const r = rows.find((x) => x.id === segs[1]); if (!r) throw storageErr(404, 404, 'Bucket not found', 'Bucket not found'); return send(res, 200, r); }
      return send(res, 200, rows);
    }

    // ----- object CRUD: /object/{bucket}/{path}, /object/authenticated/..., /object/public/..., /object/info/...
    if (a === 'object') {
      if (m === 'DELETE' && segs.length === 2) { // batch remove: DELETE /object/{bucket} {prefixes}
        const ctx = ctxOf();
        const bucket = segs[1];
        const body = parseJsonBody(await readBody(req)) || {};
        const prefixes = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
        const removed = prefixes.length ? await tx(ctx, (q) => q('delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning *', [bucket, prefixes]))
          .catch((e) => { throw pgToStorage(e); }) : [];
        for (const r of removed) objectBytes.delete(okey(bucket, r.name));
        return send(res, 200, removed);
      }
      let mode = 'plain'; let rest = segs.slice(1);
      if (['authenticated', 'public', 'info'].includes(segs[1]) && segs.length >= 4) { mode = segs[1]; rest = segs.slice(2); }
      if (rest.length >= 2) {
        const { bucket, name } = splitBucketPath(rest);
        if (m === 'GET' || m === 'HEAD') {
          if (mode === 'public') throw storageErr(400, 404, 'Bucket not found', 'Bucket not found');
          const ctx = ctxOf();
          const row = await lookupObject(ctx, bucket, name);
          if (!row) throw notFound();
          if (mode === 'info') return send(res, 200, { id: row.id, name, bucket_id: bucket, metadata: row.metadata, updated_at: row.updated_at, created_at: row.created_at });
          if (url.searchParams.has('download')) req.__download = url.searchParams.get('download');
          return sendObject(req, res, bucket, name, row);
        }
        if (m === 'POST' || m === 'PUT') {
          const ctx = ctxOf();
          const raw = await readBody(req);
          const { data, mime, cacheControl } = extractUpload(req, raw);
          const upsert = m === 'PUT' || String(req.headers['x-upsert']).toLowerCase() === 'true';
          const id = await putObject(ctx, bucket, name, data, mime, { upsert, cacheControl });
          return send(res, 200, { Id: id, Key: `${bucket}/${name}` });
        }
        if (m === 'DELETE') {
          const ctx = ctxOf();
          const removed = await tx(ctx, (q) => q('delete from storage.objects where bucket_id = $1 and name = $2 returning *', [bucket, name])).catch((e) => { throw pgToStorage(e); });
          if (!removed.length) throw notFound();
          objectBytes.delete(okey(bucket, name));
          return send(res, 200, { message: 'Successfully deleted' });
        }
      }
    }
    throw storageErr(404, 404, 'not_found', 'Route not found in fake-supabase storage');
  }

  function extractUpload(req, raw) {
    const ct = String(req.headers['content-type'] || '');
    if (ct.toLowerCase().startsWith('multipart/form-data')) {
      const { fields, file } = parseMultipart(raw, ct);
      if (!file) throw storageErr(400, 400, 'invalid_request', 'multipart body has no file');
      return { data: file.data, mime: file.type, cacheControl: fields.cacheControl };
    }
    const cc = String(req.headers['cache-control'] || '').replace(/^max-age=/, '');
    return { data: raw, mime: ct || 'application/octet-stream', cacheControl: cc || undefined };
  }

  // =========================================================================
  // Test helpers
  // =========================================================================
  async function handleTest(req, res, url, sub) {
    if (sub === 'reset' && req.method === 'POST') {
      await readBody(req);
      await tx(superuser, async (q) => {
        const tables = (await q(`select quote_ident(table_name) as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).map((r) => `public.${r.t}`);
        if (tables.length) await q(`truncate ${tables.join(', ')} restart identity cascade`);
        await q('delete from storage.objects');
      });
      objectBytes.clear();
      return send(res, 200, { ok: true });
    }
    if (sub === 'sql' && req.method === 'POST') {
      const body = parseJsonBody(await readBody(req));
      if (!body || typeof body.sql !== 'string') throw prestErr(400, 'PGRST102', 'body must be {sql, params?}');
      const result = await enqueue(async () => {
        if (Array.isArray(body.params) && body.params.length) { const r = await db.query(body.sql, body.params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; }
        const rs = await db.exec(body.sql);
        const last = rs[rs.length - 1];
        return { rows: last?.rows || [], rowCount: last?.affectedRows ?? last?.rows?.length ?? 0 };
      }).catch((e) => { throw prestErr(400, e.code || 'XX000', e.message, e.detail ?? null, e.hint ?? null); });
      if (/\b(create|alter|drop)\b/i.test(body.sql)) await loadSchema();
      return send(res, 200, result);
    }
    throw prestErr(404, 'PGRST404', 'unknown test endpoint');
  }

  // =========================================================================
  // HTTP server
  // =========================================================================
  const cors = (req) => ({
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': [req.headers['access-control-request-headers'], 'authorization,apikey,x-client-info,content-type,prefer,range,range-unit,accept-profile,content-profile,x-upsert,cache-control,x-metadata,accept,x-supabase-api-version']
      .filter(Boolean).join(','),
    'Access-Control-Expose-Headers': 'Content-Range,Content-Length,Content-Type,ETag,X-Supabase-Api-Version',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  const handler = async (req, res) => {
    const base = cors(req);
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, headers) => origWriteHead(status, { ...base, ...(headers || {}) });
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const url = new URL(req.url, 'http://fake');
      const p = url.pathname;
      if (p === '/' || p === '/health') return send(res, 200, { ok: true, service: 'fake-supabase' });
      let mm;
      if ((mm = p.match(/^\/auth\/v1\/?(.*)$/))) return await handleAuth(req, res, url, mm[1].replace(/\/$/, ''));
      if ((mm = p.match(/^\/rest\/v1\/?(.*)$/))) return await handleRest(req, res, url, mm[1]);
      if ((mm = p.match(/^\/storage\/v1\/?(.*)$/))) return await handleStorage(req, res, url, mm[1]);
      if ((mm = p.match(/^\/__test\/(.*)$/))) return await handleTest(req, res, url, mm[1]);
      return send(res, 404, { message: 'Not found' });
    } catch (e) {
      let err = e;
      if (!(err instanceof HttpError)) err = pgToPostgrest(e, 'authenticated');
      if (err.status >= 500) console.error('[fake-supabase]', req.method, req.url, e);
      send(res, err.status, err.body, err.headers);
    }
  };

  const servers = [];
  const listen = (srv, p, h) => new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(p, h, () => resolve(srv.address().port)); });
  const s4 = http.createServer(handler); servers.push(s4);
  const actualPort = await listen(s4, port, host || '127.0.0.1');
  if (!host) {
    const s6 = http.createServer(handler);
    try { await listen(s6, actualPort, '::1'); servers.push(s6); } catch { /* IPv6 loopback unavailable or taken: fine */ }
  }

  let closed = false;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    anonKey: ANON_KEY,
    serviceRoleKey: SERVICE_ROLE_KEY,
    jwtSecret: JWT_SECRET,
    users: { user1: USER_1, user2: USER_2 },
    db,
    async close() {
      if (closed) return; closed = true;
      await Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); })));
      await tail;
      await db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.FAKE_SUPABASE_PORT || 54321);
  const srv = await startFakeSupabase({ port });
  console.log(`fake-supabase listening on http://localhost:${srv.port}`);
  console.log(`  NEXT_PUBLIC_SUPABASE_URL      = http://localhost:${srv.port}`);
  console.log(`  anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) = ${srv.anonKey}`);
  console.log(`  service role key (SUPABASE_SERVICE_ROLE_KEY) = ${srv.serviceRoleKey}`);
  console.log(`  user 1: ${USER_1.email} / ${USER_1.password}  (id ${USER_1.id})`);
  console.log(`  user 2: ${USER_2.email} / ${USER_2.password}  (id ${USER_2.id})`);
  console.log(`  helpers: POST /__test/reset , POST /__test/sql {sql, params}`);
  const stop = async () => { await srv.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
