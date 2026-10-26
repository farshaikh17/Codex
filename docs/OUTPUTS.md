# Consumer outputs (engine step 6)

Status: implemented and tested offline. **Where the files live is not decided** (D3). Every command writes only to an explicit `--out`, and nothing here is scheduled or committed. The engine is not proven end to end.

This builds on steps 1–5 (farshaikh17/Codex#2) and adds new files only: `engine/outputs.py`, its tests and this document. The existing collector outputs under `public/` and the workflows are untouched.

## Public posting outputs: `python -m engine.outputs postings --out DIR [--since CURSOR] [--limit 200]`

These contain public posting data only; a test checks that no candidate id, history entry or verdict appears in them.

| File | Schema | Content |
|---|---|---|
| `status.json` | `posting-status-1` | **Read first.** Generation time; versions (store schema, extractor, gates, content hash); `latest_cursor`; this run's changes page summary; totals by availability; extraction states; per-source freshness (last attempt, last success, counts); and the SHA-256 of `index.json` and `changes.json`. |
| `index.json` | `posting-index-1` | One compact row per posting, including missing and expired ones: `posting_id`, `title`, `source_id`, `availability`, `content_hash`, `last_change`, `last_seen_at`, `last_checked_at`, `extraction_state`, `record`, `record_sha256`. |
| `changes.json` | `posting-changes-1` | A bounded page of postings whose content or availability changed after `--since`: `cursor_from`, `cursor_to`, `has_more`, `entries`. |
| `records/<provider>__<board>__<req_id>.json` | `posting-record-1` | One readable record per posting: identity and URLs, availability with its reason, `first_seen_at`, `content_changed_at`, `content_hash`, the full content (title, locations, workplace, description, pay text), its change history (`fields`, `kind`) and the extraction (state, warnings, every evidence item with quote, method, source URL and retrieval time). |

**Write order and integrity**
- Records, then `changes.json`, then `index.json`, then `status.json` last. Each file is written to a temporary name and renamed.
- If a run stops part-way, `status.json` still describes the previous complete write. `python -m engine.outputs verify --out DIR` then reports the mismatch, and rerunning the export repairs it (both tested).
- Records hold only what describes the posting, not retrieval times, so a collection that finds nothing new rewrites no record file. On the committed snapshot, the first export writes 532 records (8.2 MB); an immediate second export rewrites 0.

**Cursor**
- `pc1|<last_change>|<posting_id>`, where `last_change` is the later of the content change and the availability change.
- It's built from collector timestamps, not database row ids, so it survives a store rebuild from Git (farshaikh17/Codex#6).
- A reader keeps the last `cursor_to`, passes it as `--since`, and loops while `has_more`.
- A posting that changes again later reappears in a later page; deduplicate by `posting_id` and `content_hash`. Tests check that paging covers every posting exactly once, and that afterwards only changed or disappeared postings appear.

## Private review batches

```
python -m engine.outputs batch --out PRIVATE_DIR --candidates DIR --candidate ID --worker NAME [--batch-size 10] [--per-employer-cap 3]
python -m engine.outputs submit-batch --response PRIVATE_DIR/batch-<id>.response.json --candidates DIR --worker NAME
```

- `batch` claims a bounded batch from the review queue (step 5) and writes two files:
  - `batch-<id>.json` (`review-batch-1`): each item's posting text, gate evidence, requirement lines and lease expiry.
  - `batch-<id>.response.json` (`review-response-1`): a template with every pending requirement line pre-listed by id, with `decision` and `evidence` set to null, plus empty `findings` and `usage`.
- `submit-batch` submits each answered item in its own transaction.
  - **Safe to rerun after a partial failure:** items this worker already submitted are reported as `already_submitted`; unanswered items are `skipped_unanswered`, and their lease simply expires.
  - An error on one item (for example, a finding whose quote isn't in the posting) is reported, and the other items still go through.
  - The exit code is 1 if any item failed.
- `--out` inside the repository is refused.

## Private decision feed: `python -m engine.outputs decisions --out PRIVATE_DIR --candidates DIR --candidate ID [--since CURSOR]`

`decisions-<candidate>.json` (`decision-feed-1`) holds the queue events after the cursor, oldest first.

**Events included:**
- an automatic decision made when the item was created
- `reviewed`
- `decided_by_duplicate_review`
- `superseded`

**Each entry carries:**
- `detail`: what was true when the event happened, from the queue's append-only log.
- `current`: the item now, including its state, outcome, decided-by, verdict, blocking gates, every gate's result, reason and evidence quotes, and `superseded_by` / `duplicate_of`.
- the posting id, content hash, and the rules, profile, gates and extractor versions.

**A `superseded` entry's `current.outcome` is the old item's outcome and is no longer valid.** Treat the posting as re-review pending (the Sheets adapter does). The optional `posting` block gives title, employer, canonical URL and availability for readable rows.

**Cursor:** `df1|<event seq>`. Events filtered out still advance it, so a reader never re-reads them. This is the input the Sheets adapter (step 7) will consume idempotently.

## Compatibility plan

- **Existing paths stay.** `public/status.json`, `public/index.json` and `public/boards/*.json` (collector, PR #3's contract) and `public/pages/**` (PR #1) are unchanged. Current consumers need no change.
- **New posting outputs are additive.** If the owner wants them committed, the natural place is a new directory such as `public/postings/`, written by a workflow step after the collector. That's the same contract style as PR #3/#5: status last, hashes, schema strings, additive fields keep the schema id, breaking changes bump it. **Not done here:** it needs a workflow change and a decision on how to persist the store between runs (PR #6), and both are owner decisions.
- **Candidate outputs never go under `public/`, or anywhere in this repository.** Options for the owner (D3):
  - a private directory on the machine that runs the queue
  - a separate private repository
  - the Google Sheets ledger only, through the step 7 adapter

## Consumer access

The repository is private.
- The posting outputs, once committed, are readable only through an authenticated GitHub connector or a repository-scoped token. Public raw URLs won't work.
- Candidate outputs are private files. They reach ChatGPT only through whatever private channel the owner chooses: a private repository with its own scoped access, or the Sheets adapter.
- Nothing here creates an endpoint, and no access has been verified with the ChatGPT consumer (`docs/CONSUMER_TEST.md` on PR #3 covers the public files).
