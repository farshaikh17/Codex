# Daily discovery pipeline

Once a day, `.github/workflows/discovery.yml` finds new jobs for every candidate and client and writes them to D1. It replaces "about 30 sources" with an open dataset of **about 5 million live postings from about 80,000 employers across 64 hiring systems** (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Oracle, SuccessFactors, iCIMS, Darwinbox and more), plus a light job-site search.

## Steps

1. **Dataset query** (`engine/dataset_discovery.py`).
   - **Source.** The [ats-scrapers](https://github.com/kalil0321/ats-scrapers) "jobhive" dataset (MIT licence, refreshed daily around 14:30 UTC). DuckDB reads only the columns a query needs over HTTP, so a full scan takes seconds and nothing is downloaded in bulk.
   - **Profiles.** Each person's search profile is read from D1 at run time, so no candidate data lives in the repository.
     - The two built-in candidates use focused title searches. These are a subset of the screen's own role rules, so a selected job is always one the screen recognises.
     - Clients use their stored role keywords and location rule.
   - **Location.**
     - Jobs in the home country (matched as a whole word, so Indiana is not India).
     - Remote jobs open to anyone.
     - For Sana, the Gulf states she named.
   - **Recency and volume.** Postings up to 45 days old, newest first, at most 600 per person per run.
   - **Duplicates.** A posting already in D1 is skipped: same id, same URL, or the same company and title still active.
   - **Closed postings.** Jobs this pipeline added earlier that are no longer in the dataset are listed for closing. This only happens when the snapshot has its usual size, so a broken snapshot cannot close real jobs.
2. **Job-site search** (`engine/jobsite_discovery.py`).
   - Five searches per person a day, through the open-source JobSpy library: Indeed, LinkedIn and Naukri, plus Glassdoor and Google Jobs when they answer. A blocked site is skipped.
   - The same title rules filter the results.
   - These are job-board reports, so eligibility always starts as unknown.
   - Owner decision 2026-11-06: light daily use only.
3. **Scoring and writing** (`dashboard/scripts/dataset_apply.mjs`).
   - Every (job, person) pair is scored by the Worker's own `evaluate()`, so stored rows and the live screen cannot disagree.
   - Nothing becomes READY or STRETCH. A person decides that.
   - Ineligible jobs and jobs scoring below 30 are not stored.
   - **Never touched:** a job someone applied to, a row with a human decision, or an existing row (inserts never overwrite).
   - At most 1,500 new jobs per run, best scores first. That is about 15,000 D1 row writes per 1,000 jobs, well inside the free 100,000 a day.
   - **Closing:** only this pipeline's jobs are closed, and never one with an application or a decision.
   - **One-time re-score (owner-approved):** earlier rows the screen created are re-scored with the candidates' stored skills, score only. READY, STRETCH, applied and decided rows are excluded. Rows are tagged once and never re-scored again.
   - Finally the dashboard's response cache is cleared, so new jobs appear at once.

## Cost

| Resource | Use |
|---|---|
| GitHub Actions | A few minutes a day (the repository's free allowance is 2,000 minutes a month) |
| D1 writes | Bounded by the per-run cap |
| D1 reads | A few thousand rows for duplicate checks |
| Worker CPU | None: scoring happens in the Action, not the Worker |

## Running it by hand

Actions → "Daily discovery" → Run workflow. `max_new` sets the cap, and `job_sites=false` skips the job-site search. The run summary shows the counts: selected, already stored, new, skipped, closed, re-scored and blocked searches.

## First real run, measured locally (2026-11-06)

| | Farhan | Sana |
|---|---|---|
| New relevant jobs | about 700 | about 470 |
| Before | about 2,000 jobs in total, 3 location-eligible for Farhan | |
| Top scores | 74 (CRM and automation roles at HighLevel and Zoho partners, remote from India) | 88 (maintenance, electrical and utilities roles at Hitachi, Regal Rexnord, Bajaj Auto and others) |

Sana's on-site roles show eligibility as "unknown" by her own rule (airport access within about 2 hours has to be checked per posting).
