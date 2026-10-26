# Operations and recovery

## Normal operation

- Hourly tick at minute 23. `collect.py --trigger schedule` collects only sources whose `checked_at` is at least `poll_interval_hours` old (15 minutes slack for tick drift). If none is due, the job summary says **Collection skipped: no source is due**, no request is made and no file changes. This is a correct skip, not a failure.
- Manual run: Actions → *Collect public job feeds* → Run workflow (collects all enabled sources). Local: `python collect.py` (all) or `python collect.py --ids a,b`.
- Each real run writes a job summary table and annotations: `::warning::` for partial, `::error::` and exit 1 for failed. Exit 2 means `sources.json` is invalid and no requests were made.

## Recovery

| Symptom | Meaning | Action |
|---|---|---|
| Job failed at *Validate source registry* | Bad `sources.json` | Fix the listed errors. Nothing was published. |
| `status: failed`, all sources `failed` | Network or provider outage, or runner egress | Data is last-known-good. Re-run manually later. Don't edit `public/`. |
| One source with rising `consecutive_failures` | Board moved, renamed or removed | Check the employer's careers page. Fix `board`, or set `enabled: false` with a note. |
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
