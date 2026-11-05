# Repositories and automation

There is one working repository: **`farshaikh17/Codex`**. The dashboard source lives in its `dashboard/` folder; the
collector, the matching engine and the sync into D1 are in the repository root.

`farshaikh17/farhan-job-engine` is kept as a **backup only** (its full history was merged into this repository with
`git subtree`-style history preservation; `git log --follow dashboard/worker/index.ts` reaches the original commits). It is
not deployed from and has no active workflow. It is neither archived nor deleted until the owner decides to.

| Workflow (in `.github/workflows/`) | Trigger | Purpose |
|---|---|---|
| `collect.yml` | schedule UTC 01:37, 06:37, 11:37, 16:37, 21:37 | public ATS collection |
| `sync_collector_to_d1.yml` | schedule UTC 01:45, 06:45, 11:45, 16:45, 21:45 (plus manual, plus a push to its own files) | writes collected postings into D1 |
| `dashboard-verify.yml` | pull requests touching `dashboard/**`, manual | build + tests, no secrets |
| `dashboard-release.yml` | manual only | the only path that deploys the Worker |
| others | see their files | engine tests, career pipeline, crawl, experiments |

GitHub schedules are best effort: real runs start minutes after the nominal time, and a scheduled run's evidence is its
`event: schedule` entry in the run list, which is separate from manual runs.

## How the dashboard and the collector connect

The collector never calls the Worker's HTTP API. The sync runs `npx wrangler d1 execute career-job-engine --remote
--file=...` with the Cloudflare API token, writing straight into the same D1 database, so Worker authentication (and the
public/protected split) does not affect it. Both `wrangler.toml` files name the same account and database. **Only
`dashboard/wrangler.toml` deploys the Worker**; the root `wrangler.toml` exists so the collector's `wrangler d1 execute`
resolves the database binding and must never be used with `wrangler deploy` (that would create a second, broken
deployment and a second cron schedule).

The collector's importer writes new postings and unassessed qualifications and uses conditional upserts that leave human
decisions (manual overrides, applications) untouched. The dashboard owns the schema; a migration that changes a table the
importer writes (`jobs`, `candidate_qualifications`, `candidate_job_scores`) needs a matching importer change in
`engine/collector_importer.py`.

## Secrets

Repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` serve both the sync and the dashboard release (the
same token and account the sync already uses). `ADMIN_API_KEY` is a Cloudflare **Worker** secret, never a GitHub secret.
The optional `NEW_ADMIN_API_KEY` repository secret exists only for a deliberate key rotation.
