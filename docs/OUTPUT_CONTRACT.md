# Output contract and consumer access

## Files

| File | Schema | Content |
|---|---|---|
| `public/status.json` | `public-job-index-1` | Run summary without jobs. **Written last; read it first.** |
| `public/index.json` | `public-job-index-1` | Same summary plus one compact row per listing (`key`, `title`, `locations`, `url`, `content_hash`, `observed_at`, `board_file`, `source_status`, `change`). |
| `public/boards/<source>.json` | `public-job-board-1` | Full normalized postings with complete descriptions for one source. |

Run-level fields (status.json also carries `manifest`): `run_id`, `trigger` (`schedule`, `workflow_dispatch`, `push`, `local`), `attempted_at`, `status` (`ok` = every attempted source succeeded, `partial`, `failed` = none succeeded), `outcome` (plain sentence), `attempted_sources`, `successful_sources`, `failed_sources`, `not_due_sources`, `total_sources`, `listing_count`, `orphan_board_files`, `notice`.

Per-source fields: `source`, `endpoint`, `status` (`ok` or `failed`; always the source's latest real attempt), `checked_at` (time of that attempt), `attempted_this_run` (false means the source wasn't due, no request was made, and the entry is copied unchanged from the earlier run), `last_success_at`, `consecutive_failures`, `poll_interval_hours`, `next_due_at`. For `ok`: `jobs`, `skipped`, `new`, `changed`, `no_longer_listed`. For `failed`: `error_type`, `error` (redacted), `retained_historical_jobs`.

Per-listing `change`: `new`, `changed`, `unchanged` (fetched this run), `unknown_after_failure` (source failed; data is older), `not_checked` (source not due).

Not READY evidence: no file here says a job is suitable, eligible or open for any candidate.

## Who can read it

The repository is private.

| Reader | Method | Tested? |
|---|---|---|
| Posting store (farshaikh17/Codex#2, unmerged) | Reads `public/` from a checkout | Yes, offline: `ingest_snapshot` against this branch's outputs (scratch scenario) |
| Repository owner | GitHub UI / git | Yes (owner pushes) |
| This Claude Code session | Repository-scoped GitHub access | Yes |
| ChatGPT tasks | Authenticated GitHub connector, per MIGRATION.md | **Not verified.** Nothing in this repository proves a ChatGPT task has read these files. |
| Anyone via `raw.githubusercontent.com` without auth | – | **Will not work** for a private repository. Don't rely on it. |

No new external endpoints are created by this work. See [CONSUMER_TEST.md](CONSUMER_TEST.md) for how the original chat can test its access.

## Detecting stale data

1. Read `status.json`. Compare `run_id` with the last one you processed. Unchanged means nothing new.
2. `attempted_at` older than about 6 hours (5-hour interval plus hourly tick plus GitHub delay) means the schedule may have stopped. Say so, and don't present the data as current.
3. `status: failed` means every listing is last-known-good from earlier runs.
4. Per source: `consecutive_failures > 0` or `checked_at` older than `next_due_at` plus 2 hours means that source's jobs are historical.
5. A listing's `observed_at` is when it was last fetched successfully, not when the file was written.

## Resuming after an interrupted read

Process by `run_id`. Record `(run_id, board_file)` pairs you have finished. If the `run_id` in `status.json` changes mid-read, restart from `status.json` for the new run. Board files for sources that were `ok` in a run carry the same `run_id`. Files for sources that failed or weren't attempted this run carry the earlier run's `run_id`, which is expected. Invariant: for every `ok` source, the board file's `collected_at` equals the source's `checked_at`. A mismatch means a partial read from mixed commits: re-read from one commit.

## Verifying one generation (manifest)

Moving several files into place is not atomic. If a run dies between moves, `public/` can hold board files from the new run next to an index and status from the old one. Two guards stop that from being ingested silently:

- `status.json` carries `manifest`: `{relative path: SHA-256}` for `index.json` and every board file in the snapshot, including carried board files that were not rewritten. It is written last.
- `python collect.py --verify` compares the files on disk with the manifest (no network). The publish step in `collect.yml` runs it whenever `public/` changed. On any mismatch it reverts `public/` to the last commit and fails the job, so a mixed generation is never committed. Tested: `test_crash_during_replacement_is_detected_not_silent` crashes on the second move, confirms mixed generations on disk, and confirms verify reports them.

Consumers: after reading `status.json`, compute the SHA-256 of `index.json` and of every board file you read, and compare with `status.json.manifest`. On a mismatch, discard what you read and use the previous commit. The posting store's existing `collected_at == checked_at` check catches the same case for ok sources. A `status.json` without `manifest` was written by the pre-P2 collector and cannot be verified this way.

## Schema compatibility

- Additive fields keep the schema id (`public-job-index-1`, `public-job-board-1`). Consumers must ignore unknown fields. This PR adds fields only.
- Removing or renaming a field, or changing a field's meaning, bumps the schema id (`-2`). Both versions are documented here during a transition.
- `content_hash` covers the normalized job fields. Adapter changes that alter normalization are announced in the PR and, where possible, migrated so they aren't flagged as real changes.
