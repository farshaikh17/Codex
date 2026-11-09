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
