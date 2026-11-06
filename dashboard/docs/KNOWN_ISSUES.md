# Known issues and deferred decisions

Nothing below blocks the release. Each item says who decides or what would close it.

## Owner decisions (recorded 2026-11-05)

1. **Sana's location preference: decided, with evidence required.** Remote is preferred. An on-site or hybrid role is acceptable where a
   commercial airport is within about 2 hours; that is a preference to verify per posting, and no list of city names can establish it
   (Mumbai and Pune are examples the owner gave, not a list). Middle East and Europe stay as relocation preferences, without assuming work
   authorization. Consequently the Worker's discovery screen no longer calls an on-site role in a listed Indian city "eligible": it is
   **unknown** until accessibility is verified, and only a role that is remote in India is affirmatively eligible. The score-correction script (`scripts/rescore_ranking_v2.mjs`, run by the release) applies
   this to the preliminary rows already stored (reason text exactly "Posting is in an accessible Indian location."), lowering their score
   by the 10 points that eligibility had added.
2. **Farhan's 12 application records: owner's understanding recorded, nothing changed.** The owner believes they were listings added
   very early on that were not eligible, not real applications. They remain in the tracker and in every count (none was deleted,
   reclassified or excluded) until the owner confirms record by record, in particular the Drivetrain `APPLIED` record `app-803e11ab`, the
   only one with an applied date. Facts: 4 sit on synthetic or test-fixture jobs, 7 are rejections noted "Playwright verified rejection
   test" on real public postings, 1 is the Drivetrain record.
3. **Relevance scoring: approved and implemented (`worker/discovery.ts`; stored rows corrected once by `scripts/rescore_ranking_v2.mjs`).** For Farhan, a title on his avoid list
   (software, SRE/DevOps, ML, security, finance, support, engineering management, test automation) is capped at 40, and a posting
   whose only stated location is outside India loses 15 points unless it affirmatively supports remote work from India. Sana keeps the
   old scoring (she is open to relocation). Eligibility, status and READY rules are unchanged, human overrides and applications are
   never touched, and scores from the collector's engine are not touched. The correction uses the Worker's own functions, lowers scores only, skips rows already scored under the new rules (tag `ranking_v2`), refuses to write more than 20,000 rows, and is safe to re-run.
4. **Application tracker visibility: public is fine for now** (status and dates only, no notes).
5. **Still open by choice:** one shared operator key for both candidates (not yet), uptime monitoring (not now).

## Behaviour to be aware of

* **Cached answers.** Dashboard reads are cached in D1: up to 30 minutes for visitors and 10 minutes for the operator.
  An operator change clears the cache at once; new postings from the cron or the collector sync appear when an entry
  expires. Answers carry `X-Cache: HIT`, `MISS` or `STALE`.
* **Daily public read cap.** After 2,500,000 rows read by visitor cache misses in a UTC day, visitors see the last cached
  answer (`X-Cache: STALE`) or a 503 until midnight UTC. Operator reads are never blocked. Anyone can still spend that
  public share by requesting many different filter combinations; the cap only guarantees it cannot take the whole
  free allowance.

* **Public viewing.** Anyone with the URL can read jobs, candidate summaries, analytics and the application tracker
  (status, dates, job). That is intended. Employers, pay, notice, city, location preferences, application notes, resume
  versions, application history, audit trails and run logs are not served publicly. If a public field turns out to be
  more than you want visible, tell the maintainer: the field list is in `worker/index.ts` (`PRIVATE_KEYS`, `publicLocation`,
  the public profile block, `PUBLIC_READ_PATTERNS`).
* **Application tracker is public.** It shows which jobs each candidate saved, applied to or was rejected from, with
  status and dates but without notes. If that should be private, remove `/api/applications` and
  `/api/candidates/:id/applications` from `PUBLIC_READ_PATTERNS`.
* **One shared operator key** protects all changes for **both** candidates. It is not per-user or per-candidate
  authorization. Use a long random key; the limiter slows guessing from one address but cannot stop a distributed attack,
  and a 32+ character random key is the real protection.
* **The limiter is per client address and counts only wrong keys.** Visitors send no key, so ordinary browsing is never
  counted. Two people behind the same address share a counter. A locked-out address can still view every public page.
  There is deliberately no global lockout (that would let anyone lock the operator out).
* **Settings: only some fields persist.** `PUT /api/profile` stores name, location, years and the qualification
  threshold. Skills, roles, pay floors, notice period and preferences shown in Settings are not written by that endpoint.
  Sana's experience is computed from her career start date, so her editable years value is display-only. Candidate facts
  (employment history, education, pay line) live in `worker/index.ts` (`CANDIDATE_FACTS`) and change by editing the code.
* **Discovery does not read Settings.** Qualification is produced by the collector (`farshaikh17/Codex`); the Worker's
  cloud discovery stores postings as NEEDS_REVIEW.
* **Source health.** The Worker polls only the sources in `cloud_sources`; its scorecard shows their last status and error.
  Latency is not measured (shown as "not measured"). Jobs imported by the GitHub collector appear as "not polled by the
  Worker"; their health is the collector workflow's.
* **Weekly figures.** "New this week" counts jobs whose READY qualification time falls in the current Sunday-Saturday
  America/New_York week; open inventory counts active jobs only; the cohort ledger's lifetime numbers are all-time. Old
  `qualified_at` values are never rewritten to improve progress.
* **`qualified_at` for the same job** can be refreshed by a collector re-qualification, which can move a job into the
  current week. That is the collector's behaviour and is unchanged.
* **Older list queries** (`/api/jobs` and friends) still return the latest application per job when duplicates exist, and
  the table has a unique index that prevents duplicates anyway.

* **Application totals on closed jobs.** The overview "applied" figure, the discovery funnel and `/api/analytics` count
  application records even when the job later closed; the India Remote summary counts only open jobs. Tracker records are
  never hidden because a posting expired.
* **Resume import is a stub.** `POST /api/profile/import-resume` returns fixed sample data, not a parse of the pasted text.
* **Limiter housekeeping.** Idle rows are trimmed on about 5% of failures, so the table stays small without a scheduled job.
  Local runs have no `CF-Connecting-IP`, so all local requests share one bucket.
* **Partial profile saves** keep stored values for fields not sent; fields the endpoint does not store are ignored.

## Not verified (needs access this session did not have)

* Whether `ADMIN_API_KEY` is present in Cloudflare is checked by name in the release preflight (the value is never read).
  Protected actions fail closed (503) if it is missing; public viewing does not depend on it.
* Cloudflare billing. D1 usage is now measured (see `INCIDENT_2026-11-05.md`): the diagnose mode reads 24-hour rows
  read/written, and the `read_meter` table records rows read by dashboard cache misses per UTC day.
* A remote disposable D1 database (tests use Cloudflare's local D1 engine through `wrangler dev --local`).
* Whether the sync workflow's *scheduled* run still succeeds after the Worker is deployed; the release does not touch the
  collector, and the sync path does not use the Worker API, but the first scheduled run after release should be checked.

## Housekeeping

* `legacy/` holds the original Windows-path scripts; they are not run by anything.
* The collector's two Python tests of the importer live in `legacy/` because they need that repository's `engine/`.

- **Ranking correction and job-board rows.** Job-board rows are stored with eligibility forced to UNKNOWN after scoring, so the script re-runs the Worker's own evaluate() on the stored posting (title, location, workplace type, description) to get the eligibility the score was computed with, and applies the same foreign-location rule. A row with no stored description is left unpenalised. The script only ever lowers scores and never changes status, lane, overrides, applications or history. Foreign-location detection is a text rule: 'Hyderabad, Pakistan' reads as Indian, and unusual exclusion wording may be misread; both err toward not penalising.

- **Un-saving a job: fixed (2026-11-06).** It used to set the record to WITHDRAWN, which every list counted as applied. "Save" off now removes a record that is still only SAVED with no notes (and writes an UNSAVED history row); a record that has moved on cannot be removed that way and is changed in the tracker instead.
- **Built-in candidates' skills were never stored (found 2026-11-06; fixed by migration 0013).** The screen scores 8 points per primary skill found in a posting, but no seed, importer or editor ever wrote `primary_skills` for Farhan or Sana, so every role match scored a flat 40/50 and Farhan's threshold of 70 was unreachable by the automated screen (the profile page displayed a fallback list, which hid it). Migration 0013 fills the column only when it is empty, with the documented lists the profile already shows. **Rows already scored keep their scores**: new postings, changed postings and the unassessed collector backlog get the corrected scores; a one-time re-score of the earlier preliminary rows (no overrides, no applications) would raise scores and needs the owner's approval, because the approved correction script only ever lowers them. With all six skills a posting can reach 90; it still needs three named skills to reach 70, so 70 remains a demanding bar by design.
- **Sana's two READY rows carry the retired city rule ("accessible Indian location").** The correction deliberately leaves READY rows and overrides alone, because READY is a human-level status. The owner decides whether to keep or revisit them; nothing automated will change them.
- **Collector schedule.** GitHub runs scheduled workflows best-effort: runs start minutes to hours late and some slots are dropped (see COLLECTOR_SCHEDULE_AND_COVERAGE.md). Each run is independent, so a missed slot loses nothing except freshness. There is no code fix; schedules are unchanged by the owner's instruction.
- **Repository growth from committed collector snapshots.** Every collector run commits about 25 MB of JSON under `public/` (47 runs so far, about 280 MB of history, 23 MB packed). `engine/persist.py` rebuilds state from that history and the sync reads the current files, so the snapshots cannot simply stop being committed. Options for the owner: keep as is (fine for months), or move the per-run snapshots to a release asset or a separate data repository and keep only `status.json` in Git. GitHub Actions minutes are not a concern: the scheduled jobs cost about 7 minutes a day; releases and pull-request checks are the bulk and run only when asked.
- **Role family is a label derived from the posting title by fixed rules (`worker/listing.ts`), first matching rule wins, and a title no rule matches is "Unclassified".** It is a reading aid, not a classification of the work: for example "Data Engineer, Utilities" or "Wind Developer" read as power/energy. Product names that contain a rule word are excluded for the common cases (Power BI, Power Apps).
- **The pay-floor filter was removed.** It was a hard-coded 60K label that could not be computed from public data and would reveal a private figure. Filters are: salary published or not.
- **Tab numbers on the READY dashboard count the whole queue; the list under a search or review sub-filter is narrower and says so.**
