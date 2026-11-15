# Career Job Engine: review and QA handoff (written 9 Nov, updated 10 Nov 2026 - see section 10)

**Audience:** other AI agents (and humans) asked to review, QA or challenge the work done between 2026-11-07 and 2026-11-09.
**Author's stance:** this is a self-report. Treat every claim as something to verify; section 8 lists the claims I am least sure of.
**Live site:** https://career-job-engine.farshaikh17.workers.dev (public, read-only; changes need an operator key you will not have).
**Repo:** `farshaikh17/Codex` (private; the Worker, D1 migrations and React dashboard are in `dashboard/`, the Python discovery engine and collector at the repo root). `main` was `5832c43` when released; later commits are data snapshots by the collector bot and docs.
**Deployed Worker commit:** `5832c43a124a93294fae2f6ae0a8d0b7b9cc7af7`, deployed 2026-11-09 00:58 UTC (`GET /api/version`).

## 0. Ground rules for reviewers

* **Read-only.** Do not run write operations, dispatch workflows, deploy, or change data. Production changes go only through the manual workflow `.github/workflows/dashboard-release.yml` and only by the owner or the owner's agent.
* **Privacy.** The repo contains no CVs or contact details; do not add any, and do not paste candidate documents into reports. Two candidates exist: `farhan_shaikh` and `sana_ansari`.
* **Budget.** Production is on Cloudflare's free tier (D1: 5,000,000 rows read and 100,000 rows written per UTC day). Every production query you run costs quota. Prefer reading code, workflow logs and the public API (cached, a page or two) over anything that scans.
* No automated applications or outreach exist or are wanted. Applying is manual.

## 1. What the system is

* **Worker** (`dashboard/worker/index.ts`, `discovery.ts`, ...): serves `/api/*` and the SPA. Public requests are read-only and field-stripped; operator requests (bearer key) can write. A response cache and a read meter live in D1 (`response_cache`, `read_meter`); a public read cap (`PUBLIC_DAILY_READ_BUDGET`, 2,500,000 rows) protects the quota.
* **Screen** `evaluate(candidate, posting, ctx)` in `dashboard/worker/discovery.ts`: the single scoring and eligibility function. The Worker's 2-minute cron and the GitHub discovery scripts both use it.
* **Pipelines (GitHub Actions):** `collect.yml` + `sync_collector_to_d1.yml` (official ATS boards), `discovery.yml` (daily: a 5M-job open ATS dataset via DuckDB, job-site search, remote boards, employer feeds, scoring, D1 import, liveness), `watchlist.yml` (priority employers and boards), `dashboard-verify.yml` / `tests.yml` (CI), `dashboard-release.yml` (the only deploy path; modes preflight, release, verify, diagnose), `ai-probe.yml` (one-request probe).
* **Candidates:** Farhan (remote only, from anywhere, builder roles; explicit exclusions: business analyst, deal desk, sales, admin, junior/intern, developer, hands-on Salesforce/HubSpot/Zoho; employer Ajaia skipped; pay floor INR 1.2L/month). Sana (open to anywhere; power-plant operations and maintenance, reliability, energy efficiency and transition; on-site is fine).

## 2. Timeline

| When (UTC) | Event |
|---|---|
| 7 Nov 02:03 | Discovery run 2 (code with an unindexed correlated subquery in the copy-collapse step). |
| 7 Nov ~02:24 | D1 free-tier read limit exceeded; site returned 503 on uncached reads; four release attempts failed (quota, not code). Day total **17,026,513 rows read** (limit 5M). |
| 8 Nov 00:00 | Quota reset; diagnose run read the day totals; fixes began. |
| 8 Nov 00:21 / 03:03 / 03:16 | Releases of the first fixes, the simpler UI (#41) and the inspection-panel fix. |
| 8 Nov 19:40 | First scheduled discovery run on the fixed code. |
| 9 Nov 00:21 -> 00:58 | Further releases; re-score batches; final state below. |

## 3. Findings and fixes (mapped to the original QA handoff, items 1-9)

Columns: **evidence** (what showed it), **fix** (PR), **verified how**, **residual risk / confidence**.

| # | Finding | Evidence | Fix | Verified how | Residual |
|---|---|---|---|---|---|
| 1 | D1 daily read quota exhausted (17.0M on 7 Nov) | `wrangler d1 info`, Cloudflare analytics (account usage), `d1 insights` top queries | #45 (no per-row score lookup, no OFFSET paging), #42 (budget guard), #55 (catch-up scheduling) | 38 s -> 0.05 s on a 22k-job local sqlite copy; 8 Nov total 2.10M; guards seen skipping/allowing in run logs | **Cause is an inference** (about 15M of 17.0M rows are not Worker reads; the copy-collapse subquery scanned an unindexed table once per job). Not directly measured. Confidence medium-high. |
| 2 | "Unable to provide visa sponsorship" counted as sponsorship offered (Novelis role marked ELIGIBLE, 87) | Offline repro on the real posting text with the deployed and `main` code | #43 (denial words before/after the phrase) | Test with the real text, 8 denial phrasings, genuine offers still count; production list of still-affected rows (18, all Sana, none decided) printed by diagnose mode | Status stays UNKNOWN by owner decision (not INELIGIBLE). 18 stored rows keep the old status until re-scored; the re-score (#57/#61) should fix them, **not yet verified row by row**. |
| 3 | List says "5 skills matched, years met"; panel says "no skills, 0% primary, no explicit minimum" | Opened a real production row in Chromium | #49 then **#51** (root cause: the API sends `score.breakdown`, the panel read `score.score_breakdown`, so it showed defaults for every row) | Browser check against the live API before and after | #49 alone did not work; found only by viewing production. The release e2e does not open a discovery row. |
| 4 | Farhan queue: foreign-restricted, apprentice and software roles ranked high | Re-evaluated his live top 40 with `evaluate()`; stored scores of 77-90 were stale | #58 (worldwide wording, US states/NYC as US-only, apprentice/trainee/SDE), #61 (foreign-location list covers every country), #57 (re-score marker, now `profile_v5`) | Unit tests; his top 14 re-read after batches 1-3 (10 of 14 on final rules) | A posting limited to one other country stays **UNKNOWN** (reviewable) at a lower rank; owner may want INELIGIBLE. One more batch was running. |
| 5 | Sana's profile listed Electrical/Substation Maintenance (her work was mechanical and process equipment) | Compared stored lists with her CV (not in repo) | #46 migration `0017_sana_profile_cv.sql` (runs once) | Diagnose mode prints both candidates' skill lists (2 rows) | Owner kept "Switchgear & Transformers" and "Generators & Motors" ("she has worked on it"). **Farhan's profile was not reviewed for overstatement** (needs his CV). |
| 6 | AI review batches of 5 used the first item's profile (could straddle candidates) | Code reading; unit test reproduces the 7+3 split | #44 (group by candidate) | Python tests | Moot in practice: **the free model provider was retired on 2026-07-30**; the step failed all 20 batches on its first run and is now OFF (#52, #53, #54). No AI replacement (owner: none). |
| 7 | Source labels and health: "Employer feed" for every source; JobSpy `blocked: 0` despite 403/429 | UI code; run 42327246708 log | #41 (labels), #48 (`BlockWatch` counts logged refusals), #51 (modal badge) | Tests; labels seen in browser | JobSpy sites remain unreliable by nature. |
| 8 | "1 applied" vs "12 applications"; resume import; settings persistence | Public applications list; code | Counts reconciled (1 applied, 10 rejected, 1 saved; 2 rows are labelled "(Synthetic)"); #60 resume import returned a hard-coded fake profile -> now 501 | Test; no defect found in settings persistence (existing tests) | The 2 synthetic rows are still counted; deleting/excluding them needs owner approval. |
| 9 | Remaining QA plan | | Partly done | See section 7 | Not exhaustive; see section 7. |

Additional work done and its evidence:

* **Release check false alarm** (run 37): the final step compared the whole `candidates` row and failed on the approved profile migration. #50: skill/role lists and `updated_at` are fingerprinted separately; everything else stays in the compared hash. Tested on a local D1 both ways.
* **Collector publish conflicts** (7 Nov 09:03): two merges seconds apart started two collector runs; the second rebased onto a snapshot the first had replaced. #50: each run fast-forwards first and retries with the verified new snapshot winning. Reproduced in a throwaway git repo.
* **Schedule drift:** GitHub started the daily discovery about 4 h late twice, and dropped some watchlist triggers. #55: more triggers plus `dashboard/scripts/recent_run_guard.mjs` (runs only if the last *real* job success is older than 7 h / 18 h; a budget-skipped run does not count).
* **Outage backup** (#59, `backupStore/backupServe` in `worker/index.ts`): successful public GET answers are also stored in the edge Cache API and served (marked `X-Cache: STALE-OUTAGE`) only when the live answer is 503. Never stored: health, version, operator reads, non-GET.
* **Re-score** (#57, #61): marker `profile_v5` on new and re-scored rows; the export (`engine/dataset_discovery.py: rescore_rows`) takes undecided preliminary rows without it, per candidate, best-ranked first, at most 1,500 per candidate per run; SQL guards leave applications, hand-set statuses and READY/STRETCH rows alone.

## 4. Pull requests and runs (ledger)

PRs (all merged unless noted): #38 ten additions (earlier), #39 source fixes, #40 fingerprint retry, #41 simpler UI + working filters, #42 budget guard, #43 sponsorship denial, #44 AI batching, #45 read costs, #46 Sana profile, #47 audit listing in diagnose, #48 JobSpy blocked count, #49 and #51 inspection panel, #50 CI failures, #52/#53/#54 AI diagnostics, probe and switch-off, #55 schedule catch-up, #56 docs (usage table), #57 re-score marker, #58 Farhan rule gaps, #59 outage backup, #60 resume stub, #61 country list and `profile_v5`.

Release/diagnose runs worth opening (Actions run ids): 42429284630 (release 37, deployed `714668e`, last step flagged the profile change), 42440932084 (`847b2c8`, UI), 42441858903 (`969d614`), 42541354627 (run 42: deployed `3d2e645`, **one browser check failed**, see 8), 42541908821 (verify of the same commit: passed), 42542910591 (release 44, `5832c43`, all passed), 42538823105 (diagnose, usage by day), 42518603571 (AI probe: endpoint answers `OK`).

## 5. Measurements (D1, per UTC day)

| Day | Account rows read | Rows written | Read meter (Worker cache misses) | Notes |
|---|---|---|---|---|
| 6 Nov | 3,125,694 | 24,391 | 2,553,470 | releases + QA; public cap tripped |
| 7 Nov | **17,026,513** | 54,927 | 2,057,557 | gap about 15M = imports run via `wrangler` (unmetered) |
| 8 Nov | 2,102,528 | **69,341** | 1,352,196 | **not a normal day**: 3 releases, 3 diagnoses, QA, first discovery run |
| 9 Nov | 831,597 at 00:57 | small | n/a | re-score batches ran after this |

Account usage = Cloudflare analytics, what the free limit applies to. The meter excludes cache lookups, cron, collector sync, wrangler imports and diagnose queries. **Writes (69% of the daily allowance on 8 Nov) are now the tighter limit.**

## 6. Owner decisions on record

No AI review (9 Nov). Keep "Switchgear & Transformers" and "Generators & Motors" in Sana's profile (9 Nov). Sponsorship-denial rows stay UNKNOWN, list only, no automatic reclassification (8 Nov). Farhan: "wherever he can be hired he will be happy" (9 Nov), applied as the rule gaps above. Apply the stale-score fix (9 Nov). Not decided: whether single-country-restricted postings should be hidden for Farhan; adding Emirates Global Aluminium, Black & Veatch and Doosan Enerbility to the watchlist (same feed reader, feeds verified); building readers for Workday/Oracle employers (KBR, GE Vernova, Hitachi, Wood) and SmartRecruiters ones (Masdar, Vattenfall, Statkraft, AFRY).

## 7. Tests run and what is not covered

* Node: `cd dashboard && npm test` (177 tests at the end; includes the migration chain). Python: `python3 -m unittest discover -p 'test_*.py'` (344+ tests, network disabled). Frontend build: `npm run build:frontend`.
* Release workflow runs `npm run verify`, a public smoke test and a real-browser read-only check (`dashboard/test/e2e/production-readonly.e2e.mjs`, desktop and 375 px).
* **Not covered:** the e2e does not open a discovery (`ds:`) row's modal; the AI step (retired); Cache API behaviour on a `workers.dev` host; per-row correctness of the re-score; Farhan's profile; the Worker cron's assessment under load; mobile layout of the new cards beyond the 375 px checks; accessibility (keyboard/contrast) of the new UI; the saved/withdrawn semantics noted in `KNOWN_ISSUES.md` (an un-saved job becomes WITHDRAWN, which lists treat as applied; not re-verified).

## 8. Where I am least sure (please attack these)

1. **Root cause of the 7 Nov overrun.** Arithmetic and timing fit (about 1,400 in-scope jobs x about 5,700 score rows), and the fix removes the pattern, but nobody measured the old statement's `rows_read` in production. Suggested check: re-create both queries on a local sqlite with the real table shapes and compare `EXPLAIN QUERY PLAN` and counted rows; look for any *other* statement scanning `candidate_job_scores` by `job_id`.
2. **Cache API on `*.workers.dev`.** Docs excerpts did not say whether `put` persists there. The unit test uses a fake cache. If it silently no-ops, visitors see the old 503 during an outage. Suggested check: inspect `backupStore/backupServe` and test with `wrangler dev` (local) and, if allowed, a custom domain.
3. **The failed browser check in run 42** ("SANA: READY dashboard ... tab count"): the same check passed in run 43 on the same commit and the live page matched the API at 00:4x UTC. I could not reproduce or explain it; I called it transient. Suggested check: read `production-readonly.e2e.mjs` lines ~87-105 and look for a race between the screen's cached counts and the second API call during a cache-generation change.
4. **Re-score correctness.** `profile_v5` rows were re-scored with `evaluate()` in `dataset_apply.mjs`; I checked tops of queues, not a statistical sample. Suggested check: sample 30 rows per candidate before/after (breakdown carries `rescored_at`), confirm no row with an application, an override or READY/STRETCH status changed, and that no eligible Farhan role became INELIGIBLE wrongly.
5. **Rule choices that are judgement, not fact:** a single foreign country stays UNKNOWN (rank penalty only); `sde`, `apprentice`, `trainee` treated like junior/developer titles; US state names (Georgia excluded as it is also a country) treated as US-only; Gulf visa likelihood rests on third-party lists, not on employer statements.
6. **Employer research** (for Sana): produced by a subagent from public pages; I re-checked the SmartRecruiters counts, the ACWA sitemap, the KBR Workday feed and four SuccessFactors RSS feeds. The rest is unverified. No first-party visa statements were found for any employer.
7. **Process lapses to know about:** one commit with invalid workflow YAML was pushed to a branch (never merged; fixed before merge); the first inspection-panel fix (#49) did not work and was corrected only after a production check; a probe workflow initially reported green without sending a request (`| tee` masked the failure).

## 9. Suggested review checklist (about 60-90 minutes)

1. Read `dashboard/worker/discovery.ts` `evaluate()` end to end; list every path that can set `ELIGIBLE`; confirm none can fire on a denial phrase (`negated`, `noVisaRoute`).
2. Read `dashboard/scripts/dataset_apply.mjs` (copy-collapse query, re-score SQL guards, markers) and `engine/dataset_discovery.py` `rescore_rows`; try to construct a row that the SQL would change although it has an application or manual override.
3. Read `dashboard/scripts/budget_guard.mjs` and `recent_run_guard.mjs` and the guard jobs in `discovery.yml` / `watchlist.yml`: can a failure of the guard itself stop work forever, or let work run when it should not?
4. Read `backupStore/backupServe` in `worker/index.ts`: can an operator or private answer ever be stored or served publicly?
5. Read migration `0017` and `dashboard/scripts/fingerprint.mjs`: could the new fingerprint exclusion hide a harmful change to `candidates`?
6. Open the live site on desktop and a phone-width viewport as both candidates: filters ("Found on", workplace, eligibility, strong matches), pagination, the job modal for a discovery row, save/unsave behaviour (read-only visitors cannot write), exports if present.
7. Compare the claims in section 3 with the Actions logs listed in section 4; report any claim you cannot reproduce.
8. Report findings as: ID, severity, evidence (file:line or run id), reproduction steps, suggested fix, confidence. Please separate "tested" from "read only" from "proposed".

## 10. State on 10 Nov 2026 (supersedes the "deployed commit" and "open" statements above)

**Live:** Worker commit `d3a39b9` (release run 47, 18:04 UTC), all release checks and a separate real-browser check (desktop 33/33, mobile 33/33) passed. `main` after that: #72 (SuccessFactors feeds), data snapshots.

**Merged since section 3 was written:** #63 JobSpy refusal detection, #64 account-wide budget guard (confirmed working live: guard line "rows read today 1,668,798" at 17:18 UTC), #65 valid application links and `--max-new 0` now means zero (before this, the "max_new 0" re-score runs of 8-9 Nov were NOT capped at zero), #66 decided jobs protected across candidates during liveness, #68 privacy/outage/cost QA (share-link answers no longer stored in the outage backup; un-save race; onboarding cursor; CORS limited to the site's own origin; operator-only delete-client; accessibility; CI now runs all Node test files), #69 Sana ranking (generic field-service titles need an energy word, electrical-only titles -12), #70 Farhan: Business Systems Analyst / Sales Engineer / Pre-Sales / Treasury avoided, exact-duplicate-only collapse (replaces the title-only collapse), relocation never overrides a sponsorship denial, #71 Farhan: Strategic Solutions Engineer / Commercial Operations Specialist / any "treasury" title avoided, re-score marker `profile_v7`, #72 Emirates Global Aluminium, Black & Veatch and Doosan (non-Bobcat) added to the SuccessFactors reader. #62 and #67 were closed as superseded by #70.

**Owner decisions added 9-10 Nov:** exclude Business Systems Analyst and anything irrelevant for Farhan; drop the three borderline roles; #62/#67 left to judgement; add the three SuccessFactors employers; no AI review; keep Switchgear & Transformers and Generators & Motors on Sana's profile. Farhan's CV was not supplied, so his profile was not checked for overstatement.

**Measured:** D1 reads 1.67M of 5M at 17:18 UTC on 10 Nov. Writes after the re-score were not measured (the run summary step output was not readable through the API). Top lists after the v6 re-score: Sana's list leads with maintenance/utilities/HVDC roles, electrical-only titles at 81-83; Farhan's list had three borderline roles which #71 removes as rows are re-scored on `profile_v7`.

**Known gaps / for reviewers to check:**
1. Root cause of the 7 Nov overrun is still an inference (section 8, item 1).
2. The Cache API outage backup probably does nothing on `*.workers.dev`; untested on a real host.
3. The desktop real-browser check failed once on a first run (twice: 9 Nov release run 42, and 10 Nov first run) and passed on repeat; cause unknown (likely a cold cache), not reproduced.
4. D1 writes per day after the full re-score are unmeasured; the guard stops runs at 80% of the daily write allowance.
5. Weekend job counts (8-9 Nov) were not collected.
6. Doosan's Enerbility itself had no open posting on 10 Nov; only other Doosan-group (non-Bobcat) roles flow through.
7. Employer sources for Sana, added 10 Nov: SuccessFactors (Emirates Global Aluminium, Black & Veatch, Doosan non-Bobcat), SmartRecruiters (Masdar, Vattenfall, AFRY, Statkraft) and Workday (KBR, GE Vernova, Hitachi), all read-only public APIs, title list only for SmartRecruiters/Workday (no job text, so scoring is on title and location). Wood (Oracle Recruiting Cloud, `ehif.fa.em2.oraclecloud.com`, site CX_1) was added in a follow-up reader. None of these readers has run in a production discovery run yet at the time of writing; the first run's report (`more_sources_report.json`: read/kept per source) is the thing to check.
8. Un-save: KNOWN_ISSUES.md records that the old WITHDRAWN behaviour was fixed on 6 Nov (a record that is still only SAVED is removed and an UNSAVED history row is written); the worker code no longer sets WITHDRAWN on un-save. #68 additionally closed a race in that path. Checked by reading code; not exercised against production.
