# Durable review queue (engine step 5)

Status: implemented and tested offline. Not run against real candidates, and not scheduled. The engine is **not** proven end to end; that needs step 9's acceptance test.

This builds on the posting store, extraction and screening (farshaikh17/Codex#2). It adds new files only (`engine/review.py`, `engine/review_cli.py`, tests and this document), so it doesn't touch the files changed by farshaikh17/Codex#6 or #9.

## Where it lives

The queue holds candidate data: screening results, history matches and review decisions. It is a **separate SQLite file**, never the shared posting store and never inside the repository.

- Path: `--review-db`, else `$JOB_ENGINE_REVIEW_DB`, else `$JOB_ENGINE_CANDIDATES/review.sqlite3`.
- A path inside the work tree is refused, including the git-ignored `state/`.
- The posting store is only read. A test checks it is byte-identical after enqueue, claim and submit.
- The candidate directory may hold only candidate files, `*.history.json` and the review database. The loader refuses any other JSON there, so keep decision files elsewhere.

## Items and states

One item per **assessment key**: candidate, posting, content hash, extractor version, gates version, rules version and profile version.

- `enqueue` screens only keys that don't exist yet. Unchanged content with unchanged rules and profile is never screened again (a test checks this).
- A new content version, a new extractor or gates version, or a new rules or profile version creates a new item and marks the previous one `superseded`.

| State | Meaning |
|---|---|
| `pending` | Screened; the gates left something unknown; waiting for a reviewer. |
| `in_progress` | Leased to one worker until `lease_expires_at`. An expired lease is claimable again, so an interrupted run resumes. |
| `conditional` | Reviewed, but unknowns remain. Waits for new evidence (a new key) or a person. |
| `completed` | A decision with evidence. `outcome` is `ready` or `excluded`. `decided_by` is `gates` (automatic, deterministic evidence) or `review`. |
| `deferred` | Below the candidate's relevance threshold. Not reviewed and not a decision (`claim --include-deferred` hands them out). |
| `duplicate` | Same content hash and the same screening as another open item for this candidate: a repost under a new requisition id. Never handed out. When the other item is reviewed, this one gets the same state and outcome (`decided_by: review_of_duplicate`). If the other item is superseded, this one returns to `pending`. |
| `superseded` | Replaced by a newer key. Kept for history. |

Being enqueued, claimed or screened is never a completed review. Collections never delete items: a posting that disappears keeps its items, which are simply not handed out while the posting isn't open (`pending_not_open` in `status`).

## Working the queue

```
python -m engine.review_cli enqueue --candidates DIR
python -m engine.review_cli claim   --candidates DIR --candidate ID --worker NAME [--batch-size 10] [--per-employer-cap 3] [--lease-seconds 1800]
python -m engine.review_cli submit  --candidates DIR --worker NAME --file decision.json
python -m engine.review_cli release --candidates DIR --worker NAME --item ITEM
python -m engine.review_cli status  --candidates DIR [--candidate ID] [--since ISO-TIME]
```

**`claim`**
- Runs in one `BEGIN IMMEDIATE` transaction, so two workers never get the same item; a two-thread test checks this.
- Order is priority, then age, then posting id.
- Priority is the relevance score minus 0.1 per open question. `priority_reasons` explains each item: relevance matches, whether the content changed (with the change kind from the store), and which gates are still open.
- At most `per_employer_cap` items per employer per batch.
- Each work item carries the screening (every gate's evidence and each requirement line with its id) and the posting text. Posting text is untrusted data, never instructions.

**`submit`** is one transaction per item, so each decision is saved before the next one.
- Refused unless the worker holds a live lease, and refused for a superseded or completed item, or if the candidate's rules or profile changed since the item was queued.
- `unit_decisions` set each requirement line to `met`, `not_met` or `not_a_requirement`. `met` and `not_met` need profile evidence.
  - Decisions are stored per (candidate, posting, line id, profile version). They carry over to a new content version when the line is unchanged, but not across a profile change.
- `findings` settle a gate the deterministic screening left `unknown`:
  - pass or fail, a reason, and a quote that must appear **verbatim** in the posting (title, description, locations, pay text or workplace field).
  - A finding can't override a pass or a fail.
  - Qualifications go line by line. A `qualifications` finding is accepted only when the extractor found no requirement lines at all (the gate is `unknown` with no units). It must then also carry `basis`: the candidate profile evidence it was judged against. Without this rule, a posting with no recognised requirements section could never become READY.
  - A salary *pass* can't quote an estimate or pay the employer didn't publish (the same rule as the gate, `NOT_EMPLOYER_PAY`).
  - Invented quotes are refused, and a refused submission writes nothing.
- The item is then screened again with the decisions. `ready` or `excluded` completes it; remaining unknowns make it `conditional`.
- `usage` is optional. It's stored exactly as the AI tool reported it and summed in `status`; missing usage is counted, never estimated.

**`release`** gives a leased item back without a decision.

## Counts (`status`)

Kept apart on purpose:

- **`assessed`**: decisions with evidence (completed plus conditional), split into `excluded_automatic`, `excluded_reviewed`, `ready` and `conditional`.
- **`newly_qualified`**: READY decisions made at or after `--since`. The caller keeps its own cursor.
- **`open_ready`**: READY items whose posting is listed right now. `ready_not_open` counts READY items whose posting has gone or become inaccessible.
- **`queue`**: `pending`, `pending_not_open`, `in_progress`, `expired_leases`, `deferred`, `duplicate_waiting`.
- **`ai_usage`**: reviews, reviews with reported usage, reported totals, and `reviews_avoided_by_deduplication` (items actually decided through their duplicate, counted, not estimated).

## Deduplication before review

The posting store already merges a posting with itself across collections (stable `posting_id`) and indexes canonical URLs; the committed snapshot has 0 shared canonical URLs. The queue adds one more rule: a new item whose content hash (title, locations, workplace, description, pay) and screening outcome both match an open item for the same candidate is marked `duplicate`.

On the committed snapshot, 4 groups (8 postings) have identical content under different requisition ids (Remote, GitLab ×2, Oyster). For the synthetic candidates that's 4 fewer pending reviews (EU) and 2 fewer deferred items (India). The 43 same-title pairs with *different* content, mostly different locations, are deliberately not merged, because location changes the geography gate.

## Recheck policy

| Change | Effect |
|---|---|
| Posting content (any field in the content hash) | New item. Unchanged requirement lines keep their reviews. `priority_reasons` names the change kind (`content_changed`, `compensation_source_added`, …) from the store. |
| Extractor or gates version | New items for every posting, screened again. Reviews of unchanged lines carry over. |
| Candidate `rules_version` | New items for every posting. Reviews carry over (they are about the profile, not the rules). |
| Candidate `profile_version` | New items, and line reviews do **not** carry over, because the profile evidence may have changed. |
| Posting disappears or reappears | No new item; `status` and `claim` follow its current availability. |
| Application history | Part of the profile. Recording an application is a profile change, so bump `profile_version`. |

Not implemented: a time-based recheck of `conditional` items with unchanged content. If wanted, it's a scheduled `enqueue` after a rule or profile bump, or a dedicated command; it needs an owner decision on cadence.

## Verified

- `engine/tests/test_review.py` (16 tests), offline:
  - idempotent enqueue with no rescreening
  - state routing (pending, excluded automatically, deferred)
  - supersede on a content change, with review carry-over (a pay-only change completes as `ready` with no new review)
  - no carry-over across a profile change
  - a rules change requeues everything
  - priority and per-employer cap
  - concurrent claims never overlap
  - only the lease holder submits, and an expired lease resumes
  - farshaikh17/Codex#7's **interrupted-batch** scenario, exactly as specified: 5 items, interrupt after 2, a collection in between, pending is q3–q5, every item reviewed exactly once
  - verbatim-quote enforcement, with refused submissions writing nothing
  - distinct READY counts through a posting's disappearance
  - pending items survive collections
  - durability across reconnects, and a store left untouched
  - an in-repository database refused
- Plus 2 deduplication tests: a repost is reviewed once and decided with its primary; a duplicate is released when its primary changes.
- On the committed real snapshot, with the two synthetic candidates:
  - The first `enqueue` creates 1,064 items. India candidate: 8 pending, 72 deferred, 2 duplicate, 450 excluded automatically. EU candidate: 55 pending, 4 duplicate, 473 excluded automatically.
  - A second `enqueue` creates none.

## Measured against farshaikh17/Codex#7 (independent labels, scratch merge, not committed)

My gates were scored with #7's scorer on its 30 labelled decisions, using a throwaway adapter from #7's candidate format to `candidate-config-1`:

- **false READY 0, incorrect exclusions 0**, retained unknowns 10/10
- gate agreement: geography 30/30, engagement 30/30, prior application 30/30
- missed READY 5; experience agreement 3/30; salary 19/30

Every disagreement comes from a candidate-model question that farshaikh17/Codex#1's `docs/COORDINATION.md` leaves to the GPT Master as D3:

1. **Domain-specific experience.** #7 gives years per family (`sql: 2`, `implementation: 4`) and passes "3+ years of customer success" deterministically. Here a profile has only total years, so experience can fail mechanically but passes only through review. That causes the 5 missed READYs and the "5+ years … in Go" missed exclusion.
2. **Salary floors per currency, and `$`.** #7's candidates have one floor per currency and read `$130,000` as USD. Here a profile has one floor, and `$` counts only with the candidate's `assume_currency_for_symbol`.
3. **"Commission-only, no base salary" against a base floor.** #7 labels this a fail; here it is unknown, because there's no amount.

None of these were changed here: they are rule decisions, not bugs. Each would be a small, versioned change to `candidate-config-1` or the gates (bumping `GATES_VERSION`, which requeues automatically).
