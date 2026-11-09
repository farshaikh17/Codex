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
