# Daily discovery pipeline

Once a day, `.github/workflows/discovery.yml` finds new jobs for every candidate and client and writes them to D1. It replaces "about 30 sources" with an open dataset of **about 5 million live postings from about 80,000 employers across 64 hiring systems** (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Oracle, SuccessFactors, iCIMS, Darwinbox and more), plus a light job-site search.

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
   - The screen itself never returns READY or STRETCH. Since 12 Nov 2026 a shortlist step at the end of the write (owner decision) promotes the best screened rows:
     READY = score at the threshold and eligibility confirmed; STRETCH = the same score with eligibility to confirm, or confirmed and up to 10 points lower. Both need the current rules' mark, one matched profile skill and a posting verified open in the last 4 days; 25 of each per person. The reason starts "Shortlisted automatically." and the row returns to review when it stops qualifying. A person's decision or an application is never touched.
   - Ineligible jobs and jobs scoring below 30 are not stored.
   - **Never touched:** a job someone applied to, a row with a human decision, or an existing row (inserts never overwrite).
   - **Field safety:** every field is bounded, control characters are removed, and a job with an unusable URL is skipped.
   - **Daily cap:** at most 800 new jobs per run, best scores first. The `max_new` input allows up to 3,000.
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
