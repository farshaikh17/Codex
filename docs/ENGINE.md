# Job engine: audit, plan and integration boundaries

Status: steps 1 and 2 implemented and tested offline. The complete engine is **not** proven to work; that needs the end-to-end acceptance test in step 9.

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

Step numbers match `docs/BACKLOG.md` in farshaikh17/Codex#3 (E1 = step 1, and so on).

1. **Posting store (done).** `engine/store.py`: stable IDs, canonical URLs, content hashes, versions, observations, and the four availability states. It ingests the collector's snapshots idempotently.
2. **Extraction records (done for ATS postings, section 6).** Evidence items per posting version, mandatory and preferred requirements kept apart, verbatim pay text, field states, extraction warnings, and named change kinds. Trafilatura was evaluated and not adopted (section 6).
   **2b. Crawl4AI leads (done, docs/LEADS.md).** PR #1's page captures are ingested as *source pages / leads* (section 3), never as postings. Real-capture tests run once PR #1 is merged.
3. **Candidate configuration and isolation.** A `candidates/` loader for a private config path outside Git (an environment variable). The config holds a profile version, a rules version and gate definitions. Synthetic fixtures only in Git. Missing facts stay `unknown`.
4. **Evidence-based gates.** Configurable gates for geography, engagement, experience, salary and prior applications. Each result is `pass` / `fail` / `unknown` with evidence (posting version hash, field, quoted span) or an explicit unknown reason. Keyword relevance is a separate score that never sets a gate.
5. **Durable review queue.** Per-candidate queue keyed on (candidate, posting, content hash, rules version, profile version). States are pending, in_progress (with a lease), conditional and completed. Each decision is committed before the next item. Expired leases are recovered. Reassessment happens only when one of those keys changes. Being indexed is never treated as reviewed. Reports keep the assessed, newly qualified and open READY counts separate.
6. **Consumer outputs.** A compact source/status index, bounded review batches with a cursor, per-posting records with evidence and hashes, and a schema version on every file. Existing `public/` paths stay unchanged. Candidate outputs go to a private location agreed with the consumer, never to `public/` (see section 4).
7. **Google Sheets adapter interface.** A protocol plus a fixture-backed fake. Writes are idempotent upserts keyed on posting and decision IDs, with a write journal for recovery after partial failure. No live Sheets calls in this repo's tests.
8. **Reliability (engine side done, docs/RELIABILITY.md).** `python -m engine.run`: a run lock across processes, a run history (store schema 4), freshness and partial-run reporting, counts, an extraction time budget and tolerance of sources the collector didn't attempt. Actual AI usage is recorded only when the consumer reports it. Per-source backoff and request budgets are collector-side, in `collect.py`, built by the collector's PR chain.
9. **Scheduling and acceptance (offline acceptance done; see docs/SCHEDULING.md).** `python -m engine.acceptance` passes end to end, offline, with synthetic candidates, and `engine.yml` runs it on demand only. Still open: re-verify the Actions no-spend controls (owner, billing access), decide where the store persists between runs (D3), and run the consumer-side acceptance (live Sheets, ChatGPT access). Until those pass, nobody should say the complete engine works.

## 3. Crawl4AI integration boundary (proposed; needs acknowledgement from the Crawl4AI owner)

- **Ownership.** The Crawl4AI work owns `crawl_pages.py`, `pages.json`, `test_crawl_pages.py`, `.github/workflows/crawl-pages.yml`, `requirements-crawl.txt` and `public/pages/**`. Engine PRs do not edit those files, `collect.py`, `adapters.py`, `collect.yml`, `OPERATIONS.md`, `README.md` or `MIGRATION.md`. Exception, owner-requested: the `collect.yml` test scope and branch filter (docs/SCHEDULING.md). Engine documentation lives in `docs/`.
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

## 6. Extraction records (step 2)

```
python -m engine extract                      # extracts every stored version not yet extracted at the current extractor version
python -m engine show --posting greenhouse:gitlab:8860302002   # one readable record: identity, availability, changes, evidence
```

`engine/extract.py` is deterministic and uses only the standard library: no network, no LLM, no confidence percentages. It reads one stored posting version and returns evidence for six fields: `location`, `workplace`, `employment_type`, `compensation`, `requirements_mandatory` and `requirements_preferred`.

**Evidence item** (`evidence-1`): `{field, source_url, retrieved_at, quote, interpretation, method, schema_version}`.
- `quote` is always a verbatim span of the posting's own text. A test checks this for every committed posting.
- `retrieved_at` is when this content version was first retrieved.
- `method` names where the quote came from: `ats_field:<name>`, `description_section:<heading>`, `inline_marker_in:<heading>`, `location_text`, `description_text` or `title`.
- `interpretation` is filled only for explicit wording. Workplace is `remote`, `hybrid` or `onsite`. Employment type is `full_time`, `part_time`, `contract`, `internship` or `temporary`. Pay is parsed ranges. Locations, location restrictions and requirements are quoted, never interpreted: geography and qualification judgements belong to the candidate gates (step 4).

**Field states:**
- `stated`: at least one item.
- `not_stated`: text was read and nothing was found.
- `not_retrieved`: there was no description to read.
- `conflicting`: two explicit interpretations disagree, for example PostHog `Remote (US)` against the feed field `OnSite`. Quotes without an interpretation never create a conflict.

**Requirements.** Descriptions are split at recognised headings, calibrated on the committed postings: "What you'll bring", "Qualifications", "\*Required", "Desired", "Nice to have" and others. Lines in a mandatory section that say "is a plus", "preferred", "helpful, but not required" and so on move to preferred, unless they say "(required)". Mandatory text is kept in full, as contiguous verbatim runs. Unrecognised short lines stay content, so a section can run into an unfamiliar following heading. A description with no recognised requirement heading gets `requirements_not_sectioned` and is never guessed.

**Compensation.**
- Sources: the feed field (Ashby summary split at `•`, Lever `salaryRange`, Greenhouse `pay_input_ranges`), "Compensation" or "… Salary Range" sections, and lines with pay wording that contain an amount.
- An amount counts only with a currency or a `K` suffix, so years, `401(k)` and "40 days off per year" are ignored.
- Ranges keep the original units. There's no currency or period conversion, and `$` is not assumed to be USD (`currency` is set only from an explicit code). Lakh and crore are recorded in `amount_unit`, not multiplied.
- Recorded separately: `basis` (`base`, `ote` or `unspecified`), `estimated`, `variable_mentioned`, `equity_mentioned` and `multiple_ranges`.

**Warnings and state.** Possible warnings: `empty_description`, `thin_description` (under 80 words), `navigation_only`, `possibly_truncated`, `list_captured_as_description`, `compensation_signalled_not_found` (strong pay wording such as "base salary" or "pay range" with no amount) and `requirements_not_sectioned`. The state is `failed` (empty), `thin`, `uncertain` (any other warning) or `ok`.

**Store (schema 2, migrated automatically from 1).**
- `extractions` and `evidence` are keyed by (posting, content hash, extractor version). They are independent of any candidate, so unchanged content is never re-extracted. A new `EXTRACTOR_VERSION` re-extracts everything and keeps the old rows.
- `extract_pending` commits every 100 versions, so an interrupted run resumes where it stopped.
- `version_changes` records the fields that changed in each content change, with a kind:
  - `content_changed`
  - `compensation_source_added`: only the pay field appeared, for example after the collector enables Greenhouse `pay_transparency`.
  - `compensation_removed`
  The review queue (step 5) uses this to recheck only salary gates when pay is newly published, instead of reassessing the whole role. Migration rebuilds this history from schema 1 observations.

**Measured on the committed snapshot (532 postings).**
- States: 502 `ok`, 30 `uncertain`, 0 `thin` or `failed`.
- Warnings: `requirements_not_sectioned` 26 (mostly Clipboard, whose descriptions have no requirements heading) and `compensation_signalled_not_found` 4. Two of the four are correct (PostHog: "base salary component, plus a bonus" with no amount). Two are false (Oyster duties mention the "EU Pay Transparency" directive).
- Compensation stated: 213. Mandatory requirements stated: 501. Preferred: 318. Workplace conflicting: 4. Employment type stated or conflicting: 9. Most postings don't state it in role wording; boilerplate such as "How GitLab Supports Full-Time Employees" is deliberately not counted.

**Known gaps.**
- The collector drops Ashby `employmentType` and Greenhouse `metadata`, so employment type relies on text. Fixing that is a collector change, owned by PR #3's area.
- Greenhouse feeds don't request `pay_transparency` yet (BACKLOG E2 measurement).
- Heading patterns are English only.
- Section boundaries depend on known headings.

### Trafilatura evaluation (2026-10-26)

- **Licence and dependencies, verified from PyPI and the installed metadata:** trafilatura 2.3.1, Apache-2.0. It installs 18 packages, including lxml 6.1.3 (C extension, BSD-3-Clause), dateparser, regex (Apache-2.0 AND CNRI-Python), certifi (MPL-2.0) and `tld` (MPL-1.1 OR GPL-2.0-only OR LGPL-2.1-or-later; the MPL option would be chosen). All are free and open source.
- **Synthetic comparison:** on ATS description fragments, the shape every current source delivers, the standard-library `html_to_text` and Trafilatura both kept 5/5 requirement bullets and the pay line. On a full page with navigation and footer, Trafilatura removed the boilerplate and the standard library leaked it.
- **Decision: not adopted.** The engine has no full-page HTML input today. Crawl4AI captures arrive as its own markdown, and ATS feeds are fragments. Trafilatura would add 18 packages and break the install-free CI for no measured gain.
- **Revisit when** primary-posting-page verification fetches single job pages. Swapping converters changes text (for example, it adds `- ` bullets), so it needs a `CONTENT_HASH_VERSION` and `EXTRACTOR_VERSION` bump to avoid false content changes. This was one synthetic comparison, not a benchmark; the step H fixtures should repeat it.

**Extractor version 3 (Ashby tiers, Greenhouse labels).** When the collector writes Ashby pay as `{"source":"ashby.compensationTiers",...}` (collector normalization_version 2), each tier component becomes one evidence item, method `ats_field:compensationTiers`, quoting the component's JSON exactly as it appears in `compensation_raw`:
- Currency comes from `currencyCode` only; null stays null, and `$` is never read as USD.
- Period comes from `interval` (`1 YEAR` → year; `NONE` or an unknown interval → null, kept in `interval_raw`).
- Basis comes from `compensationType` (Salary → base; Bonus and Commission → variable; Equity* → equity). `EquityPercentage` amounts carry `amount_unit: percent`.
- Null amounts give no range. `label` is the tier title (for example "Canada"). A tier's `additional_information` (for example "Estimated OTE:  65K-80K USD") is a separate item, quoted verbatim with no interpretation, never parsed into amounts. Nothing is converted, annualized or merged across tiers.

Greenhouse labels (title and blurb) are now plain text instead of HTML; period stays null because Greenhouse publishes none. On real feeds saved 2026-10-26, Oyster pay went from one range with currency null to Salary ranges in 12 stated currencies, and Zapier gained its INR tier. Bumping `EXTRACTOR_VERSION` makes `extract` redo stored versions lazily.

## 7. Persistence and recovery (before any scheduled use)

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
