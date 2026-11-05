# Release process

Production is changed by exactly one path: the manual **Release to production** workflow
(`.github/workflows/release.yml`). It runs from `main`, one run at a time, re-runs every check itself, and is never
triggered by a push, a schedule or another workflow. Nothing in this repository uses a paid Cloudflare or GitHub
feature.

## One-time setup (in the GitHub web UI; never paste secrets into chat, issues or files)

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret:

| Secret | Value | Required |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | API token for the Cloudflare account that owns the `career-job-engine` Worker and D1 database. Permissions: Workers Scripts Edit, D1 Edit. No billing permission is needed. The collector repository already holds a token for this account; reusing it works if it also has Workers Scripts Edit. | yes |
| `CLOUDFLARE_ACCOUNT_ID` | The account id that `wrangler.toml` names (`account_id`). The release stops before changing anything if they differ. | yes |
| `NEW_ADMIN_API_KEY` | A new operator key you generated yourself (for example in a password manager, 32+ random characters). Only used if you tick `rotate_key`. | optional |
| `OPERATOR_SMOKE_KEY` | The operator key, so the post-deploy smoke test can also run its authenticated checks. | optional |

Settings -> Environments -> New environment `production`: under *Deployment branches* choose **Selected branches** and
allow only `main`; add yourself as required reviewer if your plan allows. The deploy job uses this environment, so a
release workflow edited on another branch cannot run with the production secrets.

## Releasing

1. Merge the tested change into `main` (the `Verify` workflow runs on the pull request).
2. Actions -> **Release to production** -> Run workflow, branch `main`, paste the full commit SHA of `main` into
   `confirm_sha`. Leave `rotate_key` off unless you are replacing the operator key.
3. The run, in order: verifies again from a clean checkout; checks the account matches `wrangler.toml`; checks the
   `ADMIN_API_KEY` secret exists (name only, the value is never read); records the current deployment list and the D1
   restore bookmark in the run summary; fingerprints applications, application history, manual overrides and
   candidates field by field; adds the `auth_failures` table (only migration 0008; 0001-0007 are never replayed);
   builds and deploys; runs the smoke test; fingerprints again and fails if any protected record changed.
4. Open the dashboard and unlock it with the operator key.

## Operator key

* One shared key unlocks the dashboard for **both** candidates. It is not per-user or per-candidate authorization.
* It lives only as the Worker secret `ADMIN_API_KEY` and, while unlocked, in that browser tab's `sessionStorage`.
* Rotating: add `NEW_ADMIN_API_KEY` as a secret, run the release with `rotate_key` ticked, then delete that secret.
  The old key stops working immediately.
* After 8 wrong keys in 15 minutes from one address, that address is refused (HTTP 429) for the rest of the window,
  including with the correct key. Wait up to 15 minutes, or clear it (see Rollback).

## Rollback

| Situation | Action |
|---|---|
| New Worker unusable | `npx wrangler rollback <version id>` using the id in the release summary (restores Worker and frontend together). The previous Worker had no API authentication, so prefer a forward fix. |
| Locked out by the limiter | Wait 15 minutes, or `npx wrangler d1 execute career-job-engine --remote --command "DELETE FROM auth_failures"`. |
| Key lost or exposed | Re-run the release with `rotate_key`. |
| Data concern | The release writes no existing row. The restore bookmark is in the run summary (`wrangler d1 time-travel restore`); restoring discards later writes, so do it only deliberately. |

## Local verification (no Cloudflare account needed)

```
npm ci
npm run verify          # frontend build, Worker dry-run bundle, 22 Worker tests, bundle-privacy tests, migrations
```

Real-browser tests against the real Worker runtime and a local D1 (disposable data only):

```
npx wrangler d1 migrations apply career-job-engine --local --persist-to .tmp-d1
node test/seed-sql.mjs > .tmp-seed.sql && npx wrangler d1 execute career-job-engine --local --persist-to .tmp-d1 --file=.tmp-seed.sql
npx wrangler dev --local --port 8787 --persist-to .tmp-d1 --var ADMIN_API_KEY:any-local-test-value &
E2E_KEY=any-local-test-value node test/e2e/browser.e2e.mjs desktop      # and: mobile
```
(`E2E_CHROMIUM=/path/to/chrome` selects a browser if Playwright's own is not installed; `.tmp-*` is git-ignored. The run
ends by deliberately locking the local limiter, so clear it before running again:
`npx wrangler d1 execute career-job-engine --local --persist-to .tmp-d1 --command "DELETE FROM auth_failures"`.)
