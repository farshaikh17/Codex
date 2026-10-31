# Career pipeline: discovery → qualification → durable state → private dashboards

`python -m engine.pipeline run --candidates DIR --state FILE --out DIR [--boards public/boards] [--offline]`

The run has four stages:

1. **Discovery.**
   - The collector's ATS boards (`public/boards`) are read on every run.
   - Rotating free searches from `engine/discovery_sources.json` run alongside them:
     - Himalayas Jobs API.
     - Workday career-site JSON for GE Vernova, Hitachi (including Hitachi Energy), Baker Hughes and KBR. All four were verified on 2026-10-30.
   - Each run takes the least recently run queries first.
   - Workday requisitions already stored are not fetched again. A query whose detail budget ran out stays due.
   - Search-found postings stay in the assessable pool for 21 days after they were last seen.
2. **Qualification.**
   - Uses `engine.qualify` with the existing gates.
   - Matching is batch-independent from `MATCH_VERSION` 3 onwards: fixed phrase weights instead of rarity across the scored batch.
   - Titles are capped below `min_fit` for:
     - entry-level programmes (intern, co-op, apprentice, trainee);
     - IT infrastructure, network and cloud;
     - specialist professions the candidate's history doesn't evidence.
   - `EXPERIENCE_GAP`: a mandatory line asks for more years than `profile.experience_years` + 1. The job is kept and ranked low; it is never a REJECT.
   - Ashby salary components summarised as OTE count as on-target earnings, not base pay (`EXTRACTOR_VERSION` 5).
3. **State** (`engine/tracker.py`, private SQLite).
   - Stores postings, qualifications, state-change events, reviews, discovery rotation and runs.
   - A (candidate, posting) is reassessed only when one of these changes:
     - the content;
     - the match, gates, extractor or pipeline version;
     - the profile or rules version;
     - the application history.
   - Application reviews (`applied`, `interviewing`, `offer`, `rejected`, `withdrawn`) feed the `application_history` gate, so the job is APPLIED on the next run.
4. **Outputs.** All are private and refused inside the repository:
   - `<out>/index.html`
   - `<out>/<candidate>/dashboard.html`
   - `<out>/<candidate>/jobs.csv`
   - `<out>/<candidate>/results.json`
   - `<out>/run.json`

Reviews: `python -m engine.pipeline review --state FILE --candidate ID --posting KEY --decision applied --note "..."`.
Status: `python -m engine.pipeline status --state FILE`.

## Scheduled operation (`.github/workflows/career-pipeline.yml`)

- **When it runs.** Daily at 03:23 UTC, and on manual dispatch. GitHub runs schedules and manual dispatch only from the default branch, so **nothing runs until this branch is merged**.
- **Script.** The job runs `engine/ci/run_pipeline.sh`, which can also be run locally.
- **Secrets.** Two repository secrets are required. Without them the run is skipped and reads or writes nothing.
  - `CANDIDATES_B64`: `tar -czf - farhan.json sana.json [*.history.json] | base64 -w0`.
  - `PIPELINE_PASSPHRASE`: encrypts both the state and the results.
- **State.**
  - The tracker is AES-256 encrypted (`openssl enc -aes-256-cbc -pbkdf2 -iter 200000`) and kept in the Actions cache.
  - It is also uploaded with the results artifact (retention 30 days). The artifact copy is the backup if the cache is evicted, which happens after 7 days unused.
- **Results.** The artifact `career-results-<run_id>` holds `results.tar.gz.enc`. Decrypt it with:
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:PASSPHRASE -in results.tar.gz.enc | tar -xz`
- **What gets deleted.** Plaintext profiles, state and outputs are removed from the runner at the end of the script.
- **Job summary.** Candidate-agnostic: totals only.
- **Cost.** GitHub-hosted runner minutes from the private repository's free allowance, about 3–4 minutes per daily run. No paid service. MIGRATION.md records a $0 Actions budget; the owner should re-check this in billing settings before merging.
