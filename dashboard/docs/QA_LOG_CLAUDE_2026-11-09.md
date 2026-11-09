# QA log: Claude session, 2026-11-09 (technical QA only)

Scope rule from the owner: the engine does not decide which jobs suit Farhan or Sana; that is the owner's call. This log covers technical
quality only. Screening-rule behaviour (sponsorship wording, location rules) is handled on the `codex/*` branches and was deliberately
left alone here (a first attempt was reverted in `bbfe9d9`).

## Checked and passing (local disposable D1 + Chromium, no production access)
* `npm run verify` (178 Node tests incl. migration chain), 348 Python tests, `npm audit` 0 vulnerabilities.
* Browser: `browser.e2e` 31/31 desktop and mobile, `listing.e2e` 48/48, `site.e2e` 20/20, production-readonly rehearsal, post-deploy smoke.
* Resold-client isolation: a private client is invisible to anonymous callers and answered like an unknown id; a share link reads only its
  own client, cannot write or reach operator routes, is ignored in a query string, and stops working once revoked; CSV export needs the operator.
* Public intake form (`/apply`): honeypot, 413 on oversize bodies, 429 after 5 submissions per network per day, consent required, hostile
  text stored as text and escaped on output (no `innerHTML` in the frontend).
* Injection-style input on `candidate_id`, `sort_by`, paths: 400/200, never SQL errors.
* Workflows: no `pull_request_target`; no user-controlled text in `run:` steps.

## Fixed on branch `ccr-31e055c3-e2y6ub`
* Junk `limit`/`offset` returned 500 on the job lists (now defaults; test added).
* CORS reflected any origin; now only the site's own origin and localhost.
* Security headers on API answers and the app shell (`frontend/public/_headers`).
* Budget guard now emits a warning annotation when usage cannot be read.
* Stale browser e2e brought up to date with the simpler UI.

## Open
* Outage backup: Cache API is not active on `*.workers.dev`; needs a custom domain or KV (see KNOWN_ISSUES.md). Owner decision.
* Public `/profile` shows Farhan's education line ("University of Mumbai"); the privacy test flags any city name. Owner decision.
* Not covered: live site UI (sandbox cannot reach it), accessibility, quota root cause of 7 Nov (needs production reads), run 42 browser flake.

## Second pass: full read-through (later the same day)
Passing:
* Operator auth: fail-closed when the key is unset, timing-safe compare, lockout keyed on `CF-Connecting-IP` only (never X-Forwarded-For).
* SQL: every interpolated fragment is a hard-coded column name or a whitelisted `ORDER BY`; all values are bound.
* Import safety (`dataset_apply.mjs`): closure needs two consecutive snapshots + a healthy ATS count + a per-run cap, and never touches rows with an
  application or manual override; copy-collapse and re-score keep the same guards. `candidate_job_scores` has PRIMARY KEY (candidate_id, job_id), so
  the per-candidate joins are indexed.
* Python: pyflakes finds only unused imports; no `shell=True`/`eval`/`pickle`; every network call has a timeout.
* Public site accessibility (desktop + 375 px): lang, title, one h1, labelled fields, named buttons/links, no horizontal scroll, mobile menu works.
* Workflows: timeouts, concurrency groups, least-privilege permissions, actions pinned to a major version.
Findings (none fixed; none block the release):
1. GitHub keeps only ONE pending run per concurrency group, and a newer pending run replaces the older. `discovery`, `watchlist` and
   `sync_collector_to_d1` share the group `d1-collector-sync`, so a pending scheduled run of one can be dropped by another's. That may be part of
   the "dropped triggers" seen on 8 Nov; the catch-up guard hides it. `dashboard-release` uses a different group, so a release can overlap a D1 import.
2. Cost to measure before trusting: the copy-collapse statement scans all `candidate_job_scores` per discovery run, and the Analytics average-score
   query scans one candidate's score rows per cache miss. Both are fine at today's size; neither has a measured `rows_read`.
3. Minor: `/apply` consent checkbox is a 13 px target; `/app` has no `<h1>`; a handful of unused imports in Python files (left alone to avoid
   conflicts with the `codex/*` branches that edit `engine/`).

## Segment 2: D1 quota and query cost (06:35 UTC)
* Database `career-job-engine`: 43.6 MB, 28 tables, APAC, no replicas. Storage is far from any free-tier limit.
* The connector tools cannot read "rows read today" (that needs the GraphQL analytics token the GitHub workflows hold), so no live figure was taken
  and no production query was run.
* Modelled on a local copy scaled to 30,000 jobs per candidate (60,000 qualification and score rows), using `EXPLAIN QUERY PLAN` and row counts:
  every uncached `/api/jobs` request runs (1) a status-count query that walks all of the candidate's qualification rows and looks each job up
  (about 60k rows read) and (2) a page query that must sort the whole candidate set by score before `LIMIT 50` (about 90k rows read), so
  **about 150k rows per cache miss, per filter combination**. With the public read cap at 2,500,000 that is roughly 16 distinct uncached views a day
  at this size, and it grows linearly with jobs per candidate. It explains why the cap trips under QA and why many filter combinations are costly.
  Real per-candidate sizes in production are unmeasured; treat the numbers as an order of magnitude.
* Options (none applied; each needs equivalence tests and a measurement against real `rows_read`): drive the page query from
  `candidate_job_scores` using `idx_cjs_cand_score` so `LIMIT 50` stops early; cache the status counts separately from the page and for longer;
  keep a per-candidate counts table updated by the importers.
* Guard: the current script filters the analytics by this database only, while the free limit is per account (two other Workers exist on the
  account). ChatGPT's `codex/account-d1-budget` changes it to account-wide; it merges cleanly with this branch.

## Segment 3: pipelines (07:35 UTC), from the GitHub Actions run list (74 scheduled runs on record, last 3 days read)
Health: every scheduled run in the window succeeded. Failures in the last 40 runs: release run 42 (the browser flake, rerun passed) and the PR 63
tests (cured by ChatGPT's next push). Daily discovery run 42545243046 (the fourth re-score batch) finished successfully at 01:33 UTC.
Schedule delivery (observed, UTC): cron times are what the workflow files ask for.
| Workflow | Cron asks for | Scheduled runs actually seen |
|---|---|---|
| collect | 01:37, 06:37, 11:37, 16:37, 21:37 | 7 Nov 01:08, 07:43, 16:58; 8 Nov 00:52, 07:54, 17:13; 9 Nov 01:10 (about 3 a day) |
| sync collector to D1 | 01:45, 06:45, 11:45, 16:45, 21:45 | 7 Nov 01:13, 07:47, 16:59; 8 Nov 00:54, 07:58, 17:14; 9 Nov 01:14 (about 3 a day) |
| daily discovery | 15:13, 17:13, 19:13, 21:13 | 7 Nov 19:25 (9 s, guard skip during the quota outage); 8 Nov 19:40 (real run). The 15:13 and 17:13 triggers never arrived. |
| watchlist | every 2 h at :07 | 7 Nov 09:50; 8 Nov 00:19, 10:04; 9 Nov 06:24 (2-3 a day, 12 asked for) |
| career pipeline | 03:23 | 6 Nov 11:11, 7 Nov 10:28, 8 Nov 10:36 (about 7 h late every day) |
Reading: GitHub treats `schedule` as best effort and this repo gets roughly one delivery per 6-9 hours whatever the cron says, so a trigger
is "dropped" most of the time. The recent-run guards turn that into the intended cadence, so nothing is broken, but any plan that needs a
run at a given hour (e.g. a morning report) cannot rely on `schedule`. The shared concurrency group theory from the first pass is NOT the main
cause: drops happen while nothing else is running.
Options for the owner (none applied): (a) accept the cadence, since the guards catch up; (b) let the Worker's own cron (reliable, already every
2 minutes) start the GitHub workflows with `workflow_dispatch`, which needs a GitHub token stored as a Worker secret with only `actions:write`,
a security trade-off to approve explicitly.

## Segment 4: data integrity (08:38 UTC)
* A production sample of re-scored rows could not be taken: the live site is unreachable from the sandbox and no production D1 query was run.
  The owner or ChatGPT can still do it with the public API: sample 30 `ds:` rows per candidate, check `score.breakdown.rescored_at` and `profile_v5`.
* Added `re-score property` to `test/dataset.test.mjs`: 400 rows with random status (incl. READY/STRETCH/INELIGIBLE), manual override, own-candidate
  application, existing marker, and varied posting text. Invariants checked: jobs and applications tables byte-identical; a protected row's
  qualification and score rows are identical before and after; an untagged undecided row gets the marker; its status can only stay or become
  INELIGIBLE; the same SQL applied again changes nothing. Mutation check: removing the guard from the score update makes the test fail.
* `engine/dataset_discovery.py: rescore_rows` reviewed: pages by (score, job) with no OFFSET, excludes applications and overrides, bounded by
  `per_candidate`, injection-safe quoting. Cost note: it filters on `score_breakdown LIKE` after walking the candidate's score index from the top, so
  rows already re-scored at the head of the ranking are re-read on every run, and once the re-score has finished it still walks every row each
  discovery run (about two reads per row, per candidate). A "done" flag in `discovery_state` would stop that; not changed because `engine/`
  is being edited on the `codex/*` branches.
* All six `codex/*` branches still merge cleanly with this branch.

## Segment 5: Python engine under fault injection (09:35 UTC)
* Fuzzed `adapters.normalize` / `extract_jobs` for greenhouse, lever and ashby: every field of a valid sample job replaced in turn by 18 odd values
  (null, 0, -1, 1.5, NaN, booleans, empty containers, a 100 KB string, markup, a 10^30 integer, an impossible date), plus whole-job and whole-response
  mismatches. 12 unexpected `TypeError`s, all the same bug: four fields iterated as lists without a type check (greenhouse `offices`, lever
  `categories.allLocations` and `lists`, ashby `secondaryLocations`).
* Why it mattered: `collect.py` catches the error per source, so one malformed job marked the WHOLE board failed and kept stale data (and bumped its
  failure count) until the vendor fixed the record; `market_discovery.py` caught only `ValueError`/`KeyError` around the employer-target pass, so the same
  error escaped and could end that pass.
* Fixed: `adapters._list()` treats a non-list as empty; the employer-target `except` also catches `TypeError`/`AttributeError`. Behaviour for valid
  data is unchanged (all 352 Python tests pass). `adapters.py` keeps its CRLF line endings so the diff is 12 lines.
* New `test_adapters_robustness.py` (4 tests); the same tests fail against the old `adapters.py`.
* Reviewed and fine: `Network` in `market_discovery.py` (requests counted and deadline-bound, redirects refused, no retries, body reads time- and
  byte-bounded, HTTP 429 halts the run, robots rules and a capped crawl-delay respected). JobSpy block handling is being changed on
  `codex/jobspy-refusal-detection`, so it was left alone.

## Segment 6: frontend (10:36 UTC)
* Crawled Dashboard, Farhan, Sana, Analytics, Applications and Settings at 1440 px and 375 px (isMobile, touch) against a local server with seeded data:
  zero console errors, zero failed API requests, zero horizontal overflow, no off-screen elements; screenshots of the dashboard and a candidate workspace
  checked by eye (layout holds at phone width, nothing clipped).
* Fault injection (API replaced by 503, 500, dropped connection, captive-portal HTML with 200): all show "Unable to connect to Career Job Engine backend",
  no blank page. Slow API (6 s) shows "Loading…" and recovers.
* DEFECT FIXED: a 200 answer in the wrong shape (`{}`, `[]`, `null`) threw during render and left a blank white page (`E.filter is not a function`,
  `Cannot read properties of null`). Realistic after an update when a cached bundle meets a newer API. There was no React error boundary. Added
  `components/ErrorBoundary.tsx` (plain message plus a Reload button, nothing sent anywhere) wrapped around `<App />` in `main.tsx`.
* New `test/e2e/faults.e2e.mjs` (local only, like the other browser suites): 7 scenarios x 2 checks. New build passes mobile and desktop; the
  build without the boundary fails 6 of 14, so it detects the regression.
* Observation, not changed (owner's call): the Dashboard card says Farhan has 40 READY / 41 STRETCH / 121 TO REVIEW while his workspace says 39 / 40 / 119.
  Both are right: the overview counts every job, the workspace excludes jobs applied to or dismissed. A visitor will see two different numbers with no explanation.
* The 503 message is the generic "Unable to connect" rather than the server's own wording ("temporarily unavailable"); fine for now.

## Segment 7: security and privacy (11:35 UTC)
Checked and fine:
* Secrets: scanned the working tree and every commit (433) for cloud, GitHub, Slack, JWT, private-key and long key-like strings: nothing but the unit-test
  constant `unit-test-key-not-a-secret`. No CV or document files are tracked (the only "cv" file is migration 0017, which holds skill lists).
* Public API: requested every GET route for both candidates with three query shapes (234 requests, 110 public 200s, 393 distinct JSON keys) against a
  database seeded with private markers (notes, resume text, private city): no marker, e-mail, stack trace, SQL error or path in any body, success or error.
  Reviewed the key list by eye: the sensitive-sounding ones are `citizenship` (country only), `manual_override_status` (a status, not the reason),
  `eligibility_reason`/`qualification_reason` (system text) and `contact_email` (empty).
* Login limiter: 8 wrong keys get 403, the 9th 429; the right key is also refused while that address is locked; another address is unaffected;
  `X-Forwarded-For` is ignored; a key in the URL is ignored. Lockout is per address (IPv6 per /64), so one person cannot lock out everyone.
* Share links: 192-bit random token (`crypto.getRandomValues`), only its SHA-256 stored, shown once, revocable. Logging records the path only.
* `/apply` re-render escapes hostile input (no raw script or `onerror`); links must start with `https://`.
Fixed (commit with this entry):
* LATENT LEAK: public `GET /api/profile` returned `education: cand.education || facts.education_detail`, so for a candidate with no stored education it
  published the full built-in line (college name and graduation year, e.g. "BMS in Marketing, NM College (University of Mumbai), 2017"). Every other endpoint falls
  back to blank. The public answer now falls back to the short label only; the operator view is unchanged. New test `QA: a visitor never gets the full built-in
  degree line` fails on the old code. Production may already be unaffected if both candidates have a stored value (release run 44's privacy check passed there),
  but nothing in the code guaranteed it.
* Defence in depth: the operator inbox only renders an applicant's link as a link if it starts with `https://` (the server already enforces this).
Open, for the owner:
* The two candidates' employer, role and date history, and degree details, are written into `dashboard/worker/index.ts` as built-in profile data. The repo is private
  and the public API does not serve it, but it must be removed from the code (kept in D1 only) before the code is shared with, or sold to, anyone. Also
  `migration/source-commits.json` contains the owner's git e-mail.
* `/api/profile` still returns the stored `education` value as saved; whether that stored text should be the short label is the owner's call.

## Segment 8: reliability (12:35 UTC)
Method: the real Worker in the test harness with a database whose every call throws one of four messages (the free-tier read limit, "network connection
lost", a Durable Object reset, and an unrecognised error), then requests of every kind plus the 2-minute cron.
Good: data routes answer 503 with `Retry-After: 300` and the friendly JSON; `/api/version` and `/api/brand` still answer; the marketing site (`/`, `/pricing`,
`/faq`, `/apply`, `/robots.txt`) renders without D1; an unrecognised error stays a plain 500 with no detail; the correct operator key still signs in during an outage.
Fixed:
* The login limiter FAILED OPEN when D1 was unavailable: the table lookup threw, was logged, and wrong keys were not counted at all, so guessing was unlimited
  for the length of an outage. Now a per-isolate in-memory counter (same limit, same window, same "identical wrong key is not a new guess" rule, capped at 5,000 addresses)
  takes over when the table cannot be reached. Weaker than the shared table (each isolate counts separately) but never worse than no limit.
* `scheduled()` rethrew the D1 error on every tick, so a quota outage produced a failed-invocation entry every 2 minutes. A database failure is now logged once as
  `cloud_discovery DB_UNAVAILABLE` and the tick returns; the next tick retries. Any other error still throws so real bugs stay loud.
* Tests: `QA: with D1 down the login limiter still limits ...`, `QA: repeating the identical wrong key ...`, `QA: the cron skips a tick quietly ...` (the first and last fail on
  the old code), and `lease: a second tick while one holds the lease is skipped ...` (the lease logic was correct but untested).
Migrations: applied each of the 17 files a second time to a finished database. All re-run cleanly except `0004_broad_discovery.sql` (SQLite cannot `ADD COLUMN IF NOT EXISTS`;
Wrangler records applied migrations so it is not re-run). No re-run changed any row count, so the data migration `0017` is idempotent.
Not covered: real D1 behaviour under load (the harness is SQLite), GitHub workflow retries, the Cache API backup (needs a custom domain, see KNOWN_ISSUES).

## Segment 9: reselling readiness (13:35 UTC)
Walked the whole client lifecycle in the harness (real Worker, seeded database):
form `POST /apply` (303) -> operator sees the request -> `POST /api/clients` -> request linked and marked CONVERTED -> backfill loop screens every active job
(qualification and score rows equal the active job count) -> share link -> anonymous callers cannot see the client (same answer as an unknown id) -> the link
shows the client their own jobs and a CSV export -> client profile through the link has the public shape (no pay line, no employment history) -> revoke -> the old link
stops working. All steps passed.
Gap found and fixed: `GET`/`POST`/`PUT` existed for clients but no `DELETE`, while the privacy notice says "Ask us ... to have everything deleted; we delete it from our database".
After a manual "delete" nothing could be removed through the product: the candidate row (name, skills), 4 screening tables, share links, `client_profiles` and the application
record in `client_requests` (e-mail, phone, link; that table has no foreign key, so even a cascade would have missed it) all remained.
Added `DELETE /api/clients/:id` (operator only): one atomic batch over 10 client tables, matching cached answers, then the candidate row; built-ins and unknown ids are refused
with 400; the registry and cache generation refresh; a second call answers "unknown client". Test `QA: DELETE /api/clients/:id erases the client ...` checks every table that has a
`candidate_id` column ends at zero for that client while another client and the built-ins keep every row, the share link dies, and an anonymous caller gets 401.
Open for the owner (documented in KNOWN_ISSUES.md):
* Onboarding write cost: 2 rows per active job; the UI's "screen all" caps one click at 6,000 jobs (about 12,000 writes) but a full catalogue (22,000 jobs, about 44,000 writes) plus
  the daily import can pass the free tier's 100,000 daily writes. No Worker-side daily write counter exists (reads have one). Options: spread onboarding, screen only jobs matching the
  client's role keywords, or add a write meter.
* No "Delete client" button in the dashboard (API only), deliberately: a destructive action should get its own confirmation design.
* Other reselling items not built: per-client limits (number of clients, share links, jobs), billing, a client-facing audit trail, and per-client data export other than the CSV of jobs.
