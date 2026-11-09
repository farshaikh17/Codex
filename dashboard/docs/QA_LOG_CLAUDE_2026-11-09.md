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
