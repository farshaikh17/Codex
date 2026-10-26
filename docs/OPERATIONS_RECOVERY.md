# Operations and recovery

## Normal operation

- Five scheduled runs a day at 01:37, 06:37, 11:37, 16:37 and 21:37 UTC (owner's schedule, 2026-10-26). `collect.py --trigger schedule` collects every enabled source, except one that sets its own `poll_interval_hours`, which waits until its last real attempt is that old (15 minutes slack for drift). If every source is waiting, the job summary says **Collection skipped: no source is due**, no request is made and no file changes. With the current registry, where no source sets an interval, every scheduled run collects.
- Manual run: Actions → *Collect public job feeds* → Run workflow (collects all enabled sources). Local: `python collect.py` (all) or `python collect.py --ids a,b`.
- Each real run writes a job summary table and annotations: `::warning::` for partial, `::error::` and exit 1 for failed. Exit 2 means `sources.json` or `employers.json` is invalid and no requests were made.

## Backoff and budgets

- **Backoff, scheduled runs only.** The first failure is retried on the next run. From the second consecutive failure the source waits 10 h, then 20, 40, 80, up to 7 days. A 404 or 410 (board moved or removed) waits 24 h, doubling up to 7 days. A 429 waits at least 24 h, or the server's `Retry-After` if longer. Manual runs (Run workflow, `python collect.py`, `--ids`) ignore backoff, because a person asked for them. The job summary shows `backoff until …` for each waiting source.
- **Request budget:** at most 40 feed requests per run (`LIMITS` in `collect.py`). When more sources are due, never-attempted sources go first, then the least recently checked. The rest wait for the next run (`not_attempted_reason: request_budget`, or `deferred_sources` if never attempted).
- **Time budget:** no new request starts 8 minutes into the run (`deadline_s`), so publishing finishes inside the 12-minute job timeout. Unreached sources get `time_budget`.
- **If every source is waiting,** the job summary says **Collection skipped: every source is waiting**. No request is made and nothing is published.

## Recovery

| Symptom | Meaning | Action |
|---|---|---|
| Job failed at *Validate source registry* | Bad `sources.json` or `employers.json` | Fix the listed errors. Nothing was published. |
| `status: failed`, all sources `failed` | Network or provider outage, or runner egress | Data is last-known-good. Re-run manually later. Don't edit `public/`. |
| One source with rising `consecutive_failures` | Board moved, renamed or removed | Check the employer's careers page. Fix `board`, or set `enabled: false` with a note. After fixing it, Run workflow (manual) to retry at once instead of waiting out the backoff. |
| `http_status: 429` | The provider is rate limiting | Do nothing. Scheduled runs wait at least 24 h, or `Retry-After`. Don't trigger manual runs repeatedly. |
| `Redirect requires source review` | Feed URL now redirects | Verify the new board, then update the registry. Redirects are never followed automatically. |
| `orphan_board_files` non-empty | Source removed or renamed in the registry | File left untouched. Delete it in a reviewed commit if it's no longer needed. |
| `.collect-staging-*` directory left behind | Process killed mid-publish | Safe to delete. It is gitignored and never published. |
| `Another collection run holds .collect.lock` | Concurrent local run | Wait. The lock is released automatically when the other process exits. |
| Publish step push rejected | Concurrent commit | The step rebases (no force push). Re-run if it still fails. |

Interrupted runs: collection is a single stage. Output is staged and moved into place only after every due source was handled, with `status.json` moved last. An interrupted run publishes nothing, and re-running is safe and idempotent apart from timestamps.

## Retention and growth

Board files are replaced each run, so working-tree size is bounded by current postings. History lives in git. No log or output file grows across runs. Disabled or removed sources stop appearing in the index, and their old board files are reported, not deleted.

## Spending controls

Private-repository Actions minutes come from the account allowance. MIGRATION.md records a verified Actions budget of $0.00 with usage blocked beyond the allowance. That check was done in the billing UI and can't be repeated from this session. This change adds no workflow, schedule or browser workload. The collection job has a 12-minute timeout. A local measured trial took 37 s for 10 sources, plus runner checkout and setup.

## Dependency checks

Collection uses only the standard library, so there is nothing to audit. PR #1's `requirements-crawl.txt` should get a free `pip-audit` step when it merges (BACKLOG P9).

## Secrets

The collector needs no secrets. Error messages are redacted (URL credentials, token-like query parameters, bearer/basic values) before they reach status files or logs.
