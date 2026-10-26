# Consolidated backlog (job-research engine)

One engine, built in layers:
- Collection: the stdlib ATS feed collector (`collect.py`), plus the manual Crawl4AI page fallback in farshaikh17/Codex#1.
- Storage: the SQLite posting store in farshaikh17/Codex#2.
- Assessment and review: built on that store.

This file merges the extended scope (sections A–L of the extension request) with both open PRs and with the plan in PR #2's `docs/ENGINE.md`. Where the two plans overlap, ENGINE.md step numbers are kept ("E2" = ENGINE step 2), so there is one plan, not two. Each row is one reviewable PR.

Status labels are used exactly as defined in [HANDOFF.md](HANDOFF.md#status-labels).

## Open PRs

| PR | Scope | State |
|---|---|---|
| farshaikh17/Codex#1 `build/crawl4ai` | Manual, allowlisted Crawl4AI career-page capture (`crawl_pages.py`, `pages.json`, `public/pages/`). Robots checks, login/CAPTCHA/denial/rate-limit stop, redirect allowlist, thin/usable classification. Restricts feed workflow `push` to `main`. | Implemented and tested offline. Live collection verified on the build branch (5 usable, 1 failed). No schedule. |
| farshaikh17/Codex#2 `builder1` (E1) | `engine/store.py`: SQLite posting store. Stable ids, canonical URLs, content-only hashes, version history, observations, availability states (listed, missing, inaccessible, expired). Idempotent ingest of `public/`. | Implemented and tested offline (per its PR). |
| farshaikh17/Codex#3 `builderbranches` (P2, this) | Registry and validation, plus reliable collection runs. See below. | Implemented and tested offline. Live collection verified (local container, scratch output). |
| main | ATS feed collector, 10 feeds, five scheduled runs a day (owner's change, 562baaf). | Live collection verified (push runs). Scheduled execution verified once: run [40288776346](https://github.com/farshaikh17/Codex/actions/runs/40288776346) (event `schedule`, 07:55 UTC on 2026-10-26, pre-P2 code) collected and committed 456397a. The hourly ticks 02:23–06:23 created no runs at all, and this tick started 32 minutes late. GitHub's schedule is best-effort, so freshness checks matter. |

Merge compatibility (checked 2026-10-26 by test merge): #1, #2 and #3 merge cleanly in any order. Each suite passes on the merged tree, and PR #2's ingest accepts PR #3's outputs, including not-due carry-over. PR #3 copies PR #1's `collect.yml` hunks verbatim. It keeps `sources.json` a list for PR #2's reader and keeps `read`/`write` stable for `crawl_pages.py`.

Overlap already resolved:
- PR #1 covers part of E (page access-restriction detection) and part of B (allowlist, bounded fetch). B reuses its `validate`, `robots_allows`, `classify`.
- PR #3 delivers most of E8 (run lock, freshness and partial-run reporting, per-source failure counts). E8 narrows to per-source backoff and request budgets.
- Storage decision (K, DuckDB): PR #2 chose SQLite (stdlib). No DuckDB code exists, so none is added.

## Status refresh (2026-10-26 ~23:00 UTC; supersedes the State column below where they differ)

| Row | State | Where |
|---|---|---|
| P2 registry + reliable runs | Implemented and tested offline. Consolidated with #5 (manifest) and current `main` (owner's five-daily cron, `branches: [main]`, no age gate). Every scheduled run collects every source without its own `poll_interval_hours` | #3 `0c76b85` |
| E2a compensation inputs | Implemented and tested offline. Live collection verified in a container, scratch only: 162 compensation-only changes, all attributed to the collector. Includes #8 (Ashby tiers verbatim, `normalization_version` 2) | #4 `c4e38fc` |
| E1/E2 store + extraction | Implemented and tested offline. Includes #6 (rebuild from Git history) and #9 (tiers). Extractor version 4 (B3): K/M/B suffixes, coded dollars, per-unit ranges, company figures not pay | #2 `23922ab` |
| E3–E7 gates, review queue, outputs, Sheets interface | Implemented and tested offline. **Provisional**: candidate policy awaits the canonical Sheets comparison (see HANDOFF.md, *Provisional candidate-policy rules*). Sheets adapter is a fake only; no live writes | #2 `23922ab` |
| H benchmark | Implemented and tested offline. Bare-`$` labels corrected (`2bae921`). **Provisional** labels: see HANDOFF.md | #7 `2bae921` |
| B discovery | Implemented and tested offline. **Parked** outside the minimum release | #10 `51d450d` |
| E8 backoff and budgets | Implemented and tested offline; keeps #5's manifest. **Parked**; backoff policy unapproved | #11 `5c26659` |
| P8 fold `pages.json` into the registry | Not started | – |
| K tool evaluations | Trafilatura evaluated, not adopted (`docs/ENGINE.md` §6). JobSpy: not started. actionlint: not started. Bounded assignments are in `docs/COORDINATION.md` on `build/crawl4ai` | – |
| P10/E9 schedule + acceptance | Schedule set by the owner on `main` (`562baaf`, `709948e`). **Scheduled execution of the new cron not yet verified**: the 21:37 UTC slot created no run. End-to-end acceptance passes offline; the READY path is proven on a synthetic posting only | – |

## Dependency order

```
P2 (#3) registry + reliable runs ─┐
E1 (#2) posting store ────────────┼─> E2 evidence + extraction warnings ─> H benchmark fixtures ─> E3+E4 candidate config + gates ─> E5 review queue ─> E6 consumer outputs ─> E7 Sheets interface
#1 page fallback ─────────────────┤
                                  ├─> B bounded source discovery (needs #1)
                                  └─> P8 fold pages.json into registry (needs #1)
K tool evaluations: only on demonstrated gaps.   E8 rest + E9 scheduling/acceptance + P10 cost: last.
```

## Rows

| # | Scope | Covers | Depends on | State |
|---|---|---|---|---|
| P2 | **This PR.** `sources.json` (list) plus `employers.json` registry: strict keys (no candidate fields), evidence-required geography and job families, duplicate and malformed board detection, URL template checks, per-source `enabled`/`poll_interval_hours`. `registry.py` validates before any request. Collector: staged publication with status last, `run_id`, `trigger`, `outcome`, per-source due scheduling with an unchanged carry-over of the last attempt, `last_success_at`, `consecutive_failures`, zero sources refuses to publish, all-failed labelled last-known-good, redacted errors, local lock, a job summary that separates *skipped (not due)* from a real run, annotations. | A, I, J (no new workload) | – | Implemented and tested offline; live collection verified (local) |
| E2a | **Collector compensation inputs** (farshaikh17/Codex `builderbranches-compensation`, stacked on #3). Greenhouse `pay_transparency=true` and Ashby `includeCompensation=true` for every source and as registry defaults, with a warning when missing. `changed_fields` per changed posting and `endpoint_changed` per source, so a pay-only change caused by the URL change isn't mistaken for an employer edit. Collector-owned files only, per ENGINE.md's boundary. Measured: +125 postings with employer-published pay. | D (inputs) | P2 | Implemented and tested offline; live collection verified (local) |
| E2 | **Evidence and extraction records** per posting version in the store. **Owned by the PR #2 session** (its user asked it to proceed with step 2 on 2026-10-26 11:48 UTC); not built here to avoid conflicting edits. Scope as merged from the extension request: items `{field, source_url, retrieved_at, quote, interpretation, state, method, schema_version}` for location, workplace, compensation, employment type, and requirement sections. Compensation keeps original currency, period and wording, and separates fixed, variable, total and estimated pay. Mandatory and preferred requirements are kept apart. States: `stated`, `not_stated`, `conflicting`, `not_retrieved`. No confidence percentages. Warnings: empty or navigation-only, truncated, list captured as a description, missing requirement or compensation section when the source signals one. Crawl4AI captures become leads, never postings. Compensation input gap closed by E2a. E2 should interpret `compensation_raw` per provider: Greenhouse `pay_input_ranges` (cents, currency, and blurb restrictions such as "residents of the United States only"), Ashby summaries ("Offers Equity", "Offers Bonus", "Multiple Ranges") and Lever salary text. It should use `changed_fields` to decide which assessments a change affects. | D, E | P2, E1, E2a | Being built in the PR #2 session (not here) |
| H | **Benchmark fixtures and metrics harness.** Hand-labelled synthetic cases plus permitted public examples: remote US-only, India explicitly allowed, worldwide wording with a conflicting country, missing salary, variable-only, a range spanning the threshold, mandatory unmet, preferred unmet, duplicates across URLs, reopened requisition, expired page returning HTTP 200, failed retrieval after success, one posting assessed for two candidates. Metrics: false READY, incorrect exclusions, correctly retained unknowns, duplicate handling, queue completion and interruption recovery, extraction completeness. Labels are test expectations, never model output. False READY is the primary metric, reported next to false exclusions. | H | E2 | Implemented and tested offline (`builderbranches-benchmark`, stacked on E2a); extractor measured on a scratch merge, see BENCHMARK.md |
| E3+E4 | **Candidate configuration and gates.** Private config path outside Git; synthetic examples only. Separate dimensions, each an evidence state with reasons: relevance (deterministic job-family routing, which only prioritizes), mandatory qualifications, geographic eligibility, salary evidence, application status. READY only when every dimension is supported by stated evidence. | C, D | E2, H | Not started |
| E5 | **Durable review queue and recheck policy.** Keyed on candidate, posting, content hash, rules version and profile version. Leases, resume after interruption, pending items never erased by a collection. Recheck on: new relevant posting, meaningful change, profile or rule change, a conditional job with new evidence or a bounded schedule. Skip unchanged completed reviews. Respect applied/rejected history. Per-employer cap per batch. Explainable priority reasons. Rule and normalization versions stored with every assessment. | C, F | E3+E4 | Not started |
| E6 | **Consumer outputs**: bounded review batches with a cursor, per-posting evidence records, a schema version on every file. Candidate outputs never go under `public/`; their location is an owner decision. | G | E5 | Not started |
| E7 | **Sheets adapter interface** with a fixture-backed fake and idempotent upserts. No live Sheets calls, and no live tracker or task changes. | G | E6 | Not started |
| B | **Bounded source discovery.** Separate manual workflow. Start from `employers.json` `careers_url`s, detect Greenhouse/Lever/Ashby links and board ids, read permitted sitemaps and JSON-LD `JobPosting`. Explicit scope, maximum pages, depth and request budget; never an open crawl. Writes proposals for review only. A source enters recurring collection only after `registry.py` validation and a reviewed PR. Prefer ATS feeds over browser capture. | B | P2 | Implemented and tested offline; live discovery verified (local container, 16 targets, 40 requests). Branch `builderbranches-discovery`, stacked on #3. Its robots policy copies PR #1 rather than importing it, until P8 consolidates them |
| P8 | **Fold `pages.json` into the registry** as `career_page` sources. Merge root README and OPERATIONS with `docs/`. | A, L | P2, #1 | Not started |
| K | **Tool evaluations, only on demonstrated gaps.** Trafilatura: only if E2/H fixtures show stdlib `HTMLParser` or Crawl4AI markdown failing on ordinary HTML. JobSpy: an optional, disabled discovery experiment, if B leaves a gap. Licenses verified from primary sources at evaluation time. Free `pip-audit` for `requirements-crawl.txt` after #1 merges. | K, I | E2/H evidence | Not started |
| E8 | **Collector backoff and budgets** (`builderbranches-reliability`, stacked on #10). Per-source backoff on scheduled runs (10 h doubling to 7 days; 404/410 from 24 h; 429 at least 24 h or `Retry-After`), a request budget of 40 per run (never-attempted first, then stalest), a time budget of 8 minutes, `not_attempted_reason` and `deferred_sources` in status, and a clean skip when every source waits. The collector half of ENGINE step 8; the PR #2 session was told. | I | P2 | Implemented and tested offline; PR #2 ingest verified against backoff and budget snapshots |
| P10/E9 | **Schedule, cost and acceptance.** P10 done by the owner on `main` (562baaf): five daily runs at `37 1,6,11,16,21 * * *`, no age-gate skip, about 150 runner minutes a month instead of about 720. #3 was merged with it so that every scheduled run collects (`poll_interval_hours` is opt-in). Remaining (E9): re-verify the no-spend controls (billing UI) and the end-to-end acceptance with the consumer. | J | #1, E6 | Needs decision |

## Out of scope by instruction

No repository visibility changes, no new external endpoints, no edits to live ChatGPT tasks or Google Sheets, no paid APIs, proxies, LLM calls or hosting, no CAPTCHA solving or stealth, no Activepieces, vector database, multi-agent framework or dashboard.
