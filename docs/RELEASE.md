# Release plan: operator authentication, per-candidate analytics, guess limiter

Status: prepared on branch `qa-fixes`. **Nothing here has been run against production.**
Cost: free tier only (Workers, D1, Actions manual runs). No paid binding, rule or add-on is used or assumed.

## What changes in production

| Area | Change |
|---|---|
| Worker | Every `/api/*` route except `health`, `version` and `auth/verify` needs `Authorization: Bearer <ADMIN_API_KEY>` (401 none, 403 wrong, 503 server key unset, 429 locked out). |
| Guess limiter | 8 wrong keys in 15 minutes from one client address locks that address for the rest of the window, correct key included. Stored as a SHA-256 of the address in table `auth_failures` (migration 0008). A missing table or D1 error never locks the operator out and never weakens the key check. |
| Analytics | Discovery funnel and source scorecard are computed per candidate from live data. All figures use one scope (active jobs). |
| Joins | Application records are aggregated per (candidate, job) before joining, so duplicate application rows cannot multiply job counts. |
| Frontend | Unlock window and lock button; 401/403 opens it and drops the stored key. Analytics follows the selected candidate. Wording fixes. |
| Database | One additive table (`auth_failures`). No existing table, row, application, override or history record is touched. |

## Preconditions (checked)

* `ADMIN_API_KEY` already exists in production. Checked without reading it: an empty-key `POST /api/auth/verify` returns 400 "key is required" (the unset case returns 503, and that check runs first). Its value was never displayed.
* The collector's sync path does not use the Worker's HTTP API. `engine/staging_bridge.py` runs `npx wrangler d1 execute career-job-engine --remote --file=... --json` with `CLOUDFLARE_API_TOKEN`, which talks to the Cloudflare API directly, so API authentication does not affect it. Verified by reading the code and by running the real importer against a local D1 while the authenticated Worker was up (5 postings, 10 qualifications imported; the Worker still refused anonymous calls).

## Secret handling

* Do not paste the key into chat, commits, issues, workflow files or `wrangler.toml`.
* If you still have the key (the dashboard unlock window used it), nothing needs to change.
* If you do not, rotate it. This reads from a prompt, not from the command line:
  `npx wrangler secret put ADMIN_API_KEY`
  Use a long random value (for example the output of `openssl rand -base64 32`), store it in a password manager, then use it in the dashboard unlock window.
* The key lives only in Cloudflare (Worker secret) and in the browser tab's `sessionStorage` while unlocked.

## Deployment steps (you run these; each is reversible)

Run from the repository root of `farhan-job-engine`, on a branch that contains the approved changes, signed in with `npx wrangler login` or `CLOUDFLARE_API_TOKEN` in your shell.

1. **Record the rollback point** (read-only):
   `npx wrangler deployments list` (note the current version id)
   `npx wrangler d1 time-travel info career-job-engine` (note the restore bookmark)
   Optional file backup kept outside the repository: `npx wrangler d1 export career-job-engine --remote --output ../career-backup.sql`
2. **Confirm the secret is set** without showing it: `npx wrangler secret list` (look for `ADMIN_API_KEY`).
3. **Add the limiter table** (idempotent, additive):
   `npx wrangler d1 execute career-job-engine --remote --file=migrations/0008_auth_failures.sql`
   Use this instead of `migrations apply`: production may not track migrations 0001-0007 in wrangler's ledger, and some of them insert rows.
4. **Build and deploy** (frontend assets ship with the Worker):
   `npm ci && npm run build:frontend && npx wrangler deploy`
5. **Smoke test** (read-only, key from your shell, never printed):
   `SMOKE_BASE=https://career-job-engine.farshaikh17.workers.dev SMOKE_KEY=... SMOKE_EXPECT_APPLICATIONS=12 node scripts/post_deploy_smoke.mjs`
   It makes one deliberate wrong-key attempt, well under the lockout limit.
6. **Open the dashboard**, unlock with the key, switch Farhan, Sana, Analytics, Settings.
7. **Check the collector**: `Actions -> Sync Collector Postings to Cloudflare D1 -> Run workflow` (or wait for the next scheduled run) and confirm it succeeds.

Order matters: the secret and table exist before the new Worker goes live, so there is no window where the Worker is locked out or unprotected.

## Rollback plan

| Problem | Action | Effect |
|---|---|---|
| Dashboard or API misbehaves after deploy | `npx wrangler rollback <previous-version-id>` (or Dashboard -> Workers -> career-job-engine -> Deployments -> select the previous version -> Rollback) | Restores the previous Worker **and** frontend bundle. Takes seconds. Note: the previous version has no authentication, so use this only if the new version is unusable; prefer fixing forward. |
| Locked out by the limiter | Wait up to 15 minutes, or clear it: `npx wrangler d1 execute career-job-engine --remote --command "DELETE FROM auth_failures"` | Removes lockouts only. |
| Key lost or compromised | `npx wrangler secret put ADMIN_API_KEY` with a new value | Takes effect immediately. Old key stops working. |
| Data concern | Nothing to undo: the release adds one table and changes no rows. If ever needed: `npx wrangler d1 time-travel restore career-job-engine --bookmark <bookmark from step 1>` | Restores the database to the recorded moment (also discards later writes, so use only with care). |
| The limiter table is unwanted | Leave it. It is additive and harmless; the old Worker ignores it. | |

## Verification already done (disposable data only)

See the test report delivered with this plan: Worker unit tests (18), real-browser tests on desktop and 375 px mobile (23 each), a real local D1 (workerd) comparison of API figures against SQL, a duplicate-application inflation test, the collector importer run, and a clean-checkout `npm run verify`.

## Not covered

* A disposable *remote* Cloudflare D1 database was not used: no Cloudflare credentials were available to this session. The local D1 used here is Cloudflare's own `wrangler dev --local` engine (workerd + SQLite).
* Behaviour at production data volume (about 2,100 active jobs per candidate) was not timed; the new queries are single grouped scans over the existing indexed tables.
* Cloudflare edge behaviour for unusual URLs.
* Scoring, application records and candidate preferences are deliberately untouched and still await your decisions.
