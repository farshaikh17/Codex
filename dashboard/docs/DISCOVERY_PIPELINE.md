# Daily discovery pipeline

Once a day, `.github/workflows/discovery.yml` finds new jobs for every candidate and client and writes them to D1. It replaces "about 30 sources" with an open dataset of **about 5 million live postings from about 80,000 employers across 64 hiring systems** (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Oracle, SuccessFactors, iCIMS, Darwinbox and more), plus a light job-site search.

## The daily run as of 13 Nov 2026 (plan phases 1-6)

This section is the current description; "Steps" below is the original one, kept for detail and corrected where it changed. The plan
(`PLAN_DIVERSITY_AND_9_OF_10.md`) names every rule; its section 10 lists what was read differently and what is knowingly left.

**When it runs.** `discovery.yml` is triggered at 15:13, 17:13, 19:13 and 21:13 UTC (after the dataset refresh) and at 01:13 and 03:13 UTC
(catch-up). Two guards decide whether the trigger does the work:
- the **budget guard** reads the account's rows read today from Cloudflare analytics (no D1 read) and starts the run only below **1.5M** (the run
  itself reads about 2.4M; the free limit is 5M; lowered from 2.0M on 16 Nov to leave about 1.1M for site traffic, the watchlist and a release). A due run it skips leaves a row `{skipped: "budget"}`, and the page shows "Not updated today";
- the **recent-run guard** lets one real run through per 20 hours (a manual run always goes).
The **watchdog** (`discovery-watchdog.yml`, every 2 hours) starts a run when the last good one is over 24 hours old. Discovery has its own
concurrency group, so the watchlist or the collector sync can never cancel a queued daily run.

**What one run does, in order** (`discover` job):
1. D1 usage snapshot (for the run's `d1_rows`).
2. Download the dataset. A failed download does not stop the day: boards, other sources, re-score, still-open check and shortlist still run.
   The run is then shown red, as it is when the manifest is unreadable or over 48 hours old.
3. Select matches from the dataset, and export rows to re-score: at most **800 per person** (best first) not yet scored under the current rules
   marker (`RULES_MARKER` in `worker/discovery.ts`, now `profile_v17`).
4. Job-site search, remote boards, more sources (Workable, Eightfold, Siemens Energy, SuccessFactors, Workday, Oracle, SmartRecruiters
   employers, Arbeitnow, Getro, UN Careers, EURES; Adzuna with its free keys). Each writes its file after every source and stops starting
   sources at 80% of its time budget; Workable skips a refused search term instead of losing the rest. More sources runs the watchlist
   employers' boards first, then the cheap sources, and the big readers (SmartRecruiters, SuccessFactors, Workday) last; each source may use
   only its weighted share of the time left (`source_cap()`), and a source skipped or stopped for time is a warning line in the step and in
   the run health step. Employer career sites are stored as the
   employer's own posting (verified, normal eligibility); job boards stay "eligibility unknown".
5. Duplicates against D1; employer names instead of hiring-system tenant ids (B1); the same job in several cities is stored once with the
   cities listed (B3).
6. Score every pair with the Worker's own `evaluate()` and write one SQL file (all or nothing). The scoring rules of phases 2 and 4: Indian plant
   towns count as India (S1); every search term's title is a role match (S2); one matching word is not enough (S4); plain worldwide-remote wording
   counts (S5); too-senior and wrong-platform postings are capped (S6, S7); office jobs fail Farhan's remote-only rule (S8); Gulf details (S9);
   Sana's own target roles count as skills (S11); "N Locations" postings get their places (B2); what the job involves raises or lowers the score
   (C1); mixed titles lose 4 (C2); a plain ceiling of 92 plus up to 3 for many duties (C3). A person's decision or an application is never changed.
7. Shortlist pool (A1): every row that passes the shortlist conditions except the 4-day verification, plus every row on the automatic shortlist.
8. Still open? The pool first (the shortlist, then by score, 150 per person), then the best undecided rows: 8 workers, 8 s per request, an
   8-minute deadline after which it writes what it has. Only 404/410 twice closes a job.
9. Shortlist (`scripts/shortlist_select.mjs`, A2-A6): per person, 25 Best matches (Ready) and 25 Worth a try (Stretch), from rows verified in the
   last 4 days, ranked by score (an incumbent +2, a row over 30 days old -5); hard rules (one posting per employer and title, reposting sites at
   most 3 per tier, tenant-id employers off) and soft rules swapped for variety (2 per employer per tier, 40% per role family, Sana's Gulf and
   remote minimums, Farhan's worldwide-remote minimum, "something different"). When the still-open check verified too few rows, rows already
   shortlisted keep their place (`--relaxed`). A Gulf posting from a job board that refuses the check (Bayt, Indeed, LinkedIn) and was found
   in the last 2 days (the job-site search asks only for postings listed in the last 48 hours) counts for Worth a try only, never Best matches;
   its card says it could not be confirmed still open. One SQL file of guarded moves, then the low-match Hold.
10. Audit (A8) of the stored lists' hard rules; run log row (counts only: new, re-scored, closed, sources, the shortlist report with families,
    bands and per-source counts, `d1_rows`); run health (R8). A run that did nothing useful, or whose audit failed, turns red in the separate
    `health` job, so the guards still count the day's run.
    After the audit, the tidy-up (read diet, `scripts/tidy_jobs.mjs`): the screening, score and pipeline-history rows of jobs that closed 45 to 52 days ago, or that
    every person's screen calls ineligible 45 to 47 days after they were found, are deleted, at most 500 jobs a run, never a job anyone
    applied to, saved, rated, followed up or decided on. The job row stays (the duplicate check still knows it). See COST_MODEL_2026-11-09.md section 6.
11. The **daily phone message** (G1, `message` job): one line per linked person, also when the run failed, did nothing or was postponed. Off until
    the owner adds `TELEGRAM_BOT_TOKEN` (see `RELEASE.md`).

**The watchlist** (`watchlist.yml`, about three times a day) reads the priority employer sites and the remote boards between daily runs; when it
found nothing new it reads and writes nothing more in the database and leaves the visitors' cached lists alone (H1).

## Steps

1. **Download.** The workflow downloads today's dataset once: the [ats-scrapers](https://github.com/kalil0321/ats-scrapers) "jobhive" parquet file (MIT licence, refreshed daily around 14:30 UTC, about 2.3 GB then; 3.9 GB and `jobs/v1` since 20 Nov). DuckDB then queries it locally.
2. **Dataset query** (`engine/dataset_discovery.py`).
   - **Profiles.** Each person's search profile is read from D1 at run time, so no candidate data lives in the repository.
     - The two built-in candidates use focused title searches, which are subsets of the screen's own role rules.
     - Clients use their stored role keywords and location rule.
     - Search values are passed to DuckDB as bound parameters. A keyword like `women's health` or a country like `Côte d'Ivoire` is safe.
   - **Wide intake (14 Nov 2026): every posting that can fit, in any country.**
     - Every posting whose title passes the person's role rule, posted in the last 45 days or undated, is read, whatever its country or
       region (about 32,000 for Farhan and 38,000 for Sana on the 12 Nov snapshot). Nothing is dropped by place before scoring.
     - Each one is pre-scored on the runner (free; no database reads) with the Worker's own screen: `scripts/prescore.mjs` runs `evaluate()`
       and `placeBand()` on the same posting object the import stores. The person's place rules decide: Farhan remote and workable from India;
       Sana India, the Gulf, or abroad with a stated visa route.
     - Selected: every row that is not ruled out and scores within 15 points of the person's threshold (never 45 or below, which the import
       would hold as a low match), best fit first (score, then a stated eligibility, then newest; an undated live posting counts as today's).
     - The only cap is the D1 read budget of the duplicate check that follows: `--select-read-budget` (150,000 rows read) divided by about
       11 rows read per selected row, shared between the people (about 6,800 each; on 12 Nov it did not bind). If it binds, place sets go
       first: India / worldwide / APAC remote for Farhan; India, the Gulf, abroad with a visa route and remote for Sana.
     - The import (`dataset_apply.mjs --max-new`, 1,500) still writes the best-scored new rows first, so a backlog reaches D1 over a few days.
     - If the pre-score cannot run, the old bounded quotas are used for the day (home 400 with the Worker's Indian places, remote 200, Gulf 150,
       abroad 300), newest first with undated rows counted as today's.
     - Measured on the 12 Nov snapshot (thresholds 70 and 60): rows that can fit reaching the import went from 56 to 384 for Farhan (79 at
       his threshold, was 7) and from 265 to 2,408 for Sana (1,014 at her threshold, was 81; India 209 -> 628, Gulf 2 -> 88, abroad with a
       visa route 5 -> 139).
   - **Duplicates.**
     - Within the run: same company, title and location.
     - Against D1: same id, same URL, or the same company and title still active.
   - **Reopening.** A dataset job that reappears after being closed is reopened.
   - **Closing rule.** A job this pipeline added is closed only when both of these hold, so one scraper failing for a day closes nothing:
     - it has been missing from two consecutive snapshots;
     - its hiring system's job count is within 10% of the previous run's.
     - Nothing closes at all when the snapshot is under a million jobs.
3. **Job-site search** (`engine/jobsite_discovery.py`).
   - Five searches per person a day, through the open-source JobSpy library: Indeed, LinkedIn and Naukri, plus Glassdoor and Google Jobs when they answer. A blocked site is skipped.
   - It runs **without database credentials**, in its own environment, with a 10-minute limit. A separate step then removes duplicates against D1.
   - These are job-board reports, so eligibility always starts as unknown.
   - They are never re-checked, so they expire after 30 days, unless someone applied or decided.
   - Owner decision 2026-11-06: light daily use only.
4. **Scoring and writing** (`dashboard/scripts/dataset_apply.mjs`).
   - Every (job, person) pair is scored by the Worker's own `evaluate()`, so stored rows and the live screen cannot disagree.
   - (Replaced on 13 Nov by the shortlist selector of plan phase 3; see "The daily run as of 13 Nov 2026" above.) The screen itself never returns READY or STRETCH. From 12 Nov 2026 a shortlist step at the end of the write (owner decision) promoted the best screened rows:
     READY = score at the threshold and eligibility confirmed; STRETCH = the same score with eligibility to confirm, or confirmed and up to 10 points lower. Both need the current rules' mark, one matched profile skill and a posting verified open in the last 4 days; 25 of each per person. The reason starts "Shortlisted automatically." and the row returns to review when it stops qualifying. A person's decision or an application is never touched.
   - Ineligible jobs and jobs scoring below 30 are not stored.
   - **Never touched:** a job someone applied to, a row with a human decision, or an existing row (inserts never overwrite).
   - **Field safety:** every field is bounded, control characters are removed, and a job with an unusable URL is skipped.
   - **Daily cap:** at most 1,500 new jobs per run (the workflow's default), best scores first. The `max_new` input allows up to 3,000.
   - **One-time re-score (owner-approved):** earlier rows the screen created are re-scored with the candidates' stored skills, score only. READY, STRETCH, applied and decided rows are excluded. Rows are tagged and not re-scored again.
   - **Storage:** the description of a job closed for more than 30 days is dropped. Title, company and links stay.
   - **Writing:** everything is sent as one D1 import, all or nothing, and the dashboard's cache is cleared.

## Candidate rules (owner-confirmed 2026-11-07)

- **Farhan.**
  - **Location:** remote only, from any country, as an employee or a contractor. A role that is not remote, a hybrid role, or one that is remote within the United States only is marked ineligible and is not shown.
  - **Builder roles, in any industry:** implementation, automation, technical and revenue operations, GTM engineering, Founder's Office and Chief of Staff.
  - **Score capped (avoid list):** business analyst, deal desk, sales, admin, junior and intern roles, data engineering, and roles that need hands-on Salesforce, HubSpot or Zoho administration or development, on top of the earlier list.
  - **Skipped:** one employer the candidate asked to skip.
- **Sana.**
  - **Location:** anywhere that could be her dream job.
  - **Roles:** power-plant O&M, reliability and maintenance, plus energy efficiency, decarbonization, sustainability, clean tech and technical consulting.
- **Experience fit (both).**
  - A posting asking for more than two years beyond the candidate's own experience loses 15 points.
  - A posting whose stated requirement the candidate meets gains 5 points.
  - This puts first the roles where the candidate is an easy yes.
- **Applying the new rules to earlier jobs.** The re-score runs once with these rules. It also marks earlier undecided rows ineligible when the new rules say so, for example a role that is not remote, for Farhan. READY, STRETCH, applied and decided rows are never touched.
- **Profiles.** Migration 0015 adds the skills from each CV to the stored lists (nothing stored is removed) and raises the stored years to 9. It runs once.

## Signals added 2026-11-07 (owner-approved)

- **Pay floor.** Only a published pay range is compared, converted to rupees a month at reference rates.
  - Below the candidate's floor (Farhan: ₹1,20,000 a month): −20 points.
  - At Farhan's preferred ₹25 LPA or more: +5 points.
  - No published pay: no change. A candidate with no floor on record is never compared.
- **Employers listed publicly as hiring worldwide** (Farhan only).
  - Sources, read at run time and never stored in this repository:
    - remoteintech/remote-jobs (ISC licence): kept when region is worldwide or Asia-Pacific and the company is fully remote or remote-first;
    - yanirs/established-remote.
  - About 370 employers.
  - Effect: +5 points, no foreign-location penalty, and the note "confirm India is included". Eligibility is never changed.
- **Rejected before.**
  - Sources:
    - dashboard applications marked REJECTED;
    - applications made outside the dashboard, entered by the operator on the Profile page (`past_applications`, migration 0016).
  - New jobs from that employer are labelled with the date. Nothing is hidden or re-scored.
- **"Easy yes" note.** For a role-match it names the CV skills the posting asks for and the experience it asks for that the candidate meets. It is built only from the CV and the posting.
- **Gulf job sites for Sana.** Bayt plus Indeed and LinkedIn in the UAE, Saudi Arabia, Qatar and Oman, next to the India searches. That is 7 searches for her and 5 for Farhan.

## Remote job boards and YC companies (2026-11-07)

- **Remote job boards, through their official public feeds** (`engine/remote_boards.py`, no credentials, 5-minute limit). Each is filtered by the candidates' own role rules, and only jobs from the last 7 days are kept.
  - Remote OK. Its terms ask for a link back and a source credit: every stored job links to its Remote OK page and is labelled `remoteok`.
  - We Work Remotely: four category feeds.
  - Himalayas: the 200 newest jobs.
  - Working Nomads.
- **Board postings the screen rules out.** A job-site or board posting whose own text rules the candidate out (not remote, United States only, a clearance) is no longer stored. Only a positive eligibility claim is never taken from a board.
- **Y Combinator companies that are hiring** (yc-oss/api, about 1,500, read at run time). For Farhan's role-matches: +3 points and a note naming the batch. This serves the "well-funded, early-stage founder" goal.

## Hacker News and the daily "still open?" check (2026-11-07)

- **Hacker News "Ask HN: Who is hiring?"** (the current monthly thread, through the official Algolia HN API). Each role named on a post's first line (`Company | Role(s) | Location | REMOTE`) becomes one posting, linked to the post. Posts are kept for 35 days, because the thread is monthly.
- **Still open?** After each run, the 50 best-ranked undecided jobs per person are re-checked (`engine/liveness.py`).
  - A job is closed only on HTTP 404/410 seen twice, or on a Greenhouse error redirect.
  - Blocked sites (403/429), server errors and timeouts prove nothing.
  - Live postings get `last_verified_at`.
  - Never closed: a job with an application or a human decision.
  - The check runs in three steps, so credentials never reach the step that visits outside websites.

## More sources (2026-11-07)

`engine/more_sources.py` (no credentials, 12-minute limit, one failing source is skipped):

| Source | What it adds | Live check from the sandbox |
|---|---|---|
| Workable job search | Every Workable employer, which the open dataset does not cover; remote-only queries for Farhan | 706 read, 251 matches |
| Eightfold career sites | Fluor, NEOM, TAQA | Blocked by the sandbox proxy; first real test is on GitHub's servers |
| Siemens Energy (Avature feed) | Siemens Energy jobs; Sana's role rule now also covers turbine, boiler, field-service and control-room titles | Not reached in the local test |
| SuccessFactors RSS | ENGIE, ACWA Power, Tata Power | 248 read, 29 matches |
| Arbeitnow | Visa-sponsorship jobs in Germany; the job text is marked so Sana's visa rule sees the offer | 687 read, 34 matches |
| Getro VC networks | Portfolio jobs; the collections searched include Clean Energy Ventures | 40 read, 2 matches |
| UN Careers | Home-based consultancies are marked remote | 470 read, 7 matches |

The research file with all 20 verified sources and 17 ideas is kept outside the repository. The next candidates are EURES, The Muse, ReliefWeb, YC's job pages, free-key sources (Adzuna, Careerjet) and per-company Recruitee, Personio and Teamtailor boards.

## Sources by measurement (plan D1, 13 Nov 2026)

Each candidate source was probed live (one request each, a second apart) and added only when it answered with real rows **and** the
daily sources did not already read it. The open ATS dataset's own company lists (`storage.stapply.ai/jobhive/v1/<ats>/companies.csv`)
were used to tell what the daily run already reads.

**Farhan (Greenhouse, Lever and Ashby boards of CRM and automation vendors).** Already read every day through the dataset, so nothing is
added: GoHighLevel (Lever, 94 postings, 8 in his roles), HubSpot (Greenhouse `hubspotjobs`, 147 / 9), Zapier (Ashby, 9 / 1), Make
(Greenhouse, 6 / 0), n8n (Ashby, 56 / 0), Airtable (Greenhouse, 9 / 2), ClickUp (Ashby, 46 / 6), ActiveCampaign (Lever, 10 / 0), Close
(Ashby, 3 / 0), Intercom (Greenhouse, 115 / 13), Calendly (6 / 0), Typeform (6 / 1), Notion (Ashby, 166 / 45), Workato (Greenhouse,
63 / 1), Retool (Gem, in the dataset). Webflow answers on Ashby (25 postings, 0 in his roles today) while the dataset lists it under Greenhouse;
not added, because the daily sources have no Ashby reader of their own and it has nothing for him (re-probe if that changes). Probed, no public board on these three systems: monday.com, Pipedrive and Freshworks (empty Lever boards; both are in the
dataset through SmartRecruiters), Keap, Zoho, Tray.io.

**Sana (India and Gulf plant employers that failed the 12 Nov probe).** Several are already in the dataset through other systems, with
postings in the 12 Nov snapshot: Adani (Oracle, 1,043, e.g. "Shift Operations Engineer (O&M) - Mechanical, Anantapur"), Honeywell
(Oracle, 1,344), Emerson (Oracle, 1,199), ABB (Phenom, 2,282, about 190 in India), Linde (Cornerstone, 968), JSW (Darwinbox, 23).
Listed in the dataset's company lists, rows not counted here: ADNOC and SABIC (SuccessFactors), BP (SmartRecruiters), Danfoss
(SuccessFactors). Listed but with no postings in that snapshot: Larsen & Toubro and Tata Steel (Pinpoint), Eaton (Eightfold). Probed on their real career-site hosts and **not
added**: Aramco (SuccessFactors RSS at `careers.aramco.com` answered once with 20 maintenance postings, then refused three times:
too unreliable for a daily run), Aditya Birla for Hindalco and UltraTech (406), Reliance Industries (404), NTPC (403), QatarEnergy, DEWA,
Saudi Electricity and Mahindra (no answer), Siemens and Schneider Electric (no public Eightfold, Workday or SmartRecruiters board).

**Search terms (Workable).** Kept where one live search returned mostly the person's roles: Sana `utilities engineer` (17 of 20 on the
first page in her role rule), `energy manager` (18), `plant engineer` (13), `O&M engineer` (8); Farhan `implementation` (20),
`solutions consultant` (16). Left out: `asset performance` (finance roles only), `onboarding manager` (HR onboarding),
`technical account manager` (1), `customer engineer` (0), `business systems` (5); `commissioning`, `revenue operations`, `crm` and
`automation` were already searched. Every term passes the role test in `test/discovery.test.mjs`.

**Run log.** The shortlist report now counts, per person, the pool rows (`pool_sources`) and each tier's rows (`sources`) per source;
the run row and `/api/discovery/daily` carry it.

### Compliance, 14 Nov 2026 (robots.txt at run time)

Every reader now asks `engine/robots.py` before each request: the host's robots.txt is read once a run with the engine's own
User-Agent (`career-job-engine/1.0`), `*` and `$` are honoured, the longest rule wins, a 429/5xx/unreachable robots.txt means "do not
read this host this run", a 4xx (no robots.txt) means allowed, a redirect is checked against the robots.txt of where it leads, and
requests to one host are spaced by 0.6-1 s or the host's `Crawl-delay`. A refused source is reported as
`robots.txt disallows ...` in `more_sources_report.json` / `boards_report.json`; each source's report also gives its `requests`.

| Source | Before | Now | Measured 14 Nov (one polite read) |
|---|---|---|---|
| SuccessFactors (ENGIE, ACWA, Tata Power, EGA, Black & Veatch, Doosan, Tata Motors) | `/services/rss/job/` x 6 terms (disallowed: `Disallow: /services/`) | `/search/` result pages, newest first (allowed); a site with another page template is read from `/sitemap.xml` plus the job pages whose address names a role; descriptions from the `/job/` page | 112 read, 56 kept, 76 requests. Sana: 54 kept, 22 at 60+ (11 ELIGIBLE at 60+, all ReNew wind and solar O&M); ACWA 36 kept (Gulf, eligibility unknown until a visa route is stated). ENGIE, EGA, Black & Veatch and Tata Motors answered 404 on `/search/` (their sites showed "site maintenance" on 13-14 Nov: re-measure). Farhan: 0 |
| ReNew (new, SuccessFactors) | not read | sitemap + role job pages | 20 kept for Sana, 14 at 60+, 11 ELIGIBLE at 60+ (e.g. "Senior Engineer - Wind O & M" 94, "Engineer - Wind O & M" 91) |
| SmartRecruiters (Masdar, AFRY, Statkraft, Continental) | postings API (disallowed: `api.smartrecruiters.com` allows only LinkedInBot) | the employer's public career page `careers.smartrecruiters.com/<id>` and its "more" pages; descriptions from the posting page | 353 read, 35 kept (AFRY 29, Masdar 3, Continental 3), 66 requests; Sana 27 kept, 0 at 60+ with a list-only description. Bosch and Vattenfall left the list: their career pages forward to their own sites |
| Getro (collections 628, 1198) | public search API | **dropped**: `api.getro.com` disallows everything | cost: about 3 kept rows a day (13 Nov) |
| Remotive (Worker, 2 searches) | `/api/remote-jobs?search=` | **dropped** (migration 0024 switches its two sources off): robots.txt disallows `/api/*` and `/*search=` | cost: 2 x 10 rows a day, none in either person's lists on 13 Nov |
| Naukri (JobSpy) | 5 India searches | **dropped**: its terms forbid automated access and its robots.txt blocks AI agents | cost: 12 kept rows on 13 Nov (none with a description) |
| Jobspresso | `/feed/?post_type=job_listing` (disallowed: `Disallow: /*?`) | `/jobs/feed/` (allowed, same 20 newest jobs) | no loss |
| Adzuna (free keys) | read when the keys are set | `api.adzuna.com` disallows every agent, so it is read only when the keys are set **and** the owner sets the repository variable `ADZUNA_API_TERMS_ACCEPTED=true` (the keyed API's own terms then govern) | 0 today (no keys) |
| Indeed, LinkedIn, Glassdoor, Google (JobSpy) | searched | still searched; the job-site report now says per site whether robots.txt allows the address JobSpy reads (14 Nov: all four disallow). Skipping them is a separate owner decision (its own pull request) | - |
### New employer sources, 14 Nov 2026 (Sana; measured with one polite read and scored with the repo's `evaluate()`)

"Right" = scored 60 or more and not ineligible (Sana's Gulf rows stay "eligibility unknown" until a visa route is stated); the
ELIGIBLE count is given too. Requests are per daily run (the watchlist reads the same employer sites three times a day).

| Source | Reader | Read / kept / requests | Sana: kept, right (60+), ELIGIBLE 60+ | Farhan |
|---|---|---|---|---|
| Schneider Electric (India, UAE, Saudi) | `jibe()`: `careers.se.com/api/jobs` (robots.txt allows; its 5 s Crawl-delay is kept) | 667 / 48 / 9 | 32 kept, 2 right, 2 ELIGIBLE ("Sr. Manager - Product Management - Solar Inverters" 66, "Deputy Manager - Switchgear Training Centre" 61) | 17 kept, 0 eligible (office roles) |
| Cummins India (Oracle `cx_1007`, India filter) | `oracle_hcm()` entry, no keyword, location filter | part of 305 / 25 / 42 below | 5 kept, 2 right ("Maintenance Manager, Pune" 92, "Maintenance Engineer, Ranjangaon" 82) | 4 kept, 0 |
| Apraava Energy (Oracle `CX_1`) | `oracle_hcm()` entry | (same read) | 7 kept, 3 right ("Assistant Manager - HSSE (Renewables)" 74, "Assistant Manager - Operations (Renewables)" 61) | 0 |
| Transguard Group (Oracle `CX_2`) | `oracle_hcm()` entry | (same read) | 0 kept today (its facilities titles name no engineering/technical side) | 0 |
| Wood in the Gulf (Oracle, by place) | `oracle_hcm()` entry, Gulf places only | (same read) | 9 kept, 0 at 60+ today (project and PMC roles) | 0 |
| KBR in the Gulf (Workday, by place) | `workday()` entry, Gulf places only | not measured: `kbr.wd5.myworkdayjobs.com/robots.txt` answered 521 (server error) at both tries, so the robots rule skipped KBR for that run | - | - |
| JLL (Workday `jllcareers`, facilities-engineering terms) | `workday()` entry | 266 / 50 / 68 | 44 kept, 8 right, 7 ELIGIBLE ("Shift Engineer" Mumbai 78, Bengaluru 77, Gurugram 74; "Senior Shift In-charge" Hyderabad 77) | 6 kept, 0 |

**Worldwide energy employers probed for the owner's "any country" rule (14 Nov):** Sulzer's SmartRecruiters page lists no postings;
Wärtsilä's and Veolia's forward to their own sites (`jobs.smartrecruiters.com`, `jobs.veolia.com`); Enel's Avature feed answers empty;
Ørsted's Workday tenant refused the guessed site name; Iberdrola's careers host did not answer. None added. Already read: ENGIE,
Siemens Energy, GE Vernova, Statkraft, AFRY, Masdar, EURES (EU-wide) and Arbeitnow (visa-sponsored, Germany).

**Facilities-engineering titles (owner default: yes).** `FM_ROLE` in `engine/more_sources.py` accepts Shift Engineer / Shift In-charge,
Chief Engineer, Facility Manager - Engineering / Technical, Facilities Engineer, Technical Supervisor and MEP Engineer / Manager for Sana at
the source, and `FM_EXCLUDE` keeps office, admin, workplace, housekeeping, soft-services, security, coordinator, software and design roles
out (`test_employer_sources.py`). They are searched on JLL's board only: the Worker's role rule (`discovery.ts`, test S2) does not name
"chief engineer" or "technical supervisor" yet, so they are not Workable search terms. CBRE is not read: `careers.cbre.com` is behind a
bot challenge, and its Avature feed ignores filters (India share unmeasured).

### New boards and watchlist employers, 14 Nov 2026 (Farhan; one polite read, scored with `evaluate()`)

| Source | Reader | Read / kept / requests a run | Farhan: kept, right (60+, not ineligible), ELIGIBLE 60+ |
|---|---|---|---|
| 4dayweek.io API v2, remote + India | `remote_boards.fourdayweek()`; robots.txt `Allow: /api/v2`; their only ask is a link back, and every stored posting links to its 4dayweek.io page | 273 / 22 / 3 | 22 kept, 13 right, 12 ELIGIBLE ("Solutions Engineer", Fingerprint 79; "EPM Implementation Consultant", Vena 74; "Revenue Operations Manager", Paired 61; "Project Manager - Enterprise Customer Onboarding", Sprinto 61) |
| Real Work From Anywhere RSS | `remote_boards.realworkfromanywhere()`; every posting stored as "Remote (Worldwide)" (the board lists only work-from-anywhere jobs); the feed's bare "&" are escaped before parsing | 139 / 11 / 1 | 11 kept, 6 right, 6 ELIGIBLE (Camunda "Senior Architect, Enterprise Agentic Automation" 77) |
| WWR customer-support category | one more entry in `WWR` | 96 / 20 / 1 | 20 kept, 6 right, 5 ELIGIBLE (Databricks "Director, Delivery Solutions Architects" 82; Veeva "Solutions Architect - Cloud CRM" 66) |
| Watchlist employers' own boards (MonetizeMore on JazzHR; Massive Rocket, Sprinto, Firework on Lever; UptimeAI, Canvas Medical on Ashby; Fingerprint on Greenhouse; Paired on Workable) | `more_sources.watch_boards()`, also in the watchlist run (three times a day); JazzHR lists one posting per country, so only India / anywhere rows are read, and their text comes from the posting page | 198 / 52 / 32 | 50 kept, 13 right, 11 ELIGIBLE (UptimeAI "Implementation Engineer" 90; Fingerprint "Solutions Engineer - India" 79; Canvas Medical "Solutions Consultant" 77, "Implementation Manager" 72; Firework "Sales & Marketing Operations Manager" 67). Paired's Workable widget answered 429 to this sandbox (rate limit), so it is unmeasured; MonetizeMore kept rows had no text in this read (fixed since: 0 of them at 60+ then) |
| Jobspresso (allowed feed) | `/jobs/feed/` | 20 / 3 / 1 | 3 kept, 0 |

Sana gets nothing from these boards (remote office roles); UptimeAI's "Technical Consultant" (Bangalore) scored 63 for her.

**Reposting sites and VA staffing firms** (`engine/reposters.py`): Jobgether, Turing, Crossover, Peopleworth, Pavago, Braintrust and
virtual-assistant staffing firms (20four7VA, names such as "... Virtual Assistants" or "24/7 VA") enter at most 3 postings per firm per
run across every source, marked `reposter: true`. The shortlist's own list (`REPOSTERS` in `dashboard/scripts/shortlist_select.mjs`)
names 20four7VA and no longer names Paired, which posts its own RevOps roles (watchlisted here) (#182, 15 Nov).

**Adzuna (owner step).** Free keys: sign up at developer.adzuna.com (free plan, 250 requests a day), create an application, and add the
repository secrets `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (Settings > Secrets and variables > Actions). Because `api.adzuna.com`'s robots.txt
disallows every agent, the reader also needs the repository variable `ADZUNA_API_TERMS_ACCEPTED` set to `true` (the owner accepting that
the keyed API's own terms govern). It then makes 10 requests a day (7 for Sana, 3 for Farhan).

### Time spent where the open dataset has nothing, 19 Nov 2026 (both; live reads scored with `evaluate()` via `scripts/prescore.mjs`)

The run logs of 19 Nov showed `more_sources.py` stopping EURES, Oracle, Siemens Energy and SuccessFactors at their time caps, in the
daily run and in all three watchlist runs. (A local run of the watchlist step after this change, 900 s budget, stopped Workable and the place searches at their caps at weight 1, so
both Workable sources now have weight 2.) A check against the open dataset's own company lists (`jobs/v1/<ats>/companies.csv`) showed that
every Workday, Oracle and SmartRecruiters employer read here, six of the eight SuccessFactors sites and EURES are already in the dataset the
daily run reads in full, while Workable search, Schneider (Jibe), Eightfold, Siemens Energy, ReNew and Tata Power are not. ENGIE (about
1,700 postings, in the dataset) was the first SuccessFactors site and filled the source's cap, so ReNew, last, was never read.

| Change | Live read on 19 Nov | Sana (60+, not ineligible) | Farhan (70+, not ineligible) |
|---|---|---|---|
| Source order: the sources outside the dataset first; EURES, Oracle, SmartRecruiters, Workday take the time left | (order only) | | |
| SuccessFactors order: ReNew, Tata Power, ACWA Power, EGA first; ENGIE last | ReNew: 21 read, 41 s | 14 (wind and solar O&M, SCADA; 11 ELIGIBLE) | 0 |
| `workable_places`: Workable search by place (Sana: 7 terms in India, Saudi Arabia and the UAE, one in Qatar, Oman, Kuwait, Bahrain); `jobs.workable.com` paced at 1.2 s (it answered 429 at 0.6 s); Workable sources weight 2 | about 900 read, about 60 requests, under 2 min | 22 different jobs, 9 posted in the last 30 days (the run's cutoff), 7 of those not found by the worldwide terms | not searched: his India-remote place searches found none in 30 days the worldwide terms missed |
| Workable worldwide terms: `marketing operations` (Farhan), `boiler` (Sana) | 40 + 40 read | 2 (before the 30-day cutoff) | 3 (before the 30-day cutoff) |
| JobSpy: 4 more searches for Sana (thermal power plant maintenance, mechanical maintenance and O&M power plant in India; maintenance engineer in Abu Dhabi); `MAX_QUERIES` 7 to 11 | Indeed + LinkedIn, last 48 h | 10 not found by her other searches (Adani Power boiler maintenance, PPN Power, L&T) | - |

Left out after measuring: more Workable worldwide terms (HubSpot, Zapier, n8n, workflow automation, customer onboarding, Salesforce
consultant, technical project manager, sales operations, integration specialist; maintenance manager, turbine, asset integrity, substation,
field service engineer, solar O&M: 0 rows at the threshold), Farhan's JobSpy searches for RevOps, marketing operations, HubSpot, GoHighLevel,
automation specialist, solutions consultant and customer onboarding (22 new title matches, none at his threshold), and new public ATS
boards: the SaaS and automation employers checked (Zapier, n8n, Workato, HubSpot, Freshworks, Deel, Oyster, Toptal, Gong, Postman, Intercom,
Airtable, Notion and others) and the energy and plant employers found on a public ATS (RWE, Nordex, Wärtsilä, Sulzer, Alstom, Voith, Vestas, Uniper, SABIC,
QatarEnergy LNG, Nesma, Alfanar, Adani, Thermax, Suzlon, Avaada, Sembcorp) are already in the open dataset. Siemens Energy's feed ignores the
page offset when it is searched, so it stays a newest-first read.

## Maximum discovery, 20 Nov 2026 (audit, then every change measured live)

Owner request: scan as many postings as the free tiers allow and store only rows likely to reach a list. **Hard limits designed around:**
D1 free tier 5,000,000 rows read and 100,000 rows written a day, 5 GB stored (about 77 MB used); GitHub Actions on this public repository:
unlimited minutes, 6 h per job, about 14 GB disk and 16 GB RAM per runner. Scanning and scoring happen on the runners (free compute, the
Worker's own `evaluate()` through `scripts/prescore.mjs`); the database sees only rows that can reach a list, through the one all-or-nothing
import, whose cap is unchanged (`--max-new 1500`, about 27 rows written a new job, so at most about 40,500 writes). No paid API; Adzuna only
with its free keys and the owner's variable; robots.txt reporting and site rules unchanged; Naukri stays off (its terms forbid automated access).

### Audit (before): the run of 20 Nov 03:06-03:31 UTC (run 44665385948), 25 minutes

| Source | Scanned per run | Kept (title match) | Into the import | Time | Caps hit |
|---|---|---|---|---|---|
| Open dataset (`all.parquet`; 7.66M postings in the 18 Nov snapshot, 7.94M in the 20 Nov one, 173,000 employers, 92 systems incl. EURES and the Bundesagentur) | the whole file (DuckDB), filtered by the narrow search title rule and the last 45 days: 49,751 Farhan + 60,042 Sana rows pre-scored | plausible 236 / 1,266 (all picked; the 6,818-per-person cap never bound) | 1,502 selected, 1,203 already stored, 201 new, 3 reopened, 117 closed | 49 s download, 3 min select | none |
| JobSpy (Indeed, LinkedIn, Glassdoor, Google, Bayt) | 59 searches (Farhan 5, Sana 11), 20 results each, last 48 h; 22 refused (LinkedIn 429, Glassdoor and Bayt 403, Google empty) | 76 (Indeed 26, LinkedIn 52) | with the next two rows: 1,212 rows to the duplicate check, 510 new | 1 min 34 s | none |
| Remote boards (8 public feeds) | 1,454 | 15 | (above) | 26 s | none |
| More sources (14 sources) | 8,104 | 1,121 (Workday 434, Workable 290, SuccessFactors 106 ...) | (above) | 17 min 16 s | Siemens Energy (69 s, 460 read), SuccessFactors (207 s, 388), EURES (79 s, 203), Oracle (78 s, 234) |
| Import (`dataset_apply.mjs`) | 1,212 + 1,502 rows | - | 297 new jobs (159 too low, 260 ineligible not stored), 400 re-scored | 1 s | MAX_NEW 1,500 not reached |
| Watchlist (3 a day) | more sources `--fast` + boards, 960 s budget | - | - | about 15 min | same caps |
| Collector (`collect.yml` + `sync_collector_to_d1.yml`, 5 a day) | 17 Greenhouse / Lever / Ashby boards, 850 listings | - | collector staging import | 2 min | none |
| Worker cron (every 2 min) | `cloud_sources` boards (Remotive off) | - | at most 48 source reads and 120 postings a day (`DAY_SOURCES`, `DAY_JOBS`) | - | its own daily caps |

The local re-run of the 20 Nov job-site settings gave the same 59 searches, 22 refused and 76 kept, so the live measurements below compare like with like.

### Changes and measured yield ("at threshold" = Farhan 70+, Sana 60+, not ineligible; rows scored with `evaluate()` via `prescore.mjs`)

| Change | Scanned | Farhan | Sana | Run time |
|---|---|---|---|---|
| Dataset: title rule = the Worker's own role rule (`FARHAN_ROLE` / `SANA_ROLE`, read from `discovery.ts`) or the old search rule (`wide_role`); exclusions kept (+ `powershell` for Sana: 24 PowerShell admin rows scored 60+ on "power") | 109,793 -> 371,801 rows pre-scored (45 days) | at threshold 39 -> 67 (+28, 22 ELIGIBLE: Technical Program / Project Manager, Professional Services, Technical Account Manager); plausible 218 -> 372 | 537 -> 1,018 (+481, 309 ELIGIBLE: Shift Engineer / In-charge, Mechanical Engineer, C&I maintenance); plausible 1,236 -> 2,600 | - |
| Dataset: 45 -> 90 days (live rows in today's snapshot; undated rows were always read) | +71,903 rows | +20 (7 ELIGIBLE) | +191 (142 ELIGIBLE) | - |
| Together (20 Nov snapshot) | 443,558 rows | plausible 466, at threshold 87 | plausible 3,013, at threshold 1,185 | 175 s locally (3 scorers in parallel, batches of 25,000, 3.2 GB peak) vs about 3 min before |
| Excluded titles checked | 18,646 rows | 0 at threshold | 10 (database / site reliability): the exclusions are right | - |
| JobSpy: Indeed-only searches added (Farhan 30 terms with Indeed's remote filter; Sana 28 terms in India and 16 in each of the six Gulf countries); 200 results; a site that refused twice is not asked again; title filter = `wide_role` | 59 -> 189 searches, 338 -> 3,896 rows returned, 76 -> 353 kept | 0 -> 9 at threshold (all net-new) | 30 -> 95 (77 net-new; Gulf: 2 net-new, Indeed has few Gulf rows in 48 h) | 78 s -> 153 s |
| More sources in four parallel groups, each with its own budget (27-37 min) | Siemens Energy 460 -> 1,200 read (all 60 pages), Oracle 234 -> 528, EURES 203 -> 653, SuccessFactors read to the end without a cap | Workday answered nothing in the sandbox (2,291 read in Actions on 20 Nov), so its yield is not measured here | | each group under its budget |
| Pre-screen of the job-site and employer-site rows before the duplicate check (`engine/prescreen.py`; floor = `fit_floor()`, as the dataset intake) | 1,104 merged rows -> 241 | 416 pairs -> 34 kept (19 at threshold) | 752 -> 207 (139 at threshold) | seconds |

Checked and not added: Naukri (terms), Glassdoor, Bayt and Google through JobSpy (403 / empty from the runner and the sandbox: kept on the original searches only, where they cost one refused request each), ZipRecruiter (US / Canada only), BDJobs and HelloWork (Bangladesh, France). More ATS board directories: the dataset's own company lists already hold about 173,000 employers across 92 systems (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Personio, Teamtailor, BambooHR, JazzHR, ...); the earlier checks in this file found the SaaS and energy employers of both people there.

### How the run is laid out now

`guard` -> `collect` (8 parallel parts, no credentials, built-in profiles from the code: `dataset_discovery.py --builtin-profiles`; JobSpy
Farhan, Sana India, Sana Gulf; remote boards; more sources in 4 groups, `more_sources.py --only`) -> `discover` (dataset download and
selection, the clients' own job-site searches, `merge_collect.py` (each posting once, reposters capped across parts, every person whose role
rule matches the title added), `prescreen.py`, duplicate check, one import, then everything as before). When any client profile exists,
the discover job also runs the clients' JobSpy searches (480 s budget) and a second pass of the remote boards and more sources with every
profile (the collector parts match titles against the built-in rules only, so a client's keywords would otherwise never see those rows).
A manual run with `job_sites=false` skips every JobSpy search, as before. The job-site search writes its results after every search, so a
part stopped by its time limit still uploads what it found; the merge reports any expected part that uploaded nothing. Collector artifacts hold public
postings and counts only (this repository and its artifacts are public); candidates, profiles of clients and decisions never leave the
discover job. The guards read up to 50 jobs a run (a run now has about 16). The dataset address is the canonical `jobs/v1` (the manifest lists
`jobhive/v1` as deprecated); the file is now 3.9 GB.

### New daily totals (estimates from the measurements above)

- **Scanned:** the whole 7.9M-posting snapshot by title, 443,558 rows scored with the screen (was 109,793); 189 job-site searches, about
  3,900 rows (was 338); more sources read to their ends (about 10,000 rows).
- **Relevant found:** in the dataset about 466 (Farhan) and 3,013 (Sana) rows that can reach a list, 87 and 1,185 at threshold, most already
  stored after the first day; job sites and employer sites about 34 and 207 a day (19 and 139 at threshold).
- **Rows written:** the first run after this change is bounded by `--max-new 1500` (about 40,500 writes, inside 100,000); after that the
  daily new rows are the day's new postings, estimated 300 to 800 jobs (8,000 to 22,000 writes). Rows below the floor are no longer imported
  only to be held.
- **Rows read:** the duplicate check reads about 11 rows a selected row: dataset about 3,500 rows (about +22,000 reads), job-site rows
  1,212 -> about 250 (about -10,000). About +12,000 of the run's 2.4M; the budget guard is unchanged.

**Risks.** Job sites can refuse at any time (a refused site is skipped, and twice-refused sites are not asked again); a collector part that
fails or times out is a warning in the merge and the run goes on; the dataset file grew to 3.9 GB (download about 1-2 min; the runner has
14 GB); `jobhive/v1` may stop being served (we moved to `jobs/v1`); the first day after the change uses most of the write cap; the
pre-score is now about 4x the rows (3 min on the runner, well inside the 55-minute job).

## The ten additions of 2026-11-07 (owner-approved)

1. **Location class.** Each posting's own words put it in one of: work from anywhere, India named, US only, EU only, or restricted to another region's hours. For Farhan, EU-only is ineligible and another region's hours costs 10 points. The class is said in the note.
2. **Title synonyms.** The searches and the screen's role rules now include German, French and Dutch power-plant titles (Instandhaltung, Kraftwerk, Elektroingenieur, ingénieur maintenance, onderhoudsingenieur and more) and Farhan's adjacent titles (sales ops, marketing ops, systems architect, customer onboarding, business operations).
3. **Learning from decisions.** Saves, applies and hand-set READY rows are positive; hand-set INELIGIBLE, HOLD and CLOSED rows are negative. A small word model per person (`engine/signals.py`) moves a score by at most 5 points and says "like roles you saved" or "like roles you dismissed". It switches on only after 10 decisions.
4. **UK sponsor register.** GOV.UK's daily list of Skilled Worker sponsors. For Sana, a UK posting from a licensed sponsor is not penalised as "no visa route", and the note says so.
5. **AI review: removed.** It was switched off when its free provider was retired (30 Jul 2026) and the owner's standing rule is no AI review, so the script, its probe workflow and its daily step were deleted on 13 Nov. Nothing in the daily run sends job text to a model.
6. **Watchlist, three times a day** (`.github/workflows/watchlist.yml`). The priority employer sites and the remote boards are read at 03:07, 09:07 and 21:07 UTC, between the daily runs. Up to 300 new jobs each time.
7. **Reposts and long-open listings.** A role that closed in the last 180 days and is back under a new id is noted as reposted. Undecided rows for jobs first seen more than 60 days ago get a "listed for 60+ days" note.
8. **Agency flag.** Staffing-agency names and "on behalf of our client" wording cost 5 points and are said in the note.
9. **Language gate.** A posting that requires German, Dutch, French, Arabic or Spanish, or is written in German, French or Dutch, costs 10 points and is said in the note.
10. **EURES and Adzuna.** EURES (the EU portal, about 2 million vacancies) is searched for Sana's and Farhan's terms, English titles first. Adzuna (India, UK, Germany, Netherlands) runs when the free `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` secrets are set.

The daily cap is now 1,500 new jobs (about 35,000 of the 100,000 free daily writes at the cap).

## Cost (free tiers)

| Resource | Use |
|---|---|
| GitHub Actions | About 10 minutes for the daily run plus about 4 minutes for each of the three watchlist runs: about 25 minutes a day, inside the 2,000 minutes a month |
| D1 writes | About 18 to 27 row writes per new job, counting indexes. 1,500 jobs is about 27,000 to 40,000 a day, plus closures and the watchlist; inside the free 100,000 a day |
| D1 reads | Duplicate checks (about 2 rows per selected posting), one scan of active jobs, one of this pipeline's jobs, and the re-score export (one-time) |
| D1 storage | About 4 to 6 MB a day at the cap, reclaimed as closed jobs' text is dropped. The free database limit is 500 MB; the diagnose workflow reports the size |
| Worker CPU | None: scoring happens in the Action |

D1 imports make the database briefly unavailable to queries while they run (a few seconds at this size). The run is scheduled at 15:13 UTC, away from the collector's slots.

## Running it by hand

Actions → "Daily discovery" → Run workflow. `max_new` sets the cap; `job_sites=false` skips the job-site search. The run summary shows counts only:
- selected, duplicates, already stored, new, reopened
- closed, first-time missing, cleared
- skipped, re-scored, blocked searches

## First real run, measured locally (2026-11-06)

| | Farhan | Sana |
|---|---|---|
| New relevant jobs | Hundreds | Hundreds |
| Top scores | Mid-70s (CRM and automation roles remote from India) | Up to 88 (maintenance, electrical and utilities roles at Hitachi, Regal Rexnord, Bajaj Auto and others) |

Before this, there were about 2,000 jobs in total, and 3 were location-eligible for Farhan.

Sana's on-site roles show eligibility as "unknown" by her own rule: airport access within about 2 hours has to be checked per posting.
