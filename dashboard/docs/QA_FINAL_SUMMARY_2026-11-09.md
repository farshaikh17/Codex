# Final QA summary, 2026-11-09 (Claude, technical QA only)

Scope rule from the owner: the engine never decides whether a job suits Farhan or Sana. Everything here is about whether the engine works. Nothing in this summary has been deployed:
the live site is still commit `5832c43`. Branch: `ccr-31e055c3-e2y6ub` (18 commits, 34 files, no pull request yet). Details per segment: `QA_LOG_CLAUDE_2026-11-09.md`; schedule and evidence:
`QA_SCHEDULE_2026-11-09.md`; what needs a decision: `OWNER_DECISIONS_2026-11-09.md`.

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
