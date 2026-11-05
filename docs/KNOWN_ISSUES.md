# Known issues and deferred decisions

Nothing below blocks the release. Each item says who decides or what would close it.

## Decisions that only the owner can make (nothing was changed for these)

1. **Sana's preferred Indian cities.** Earlier records disagree (Bengaluru, Hyderabad, Chennai vs Bengaluru, Pune,
   Mumbai). The stored list (Bengaluru, Hyderabad, Chennai) is preserved and shown as stored.
2. **Farhan's 12 application records.** The real-world meaning is not confirmed, so none was deleted, reclassified or
   excluded from counts:
   * 4 sit on synthetic or test-fixture jobs (`syn-001`, `syn-002`, and two `TEST_FIXTURE` jobs);
   * 7 are rejections noted "Playwright verified rejection test" on real public postings, with no applied date;
   * 1 is the Drivetrain `APPLIED` record `app-803e11ab` (the only record with an applied date).
   Until answered, the tracker total (12) includes them. The dashboard card now shows the *applied-stage* count
   separately from the tracker record count so the number is not mistaken for 12 submissions.
3. **Relevance scoring (proposal only, not implemented).** In a read-only sample of Farhan's 200 highest-scoring review
   items, 71 had titles matching his avoid list (software, SRE/DevOps, ML, security, finance, support, engineering
   management, SDET) at 58-67%, and 53 named a US or European location with India eligibility unknown. The score is driven
   by the role label plus one generic keyword and has no title or location negative gate. Proposal: cap the score at 40
   for avoid-list titles and subtract a fixed amount when the only stated location is outside India; leave eligibility
   and READY rules alone. Expected effect: those 71 titles drop below the review threshold; the 1 READY and 2 STRETCH
   jobs and all unknown-eligibility jobs stay in review. Needs the owner's go-ahead because it changes ranking.

## Behaviour to be aware of

* **One shared operator key** unlocks the dashboard for both candidates. It is not per-user or per-candidate
  authorization. Use a long random key; the limiter slows guessing from one address but cannot stop a distributed attack,
  and a 32+ character random key is the real protection.
* **The limiter is per client address.** Two people behind the same address share a counter, and an attacker who can send
  from many addresses is not slowed by it. There is deliberately no global lockout (that would let anyone lock the operator
  out).
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

* Whether `ADMIN_API_KEY` is present in Cloudflare via authenticated metadata (an empty-key request returned 400, which
  is indirect evidence: an unset key would have returned 503). The release workflow checks the secret list by name.
* Cloudflare billing or usage, D1 row counts against free-tier limits, and production query timings. D1 usage estimates
  in this repo are design reasoning, not measurements.
* A remote disposable D1 database (tests use Cloudflare's local D1 engine through `wrangler dev --local`).
* Whether the sync workflow's *scheduled* run still succeeds after the Worker is deployed; the release does not touch the
  collector, and the sync path does not use the Worker API, but the first scheduled run after release should be checked.

## Housekeeping

* `legacy/` holds the original Windows-path scripts; they are not run by anything.
* The collector's two Python tests of the importer live in `legacy/` because they need that repository's `engine/`.
