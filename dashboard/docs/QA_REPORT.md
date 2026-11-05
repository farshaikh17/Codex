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

Two reviews by a reviewer context that did not write the code (a separate Claude session given the diff, the acceptance
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

