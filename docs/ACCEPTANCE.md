# Acceptance-test checklist

Tick only with evidence (test name, run URL or commit). Labels follow [HANDOFF.md](HANDOFF.md#status-labels).

## Registry (P2)
- [x] `python registry.py` prints OK for the committed registry: `test_repository_registry_is_valid`
- [x] Duplicate board (case-insensitive), duplicate id, malformed id or board, off-template URL, unknown keys and candidate fields are rejected: `test_registry.py`
- [x] Geography needs explicit evidence; remote wording is refused as a basis: `test_geography_requires_explicit_evidence`
- [x] Invalid registry: exit 2, no requests, no file changes (local CLI check, 2026-10-26)

## Reliable runs (P2)
- [x] Zero sources refuses to publish: `test_zero_sources_never_publishes`
- [x] Crash mid-run leaves the previous publication byte-identical, with no staging dir left behind: `test_crash_mid_run_leaves_previous_publication_intact`
- [x] `run_id` shared by status, index and produced boards: `test_run_id_links_boards_index_and_status`
- [x] Partial and failed states, `consecutive_failures`, `last_success_at`, original `observed_at` kept: `test_failure_history_and_last_known_good`, `test_all_failed_is_failed_not_ok`
- [x] Not-due sources make no requests and are marked `not_checked`, and their status entry is the unchanged latest real attempt: `test_not_due_sources_carried_without_requests`, `test_carried_failure_keeps_failure_count`, `test_due_selection`
- [x] Every published source state is an `ok`/`failed` attempt with `checked_at`, and `ok` boards match it (posting-store compatibility): `test_every_published_source_state_is_a_real_attempt`
- [x] Three-way merge of this branch, `build/crawl4ai` and `builder1` is clean. All suites pass. farshaikh17/Codex#2's `ingest_snapshot` accepts full, not-due, rebuilt-from-not-due and carried-failure snapshots (scratch scenario, 2026-10-26)
- [x] Secrets redacted from errors: `test_redaction`, `test_failure_history_and_last_known_good`
- [x] Concurrent local run refused: `test_concurrent_run_refused`
- [x] Live collection against the 10 feeds: 10/10 ok, keys and hashes identical to the committed snapshot (local container, scratch output, 2026-10-26)
- [ ] Actions `workflow_dispatch` run on `main` after merge produces a job summary table
- [ ] First `schedule` event run shows *Collection skipped* or a collection, plus a matching commit
- [ ] Re-check merges with PR #1 and PR #2 at merge time

## Consumer (G)
- [ ] Original chat completes [CONSUMER_TEST.md](CONSUMER_TEST.md) and reports results
- [ ] End-to-end tracker ingestion verified (out of scope here)

## Later PRs
E2 onward add their own sections when they land.
