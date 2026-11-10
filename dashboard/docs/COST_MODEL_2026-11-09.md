# Query cost, onboarding writes and outage recovery: assessment (2026-11-09)

Evidence labels used throughout. **[docs]** Cloudflare documentation, read on 2026-11-09 through the Cloudflare docs search tool. **[local]** measured or modelled on a local SQLite stand-in
(rows counted by instrumenting the query or reading its plan; NOT counted by D1). **[observed]** Cloudflare analytics as reported by GPT at 2026-11-09 21:36 UTC, aggregate only.
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
* Onboarding a client = 9 x active jobs N: N = 3,000 -> 27,000; N = 5,000 -> 45,000; **N = 11,100 uses the whole day's allowance**. Production N is unknown (**blocker**: the live count could not be read); it is at least 2,462 (Sana's list total, GPT) -> at least ~22,000 writes.
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
With Farhan's 1,408 and Sana's 2,462 qualification rows (GPT, historical): ~12,700 and ~22,200 reads per miss -> ~110 to 200 distinct uncached views a day inside the 2.5M public cap (cache TTL 30 minutes for visitors).
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
