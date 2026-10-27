# Engine reliability (step 8, engine side)

Step 8 is split by ownership (docs/ENGINE.md section 3):

- **Collector side** (`collect.py`): per-source backoff and request and time budgets. This is being built by the collector's own PR chain (stacked on farshaikh17/Codex#10). The engine does not duplicate it and never fetches anything.
- **Engine side** (this page): what happens after a snapshot is published. That covers a locked run pipeline, a run history, freshness and partial-run reporting, counts, an extraction time budget, and tolerance of sources the collector didn't attempt.

## One run: `python -m engine.run`

```
python -m engine.run [--public-out DIR] [--candidates DIR --queue PATH] [--report FILE]
                     [--stale-after-hours 12] [--extract-budget-seconds N] [--wait-seconds N] [--strict]
python -m engine.run --history 10
```

Stages, in order:

| Stage | Kind | What it does |
|---|---|---|
| `ingest` | core | `ingest_snapshot` on `public/` (one transaction) |
| `extract` | core | `extract_pending`, commits per batch, optional time budget |
| `leads` | optional | `ingest_pages` when `public/pages/index.json` exists (farshaikh17/Codex#1), else skipped |
| `outputs` | optional | `write_postings` to `--public-out`, then `verify`; skipped without it |
| `candidates` | optional | `enqueue` and `status` per candidate, with `--candidates` and `--queue` (private); else skipped |

**Outcome**

- **`ok`**: every stage ran and every source is fresh.
- **`partial`**: the run finished, but something is incomplete or old. Each reason is listed:
  - a source failed, wasn't attempted, or is stale, failing, never succeeded, or isn't reported;
  - the snapshot is older than `--stale-after-hours`;
  - extraction stopped on its budget;
  - an extraction failed;
  - an ingest or page-capture warning;
  - an optional stage failed (later stages still run).
- **`failed`**: a core stage raised. Later stages don't run. Committed work is kept, because ingest is one transaction and extraction commits per batch, so the next run resumes.
- **`interrupted`**: a run that died without finishing. The next run marks it and lists it in `previous_interrupted`.

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | `ok` or `partial` |
| 1 | `failed` |
| 2 | another run holds the lock |
| 3 | `partial` with `--strict` |

## Run lock

`engine/lock.py` takes an OS file lock (`flock`; `msvcrt` on Windows) on `<store>.lock`. The operating system releases it when the holder exits or is killed, so a crashed run never leaves a stale lock and nothing has to expire. A test kills a holding process and takes the lock straight after.

- The lock file records the holder (pid, host, purpose, since), so a refused run says who holds it.
- `python -m engine ingest` and `python -m engine extract` take the same lock.
- Reads (`summary`, `show`, `--history`) don't need it: SQLite's WAL mode lets them run during a write.
- The lock covers engine runs on one machine. Two machines with separate copies of the store aren't coordinated; where the store lives is still decision D3.

## Run history (store schema 4)

Table `engine_runs` holds one row per run: `started_at`, `finished_at`, `outcome`, `reasons`, the report and any error. Rows are inserted as `running` before any stage. `--history N` prints recent runs with per-stage seconds, so durations can be compared over time.

The store holds **public data only**, so the stored report never includes candidate counts. A failed candidate stage stores only the exception type, because its message can name a candidate. Candidate counts appear only in the printed report or `--report` file, and with `--candidates` that file is refused inside the repository.

## Freshness

`store.freshness(conn, now, stale_after_hours, expected)` reports one state per source:

| State | Meaning |
|---|---|
| `fresh` | the last successful retrieval is within the threshold |
| `stale` | the last successful retrieval is older |
| `failing` | the latest retrieval failed; `consecutive_failures` and `last_error` are given |
| `never_succeeded` | retrievals exist but none succeeded |
| `not_reported` | listed in `sources.json` but never seen in a snapshot |

The default threshold, 12 hours, allows for one missed collection at the current five-a-day schedule.

## Sources the collector did not attempt

If a source entry in `status.json` has a status other than `ok` or `failed`, or has no `checked_at`, it's reported as `not_attempted`, with `not_attempted_reason` when given. For example, a source skipped while backing off. No retrieval is recorded and no posting changes, because a skipped source says nothing about its postings.

Before this change, any such entry hit the store's `status in ('ok','failed')` constraint and rolled back the **whole** ingest, so a single new status value would have stopped all ingestion.

## Counts in the report

| Count | Meaning |
|---|---|
| `collected` | listings in the retrievals ingested by this run (new, changed and unchanged) |
| `new`, `changed`, `unchanged`, `missing`, `inaccessible`, `relisted` | per-run availability changes |
| `postings` | store totals by availability |
| `duplicate_canonical_urls` | the same posting URL under two posting IDs |
| `extracted`, `extraction_failed`, `extraction_pending` | extraction work |
| per candidate, private | the queue's `enqueue` counts (`excluded_automatic`, `pending`, `deferred`, `duplicate`, …) and `status`: assessed, excluded automatically or by review, READY, open READY, queue state, and AI usage as reported (never estimated) |

## Measured

On the committed snapshot (10 sources, 536 listings), a first run takes about 3.3 s: ingest 0.27 s, extraction 2.8 s, outputs 0.26 s. An unchanged rerun takes milliseconds and does no work.

The acceptance run (docs/SCHEDULING.md) now includes four reliability checks:
- a run on the real snapshot is ok, with every source fresh;
- a second run is refused while the lock is held;
- the follow-up run is partial, names its failed source and re-extracts only the change;
- both runs are recorded.

## Not covered here

- Backoff and request budgets: collector-side, see above.
- Scheduling: nothing is scheduled (docs/SCHEDULING.md).
- Where the store persists between runs: D3.
- Alerting: the outcome and reasons are reported; who is notified is a consumer decision.
