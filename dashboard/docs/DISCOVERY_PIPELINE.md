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
     - up to 200 remote roles open to anyone. Sana's search also covers the Gulf states she named.
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
   - Nothing becomes READY or STRETCH. A person decides that.
   - Ineligible jobs and jobs scoring below 30 are not stored.
   - **Never touched:** a job someone applied to, a row with a human decision, or an existing row (inserts never overwrite).
   - **Field safety:** every field is bounded, control characters are removed, and a job with an unusable URL is skipped.
   - **Daily cap:** at most 800 new jobs per run, best scores first. The `max_new` input allows up to 3,000.
   - **One-time re-score (owner-approved):** earlier rows the screen created are re-scored with the candidates' stored skills, score only. READY, STRETCH, applied and decided rows are excluded. Rows are tagged and not re-scored again.
   - **Storage:** the description of a job closed for more than 30 days is dropped. Title, company and links stay.
   - **Writing:** everything is sent as one D1 import, all or nothing, and the dashboard's cache is cleared.

## Cost (free tiers)

| Resource | Use |
|---|---|
| GitHub Actions | About 5 to 10 minutes a day (the repository's free allowance is 2,000 minutes a month) |
| D1 writes | About 18 to 27 row writes per new job, counting indexes. 800 jobs is about 15,000 to 22,000 a day, plus closures and the one-time re-score; inside the free 100,000 a day |
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
