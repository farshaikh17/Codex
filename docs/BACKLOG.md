# Consolidated backlog (job-research engine)

One engine: the stdlib ATS feed collector (`collect.py`, `adapters.py`) plus the manual Crawl4AI page fallback from farshaikh17/Codex#1. This file merges the extended scope (sections A–L of the extension request) with that existing work. It is dependency-ordered. Each row is one reviewable PR.

Status labels are used exactly as defined in [HANDOFF.md](HANDOFF.md#status-labels).

## Existing work

| PR | Scope | State |
|---|---|---|
| farshaikh17/Codex#1 `build/crawl4ai` | Manual, allowlisted Crawl4AI career-page capture (`crawl_pages.py`, `pages.json`, `public/pages/`). Robots checks, login/CAPTCHA/denial/rate-limit stop, redirect allowlist, thin/usable classification. Also restricts feed workflow `push` to `main`. | Open, unmerged. Implemented and tested offline; live capture verified on the build branch (5 usable, 1 failed). No schedule. |
| main | ATS feed collector, 10 Greenhouse/Lever/Ashby feeds, hourly cron with 5-hour gate. | Live collection verified (push runs). Scheduled execution **not** verified: no `schedule` event run existed as of 2026-10-26 02:10 UTC. |

Overlap with this scope: PR #1 already covers part of E (access-restriction detection for pages) and part of B (allowlist, bounded fetch). Later PRs reuse its `validate`, `robots_allows` and `classify` and don't write their own. Nothing below edits `crawl_pages.py` until PR #1 merges.

## Dependency order

```
P2 registry + reliable runs ──┬─> P3 evidence + extraction warnings ──> P4 benchmark fixtures ──> P5 assessment dimensions ──> P6 review queue + recheck
                              ├─> P7 bounded source discovery (needs PR #1 merged)
                              └─> P8 fold pages.json into registry (needs PR #1 merged)
P9 tool evaluations: only when P3/P4 fixtures demonstrate a gap
P10 schedule/cost changes: after PR #1 merges (same workflow file)
```

## Rows

| # | PR scope | Covers | Depends on | State |
|---|---|---|---|---|
| P2 | **Registry + validation + reliable runs** (this branch, `builderbranches`). `sources.json` becomes `source-registry-1` (employers + sources, strict keys, provenance-required geography/job families, duplicate/malformed board detection, URL template checks, per-source `enabled`/`poll_interval_hours`). `registry.py` validates before any request. Collector: staged publication (status.json last), run IDs, trigger recorded, per-source due scheduling, `not_due` carry-over, `last_success_at` + `consecutive_failures`, zero sources refuses to publish, all-failed is explicitly last-known-good, redacted errors, local lock, GitHub step summary distinguishing *skipped (not due)* from a real run, `::warning::`/`::error::` annotations. | A (core), I (core), J (no new workload) | – | Implemented and tested offline; live collection verified (local container, scratch output, 10/10 ok). Not yet run in Actions. |
| P3 | **Evidence schema + extraction warnings for ATS postings.** Per-posting `evidence[]` items `{field, source_url, retrieved_at, quote, interpretation, state, method, schema_version}` for location, workplace, compensation (original currency, period, wording; fixed vs variable vs total; employer-published only), employment type, requirement sections (mandatory vs preferred kept apart). Explicit states: `stated`, `not_stated`, `conflicting`, `not_retrieved`. Warnings: empty/navigation-only, truncated, list-as-description, missing requirement/compensation section when the source indicates one. Includes a measured gap: **Greenhouse list feeds return `pay_input_ranges` only with `pay_transparency=true`**. Today 0 of 374 Greenhouse jobs carry compensation. A check on 2026-10-26 with the flag returned ranges for 106 of 239 GitLab jobs and 0 of 133 Twilio jobs. The registry already allows the flag. Enabling it changes content hashes, so it ships with a one-time `change: rehashed` migration and doesn't flag everything as `changed`. | D, E | P2 | Not started |
| P4 | **Benchmark fixture set + metrics harness.** Synthetic and permitted public cases with hand-written labels (the H list: remote US-only, India explicitly allowed, worldwide-with-conflict, missing salary, variable-only, range spanning threshold, mandatory/preferred unmet, cross-URL duplicates, reopened requisitions, expired page HTTP 200, failed retrieval after success, one posting / two candidates). Metrics: false READY, incorrect exclusions, retained unknowns, duplicate handling, queue completion/interruption recovery, extraction completeness. Labels are test expectations, never model output. | H | P3 | Not started |
| P5 | **Candidate configuration + assessment dimensions.** Candidate configs live outside the repo (gitignored `candidates/` or a path argument); only synthetic examples are committed. Separate dimensions: relevance (deterministic job-family rules), mandatory qualifications, geographic eligibility, salary evidence, application status. Each is an evidence state with reasons, never a single score. READY requires every dimension supported by stated evidence; any unknown blocks READY. | C, D | P3, P4 | Not started |
| P6 | **Review queue + recheck policy.** Durable per-candidate queue state (resume after interruption, pending items never erased by a new collection), recheck triggers (new relevant, meaningful change, profile/rule version change, conditional job on evidence change or bounded schedule), skip unchanged completed reviews, respect applied/rejected history, per-employer cap per batch, explainable priority reasons. Rule/normalization versions stored with every assessment. | C, F | P5 | Not started |
| P7 | **Bounded source discovery.** Separate manual workflow: start from registry `careers_url`s, detect Greenhouse/Lever/Ashby links and board ids, read permitted sitemaps/JSON-LD `JobPosting` within explicit scope, max pages, depth and request budget. Writes `proposals/` for review only; nothing enters recurring collection without validation via `registry.py`. Reuses PR #1 robots/limits. | B | P2, PR #1 merged | Not started |
| P8 | **Fold `pages.json` into the registry** as `provider: career_page` sources; consolidate README/OPERATIONS with `docs/`. | A, L | P2, PR #1 merged | Not started |
| P9 | **Tool evaluations (only on demonstrated gaps).** Trafilatura: only if P3/P4 fixtures show stdlib `HTMLParser` or Crawl4AI markdown failing on ordinary HTML. DuckDB: no DuckDB code exists in this repo today (only a `.gitignore` entry); consider it only if P6 queue queries outgrow JSON. JobSpy: optional, disabled discovery experiment. Licenses checked from primary sources at evaluation time. `pip-audit` (free) for `requirements-crawl.txt` once PR #1 merges. | K, I | P3/P4 evidence | Not started |
| P10 | **Schedule and cost.** Hourly ticks on a private repo cost about 720 of 2,000 free minutes a month even when every tick skips (PR #1 OPERATIONS note). With per-source due scheduling from P2, a `23 */5 * * *` cron loses nothing for 5-hour sources. Owner decision; deferred to avoid editing the same workflow lines as PR #1. Measure real runtime from Actions logs first (local trial: 37 s collection, plus checkout and setup). | J | PR #1 merged | Needs decision |

## Out of scope by instruction

No repository visibility changes, no new external endpoints, no edits to live ChatGPT tasks or Google Sheets, no paid APIs/proxies/LLM calls/hosting, no CAPTCHA solving or stealth, no Activepieces, vector database, multi-agent framework or dashboard.
