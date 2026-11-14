# Daily discovery pipeline

Once a day, `.github/workflows/discovery.yml` finds new jobs for every candidate and client and writes them to D1. It replaces "about 30 sources" with an open dataset of **about 5 million live postings from about 80,000 employers across 64 hiring systems** (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Oracle, SuccessFactors, iCIMS, Darwinbox and more), plus a light job-site search.

## The daily run as of 13 Nov 2026 (plan phases 1-6)

This section is the current description; "Steps" below is the original one, kept for detail and corrected where it changed. The plan
(`PLAN_DIVERSITY_AND_9_OF_10.md`) names every rule; its section 10 lists what was read differently and what is knowingly left.

**When it runs.** `discovery.yml` is triggered at 15:13, 17:13, 19:13 and 21:13 UTC (after the dataset refresh) and at 01:13 and 03:13 UTC
(catch-up). Two guards decide whether the trigger does the work:
- the **budget guard** reads the account's rows read today from Cloudflare analytics (no D1 read) and starts the run only below **2.0M** (the run
  itself reads about 2.4M; the free limit is 5M). A due run it skips leaves a row `{skipped: "budget"}`, and the page shows "Not updated today";
- the **recent-run guard** lets one real run through per 20 hours (a manual run always goes).
The **watchdog** (`discovery-watchdog.yml`, every 2 hours) starts a run when the last good one is over 24 hours old. Discovery has its own
concurrency group, so the watchlist or the collector sync can never cancel a queued daily run.

**What one run does, in order** (`discover` job):
1. D1 usage snapshot (for the run's `d1_rows`).
2. Download the dataset. A failed download does not stop the day: boards, other sources, re-score, still-open check and shortlist still run.
   The run is then shown red, as it is when the manifest is unreadable or over 48 hours old.
3. Select matches from the dataset, and export rows to re-score: at most **800 per person** (best first) not yet scored under the current rules
   marker (`RULES_MARKER` in `worker/discovery.ts`, now `profile_v15`).
4. Job-site search, remote boards, more sources (Workable, Eightfold, Siemens Energy, SuccessFactors, Workday, Oracle, SmartRecruiters
   employers, Arbeitnow, Getro, UN Careers, EURES; Adzuna with its free keys). Each writes its file after every source and stops starting
   sources at 80% of its time budget; Workable skips a refused search term instead of losing the rest. Employer career sites are stored as the
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
11. The **daily phone message** (G1, `message` job): one line per linked person, also when the run failed, did nothing or was postponed. Off until
    the owner adds `TELEGRAM_BOT_TOKEN` (see `RELEASE.md`).

**The watchlist** (`watchlist.yml`, about three times a day) reads the priority employer sites and the remote boards between daily runs; when it
found nothing new it reads and writes nothing more in the database and leaves the visitors' cached lists alone (H1).

## Steps

1. **Download.** The workflow downloads today's dataset once: the [ats-scrapers](https://github.com/kalil0321/ats-scrapers) "jobhive" parquet file (MIT licence, refreshed daily around 14:30 UTC, about 2.3 GB). DuckDB then queries it locally.
2. **Dataset query** (`engine/dataset_discovery.py`).
   - **Profiles.** Each person's search profile is read from D1 at run time, so no candidate data lives in the repository.
     - The two built-in candidates use focused title searches, which are subsets of the screen's own role rules.
     - Clients use their stored role keywords and location rule.
     - Search values are passed to DuckDB as bound parameters. A keyword like `women's health` or a country like `Côte d'Ivoire` is safe.
   - **Two quotas per person,** so neither crowds out the other:
     - up to 400 in the home country. For a remote-only search, remote roles come first. The country is matched as a whole word, so Indiana is not India.
     - up to 200 remote roles open to anyone.
     - up to 300 more per person (owner rules, 2026-11-07):
       - **Farhan:** remote roles posted in other countries, never the United States.
       - **Sana:** on-site roles anywhere in the world, with postings that offer visa sponsorship or relocation first.
   - **Recency:** postings up to 45 days old, newest first.
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
Siemens Energy, GE Vernova, Statkraft, Vattenfall (dataset), AFRY, Masdar, EURES (EU-wide) and Arbeitnow (visa-sponsored, Germany).

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
does not name 20four7VA yet, and it names Paired, which posts its own RevOps roles (watchlisted here): both are for the shortlist's owner.

**Adzuna (owner step).** Free keys: sign up at developer.adzuna.com (free plan, 250 requests a day), create an application, and add the
repository secrets `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (Settings > Secrets and variables > Actions). Because `api.adzuna.com`'s robots.txt
disallows every agent, the reader also needs the repository variable `ADZUNA_API_TERMS_ACCEPTED` set to `true` (the owner accepting that
the keyed API's own terms govern). It then makes 10 requests a day (7 for Sana, 3 for Farhan).

## The ten additions of 2026-11-07 (owner-approved)

1. **Location class.** Each posting's own words put it in one of: work from anywhere, India named, US only, EU only, or restricted to another region's hours. For Farhan, EU-only is ineligible and another region's hours costs 10 points. The class is said in the note.
2. **Title synonyms.** The searches and the screen's role rules now include German, French and Dutch power-plant titles (Instandhaltung, Kraftwerk, Elektroingenieur, ingénieur maintenance, onderhoudsingenieur and more) and Farhan's adjacent titles (sales ops, marketing ops, systems architect, customer onboarding, business operations).
3. **Learning from decisions.** Saves, applies and hand-set READY rows are positive; hand-set INELIGIBLE, HOLD and CLOSED rows are negative. A small word model per person (`engine/signals.py`) moves a score by at most 5 points and says "like roles you saved" or "like roles you dismissed". It switches on only after 10 decisions.
4. **UK sponsor register.** GOV.UK's daily list of Skilled Worker sponsors. For Sana, a UK posting from a licensed sponsor is not penalised as "no visa route", and the note says so.
5. **Free AI review** (`engine/ai_triage.py`). The 50 best new jobs per person go to GitHub Models' free tier with the job text and a generic description of what the person wants (never a name). The review moves the score by at most 10 points and is put in front of the note. Applied, decided, READY and STRETCH rows are never touched.
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
| D1 writes | About 18 to 27 row writes per new job, counting indexes. 1,500 jobs is about 27,000 to 40,000 a day, plus closures, the watchlist and the AI review; inside the free 100,000 a day |
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
