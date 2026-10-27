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
- [ ] First `schedule` event run **with P2 code** shows *Collection skipped* or a collection, plus a matching commit (pre-P2 scheduled run already verified: run 40288776346)
- [ ] Re-check merges with PR #1 and PR #2 at merge time

## Compensation inputs (E2a)
- [x] Greenhouse and Ashby URLs request compensation by default, with a warning when missing: `test_compensation_requested_by_default_and_warned_when_missing`
- [x] `changed_fields` and `endpoint_changed` attribute a pay-only change to the endpoint change, and the original currency and wording are kept: `test_changed_fields_and_endpoint_change_attributed`
- [x] Live trial from `main`'s 07:55 snapshot (local container, scratch output): 125 postings changed, every one only in `compensation_raw` (GitLab 106, Zapier 12, Oyster 7). No other hash moved apart from 1 genuinely new PostHog posting. PR #2's store ingested it as 125 new versions with no warnings.
- [x] Ashby tiers kept verbatim and a format change attributed by `normalization_changed`: `test_ashby_tiers_kept_verbatim`, `test_normalization_change_attributed_not_an_employer_edit`
- [x] Replay of real feed responses saved 2026-10-26 ~11:57 UTC from `main`'s 07:55 snapshot: 161 postings changed, all only in `compensation_raw` (GitLab 106, Clipboard 36, Zapier 12, Oyster 7); Clipboard has `endpoint_changed: false` and `normalization_changed: true`; all 171 Ashby pay components in the feeds (Clipboard 44, Oyster 57, Zapier 70) are present in `compensation_raw` with type, currency, interval and amounts unchanged
- [ ] First Actions collection after merge shows the same 125 (or current equivalent) as `changed_fields: [compensation_raw]`

## Benchmark (H)
- [x] Labels are internally consistent: every decision follows the decision rule, and every pass/fail basis is quoted from the posting: `test_labels_are_internally_consistent`, `test_validator_catches_bad_labels`
- [x] Every difficult case from the extension request is present: `test_required_difficult_cases_present`
- [x] Metrics separate trivial assessors (always-READY, always-exclude, always-review): `test_baselines_are_separated`
- [x] Collector meets all 6 collection scenarios (29 checks), and the runner catches a wrong expectation: `test_collector_meets_every_scenario`, `test_runner_detects_a_wrong_expectation`
- [x] PR #2's extractor and gates (8794ca8) measured on a scratch merge: gates false READY 0, incorrect exclusions 0 (see BENCHMARK.md)
- [x] Validator catches a qualifications label that contradicts the candidate's years on file (the error found by cross-checking PR #2's gates)
- [x] Repository owner confirmed the two real-posting cases (2026-10-26); they now count in gating metrics: `test_only_confirmed_labels_count`
- [ ] Re-score ENGINE steps 3+4 after PR #2 merges, and after each gates change (false READY must stay 0)

## Consumer (G)
- [ ] Original chat completes [CONSUMER_TEST.md](CONSUMER_TEST.md) and reports results
- [ ] End-to-end tracker ingestion verified (out of scope here)

## Later PRs
E2 onward add their own sections when they land.
