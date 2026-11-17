# NOTES — Proof of Work build

Built 2026-11-16 from the package docs (00–07). Repo root = `code/`.

## How to run

1. Create a Supabase project. Run `supabase/migrations/001_init.sql`, then `002_storage.sql`. Create the user, then disable sign-ups.
2. `cp .env.example .env.local` and fill the four values.
3. `npm install && npm run dev` (or deploy to Vercel, doc 02 section 12).
4. Log in, set the program start date and phase in Targets & Sync, press Regenerate to get the webhook secret, then build the iOS Shortcut (doc 03 section 3).

No Supabase project? `node tests/e2e/fake-supabase.mjs` runs an in-memory stand-in built on the real migrations (PGlite). See `tests/e2e/README.md` for the `.env.local` lines and test users.

## Verification list (doc 07)

| # | Item | Result |
|---|---|---|
| 1 | `npm test` (domain vectors 1–8) and `tests-db` | PASS — 152 vitest tests (domain, API routes, fake-Supabase harness), 20 DB tests |
| 2 | `npm run build`, `tsc --noEmit` | PASS |
| 3 | Fresh Supabase project: migrations apply, sign-ups disabled | NOT RUN on real Supabase. Both migrations apply cleanly on PGlite. Sign-ups must be disabled by hand in the dashboard. |
| 4 | RLS isolation, `sync_credentials` unreadable from the browser | PASS on PGlite with the real policies (second user sees no rows or photos). Re-check on the real project. |
| 5 | No secret in the client bundle | PASS — grep of `.next/static` for `service_role`, `SERVICE_ROLE` and the key is empty |
| 6 | Empty is not zero | PASS — clearing steps in the UI stores `null`; averages ignore it |
| 7 | Manual edit lock | PASS — hand-typed protein survives a sync; cleared field is syncable again |
| 8 | Closed week refuses edits (UI, API, DB); reopen needs confirmation; sync skipped | PASS |
| 9 | Goals snapshot | PASS — phase edit refreshes open weeks only; closed week kept 2350 while open week moved to 2500 |
| 10 | Week math, America/Hermosillo | PASS (domain tests; UI showed Mon Nov 16 at 19:30 local = Nov 17 UTC) |
| 11 | Webhook curl set | PASS for 200 / 401 / 400 and dry run through the running app; 413 and 429 covered by route tests. No duplicate workouts on a second run. Rotated secret invalidates the old one (route test). |
| 12 | No red for status | PASS by inspection of Today, Weekly Hub, Compare. No automated contrast audit was run. |
| 13 | PWA | Manifest and icons present, no service worker. NOT TESTED on an iPhone. |
| 14 | Photos | PASS for compression (3000 px → 1600 px JPEG), private path, signed URL (3600 s). EXIF/GPS removal relies on canvas re-encoding; not checked with `exiftool`. |
| 15 | P0 + P1 scope | All milestones M1–M7 built. iPhone demo not done. |
| 16 | Doc 03 section 6 phone checklist | NOT RUN — needs Nico's phone and Shortcut. |

## What was tested in a real browser (against the fake Supabase)

Login; Today (edit, clear, day type switch, add session, Strong import incl. closed-week error and attach to the synced session: 8 exercises, 25 sets, 8,981 kg); Targets & Sync (goal edits, secret regenerate shown once); Weekly Hub (KPIs, ledger, energy balance, photo upload, close, lock); Compare (trend chart, deltas, effort cards); 375 px and 1280 px; light and dark.

Not exercised in the browser: magic-link login (the fake server has no OTP), PNG/PDF export buttons, photo slider drag, reopen modal (reopen verified through the API), start-new-phase modal (verified through route tests).

## Bugs fixed during integration

- `NumberField` never called `onCommit` when the parent also pushed the live value back through `value` (Today tab): no number edit was saved. It now compares against the value held on focus.
- Photo file inputs stayed enabled in a closed week (API refused anyway). Now disabled.
- Today showed macro percentages without decimals; now one decimal (97.9%, 109.5%).

## Decisions where the docs were silent

- `POST /phases`, `/phases/start-new`, `/workouts` return 201. `DELETE` returns `{ ok: true }`. `DELETE /phases/{id}` with weeks attached needs `?confirm=true` (409 `confirmation_required` otherwise).
- `GET /weeks?from&to` returns only existing days per week (no nulls); `GET /weeks/{weekStart}` returns 7 slots.
- Webhook auth header: `Authorization: Bearer pow_...`. Extra payload limits from doc 03 are enforced in `services/sync.ts` (1–7 days, 14 days back, 1 day forward).
- Strong text over 100 KB → 413. Photo delete on an empty slot → 404.
- Live-day rule (doc 01 section 9): today and open weeks show the neutral "so far" style; colours apply once the day or week has ended.
- Compare lists open weeks too (labelled "open"); the prototype listed closed weeks only.
- Ledger "% Achieved" for steps = average steps per day ÷ daily goal, computed in the UI as in the prototype (the domain summary only has % of the weekly goal). Compare's "Weigh-ins" and combined "Sessions" cards are also derived in the UI from two summaries.
- Rate limit is in-memory per instance (best effort on Vercel, as doc 02 section 11 says).

## Known gaps

- Ledger shows `0` instead of `—` in the strength-kcal cell for a Strong-only session with no calories.
- No Playwright suite (doc 02 lists it as P1).
- Domain library was not changed.
