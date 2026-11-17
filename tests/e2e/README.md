# Fake Supabase for e2e testing

`fake-supabase.mjs` is a local stand-in for Supabase (GoTrue + PostgREST + Storage) for machines with no Docker,
Supabase CLI or Postgres. It runs an in-memory PGlite with the REAL migrations in `supabase/migrations/*.sql`
(applied in sorted order), so real RLS policies, triggers and constraints apply. Test use only.

## Run

```
node tests/e2e/fake-supabase.mjs            # port from FAKE_SUPABASE_PORT, default 54321
npx vitest run tests/e2e                    # self-test using the real supabase-js client
```

Importable: `import { startFakeSupabase } from './fake-supabase.mjs'` -> `{ url, anonKey, serviceRoleKey, close(), db }`.

## `.env.local` for the app

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key printed at start>
SUPABASE_SERVICE_ROLE_KEY=<service role key printed at start>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Keys are deterministic (fixed JWT secret), so they are the same every run:

- anon: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6ImZha2UiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.np76YXWb94LZ_il0-qB1TqDeTf-IH8Ljic_BPVw12HA`
- service_role: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6ImZha2UiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.L0fUMIl_v0xEHo4sw3qc02MyKtwJvykK4B1hvOsuSPo`

## Test users

| email | password | id |
|---|---|---|
| nico@example.com | test-password-1 | 11111111-1111-1111-1111-111111111111 |
| other@example.com | test-password-2 | 22222222-2222-2222-2222-222222222222 |

Exported as `USER_1` / `USER_2`. Signups are disabled (422). More users can be added via `/__test/sql` (insert into `auth.users`;
password hash format is `scrypt$<saltHex>$<hashHex>`, 32-byte key).

## Helper endpoints

- `POST /__test/reset` : truncates all `public` tables (no triggers fire) and `storage.objects`, clears stored bytes. Users stay.
- `POST /__test/sql` body `{ "sql": "...", "params": [...] }` : runs as superuser, returns `{ rows, rowCount }`.
  Without `params` multiple statements are allowed (rows of the last one).

## Supported

- Auth: `POST /token?grant_type=password|refresh_token`, `GET /user`, `POST /logout` (204), `POST /signup` (422), `/settings`, `/health`. HS256 JWTs, 1h access tokens.
- PostgREST: GET/HEAD/POST/PATCH/DELETE, `select` (columns, aliases, casts), filters eq/neq/gt/gte/lt/lte/like/ilike/is/in/cs/cd/ov/match/imatch/isdistinct, `not.`, `or`/`and` (nested), `order`, `limit`, `offset`, `Range`, `Prefer: count`, `return`, `resolution`, `on_conflict`, `columns`, `.single()`/`.maybeSingle()` (406 PGRST116, mutations roll back), `/rpc/{fn}` (named args). Errors in PostgREST format with Postgres `hint` preserved.
- Storage (bucket `progress-photos`): signed upload (create + PUT multipart/raw), signed download URLs, authenticated download, direct upload (`x-upsert`), remove, list, `createSignedUrls`, bucket size/mime rules. `storage.objects` rows are written under the caller's role, so the real storage RLS applies.
- CORS preflight, permissive headers (origin echoed).

## Known gaps vs real Supabase

- No embedded resources (`select=*,table(*)`) -> 400 PGRST200. No JSON path operators (`col->k`), full-text search, aggregate functions, views/schemas other than `public`.
- Heterogeneous bulk insert arrays get NULL for missing keys (like PostgREST default); `Prefer: missing=default` is not honored.
- Refresh tokens are not single-use (no reuse detection); no email/OTP/OAuth/MFA/admin API; `PUT /user` not implemented.
- Storage: no move/copy, image transforms, resumable (TUS), buckets API writes, public buckets, `x-metadata`. Object bytes live in memory; rows deleted via `/__test/sql` leave orphan bytes. Errors for missing/forbidden objects are HTTP 400 with `statusCode:'404'` (as the real service).
- Timestamps use PG JSON format (`2026-11-16T10:00:00+00:00`). RLS/privileges mimic Supabase default grants (anon/authenticated/service_role get table privileges; migrations restrict them).
- All DB access is serialized through one queue (PGlite is single connection). Data is lost when the process exits.
