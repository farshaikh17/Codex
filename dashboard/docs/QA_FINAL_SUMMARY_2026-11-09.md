# Final QA summary, 2026-11-09 (Claude, technical QA only)

Scope rule from the owner: the engine never decides whether a job suits Farhan or Sana. Everything here is about whether the engine works. Nothing in this summary has been deployed:
the live site is still commit `5832c43`. Branch: `ccr-31e055c3-e2y6ub` (18 commits, 34 files, no pull request yet). Details per segment: `QA_LOG_CLAUDE_2026-11-09.md`; schedule and evidence:
`QA_SCHEDULE_2026-11-09.md`; what needs a decision: `OWNER_DECISIONS_2026-11-09.md`.

## Completion round (evening of 2026-11-09): integration, verification and the two open concerns
**Exact integration commit: `732897124cdbb886282c41620fb320716582de78`** (branch `qa/integration-2026-11-09`, base `origin/main` `75a092e`; 45 commits, 54 files, +1,566/-88).
* Included: this QA branch at code commit `bf94461` (all QA fixes and tests) and ChatGPT's #64 (`d617c80`, account-wide budget), #63 (`23d0bb2`, JobSpy refusals), #65 (`7188101`, links and import limit), #66 (`a5d3abb`, decided jobs in liveness).
* Excluded and kept separate: **#62** (`0564b93`, a screening-rule change) and **#67** (`0e80185`, removes the title-and-employer collapse: right for distinct cities, but it brings back near-duplicate rows that cost writes and list reads; an owner trade-off).
* Checked on the combined diff: no stray or sensitive file, no secret, no `.only`/debugger, no migration, no schema change; `evaluate()` (lines 227 to 328 of `discovery.ts`) is untouched (the file differs only inside `backfillClient`); the only file edited by two merged branches is `budget_guard.mjs` (my warning line plus #64's rewrite; read, coherent, tested).
* Docs-only commits made after `bf94461` on this branch (this summary, `COST_MODEL_2026-11-09.md`, corrections, patches) change nothing the integration commit tests: `git diff bf94461 HEAD --stat` lists only `dashboard/docs/**`.

### The two concerns, with an explicit disposition each
| Concern | Disposition | Evidence |
|---|---|---|
| A token-authorized private-candidate response entering a URL-only outage cache and later returned without authorization | **CONFIRMED, scope narrowed, FIXED** | Reproduced with a fake Cache API: the share-link holder's `GET /api/candidates` and `/api/dashboard/overview` were stored under the URL alone; with D1 refusing queries an anonymous visitor received them (`X-Cache: STALE-OUTAGE`) including the private client's profile entry. URLs naming the client (`/api/jobs?candidate_id=...`, `/api/profile?...`) did not leak (unknown id -> 400). Reachable only where the Cache API works (a custom domain; not `*.workers.dev`). **Red:** on unfixed `main` (`75a092e`) the regression test exits 1 (`pass 0, fail 1`). **Green:** on `7328971` it exits 0. Fix: requests carrying `X-View-Token` are never stored. Residual: a client made private after an anonymous copy was stored stays in that copy until it expires (3 days). |
| Unsave deleting newly added notes, or reporting success and recording history when nothing was deleted | **CONFIRMED (both sequences), FIXED** | With a change injected between the handler's check and its batch: (a) a note added in between was deleted with the record; (b) a status moved to APPLIED in between left the record, yet the answer was `200 {unsaved:true}` and a false `UNSAVED` history row was written. **Red:** on unfixed `main` the regression test exits 1 (the note was lost; `pass 1 fail 1`, the ordinary-cases test passes). **Green:** `7328971` exits 0 (3 of 3). Fix: both statements repeat the rule inside the atomic batch; a delete that changed nothing answers 409. My first reproduction was wrong (the injected change fired during the save); it was caught by asserting the injection happened at the right moment. |
No duplicate fix existed: neither `main` nor any `codex/*` branch contained either change (checked by searching each tip).

### Other confirmed defects fixed (all on this branch; each with a test that fails on the old code)
Public profile fell back to the full degree line; login limiter failed open while D1 was down; the cron failed loudly every tick of an outage; one malformed feed value failed a whole board; a wrong-shape answer blanked the app (error boundary); no way to delete a client; 787 low-contrast elements and keyboard-unreachable job rows; identical job-button names; CORS reflected any origin; junk paging parameters caused a 500; CI never ran 9 Node test files and 3 Python tests.
**New this round: the onboarding backfill scanned every active job on every call** (11.15 million job rows to onboard 21,120 jobs in the local model; now 21,647, 515 times fewer; see `COST_MODEL_2026-11-09.md`). **Draft pull request for this branch: https://github.com/farshaikh17/Codex/pull/68** (draft, not merged). Isolated branches (one commit each on `main` `75a092e`): `qa/outage-backup-share-link`, `qa/unsave-race`, `qa/job-row-button-names`, `qa/backfill-cursor`; patches in `dashboard/docs/qa-patches/`.

### Disproved, retracted or narrowed
* ChatGPT's outage-cache concern is narrower than stated: candidate-specific URLs do not leak. The leak is the two list-style answers.
* My earlier theory that the shared concurrency group drops scheduled runs: disproved (drops happen while nothing else runs).
* My earlier "about two rows written per job" for onboarding: wrong (index entries omitted); it is about nine. My earlier "150,000 rows per list miss": revised (see the cost model).
* ChatGPT's "budget guard may undercount": the code does filter by one database (confirmed), but no undercount is demonstrated (the second database is 24 KB, one database in the analytics).
* `dashboard/legacy/test_*.py`: not defects, dead files (one defines no tests, one hard-codes a Windows path; the README calls the folder unused).

### Verification at the exact commit `7328971` (commands, exit codes, counts)
| Command (in `dashboard/` unless stated) | Exit | Result |
|---|---|---|
| `npm ci` in `dashboard` and `dashboard/frontend` | 0, 0 | clean install |
| `npm run verify` (frontend build, Worker dry-run, Node tests, side scripts, migration chain) | 0 | **214/214** Node tests; "migration chain OK"; "0009 re-applied idempotently" |
| CI's exact Python command (network disabled), repo root | 0 | **357 run, 0 failures, 0 errors** |
| `python3 registry.py` | 0 | ok |
| browser.e2e desktop / mobile | 0 / 0 | 31/31, 31/31 |
| production-readonly desktop / mobile | 0 / 0 | 33/33, 33/33 |
| faults desktop / mobile | 0 / 0 | 14 passes each |
| a11y | 0 | 33 passes, 0 fail |
| site.e2e desktop / mobile | 0 / 0 | 20/20, 20/20 |
| post-deploy smoke (local server) | 0 | 57 passes |
| listing desktop / mobile | 0 / 0 | 48/48, 48/48 |
| clients desktop / mobile | 0 / 0 | 18/18, 18/18 (also exercises the new cursor through "screen all") |
Browser suites ran against a local `wrangler dev` with disposable data. **They are manual: CI (`dashboard-verify`, `tests.yml`) does not run them**, and the release workflow runs only the read-only production check.
**Test-state cleanup required:** a fresh local database per seed group (`test/seed-sql.mjs`, then `test/e2e/listing-seed.mjs`); `DELETE FROM auth_failures` after `browser.e2e` (it locks the local limiter on purpose; skipping it makes `site.e2e` fail with "282 vs undefined"); `delete globalThis.caches` after Cache-API tests; remove `.tmp-d1` and `.dev.vars`.

### Test discovery: do the added tests actually run?
* Node: `npm test` is `node --test test/*.test.mjs ...`: 17 files at `7328971`, per-file counts sum to 214, the glob run reports 214, `verify` reports 214. **Negative control:** a deliberately failing `test/zz_probe.test.mjs` makes `npm test` exit 1 (`# tests 206, # fail 1`); removed, exit 0 (205).
* Python: CI discovery loads 30 of 39 `test*.py` files. **Negative control:** a failing probe in the repo root, `tests/` or `engine/` makes CI's command exit 1 (353 run, 1 failure), so added tests there DO run; a probe in `dashboard/` or `experiments/` exits 0 and is never run. Not discovered: `dashboard/test_migration_chain.py` (run by `npm test` instead), `experiments/test_*.py` (76 tests, pass, run only by the manual `recruiter-experiment` workflow) and two dead files in `dashboard/legacy/`.
* Not run by CI at all: every `test/e2e/*.e2e.mjs`. An unexecuted check is not counted as passing anywhere in this report.

### Remaining unresolved, with concrete blockers
1. **Nothing was observed on the live site** (blocker: the sandbox's egress policy refuses `career-job-engine.farshaikh17.workers.dev`; the owner can allow that host for read-only requests). So: `/api/version` unread; the source commit of active Worker version `b4bba92c-c7a1-4c2e-852d-6e5cca3e50a7` is **not established** (best evidence: the newest release run is #44 on `5832c43`, finished 01:02 UTC, Worker last modified 00:58:48 UTC).
2. **No per-request production cost measurement** (blocker: only aggregate analytics are readable; per-query `rows_read` would need to be captured from the Worker or the dashboard). All costs in `COST_MODEL_2026-11-09.md` are labelled local models plus documented accounting.
3. **Production active-job count unknown**, so the onboarding write and read estimates are given as functions of N rather than one number.
4. **Outage backup effectiveness** cannot be tested without a custom domain (the Cache API is not active on `*.workers.dev`).
5. **Time Travel restore not exercised** (destructive; needs Wrangler credentials). Documented retention: 7 days on the free plan.
6. Browser suites are manual; `dashboard/legacy` tests are dead; `experiments` tests run only manually.

### Release recommendation (evidence only; owner decisions are listed after it)
**Recommend releasing the integration set** (this branch plus #63 to #66) after the owner reviews and merges, because: every automated suite passes at the exact commit with exit 0 and matching counts; no migration or schema change and no candidate rule or decision changed; two confirmed privacy/integrity defects and one defect that could burn the whole daily read allowance are fixed with tests that fail on the old code; rollback is a redeploy of `5832c43`. Run the release workflow's own preflight and verify modes, and check its browser step, before and after. Not established: live behaviour (blocker 1).
Visible or behavioural changes the owner should be aware of before releasing: darker greys and accents; CORS now limited to the site's own origin (an outside page reading the API from a browser stops working); a new operator-only `DELETE /api/clients/:id`; the onboarding backfill now screens newest-first by insertion order (rowid) in cursor-driven batches; the dashboard refresh button now only re-reads data.

### Owner decisions (separate from the recommendation)
Whether to merge #62 (screening wording: with it, "No sponsorship. Relocation assistance provided." and "Sponsorship is not offered ... for other roles" still screen ELIGIBLE) and #67 (duplicates versus distinct openings); the "Can apply (confirmed)" wording; a custom domain for the outage backup (and a shorter backup lifetime); moving the two candidates' history out of `worker/index.ts`; onboarding limits (role-keyword-only screening or a daily write meter) and the second-client timing; whether the Worker's cron may start GitHub workflows; self-hosting the fonts; scheduling or retiring the page crawl; deleting `dashboard/legacy`; and approving the visible changes listed above.

## Final regression (this branch, 16:35 UTC)
| Check | Result |
|---|---|
| `npm run verify` (frontend build, Worker dry-run, all Node tests, migrations applied and re-applied) | exit 0, 196/196 |
| Python (CI-style discovery) | 352 run, 0 failures |
| browser.e2e (visitor, operator, limiter) | 31/31 desktop, 31/31 phone |
| production-readonly rehearsal of the release browser check | 33/33 and 33/33 |
| faults (API errors, dropped connection, wrong-shape answers) | all pass, both widths |
| a11y (axe on 9 public pages + every screen + keyboard open/close) | all pass |
| site, listing, clients suites | 20/20, 48/48, 18/18 per width |
| post-deploy smoke | all pass |
| Combined code: `origin/main` + ChatGPT's six drafts + this branch | no merge conflict; 205 Node and 357 Python tests pass |
Two suites needed care, not code: `browser.e2e` deliberately locks the local login limiter at its end (the docs say to clear `auth_failures` before the next run; `site.e2e` fails with a cryptic
"282 vs undefined" if you do not), and `clients.e2e` had stale selectors (fixed).

## What was fixed (each with a test unless noted)
1. Privacy: the public profile could show the full college-and-year line when the stored text was empty (segment 7).
2. Login limiter stopped counting wrong keys while D1 was down; the 2-minute cron failed loudly on every outage tick (segment 8).
3. A malformed feed value (number where a list belongs) failed a whole employer board or ended a discovery pass (segment 5).
4. A wrong-shape answer left a blank white page; there is now an error boundary (segment 6).
5. No way to delete a client although the privacy notice promises it: operator-only `DELETE /api/clients/:id` (segment 9).
6. Accessibility: 787 low-contrast elements, unlabelled controls, colour-only links, job rows unusable from the keyboard (segment 10).
7. CORS reflected any origin; security headers added; junk paging parameters caused a 500; two dead buttons (Sync/Refresh, Reverify) fixed (segments 1 and earlier).
8. CI never ran 9 Node test files (four from ChatGPT) and ChatGPT's 3 Python tests; now it does (segment 11). Stale browser tests brought up to date.
9. Re-score SQL: a 400-row randomized property test now proves protected rows never change (segment 4).
A first attempt to change screening rules (sponsorship wording) was reverted: that is the owner's call, not QA's.

## Compared with ChatGPT's notes (six draft pull requests #62 to #67)
* Same finding, found separately: the budget guard must count the whole Cloudflare account, not one database (its #64; my segment 2). It also validated the GraphQL query against the live account, which I could not.
* Complementary: its #66 (decided jobs protected during liveness checks) and #67 (stop collapsing same-title jobs) cover import behaviour I only tested for the re-score; its #63 fixes JobSpy refusal detection.
* Its tests are honest about being unverified ("CI pending", "no production data changed"). They were not running in CI until my segment 11 fix; all of them pass.
* Not yet resolved between us: with its #62 applied, "No sponsorship. Relocation assistance provided." and "Sponsorship is not offered ... visa sponsorship available for other roles" still classify as
  ELIGIBLE (my probe, segment 3 of the first pass). Whether that matters is a screening-rule question for ChatGPT and the owner.
* Neither of us could see live usage figures or the live site from the sandbox (mine) / had less to say about the front end and reselling (ChatGPT's PRs are all in the importer and screen).

## What this QA did not cover
Live-site behaviour and real D1 timing (the sandbox cannot reach production); the cause of the 7 Nov overrun (needs the analytics token); the run 42 browser flake; screen readers, high contrast and
200% zoom; billing, per-client limits and a client-facing audit trail (not built); the outage backup (needs a custom domain or KV); real-device performance.

## Next steps, in order
Review and merge #62 to #67, open and merge the QA branch, run the release workflow once, then work through `OWNER_DECISIONS_2026-11-09.md`.
