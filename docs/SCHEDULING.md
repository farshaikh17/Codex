# Scheduling, cost and acceptance (step 9)

No new schedule is enabled by the engine. This page records what runs today, what each run costs in Actions minutes, what the acceptance test proves, and what must be checked before anything else is scheduled.

## What runs today

| Workflow | Trigger | Owner | Runtime | Billable minutes |
|---|---|---|---|---|
| `collect.yml` | `37 1,6,11,16,21 * * *` (5 a day), push to `main` touching root `*.py`/`sources.json`/the workflow, manual | collector (not engine) | 34–41 s per run in recent history | 1 per run, about 150 a month |
| `engine.yml` | **manual only** (`workflow_dispatch`) | engine | about 1 min (unit tests about 41 s, acceptance about 11 s, measured locally) | about 2 per manual run |
| `crawl-pages.yml` (farshaikh17/Codex#1) | manual | page capture | not measured here | — |

GitHub rounds each job up to a whole minute. Private repositories get 2,000 free minutes a month on the Free plan.

### Two `collect.yml` fixes (applied at the owner's request, 2026-10-26)

`collect.yml` belongs to the collector, outside the engine boundary (docs/ENGINE.md section 3). The owner asked for these two changes, and they are the only engine-side edits to it.

1. **Test scope.** The test step was `python -m unittest -v`. Unittest discovery would also find `engine/tests`, so once the engine merged, every collection would run the engine suite: about 1.5 min instead of 40 s, so 2 billable minutes instead of 1, or about 300 instead of 150 a month at 5 runs a day. The step is now `python -m unittest -v test_collect`, and the engine suite runs only in `engine.yml`.
2. **Branch filter.** The push trigger had no branch filter, so a push to any branch touching root `*.py`, `sources.json` or the workflow started a **live** employer collection. Its publish step (`git pull --rebase origin main`, `git push`) then failed on that branch. This happened once, when main was merged into `builder1` on 2026-10-26: run 40377774005 passed its tests, collected 10/10 sources and failed to publish, and nothing was pushed. The push trigger is now `branches: [main]`. Schedule and manual runs are unchanged.

## Billing verification (required before any new schedule)

MIGRATION.md records that the account billing page showed an Actions budget of $0.00 with **Usage blocked**. This session has no billing access and **has not re-verified it**. Before anything new is scheduled, the owner should check in the account's Billing → Budgets and alerts:

1. the Actions budget is $0.00 with "Stop usage when budget limit is reached" on;
2. no payment method allows overage for Actions;
3. this month's minutes used, so the added load fits inside the free quota.

Until that is confirmed, `engine.yml` stays manual.

## What could be scheduled later, and what can't

| Stage | Can run in Actions? | Why |
|---|---|---|
| Store ingest and extraction | Yes, after billing is verified | Public data only. The store (`state/engine.sqlite3`) would need a home: a cache or a committed file. That's an owner decision (D3). |
| Public outputs (`write_postings`) | Yes, same condition | Public data only. |
| Screening, review queue, decision feed, ledger sync | **No** | They need private candidate profiles and the private queue, which must never be in this repository or its Actions environment. They run where those files live (the owner's machine or the consumer side). |
| Reviewer work (AI review of pending items) | No | Done by the consumer (ChatGPT task) through review batches; usage is recorded only as reported. |

A daily ingest and extraction step would add about 1 billable minute per run (extraction is incremental; a no-change run does no work). It should run after a collection, not on its own clock.

## Acceptance test

`python -m engine.acceptance --out DIR` runs the whole engine offline against the committed snapshot with the synthetic candidates. It writes `acceptance.json` (schema `engine-acceptance-1`) and `acceptance.md`. `engine/tests/test_acceptance.py` runs it as part of the engine suite.

It uses a fixed clock and a temporary store and queue. It then makes a follow-up collection from the snapshot: one description changed, one posting removed, one source failed. Checks by area:

- **store**: every listing stored; re-ingest is a no-op; a change creates a version naming the field; a removed posting is `missing`; a failed source's postings are `inaccessible`.
- **extraction and efficiency**: every version extracted once; every evidence quote is verbatim; a second run does nothing; after the follow-up only the changed posting is re-extracted and re-screened, once per candidate.
- **leads**: captures yield leads matching the published link counts (only where `crawl_pages.py` and `public/pages/` exist, i.e. with farshaikh17/Codex#1; otherwise reported `not_run`, never `pass`).
- **isolation and screening**: screening writes nothing to the shared store; every pass and fail carries evidence; nothing is READY before qualifications are reviewed; candidate outputs inside the repository are refused; one candidate's feed is refused for another's sheet; public outputs carry no candidate id.
- **queue**: batch resubmission, lease expiry and resume, no double hand-out, READY path, reviewer exclusion, each item reviewed exactly once, disappeared postings keep their items.
- **ledger** (fake Sheets client): crash mid-sync recovers to the clean result; rerun is a no-op; human columns untouched; no duplicates; READY reaches the ledger; the incremental sync after the follow-up moves the changed row to its newest state and deletes no row.
- **outputs and measurement**: unchanged re-export rewrites nothing; `status.json` hashes verify; cursor pages cover every posting once; assessed, newly qualified and open READY are separate; AI usage is only what was reported.

**It does not prove:** live collection against employer feeds, scheduled execution, live Google Sheets or tracker ingestion, ChatGPT access to this private repository, or outcomes for real candidates. Those need the consumer-side acceptance run.

The run found one real gap, now fixed: a posting with no recognised requirements section could never become READY, because the queue refused any `qualifications` finding. See docs/REVIEW_QUEUE.md.
