# Repository ownership and automation

| | `farshaikh17/farhan-job-engine` (this repo) | `farshaikh17/Codex` (collector) |
|---|---|---|
| Owns | Dashboard frontend (`frontend/`), Cloudflare Worker API (`worker/`), D1 schema migrations (`migrations/`), release process | Public job collection (ATS feeds), matching engine (`engine/`), the collector-to-D1 importer (`engine/collector_importer.py`, `engine/staging_bridge.py`) |
| Source of truth for | The deployed Worker and the dashboard | The collected job data and the sync into D1 |
| Automation | `Verify` (pull requests to main, manual), `Release to production` (manual only) | `collect.yml` (5 daily runs, UTC 01:37, 06:37, 11:37, 16:37, 21:37), `sync_collector_to_d1.yml` (UTC 01:45, 06:45, 11:45, 16:45, 21:45, plus manual) |
| Needs secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (release only) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (sync only) |

The five daily collection times are 5, 5, 5, 5 and 4 hours apart; the schedule leaves no gap longer than 5 hours but
is not evenly spaced across the 24 hours.

## How the two connect

The collector never calls the Worker's HTTP API. The sync runs `npx wrangler d1 execute career-job-engine --remote
--file=...` with a Cloudflare API token, writing straight into the same D1 database, so Worker authentication does not
affect it. Both repositories contain a `wrangler.toml` naming the same D1 database; **only this repository deploys the
Worker.** Do not run `wrangler deploy` from the collector repository.

The collector's importer writes new postings and unassessed qualifications and uses conditional upserts that leave human
decisions (manual overrides, applications) untouched. The dashboard owns the schema; a migration that changes a table the
importer writes (`jobs`, `candidate_qualifications`, `candidate_job_scores`) needs a matching importer change in `Codex`.

## Other consumers

No other consumer of the Worker's HTTP API is known. Anything that called it without a key must now send
`Authorization: Bearer <operator key>`.
