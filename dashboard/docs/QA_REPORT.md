# Final QA report

This report covers the public read-only dashboard release (see "Production release" at the end for the deployed version and production results). Environment labels used throughout:

* **SQLite unit** = the real `worker/index.ts` on in-memory SQLite with the real migrations (Node 22).
* **Local D1** = `wrangler dev --local` (workerd + Cloudflare's local D1 engine) with disposable seeded data.
* **Browser** = Chromium driven by Playwright against the Local D1 stack, desktop 1440x900 and mobile 375x812.
* **Production** = the live Worker. Only anonymous GETs and one empty-key `POST /api/auth/verify` were made.

## What was verified, and where

| Area | Evidence | Environment |
|---|---|---|
| Every `/api` route refuses a request with no key (401), wrong key (403), unset server key (503, fail closed) | route sweep derived from the source, so a new route cannot be missed | SQLite unit; Local D1 |
| Unauthenticated writes change nothing (applications, history, overrides, profile) | before/after snapshot | SQLite unit |
| Guess limiter: 8 distinct wrong keys per 15 min per address then 429 (correct key included); identical repeated key counts once; other addresses unaffected; window expiry; success clears; missing table never locks out or weakens auth; `X-Forwarded-For` ignored; idle rows trimmed | 6 tests | SQLite unit; browser (lockout through the UI) |
| Candidate isolation: scoped routes need a known `candidate_id` (400 otherwise), path/body mismatch is 409, India Remote and cohort ledger follow the selected candidate | tests + code review of every frontend call | SQLite unit; browser |
| Overlapping requests: a slow Farhan response cannot overwrite Sana's workspace or Analytics | Farhan requests delayed 2.5 s while switching | Browser (desktop and mobile) |
| Counts: active-only inventory, applied stage vs tracker records, no invented totals, analytics one scope; API figures equal direct SQL | tests; 300-job seed compared with SQL | SQLite unit; Local D1 |
| Duplicate application rows cannot inflate job totals, lists, pagination or source counts | unique index dropped, duplicates inserted, counts compared | SQLite unit; Local D1 |
| Public bundle holds no candidate profile data, secrets or Cloudflare identifiers | denylist test on `frontend/dist` | Build output |
| Unlock / invalid key / lock / reload / stale key / expired session / candidate switching / limiter message | 27 checks per viewport | Browser |
| Collector sync path does not use the Worker API | code reading (`wrangler d1 execute --remote`) plus a real importer run into a local D1 while the authenticated Worker was up | Local D1 |
| Protected-record preservation | `scripts/fingerprint.mjs` (field-level SHA-256 of applications, history, overrides, candidates) is run before and after by the release workflow | Run locally; remote run pending release |
| Clean checkout builds and passes | fresh clone of the branch, `npm ci && npm run verify` | CI-equivalent |

## Independent review

Two reviews by a reviewer context that did not write the code (a separate session given the diff, the acceptance
criteria and no conclusions). Round 1 (commit `4cfc591`) found a candidate leak on the India Remote list and five smaller
problems; all were fixed. Round 2 (commit `fe28b97`) found no authentication bypass and these defects, all fixed in the
following commit: a stale browser key could burn 7 of the 8 allowed attempts in one page load; some `/api/candidates/:id/*`
routes did not validate the candidate; invented fallback totals remained in the frontend; candidate-switch left old
counters; the release step could hide a failed deploy (no `pipefail`); partial profile saves overwrote stored values.
A third, targeted re-check of those fixes: see the end of this file.

The reviewer is a model session, not a human, and had no Cloudflare or production access.

## Not verified

See `KNOWN_ISSUES.md` ("Not verified"): remote D1, billing and usage, production timings, authenticated confirmation that
`ADMIN_API_KEY` exists, the first scheduled sync after release.

## Bugs the tests found in the first release candidate (now fixed)

The unlock window never opened (the handler was empty); the India Remote "save" wrote to Farhan whoever was selected;
the Applications ledger showed Farhan's numbers for Sana; the dashboard stayed empty after unlocking (it fetched once,
before the key existed); the page shipped employer, pay and city text in public JavaScript.

## Re-check of the round-2 fixes (commit `d7b7849`)

The same independent reviewer context re-verified the fixes and found no defects in them. It ran `npm ci && npm run verify`
(28/28 Worker and privacy tests, DST/authedFetch/settings regressions, migrations 0001-0008, build and Worker dry run) and
the browser suite on Local D1 (desktop 27/27, mobile 27/27). A single stale-key page load in a real browser made one refused
data request and one refused key check and left the failure counter at 1. Limiter probes on SQLite: one wrong key sent 60
times never locks out and then the real key works; alternating A,B,A,B and paired guesses lock after 8 distinct guesses;
the correct key is refused during lockout on both ordinary routes and `/api/auth/verify`; 20 concurrent requests over 3
keys are counted. Concurrency was exercised serially, not as true parallel D1 writers.

Minor residuals it noted, none blocking:

1. If an *older* draft of migration 0008 (without `last_key_hash`) had ever been applied somewhere, `CREATE TABLE IF NOT
   EXISTS` would not add the column and the limiter would fail open (authentication itself is unaffected). It was never
   applied to production; the release creates the table fresh. If it is ever found in the old shape, run
   `DROP TABLE auth_failures` first and then the release step.
2. The overview request still goes out in parallel with the stored-key check when a key is stored; both carry the same
   stale key and count once.
3. A key rotated mid-session produces in-flight refusals that carry the same key and count once.

Reviewed commit for this round: `d7b7849` (documentation-only commits follow it).

## Production release (public read-only dashboard)

* Repository: `farshaikh17/Codex` (dashboard under `dashboard/`); released commit `eb3e69a3755509038fc0c224167f7c6c0de638ae`
  (merge of PR #19 and the workflow fix PR #20). Release run: <https://github.com/farshaikh17/Codex/actions/runs/42063986532>.
* Deployed Worker version `73ef33b7-274a-4902-8513-e9b0c79afb57` at 2026-11-05T16:25:17Z. `GET /api/version` reports commit
  `eb3e69a3...` and that timestamp (the `--var DEPLOYED_AT` value with colons is stored intact).
* Migration `0008_auth_failures.sql` applied (additive; 3 rows written); migrations 0001-0007 were not replayed. No seed migration, restore
  or second deployment. One schedule (`*/2 * * * *`) is declared.
* Before the release: preflight (run 42060776309) proved account and database match `wrangler.toml` and that the existing Codex token can read the Worker,
  its secrets, deployments, D1 and Time Travel.
* Independent code review (separate reviewer session, read-only): 8 confirmed defects, all fixed before release (public run-error text and rejection
  detail, sign-out leaving operator data on screen, a server hiccup signing the operator out, a keyless Save replacing the page, public-to-operator
  profile form, false-positive smoke patterns, one vacuous test removed), plus hardening (public list caps, IPv6 /64 limiter bucket, token scoped to the
  steps that need it, malformed percent-escapes, non-Bearer Authorization on a public read).

### Production results

| Check | Result |
|---|---|
| Release run public smoke test | 2 of ~70 checks flagged `"manual_override_reason"` in `/api/jobs` and `"notes"` in `/api/applications` on the **first** request of each type, within 2-3 seconds of the deploy. Not reproducible: 100 further requests (both candidates, jobs, tracker, profile) found no private key, and the follow-up verify run passed every check. Most likely the previous Worker version still answering briefly during propagation (the previous Worker served those fields to everyone). Not proven. |
| Verify run (read-only, run 42066342092) | public smoke test passed, including anonymous GETs of audit/run/backup/meta/sync routes (401) and anonymous POST/PUT of applications, profile, automation, override, feedback, resume import (401) |
| Real-browser check, production, GitHub runner | desktop 26/26, mobile (375 px) 26/26: no unlock window, no key sent, no refused request, both candidates' workspaces, Analytics scope, profile summary and tracker free of private text, bundle holds no profile data, no write attempted, no console errors |
| Same check from the development environment | desktop 26/26, mobile 26/26 |
| Protected records, before vs after | identical: applications 12 rows (`d594d21e...`), application_history 44 (`221fc998...`), manual overrides 11 (`43499257...`), candidates 2 (`08c63807...`); qualifications 4246 and scores 4246 also identical (the collector had not changed them) |
| Collector continuity (manual) | sync run 42066372766 (workflow_dispatch, 16:37 UTC, after the release): success; the importer writes straight into D1 and does not use the Worker API |
| Collector continuity (scheduled) | **Not yet observed after the release.** The last `event: schedule` run before it was 42050115956 (14:57 UTC, success). Scheduled runs have started 1-3 hours after the nominal :45 slots and some slots did not run at all (for example no scheduled run between 01:48 and 14:57 UTC on 2026-11-05), so the first post-release scheduled run is expected later today. Check `Sync Collector Postings to Cloudflare D1` for an `event: schedule` entry newer than 16:25 UTC. |

### Limitations observed in production

* The Worker's own discovery cron (`*/2`) writes a run row only when it does work. Today's source-page budget (48/48) was spent by 06:22 UTC and the
  posting queue is empty, so ticks are idle and leave no evidence until the daily budget resets at 00:00 UTC. The last recorded run (06:22 UTC, a
  Greenhouse source error) predates the release.
* Whether the existing Cloudflare token can deploy was proven by the deploy itself; Workers Scripts write permission is therefore confirmed.


## Production releases of 2026-11-06 (after the D1 daily read-limit reset)

| | Release 1 (PR #26: cache, read meter, query fix) | Release 2 (PR #28: ranking correction, Sana wording, UI) |
|---|---|---|
| Commit / Worker | `0dcff71` (main at the time; code of PR #26), deployed 00:04:01 UTC | `efdcb7c`, deployed 00:19:05 UTC |
| Workflow runs | preflight 42133687913, release 42133904922, verify 42134563242, diagnose 42134915250 | preflight 42135603612, release 42135783491, diagnose 42136407653 |
| Result | Deploy, cache flush and public smoke test passed. The first release run's browser check failed 1 of 26 checks (Sana READY card showed 0, API 2). A verify run on the same commit passed desktop 26/26 and mobile 26/26; a manual run from outside GitHub passed twice. Cause not proven; most likely the card shows 0 until the first jobs query returns after a cache flush. The check now waits up to 20 s for the card to settle. | All steps green: deploy, correction (after the deploy), cache flush, smoke test, desktop and mobile browser checks, protected-record comparison. |
| Protected records | applications 12 `d594d21e`, history 44 `221fc998`, overrides 11 `43499257`, candidates 2 `08c63807`, qualifications 4276, scores 4276: identical to the baseline in the verify run | applications, history, overrides, candidates identical before and after (the workflow compares and fails on any difference) |

Score correction (release 2, run after the deploy): 317 stored preliminary rows examined; 52 scores lowered (1 Farhan avoid-list cap, 50 Farhan foreign-location, 1 Sana) and 7 Sana rows changed from ELIGIBLE (city only) to UNKNOWN; 59 SQL statements, about 111 rows written. A dry run afterwards examined 265 rows and planned 0 changes. No status, lane, override, application or history row was written.

D1 usage measured by the diagnose runs (UTC day 2026-11-06, which started at 00:00):

| Time | Dashboard read meter (rows read by cache misses) | Public cache misses |
|---|---|---|
| 00:12, after release 1 and its checks | 321,609 | 27 |
| 00:24, after release 2 and its checks | 642,990 | 52 |

The `d1 info` field `rows_read_24h` (9.99M, then 10.37M) is a rolling 24-hour window that still contains the previous day's incident traffic, so it is not today's figure. The 1-hour insights list at 00:24 shows the same pattern: the largest cost is the per-candidate status-count query (about 32,000 rows per run) and verification traffic (fingerprint queries read 4,276 rows each). The first 25 minutes after reset, almost entirely release and verification traffic, used roughly 0.64M rows (about 13% of the 5M daily allowance). **This does not yet show steady-state usage with real visitors, cron and collector activity over a full day; the free-tier problem is mitigated and bounded by the read meter (public budget 2.5M rows per day), not proven resolved.**

Observed in the Worker log during diagnose: the 2-minute discovery cron recorded one failed work unit ("Posting missing title or official HTTPS application URL"), kept in the durable run history. Not investigated further.

Known gap in the table-count query of diagnose mode: it returned an API error on 2026-11-06 (the error is now shown, not hidden); the job inventory queries beside it worked.

## D1 usage by UTC day, measured 2026-11-09 00:12 UTC (diagnose run 42538823105)

Two different numbers, and they must not be mixed up:
* **Account usage** is Cloudflare's own analytics for the database. It counts every client (the Worker's visitors and 2-minute cron, the collector sync, the daily discovery and watchlist imports, release checks, diagnose runs). **This is what the free limits (5,000,000 rows read, 100,000 rows written per UTC day) apply to.**
* **The application read meter** (`read_meter`) counts only rows read by the Worker's own cache misses (public and operator). It excludes cache lookups, the cron, the collector sync, imports run through `wrangler` and diagnose queries. The public cap (`PUBLIC_DAILY_READ_BUDGET`, 2,500,000) is judged on the meter only.

| UTC day | What happened that day | Account rows read | Account rows written | Meter rows read (public misses) | Gap (account minus meter) |
|---|---|---|---|---|---|
| 2026-11-05 | incident day, old Worker | 9,687,915 | 11,760 | n/a | n/a |
| 2026-11-06 | four releases, QA, the public cap tripped at 2,553,470 | 3,125,694 | 24,391 | 2,553,470 (192) | about 0.57M |
| 2026-11-07 | discovery runs 1 and 2 with the new import (no budget guard yet), then the quota ran out about 02:24 | **17,026,513** | 54,927 | 2,057,557 (189) | **about 15.0M** |
| 2026-11-08 | **not a normal day**: three releases (00:21, 03:03, 03:16 UTC), three diagnose runs, browser checks, first discovery run with the fixes (19:40 UTC) | 2,102,528 | 69,341 | 1,352,196 (138) | about 0.75M |
| 2026-11-09 (to 00:12) | fresh day | 14,953 | 315 | n/a | n/a |

**Cause of the 2026-11-07 overrun (inference, strongly supported):** about 15M of the 17.0M rows were not Worker reads. The import's copy-collapse statement looked up each job's best score with a subquery over `candidate_job_scores`, which has no `job_id` index, so it scanned all ~5,700 score rows once per in-scope job (~1,400 jobs): roughly 8-16M rows read in a few seconds. It ran inside discovery run 2 (02:03 UTC), and the quota was exhausted at about 02:24. Fixed in PR #45 (one grouped join; 38 s to 0.05 s on a 22k-job local copy) and bounded by the budget guard (PR #42). It is an inference from the arithmetic and the timing, not a direct measurement; the 8 Nov figure of 2.10M, with the same discovery code path running once (19:40), is consistent with it.

**Headroom on 2026-11-08:** meter 2,500,000 - 1,352,196 = 1,147,804 below the public cap (the cap did not activate); reads 5,000,000 - 2,102,528 = 2,897,472; **writes 100,000 - 69,341 = 30,659 (69% used)**. Writes, not reads, are now the tighter limit on a busy day: the Worker's assessment cron wrote 21,220 rows to `candidate_qualifications` and 10,036 to `candidate_job_scores` in one day (5,305 and 5,018 statements), mostly working through the collector-import backlog (now 101 rows for Sana, 0 for Farhan; it was 771 and 929 on 2026-11-08 00:17 UTC).

**Per-query evidence (insights, last 24 h at 2026-11-09 00:12):** the largest readers are still the Worker's listing and count queries at roughly 5k-17k rows per call (for example the list-id query at 13,329 rows x 24 calls = 320k; the eligibility/salary facet count at 5,242 rows x 18). Together the top twelve account for under 1.0M of the day's 2.1M.

**Database after 2026-11-08:** jobs 3,699 (3,553 active), qualifications and scores 5,921 each, applications 12, history 44, cache entries 112, auth failures 0. Jobs first seen 2026-11-08: 213; 2026-11-07: 1,298. Queue DONE 297, FAILED 5, PENDING 6; last-day runs 71 posting and 50 source successes, 1 posting and 1 source error.

**Remaining errors:** five `greenhouse:elastic` postings return HTTP 404 upstream (they ended FAILED then; since 6 Nov an upstream 404 ends as GONE, and migration 0025 marks those older FAILED 404 queue rows GONE too); `lever:gohighlevel` timed out once; `greenhouse:canonical` is disabled by design (the board exceeds the 512 KiB free-tier processing budget). The free AI review is off: the free model provider was retired on 2026-07-30 (probe run 42518603571 saw HTTP 200 text/plain "OK").
