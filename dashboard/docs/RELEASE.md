# Release process

Production (the `career-job-engine` Worker and its D1 database) is changed by exactly one path: the manual
**Dashboard release to production** workflow (`.github/workflows/dashboard-release.yml` in the repository root). It runs
from `main`, one run at a time, re-runs every check itself, and is never triggered by a push, a schedule or another
workflow. Nothing here uses a paid Cloudflare or GitHub feature.

Public viewing needs **no operator key** to deploy or verify. The release uses only the Cloudflare token and account id
that the collector's sync workflow already uses.

## Secrets: where they live and what that does and does not protect

| Secret | Kind | Used by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub repository secret | `sync_collector_to_d1.yml` and `dashboard-release.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secret | both of the above; must equal `account_id` in `dashboard/wrangler.toml` |
| `ADMIN_API_KEY` | **Cloudflare Worker secret** | the Worker, for every protected action. Never a GitHub secret. |
| `NEW_ADMIN_API_KEY` | GitHub repository secret, optional | only a deliberate key rotation (`rotate_key`) |

Repository secrets are readable by workflows on *any* branch of this repository; they are not limited to one workflow, to
`main`, or to an environment. GitHub's environment secrets and deployment-branch rules would restrict that, but are
documented as unavailable for private repositories on the free plan; the project is not upgraded to get them. Safeguards that
do work: only the sync and release workflows reference the Cloudflare secrets; the repository has a single collaborator, the
owner; the release refuses to start unless the actor is the owner, the ref is `main` and the typed commit SHA matches; the
Cloudflare token is limited to one account and two permissions (Workers Scripts: Edit, D1: Edit) and should have an expiry;
secret values are never printed. If you add a collaborator, or a GitHub login leaks, a pushed branch could read these
secrets: rotate the token. If you later upgrade GitHub, create a `production` environment, move the secrets into it, allow
only `main`, and add `environment: production` to the `deploy` job.

Do not replace the collector's working token needlessly. The release's preflight proves what the existing token can read;
the deploy step proves it can write, and a refused deploy leaves production unchanged. If a permission is missing, add
only that permission to the token in Cloudflare (My Profile -> API Tokens) and re-run the preflight.

## Running a release

1. Merge the tested change into `main` (the `Dashboard verify` workflow runs on pull requests that touch `dashboard/`).
2. **Preflight first.** Actions -> **Dashboard release to production** -> Run workflow, branch `main`, `mode = preflight`,
   the full SHA of `main` in `confirm_sha`. It changes nothing in production. It proves: the commit passes the full
   verification from a clean checkout; the Cloudflare account and the D1 database id match `wrangler.toml`; the token can
   read the Worker, its deployments, D1 and Time Travel; `ADMIN_API_KEY` exists on the Worker (name only; a warning, not a
   failure, if absent); and it records the rollback points and the currently live version in the run summary.
3. **Release.** Same inputs with `mode = release`. Order of work: fingerprint protected records, add tables `auth_failures`,
   `response_cache` and `read_meter` (migrations 0008 and 0009, both additive; 0001-0007 are never replayed), optionally rotate the operator key, build and deploy with the
   commit recorded in the Worker, public smoke test (including anonymous write attempts that must be refused), read-only
   real-browser check of both dashboards on desktop and 375 px mobile with no credentials, fingerprint again and fail if
   any application, history, override or candidate record changed.
4. Verify the live commit: `GET /api/version` returns `commit` equal to the released SHA. The smoke test waits for it and
   judges only answers whose `X-Worker-Commit` header is the released SHA.
5. **Diagnose** (`mode = diagnose`, read-only) when production misbehaves: D1 info with 24-hour rows read and written, one
   `SELECT 1`, and the Worker's own error for two `/api/health` requests through `wrangler tail`. It skips the fingerprint,
   so it costs almost no D1 reads. See `INCIDENT_2026-11-05.md`.

D1 budget: Workers Free allows 5,000,000 rows read per UTC day. Every smoke pass and browser suite costs reads; the
read cache makes repeats cheap, but avoid repeated full suites against production on the same day.

## Daily phone message

After each daily discovery run the `message` job sends each linked person one line, for example
`Sana: 4 new jobs today · 25 best matches, 25 worth a try · https://…/app#sana/today`. It needs no release. It is **off** until the owner adds a channel; without one the job prints
"Daily message: skipped - no channel is set up" and does nothing.

Telegram (free):
1. In Telegram, open `@BotFather`, send `/newbot`, choose a name and a username ending in `bot`. BotFather replies with a token.
2. GitHub -> the repository -> Settings -> Secrets and variables -> Actions -> New repository secret: name `TELEGRAM_BOT_TOKEN`,
   value the token. Never paste it anywhere else.
3. Send each person the link `https://t.me/<bot username>?start=sana_ansari` (or `?start=farhan_shaikh`); they tap **Start**.
   Anyone else who should get a person's message (e.g. the owner) can open the same link; up to 3 chats per person.
4. Within 24 hours, Actions -> **Link Telegram chats** -> Run workflow. The bot answers "Linked". The chat is stored in the database
   (`discovery_state`, key `telegram:<candidate id>`), never in the repository or the log. Sending `/stop` to the bot unlinks a chat at the next link run.

Email (optional, instead or as well; e.g. a Gmail account with an app password): repository variable `DIGEST_PROVIDER` = `smtp`;
secrets `DIGEST_SMTP_USER`, `DIGEST_SMTP_PASSWORD` and `DIGEST_TO` (`farhan_shaikh=a@example.com; sana_ansari=b@example.com`);
variables `DIGEST_SMTP_HOST` / `DIGEST_SMTP_PORT` only when not Gmail (default `smtp.gmail.com`, 465, SSL).

The counts are the page's: Best matches and Worth a try, not applied, no override. When the run failed, was stopped, or finished without doing its work, the message says "today's update did not finish properly"; when the budget guard postponed it, "today's update was postponed". A message goes out at most once in 12 hours, except that a good run's message always follows a "did not finish" one. Code: `engine/daily_message.py`, tests `test_daily_message.py`.

## Operator key

* One shared key allows changes for **both** candidates. It is not per-user or per-candidate authorization.
* It lives only as the Worker secret `ADMIN_API_KEY` and, while signed in, in that browser tab's `sessionStorage`.
* After 8 different wrong keys in 15 minutes from one address, that address is refused (HTTP 429) for the rest of the
  window, including with the correct key. Public pages stay readable. A stale browser key counts as one attempt per page load.
* To rotate: add the `NEW_ADMIN_API_KEY` repository secret, run a release with `rotate_key`, then delete the secret.
* Protected actions are tested locally with a disposable key; production checks do not need the key. Use it in production
  only to make a real change you intend.

If an earlier draft of the `auth_failures` table exists (without `last_key_hash`) the limiter would fail open; run
`npx wrangler d1 execute career-job-engine --remote --command "DROP TABLE IF EXISTS auth_failures"` once before the release.
Production has not had that draft applied.

## Rollback

| Situation | Action |
|---|---|
| New Worker unusable | From `dashboard/`: `npx wrangler rollback <version id>` using the id in the preflight summary (restores Worker and frontend together). The previous Worker had no authentication at all (every route public, including writes), so prefer a forward fix. |
| Locked out by the limiter | Wait 15 minutes, or `npx wrangler d1 execute career-job-engine --remote --command "DELETE FROM auth_failures"`. |
| Key lost or exposed | Run a release with `rotate_key`. |
| Token exposed | Delete it in Cloudflare (My Profile -> API Tokens), create a new one, update `CLOUDFLARE_API_TOKEN` (the sync uses the same secret). |
| Data concern | The release writes no existing row. The Time Travel bookmark is in the preflight summary (`wrangler d1 time-travel restore`); restoring discards later writes (including the collector's), so do it only deliberately. |

## Local verification (no Cloudflare account needed)

```
cd dashboard
npm ci
npm run verify          # frontend build, Worker dry-run bundle, Worker + public-view + bundle-privacy tests, migrations
```

Real-browser tests against the real Worker runtime and a local D1 (disposable data and a throwaway key only):

```
npx wrangler d1 migrations apply career-job-engine --local --persist-to .tmp-d1
node test/seed-sql.mjs > .tmp-seed.sql && npx wrangler d1 execute career-job-engine --local --persist-to .tmp-d1 --file=.tmp-seed.sql
npx wrangler dev --local --port 8787 --persist-to .tmp-d1 --var ADMIN_API_KEY:any-local-test-value &
E2E_KEY=any-local-test-value node test/e2e/browser.e2e.mjs desktop      # and: mobile   (visitor, then operator, then limiter)
E2E_BASE=http://localhost:8787 node test/e2e/production-readonly.e2e.mjs desktop   # rehearsal of the release browser check
SMOKE_BASE=http://localhost:8787 node scripts/post_deploy_smoke.mjs                # rehearsal of the public smoke test
# people links, skill list, follow-up dates / overdue flag, Applied card, daily card. Needs descriptions naming skills and a cleared cache:
npx wrangler d1 execute career-job-engine --local --persist-to .tmp-d1 --command "DELETE FROM response_cache; DELETE FROM auth_failures; DELETE FROM application_followups; UPDATE jobs SET description = 'We need Salesforce, SQL, Python and Zapier experience for workflow automation.'; UPDATE candidates SET primary_skills = '[\"Salesforce\",\"Python\"]' WHERE id = 'farhan_shaikh'; UPDATE candidate_qualifications SET qualification_reason = '[GITHUB_COLLECTOR] Unassessed public ATS posting from acme; review pending.' WHERE candidate_id = 'farhan_shaikh' AND job_id IN ('job_001','job_002','job_008')"
E2E_KEY=any-local-test-value node test/e2e/features.e2e.mjs desktop    # and: mobile
```
(Other suites: `a11y`, `faults`, `site` use the same seed; `listing` and `clients` need a separate database seeded with `node test/e2e/listing-seed.mjs`.)
The `site` suite submits the public application form, which allows only a few submissions a day per network: after several runs on one database it
answers 429 and the suite times out. Clear it with `--command "DELETE FROM client_requests"` on the disposable database.
(`E2E_CHROMIUM=/path/to/chrome` selects a browser if Playwright's own is not installed; `.tmp-*` is git-ignored. The first
script ends by deliberately locking the local limiter, so clear it before running again:
`npx wrangler d1 execute career-job-engine --local --persist-to .tmp-d1 --command "DELETE FROM auth_failures"`.)
