# Query cost, onboarding writes and outage recovery: assessment (2026-11-09)

Evidence labels used throughout. **[docs]** Cloudflare documentation, read on 2026-11-09 through the Cloudflare docs search tool. **[local]** measured or modelled on a local SQLite stand-in
(rows counted by instrumenting the query or reading its plan; NOT counted by D1). **[observed]** Cloudflare analytics as reported by the review lead at 2026-11-09 21:36 UTC, aggregate only.
**[assumption]** stated plainly where used. Nothing here is a production per-request measurement; none could be taken (the sandbox cannot reach the live site or the analytics per query).

## 1. How D1 counts, and the day so far
* **[docs]** Rows read = rows scanned (every index entry or table row a query steps over, whatever its size). Rows written include one extra row for every index entry written ("indexes will add an additional written row").
  Deletes and updates count as writes. Free tier: 5,000,000 reads and 100,000 writes a day per account, reset 00:00 UTC; since 1 Sept 2026 queries fail past either limit until the reset ("stored data is not affected").
* **[observed]** 9 Nov UTC up to 21:36: 2,845,836 rows read (57% of the allowance) and 70,316 rows written (70%), one database represented (the second database on the account, `parenthood`, is 24 KB). A straight-line
  extrapolation **[assumption]** gives about 3.2 million reads and 78,000 writes by midnight. These aggregates cannot confirm or refute any per-request model below.

## 2. Writes, with index overhead  [local schema + docs]
Entries written per INSERT = 1 table row + 1 per index (the partial index `idx_cq_unassessed` only for collector rows still marked unassessed).
| Table | Indexes written per insert | Rows written per insert |
|---|---|---|
| `candidate_qualifications` | 5 (`cand_elig`, `job`, `cand_lane`, `cand_status`, primary key) | **6** |
| `candidate_job_scores` | 2 (`cand_score`, primary key) | **3** |
| `jobs` | 8 (`provenance`, `source_url`, `original_url`, `discovered_at`, `source_adapter`, `company`, `is_active`, primary key) | **9** |
Consequences:
* Screening one job for one candidate or client = 6 + 3 = **9 rows written**. A new job matched to both candidates in the daily import = 9 + 9 + 9 = **27**. With the 1,500-new-job cap a single import can write up to ~40,500 rows.
* Onboarding a client = 9 x active jobs N: N = 3,000 -> 27,000; N = 5,000 -> 45,000; **N = 11,100 uses the whole day's allowance**. Production N is unknown (**blocker**: the live count could not be read); it is at least 2,462 (Sana's list total, review lead) -> at least ~22,000 writes.
  **This corrects my earlier statement of "about two rows per job" (index entries were left out).**
* An idle cron tick writes ~2 table rows (take and release the lease; measured locally 2, 3, 2, 2, 2, 2): ~1,600 a day at 720 ticks, a lower bound (index entries not counted; `cloud_automation` has only its integer key).
* Re-scoring updates indexed columns (score; status and eligibility), so each re-scored row costs several index rows more than its table row (the re-score PR text said 6 to 10 rows per row; consistent).

## 3. Reads
### 3a. Onboarding backfill: a confirmed defect, fixed on the QA branch  [local, instrumented]
Fixture: 21,120 active jobs (4% inactive), a new client with no rows. Counting every job row that reaches the WHERE clause:
| Version | Calls | Job rows scanned in total | Per call | Modelled rows read (x 3 to 4 per scanned job: index entry, table row, 2 NOT EXISTS probes) |
|---|---|---|---|---|
| Before (ORDER BY discovered_at + NOT EXISTS; plan: `is_active` index, temp b-tree sort) | 528 | **11,151,360** | 21,120 (the whole catalogue, every call) | **33 to 45 million** |
| Rowid order, no cursor | 528 | 5,586,767 | ~10,580 | 17 to 22 million |
| Rowid order with cursor (now) | 528 | **21,647** | 40 | **65 to 87 thousand** |
General form: before = N x N / 40 job rows (N = active jobs): N = 3,000 -> 225,000 scanned (~0.7 to 0.9M reads); N = 5,000 -> 625,000 (~1.9 to 2.5M, up to half the day); N = 10,000 -> 2.5M (7.5 to 10M, beyond the day). After = about N.
The per-scanned-job factor (3 to 4) is an **[assumption]** about D1's accounting of index entries and point lookups; the scanned-row counts themselves are measured. The UI's old 'screen all' (150 calls) was therefore ~150 x N x (3 to 4) reads per click.
Regression tests pin the cost (`test/backfill_cost.test.mjs`); the old code fails the bound 23x on a 1,000-job fixture.
### 3b. List endpoints, uncached request  [local plans, assumption on accounting]
Count query per qualification row: index entry + table row + jobs primary-key lookup (index + row) = ~4; page query (sorted by score): covering key entry + jobs (2) + score row (2) = ~5. **About 9 reads per qualification row per uncached (candidate, filter) view.**
With Farhan's 1,408 and Sana's 2,462 qualification rows (review lead, historical): ~12,700 and ~22,200 reads per miss -> ~110 to 200 distinct uncached views a day inside the 2.5M public cap (cache TTL 30 minutes for visitors).
At 30,000 rows per candidate it would be ~270,000 per miss. **This revises my segment-2 figure of 150,000 upward because index entries are now counted.** Not changed in code; an early-stopping page query and separately cached counts remain an owner decision.
### 3c. Cron  [assumption]
An idle tick reads a one-row lease and scans ~17 source rows: order of 10^4 reads a day. Not measured.

## 4. Outage recovery
* **Model [local, `test/outage_recovery.test.mjs`]**: while D1 refuses queries, data routes answer a clear 503 with `Retry-After: 300`; `/api/version` needs no database; the cron logs `DB_UNAVAILABLE` and skips; the login limiter keeps a bounded per-instance count and the operator can still sign in.
  The moment D1 answers again: health is 200, live data is served (never the outage copy), the shared limiter table is authoritative again (an address that hit the in-memory limit is not stuck, though it gets a fresh 8 guesses from the table), no lease is left held.
* **Recovery needs no operator action [docs]**: limits reset at 00:00 UTC; stored data is not affected. Whether a write-limit outage also stops reads is not verified (the two error messages are separate).
* **Visitor-facing fallback**: the edge-cache backup serves a last good public answer only where the Cache API works (a custom domain; not `*.workers.dev`). Fix 1 stops it ever holding a share-link holder's answer.
* **Data recovery [docs]**: Time Travel is always on and free; restores to any minute within **7 days on the free plan** (30 on paid); a restore overwrites the database in place and gives a bookmark to undo it. **Not exercised here** (destructive, needs Wrangler authentication): the bookmark could be read with the read-only `wrangler d1 time-travel info`, which also needs credentials the sandbox does not hold.
* **Not verified**: the live site's behaviour during a real outage; the time Cloudflare takes to resume after midnight UTC.

## 5. Measured read budget, 11-13 Nov (plan H1, recorded 13 Nov)
Source: the budget guard's own line in the Actions logs ("rows read today N"), which is Cloudflare's account analytics for the UTC day, read at
the start of each discovery and watchlist run. Differences between two readings give what ran in between. **[observed]**

| UTC day | Reading time | Rows read so far | Rows written so far | What ran since the previous reading |
|---|---|---|---|---|
| 11 Nov | 21:57 | 1,666,354 | 15,506 | the whole day before the daily run (site, Worker cron, collector sync, two watchlist runs) |
| 12 Nov | 18:12 | 766,793 | 18,923 | 00:08 manual daily run, 00:35 and 09:43 watchlist runs, site, cron |
| 12 Nov | 21:26 | 841,669 | 19,552 | the 18:12 watchlist run (about 12 min), site, cron: **+74,876** |
| 12 Nov | 21:50 | **3,281,301** | 42,893 | the 21:26 daily run (the first with the automatic shortlist): **+2,439,632 read, +23,341 written** |
| 13 Nov | 09:27 | 1,663,824 | 3,207 | no daily run; a release preflight, a release attempt with its browser checks, one watchlist run, site, cron |

By kind (12 Nov, the one fully covered day): **the daily run about 2.4M**, a watchlist run well under 75,000, everything else (site visits,
the Worker's cron every 2 minutes, collector sync) roughly 0.7M a day. 12 Nov ended above 2.5M (3.28M at 21:50), so the budget guard
then skipped the later triggers that day; 11 Nov was at 1.67M before its daily run. 13 Nov reached 1.66M by 09:27 with no daily run: a
release day (cache flush, smoke and browser suites on both people's lists) costs as much as the background of a whole normal day.

**Over 2.5M, so the plan's three steps apply:**
1. List routes' cache TTL 30 minutes: already so for visitors (`CACHE_TTL_SECONDS.public = 1800` in `worker/index.ts`); nothing to change.
   The operator level stays at 10 minutes (it is not used by the job seekers).
2. The watchlist skips its database work when it found nothing new (`watchlist.yml`): no duplicate check when no source returned a
   posting, and no SQL file when nothing is new. Before, every watchlist run wrote a file whose housekeeping statements scan the
   `jobs` table, and bumped the cache generation, so every visitor's next list was recomputed (about 12,700 to 22,200 reads each, 3b).
3. The re-score cap is 800 per person per daily run (was 1,500), passed by `discovery.yml` as `--rescore-per-candidate 800`.
4. (Phase 6 tenth man.) The daily run may start only while the day's total is under **2.0M** (was 2.5M): 5M free limit, minus about 2.5M for
   the run, minus 0.5M for the evening's site traffic. A later start waits for the 01:13 / 03:13 UTC triggers of the next UTC day.

**Measured from now on:** each discovery and watchlist run row (`discovery_state`, key `run:<time>`) carries `d1_rows: {read, written}`,
the account's totals at the run's end minus at its start (`scripts/usage_snapshot.mjs`, Cloudflare analytics, no D1 reads). It includes
other traffic in the same minutes and the analytics can lag a few minutes, so it is an approximate cost of that run; a run across
midnight UTC has none.

## 6. Read diet (18 Nov, after the 17 Nov outage)  [local, measured with D1's own rows_read]
On 17 Nov the account reached the 5M free reads and the site answered 503 for hours. Method: the real query code (the Python export
steps, `dataset_apply.mjs`, `shortlist_select.mjs`, the audit, the still-open check, the Worker) run against a **local D1 (workerd) copy of
production size**: 30,000 jobs (23,800 active), 34,515 screening and score rows, 80 applications, 15,000 history rows, synthetic content.
Every statement's `meta.rows_read` is summed. Production counts were not read (reads are scarce); the "before" total (2.86M) agrees with the
2.4M per run observed on 12 Nov and 15 Nov, so the model is about the right size. Scripts and full tables are not in the repository.

| Daily run step | Before | After (steady) | After (first run) | Rules bump, before | Rules bump, after |
|---|---:|---:|---:|---:|---:|
| Export: profiles, re-score rows, taste rows / targets, legacy rows | 264,337 | 40,401 | 135,826 | 238,994 | 110,483 |
| Duplicate check of the selection | 97,501 | 55,831 | 58,501 | 97,501 | 58,501 |
| Closures (tracked jobs, missing list) | 23,983 | 177 | 177 | 23,983 | 177 |
| Job-site duplicate check | 31,501 | 1,500 | 1,500 | 31,501 | 1,500 |
| Import (apply.sql) | 82,843 | 30,788 | 33,316 | 95,655 | 46,128 |
| Shortlist pool export | 107,107 | 4,394 | 4,061 | 99,690 | 11,916 |
| **Still-open export** | **2,142,853** | **2,038** | 1,596 | **2,140,090** | 3,796 |
| Still-open write | 27,304 | 1,599 | 1,578 | 27,469 | 1,743 |
| Shortlist select + low-match Hold (*) | 47,797 | 88,578 | 94,021 | 41,828 | 87,954 |
| Shortlist audit | 37,906 | 2,785 | 2,725 | 39,673 | 4,541 |
| Tidy-up (nothing old enough yet) | - | 5 | 5 | - | 5 |
| **Total** | **2,863,132** | **228,096** | **333,306** | **2,836,384** | **326,744** |

(*) Before, the two "match improved" statements did not finish within 60 s on the local copy (excluded from the before figure): D1's planner
walked the (candidate, score) index for every held row. Now they look the row up by key (`+s.overall_score`) and finish in milliseconds.
"First run" includes the one weekly legacy scan. Bump: every row carries an older rules marker (as on the night `profile_v19` ships).

What changed:
* **Still-open export** (98% of the run): one window query over every score row of every person, each probing the applications table
  with no `job_id` index (a full scan of applications per row). Now two queries per person (the shortlist, then the best rows walking the
  (candidate, score) index with `CROSS JOIN`, stopping at 75) plus `idx_app_job` (migration 0026). Same jobs: `test_liveness.py` compares
  the new export with the old query on random data.
* The stored active jobs are read **once** per run (duplicate check, closures, job-site check via `work/stored_jobs.json`), recently
  closed ones through the new partial index `idx_jobs_closed_at`; URLs are looked up only for ids not already stored.
* Taste targets and the pool walk the score index and stop (`CROSS JOIN`; the pool also stops at the threshold - 10 both shortlist rules
  imply); the automatic / held rows and the audit go through the (candidate, status) index; the decided rows through `idx_cq_override`.
* Listed-60-days note and job-site expiry use `idx_jobs_channel_active_disc`; closures and liveness updates find ids by key (`+is_active`).
* The legacy scan (every screening row, about 100,000 reads, finding nothing for days) runs once a week, or at once after a rules bump or
  when the last scan found rows (`discovery_state` key `legacy_scan`).
* Tidy-up (`scripts/tidy_jobs.mjs`): measured with the clock moved forward so that rows qualify: the choice reads 2,700 to 8,000 rows and
  the deletes about 57 per job (500 jobs: about 36,000). Deleting **job rows** was tried and rejected: D1 enforces foreign keys, and
  `candidate_job_scores` and `qualification_history` have no `job_id` index, so each deleted job scanned both tables (64 million rows read
  for 1,000 jobs locally). Only the screening rows go; the job row stays.
* Migration 0026 one-time writes: one row per index entry, about 30,000 (jobs) + 6,000 (closed jobs) + a few hundred.

**Page views** (same copy, the real Worker): an uncached Today page costs about 94,000 rows for one person, the job list about 103,000, the
applications list 300, the "Updated" line 7. A D1 cache hit costs 3 reads per call; an edge hit (new, `X-Cache: EDGE`) none. On `workers.dev`
the Cache API stores nothing, so the edge copy there is the Worker instance's memory only. Misses remain the main page-view cost.

**Daily budget, before vs after (estimate).** Before: run 2.4M + watchlist ~0.2M + background (cron, collector sync, site) ~0.7M = 3.3M on a
normal day, so a release with QA browsing (each distinct uncached view ~0.1M) reached 5M. After: run ~0.25M (0.35M on a rules-bump day) +
watchlist ~0.1M + background ~0.7M = about **1.0-1.1M** on a normal day, leaving about 4M (about 40 uncached person-views) for a heavy day.
The guards' thresholds (`MAX_READS`, public budget) are unchanged.
