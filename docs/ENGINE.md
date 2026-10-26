# Job engine: audit, plan and integration boundaries

Status: foundation only. The complete engine is **not** proven to work; that needs the end-to-end acceptance test in step 9.

## 1. Audit (main at aa6f50c, build/crawl4ai at ce9c4fa, 2026-10-26)

| Area | What exists | Reuse decision |
|---|---|---|
| ATS collection | `collect.py`: Greenhouse, Lever, Ashby feeds from `sources.json`; one request per feed, 2 s spacing, 25 s timeout, 25 MB cap, no redirects, host allowlist, no retries. A failed source keeps its previous jobs. | Keep unchanged. The engine reads its outputs. |
| Normalisation | `adapters.py`: full descriptions, locations with provenance, `compensation_raw`, stable `key` = `provider:board:req_id`. | Keep. `key` becomes `posting_id`. |
| Outputs | `public/status.json`, `public/index.json` (schema `public-job-index-1`), `public/boards/<id>.json` (`public-job-board-1`). The `observed_at` field is rewritten on every successful run. `content_hash` covers URLs and the publish date. History is lost on each overwrite. | Paths kept. Durable history moves into the store. |
| Storage | None. No DuckDB code; only `*.duckdb` in `.gitignore`. | New store, see the decision below. |
| Tests | `test_collect.py` (4 tests, standard library). CI runs `python -m unittest -v` with **no pip install step**. | New tests must be standard library only. |
| Scheduling | `collect.yml`: hourly cron with a 5-hour gate and a concurrency group. On main, **push of any root `*.py` on any branch triggers a live collection**. build/crawl4ai fixes this with `branches: [main]`. | Engine code lives in `engine/` (not matched by `*.py`). The workflow is not edited here. |
| Crawl4AI | build/crawl4ai, not merged, no PR: `crawl_pages.py`, `pages.json`, `public/pages/index.json` (`public-page-capture-index-1`), `public/pages/captures/<id>.md`, manual workflow. | Not touched. Consumed through the contract in section 3. |
| Candidates, queues, screening, Sheets | None in the repo (by design). Profiles and ledgers are in private Google Sheets. | Built in later PRs. |
| Spending | MIGRATION.md records an Actions budget of $0.00 with usage blocked. This was **not re-verified in this session** (no billing access). The hourly cron costs about 720 of the 2,000 free minutes a month even when gated. | Re-verify before adding any schedule (step 9). |

**Storage decision: SQLite (Python standard library), not DuckDB.** No DuckDB store exists to reuse. Adding the `duckdb` package would break the current CI, which installs nothing, unless `collect.yml` is edited, and the Crawl4AI branch also edits that file. SQLite gives atomic transactions, WAL concurrent readers and `BEGIN IMMEDIATE` writer exclusion, which the review queue needs for claims and leases. DuckDB can still be used read-only for analysis later (`ATTACH ... (TYPE sqlite)`), without being a runtime dependency.

## 2. Dependency-ordered plan

Each step is one bounded PR. Later steps depend only on earlier ones.

1. **Posting store (this PR).** `engine/store.py`: stable IDs, canonical URLs, content hashes, versions, observations, and the four availability states. It ingests the collector's snapshots idempotently.
2. **Extraction records.** Per-version extraction metadata: description and requirement sections, verbatim salary text, word counts, and `thin` / `uncertain` / `failed` flags. Ingest Crawl4AI page captures as *source pages / leads* (section 3), never as postings. Evaluate Trafilatura for ordinary HTML in a separate spike. It was not adopted here: its current licence and dependency tree must be checked at adoption time, and it is unnecessary for the JSON ATS feeds.
3. **Candidate configuration and isolation.** A `candidates/` loader for a private config path outside Git (an environment variable). The config holds a profile version, a rules version and gate definitions. Synthetic fixtures only in Git. Missing facts stay `unknown`.
4. **Evidence-based gates.** Configurable gates for geography, engagement, experience, salary and prior applications. Each result is `pass` / `fail` / `unknown` with evidence (posting version hash, field, quoted span) or an explicit unknown reason. Keyword relevance is a separate score that never sets a gate.
5. **Durable review queue.** Per-candidate queue keyed on (candidate, posting, content hash, rules version, profile version). States are pending, in_progress (with a lease), conditional and completed. Each decision is committed before the next item. Expired leases are recovered. Reassessment happens only when one of those keys changes. Being indexed is never treated as reviewed. Reports keep the assessed, newly qualified and open READY counts separate.
6. **Consumer outputs.** A compact source/status index, bounded review batches with a cursor, per-posting records with evidence and hashes, and a schema version on every file. Existing `public/` paths stay unchanged. Candidate outputs go to a private location agreed with the consumer, never to `public/` (see section 4).
7. **Google Sheets adapter interface.** A protocol plus a fixture-backed fake. Writes are idempotent upserts keyed on posting and decision IDs, with a write journal for recovery after partial failure. No live Sheets calls in this repo's tests.
8. **Reliability.** Per-source backoff and request budgets, a run lock across processes, freshness and partial-run reporting, and counts (collected, duplicates, exclusions, pending, verified). Actual AI usage is recorded only when the consumer reports it.
9. **Scheduling and acceptance.** Re-verify the Actions no-spend controls, decide where the store persists between runs, then run the end-to-end acceptance test with synthetic candidates. Only after that may anyone say the engine works.

## 3. Crawl4AI integration boundary (proposed; needs acknowledgement from the Crawl4AI owner)

- **Ownership.** The Crawl4AI work owns `crawl_pages.py`, `pages.json`, `test_crawl_pages.py`, `.github/workflows/crawl-pages.yml`, `requirements-crawl.txt` and `public/pages/**`. Engine PRs do not edit those files, `collect.py`, `adapters.py`, `collect.yml`, `OPERATIONS.md`, `README.md` or `MIGRATION.md`. Engine documentation lives in `docs/`.
- **Interface.** The engine reads only `public/pages/index.json` (schema `public-page-capture-index-1`) and the `capture_file` it names. It relies on these fields: `id`, `employer`, `official_url`, `capture_status`, `captured_at`, `changed_at`, `content_hash`, `fresh_this_run`, and `last_attempt.{at,result,reason}`. A schema bump on that side should be a new schema string. The engine will refuse unknown schemas rather than guess.
- **Semantics.** A page capture is a listing page, not a posting. The engine stores it as a source page with its own hash history. Roles found in it become *leads* that need a primary posting before screening. `failed` and `blocked` map to the store's `inaccessible`; `thin` is recorded as thin content, never as "no jobs".
- **Shared helpers.** `crawl_pages.py` imports `read` and `write` from `collect.py`. Keep those signatures stable.
- **Workflow.** The `branches: [main]` push filter on build/crawl4ai should merge before any PR that adds root-level `*.py`.

## 4. Consumer access (private repository)

The repository is private. Consumers must read it through an authenticated GitHub connector or a token scoped to this repository; public raw URLs will not work. The store file (`state/engine.sqlite3`) is git-ignored and is not a consumer interface. Consumers will read the versioned JSON outputs produced in step 6. Candidate-specific outputs must not be committed under `public/`. Their location (private repository path, private artifact, or Sheets only) is a decision for the owner before step 6.

## 5. Posting store reference (step 1)

```
python -m engine ingest   # reads public/status.json + public/boards/*.json into state/engine.sqlite3
python -m engine summary  # counts by availability, freshness per source, duplicate canonical URLs
```

- `posting_id`: the collector `key` (`provider:board:req_id`). `canonical_url` lowercases the scheme and host and drops the fragment, default port, trailing slash and known tracking parameters (`utm_*`, `gh_src`, `lever-source`, ...). Identifying parameters such as `gh_jid` are kept. It is indexed for cross-source duplicate detection.
- `content_hash` (version 1): SHA-256 of title, sorted location texts, workplace type, description and compensation text, with whitespace normalised. Retrieval time, URLs, publish date and change labels are excluded, so re-fetching identical content is never a change. The collector's own hash is kept as `posting_versions.source_hash`.
- Time fields: `last_seen_at` (last successful retrieval that listed it), `last_checked_at` (last successful retrieval of its source), and `content_changed_at` / `posting_versions.first_seen_at` (when the content actually changed). These are independent.
- History: `posting_versions` keeps every distinct content version in full. `observations` records each retrieval outcome per posting. `source_runs` records each source attempt with its status and error.
- Availability: `listed`; `missing` (absent from a *successful* retrieval, not proof of closure); `inaccessible` (the source's latest retrieval failed); `expired` (only through `mark_expired()` with evidence, and kept through later absences). Reappearing returns a posting to `listed` and records why.
- Safety: each snapshot is ingested in one `BEGIN IMMEDIATE` transaction, so any error rolls everything back. Re-ingesting the same snapshot, or an older one, is skipped. A board file whose `collected_at` does not match `status.json` is skipped with a warning (this protects against reading a half-published commit). A concurrent writer waits up to its timeout, then fails without writing. Readers are not blocked.
- Limits: timestamps compare as ISO strings from the collector's single format. The store does not yet persist between Actions runs; it can be rebuilt by replaying committed snapshots in order (verified on the three snapshots in Git history). Persistence is decided in step 9.

## 6. Persistence and recovery (before any scheduled use)

The SQLite file is a cache, not the record. The record is (a) every collector snapshot already committed to Git and (b) `data/posting-events.jsonl`, a committed journal for facts no snapshot contains (today only expiry evidence). Nothing else needs to persist between Actions runs, and no binary database is committed.

```
python -m engine rebuild [--ref origin/main]   # replay every commit that changed public/status.json, oldest first, then the journal
python -m engine check                         # PRAGMA integrity_check; non-zero exit means delete the file and rebuild
```

- Rebuild uses `git log --reverse -- public/status.json` and `git show` per commit. It refuses a shallow clone (Actions needs `actions/checkout` with `fetch-depth: 0`).
- Journal events are applied at their place in time: an expiry is applied before the first snapshot attempted after it, so a later relisting still wins. The journal accepts only `{event: expired, posting_id, at, evidence}`; any other event type or key is refused, so candidate information cannot reach the committed file through this module. `record_expiry()` writes the store and the journal together.
- Tested (`engine/tests/test_persist.py`, synthetic Git repositories): a rebuild equals the incrementally built store table for table; a rebuild interrupted mid-way resumes on rerun to the same result; expiry evidence survives rebuild and a later relisting wins; a corrupted cache file fails `check` and a fresh rebuild restores it; a shallow clone is refused.
- Measured on this repository's real history (`--ref origin/main`, 2026-10-26): 3 snapshot commits, 30 source retrievals, 533 listed postings, 535 versions, integrity ok, two rebuilds identical, 2.3 s.
- Proposed Actions use (not added; no schedule in this PR): restore `state/engine.sqlite3` from `actions/cache` keyed on the last ingested commit as an accelerator, run `check`, and on a miss or failure run `rebuild`. Cache storage and full-history checkout use only free Actions features. Rebuild time grows with the number of snapshot commits (about 0.75 s each now); re-measure before relying on cold rebuilds.
