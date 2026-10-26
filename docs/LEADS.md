# Career-page captures as leads (engine step 2b)

Status: implemented and tested offline, and run on the real committed captures of farshaikh17/Codex#1 in a scratch merge. Not scheduled. The engine is not proven end to end.

This builds on the posting store (farshaikh17/Codex#2). It adds `engine/leads.py`, store schema 3 (page and lead tables, migrated automatically) and tests. It edits none of #1's files.

## Boundary (acknowledged by #1's owner on PR #2)

- The engine reads only `public/pages/index.json` and the `capture_file` each page names.
- The index must be `public-page-capture-index-3`; anything else is refused, as #1's contract requires.
- A capture is a **listing page, not a posting**. Roles found in it become **leads**. Leads are never screened and never enter the review queue. A lead needs its primary posting before any decision.
- **Which links are postings** is decided by the capture side's own `crawl_pages.job_links()`. The engine calls it rather than re-implementing it, and requires its result to equal the `job_links` count published in the index. If the count differs, or the capture file's `content_hash` header doesn't match the index, no leads are taken from that capture and a warning names why.
- If `crawl_pages.py` isn't in the checkout, pages are still recorded and no leads are guessed.
- Proposed improvement for #1's owner: publish the posting links themselves as an additive per-page field. Their stability rule allows that. The engine would then read links from the index and stop calling `job_links()`.

## What is stored (shared store, public data only)

| Table | Content |
|---|---|
| `pages` | One row per allowlisted page: employer, official URL, state, latest attempt, the stored capture's hashes, `review_basis`, `listing_quality`, `coverage`, flags, `job_links`, `claimed_total`. |
| `page_attempts` | Each attempt (at, result, reason, HTTP status, final URL), deduplicated by time. |
| `page_captures` | One row per distinct `review_hash`, so review-relevant changes are tracked, not raw text churn. It records how many leads were taken, or why none were. |
| `leads` | One per (page, posting link): label, URL, canonical URL, first and last seen, state, and the matched posting if any. |

**Page state**
- `captured`
- `inaccessible`: the latest attempt failed or was blocked. The earlier capture and its leads are kept, and the reason is recorded.
- `never_captured`

A changed `official_url` discards the page's earlier evidence, as the contract says.

**Lead state**
- `open`: seen in the latest review capture.
- `matched`: its canonical URL equals an ATS posting's URL or apply URL in the store, so the posting carries it.
- `not_in_latest_capture`: missing from a later capture whose coverage is `appears_complete`.
- `not_seen_partial_capture`: missing from a `partial`, `unknown` or `none_detected` capture. **That's never evidence a role is gone.**

A lead that reappears becomes `open` again.

## Commands

```
python -m engine.leads ingest [--root CHECKOUT]   # reads public/pages/ into the store; idempotent
python -m engine.leads write --out DIR            # leads.json (page-leads-1): pages, lead counts, every lead
```

`leads.json` is public page data with a notice: not postings, not screened, not READY evidence. Where it's published is an owner decision, like the other outputs (`docs/OUTPUTS.md`).

## Measured on #1's committed captures (index at 17:44 UTC, scratch merge)

- 6 pages, 6 attempts, 6 captures, **702 leads**: Atlassian 335, Canonical 333, Salesforce Workday 20, Automattic 12, Doist 2, Toggl 0.
- Every page's lead count equals its published `job_links`, with 0 warnings.
- Salesforce is `partial` (20 of 1,561 claimed) and Toggl is `none_detected`.
- A second ingest adds nothing.
- 0 leads matched an ATS posting: none of these employers are among the collector's ten feeds.
- `CommittedCaptureTests` repeats this check on any tree that has #1's files.

## Not done

- No lead is screened or queued. Promoting a lead needs its primary posting: through a new ATS source (registry, PR #3) or a person.
- The store rebuild from Git history (#6) replays feed snapshots only, not page captures. Page history would need the same treatment.
- Leads aren't deduplicated across pages, beyond the shared canonical-URL match to postings.
