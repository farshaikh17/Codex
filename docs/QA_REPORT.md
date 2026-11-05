# Final QA report (pre-production)

Commit under test: see "Reviewed commit" below. **Production has not been changed.** Environment labels used throughout:

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
