# Release process

Production is changed by exactly one path: the manual **Release to production** workflow
(`.github/workflows/release.yml`). It runs from `main`, one run at a time, re-runs every check itself, and is never
triggered by a push, a schedule or another workflow. Nothing in this repository uses a paid Cloudflare or GitHub feature.

## Where secrets live, and what that does and does not protect

The workflow reads **repository secrets**. Repository secrets are available to workflows on *any* branch of this
repository; they are **not** limited to the `production` environment, to `main`, or to this workflow file. GitHub's
environment secrets and deployment-branch rules would restrict that, but GitHub documents them as available for
*private* repositories only on paid plans (Pro, Team, Enterprise). This project is not upgraded to get them, so the
safeguards that work on a free private repository are used instead:

* only `release.yml` references the secrets (`verify.yml` and every other workflow use none);
* the repository has one collaborator, the owner (checked: `farshaikh17`, admin), so nobody else can add a workflow that reads them;
* the release refuses to start unless the actor is the repository owner, the ref is `main`, and the typed commit SHA matches;
* the Cloudflare token is limited to one account and two permissions (below), and should be given an expiry date;
* secret values are never echoed; the run summary shows only whether a secret exists.

Consequences to keep in mind: if you ever add a collaborator, or a leaked GitHub login could push a branch, that branch's
workflow could read the secrets. Rotate the token if that happens. If you upgrade GitHub later, create a `production`
environment, move the secrets into it, allow only `main`, and add `environment: production` to the `deploy` job.

## One-time setup (web pages only; never paste secret values into chat, files or issues)

### A. Cloudflare token for the account that owns `career-job-engine`

1. Sign in to Cloudflare as the owner of the `career-job-engine` Worker. Check the account: Workers & Pages should list
   `career-job-engine`, and the address bar shows `https://dash.cloudflare.com/<account id>/...`. That id must equal
   `account_id` in `wrangler.toml` (`c7e866f95a4275de2719647dd2bc4f34`). If it differs you are in the wrong account.
2. Profile (top right) -> **My Profile** -> **API Tokens** -> **Create Token** -> **Create Custom Token**.
3. Permissions, two rows: `Account` / `Workers Scripts` / `Edit`; `Account` / `D1` / `Edit`.
4. Account Resources: Include -> that one account. No zone resources. Set a **TTL** (for example 90 days).
5. Create, copy the token once.

### B. GitHub repository secrets

`farhan-job-engine` -> Settings -> Secrets and variables -> Actions -> New repository secret, four of them:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step A |
| `CLOUDFLARE_ACCOUNT_ID` | `c7e866f95a4275de2719647dd2bc4f34` (the account id from step A.1) |
| `OPERATOR_SMOKE_KEY` | the current operator key you already use to unlock the dashboard |
| `NEW_ADMIN_API_KEY` | only if you want to replace the operator key: a new random key (32+ characters) from a password manager |

`OPERATOR_SMOKE_KEY` is **required**. The authenticated smoke test and the browser check cannot be skipped: the release
fails before changing anything if it is missing, and fails if no authenticated check ran. In preflight it is proven
against the live Worker, so a wrong value is found before any change.

## Running a release

1. Merge the tested change into `main` (the `Verify` workflow runs on pull requests).
2. **Preflight first.** Actions -> **Release to production** -> Run workflow, branch `main`, `mode = preflight`, paste the
   full SHA of `main` into `confirm_sha`. It changes nothing in production. It proves: the commit is verified from a clean
   checkout; the Cloudflare account and the D1 database id match `wrangler.toml`; the token can read the Worker,
   deployments, D1 and Time Travel; `ADMIN_API_KEY` exists (name only); `OPERATOR_SMOKE_KEY` is accepted by the live Worker;
   and it records the rollback points in the run summary.
3. **Release.** Same inputs with `mode = release`. Tick `rotate_key` only to replace the operator key (then the smoke test
   and browser check use `NEW_ADMIN_API_KEY`). Order of work: fingerprint protected records, add table `auth_failures`
   (migration 0008 only; 0001-0007 are never replayed), optionally rotate the key, build and deploy, authenticated smoke
   test, read-only real-browser check of both dashboards on desktop and 375 px mobile, fingerprint again and fail if any
   application, history, override or candidate record changed.
4. Open the dashboard and unlock it with the operator key.

## Operator key

* One shared key unlocks the dashboard for **both** candidates. It is not per-user or per-candidate authorization.
* It lives only as the Worker secret `ADMIN_API_KEY` and, while unlocked, in that browser tab's `sessionStorage`.
* After 8 different wrong keys in 15 minutes from one address, that address is refused (HTTP 429) for the rest of the window,
  including with the correct key. A stale browser key counts as one attempt per page load.
* To rotate: set `NEW_ADMIN_API_KEY`, run a release with `rotate_key`, then delete `NEW_ADMIN_API_KEY` and put the new
  value in `OPERATOR_SMOKE_KEY`.

If an earlier draft of the `auth_failures` table exists (without `last_key_hash`) the limiter would fail open; run
`npx wrangler d1 execute career-job-engine --remote --command "DROP TABLE IF EXISTS auth_failures"` once before the release.
Production has not had that draft applied.

## Rollback

| Situation | Action |
|---|---|
| New Worker unusable | `npx wrangler rollback <version id>` using the id recorded in the preflight summary (restores Worker and frontend together). The previous Worker had no API authentication, so prefer a forward fix. |
| Locked out by the limiter | Wait 15 minutes, or `npx wrangler d1 execute career-job-engine --remote --command "DELETE FROM auth_failures"`. |
| Key lost or exposed | Run a release with `rotate_key`. |
| Token exposed | Delete it in Cloudflare (My Profile -> API Tokens), create a new one, update `CLOUDFLARE_API_TOKEN`. |
| Data concern | The release writes no existing row. The Time Travel bookmark is in the preflight summary (`wrangler d1 time-travel restore`); restoring discards later writes, so do it only deliberately. |

## Local verification (no Cloudflare account needed)

```
npm ci
npm run verify          # frontend build, Worker dry-run bundle, Worker + bundle-privacy tests, migrations
```

Real-browser tests against the real Worker runtime and a local D1 (disposable data only):

```
npx wrangler d1 migrations apply career-job-engine --local --persist-to .tmp-d1
node test/seed-sql.mjs > .tmp-seed.sql && npx wrangler d1 execute career-job-engine --local --persist-to .tmp-d1 --file=.tmp-seed.sql
npx wrangler dev --local --port 8787 --persist-to .tmp-d1 --var ADMIN_API_KEY:any-local-test-value &
E2E_KEY=any-local-test-value node test/e2e/browser.e2e.mjs desktop      # and: mobile
E2E_BASE=http://localhost:8787 E2E_KEY=any-local-test-value node test/e2e/production-readonly.e2e.mjs desktop   # rehearsal of the release browser check
```
(`E2E_CHROMIUM=/path/to/chrome` selects a browser if Playwright's own is not installed; `.tmp-*` is git-ignored. The first
script ends by deliberately locking the local limiter, so clear it before running again:
`npx wrangler d1 execute career-job-engine --local --persist-to .tmp-d1 --command "DELETE FROM auth_failures"`.)
