# Collector schedule behaviour and discovery coverage (measured 2026-11-05)

Nothing here changes any schedule, workflow, token or infrastructure. The existing schedules stay as they are.

## What the schedules do in practice

`collect.yml` is nominally at UTC 01:37, 06:37, 11:37, 16:37, 21:37 and `sync_collector_to_d1.yml` at :45 of the same hours. From the
GitHub run history (27 scheduled collection runs, 2026-10-27 to 2026-11-05):

* **Every scheduled run that started succeeded.** No failed scheduled collection or sync run was found.
* **About 60% of nominal slots produced a run.** From 2026-10-28 01:37 to 2026-11-05 11:37 there were 43 nominal slots and 26 scheduled
  runs; the others were skipped or never started.
* **Runs that did start were late.** Delay after the nominal time: minimum 7 minutes, median about 1h54, 90th percentile about 3h40,
  maximum 4h40 (2026-10-31 16:17 for the 11:37 slot).
* **The collection and the D1 sync are delivered together.** Each sync run started 1-3 minutes after the matching collection run, so a
  skipped collection slot is a skipped sync slot.
* **Today:** the last scheduled run before the dashboard release was at 14:55 UTC (collection) and 14:57 UTC (sync); the 16:37 and 21:37
  slots had not run by 21:50 UTC.

This is GitHub's scheduler behaviour (scheduled workflows are best effort and may be delayed or dropped under load); the workflow files
are correct. Two consequences for how the dashboard is read: **data can be several hours old, occasionally most of a day**, and a
manual "Run workflow" is the only way to force a refresh. A Cloudflare cron trigger would not be an exact-to-the-minute guarantee either, so
no infrastructure change is proposed or made here; the next step is to keep measuring actual runs.

## Where the "20,380 jobs" figure came from

It is **not found** in this repository, in any branch or in the full git history of either repository, in the backup repository, or in
this project's transcripts available to the maintainer who investigated. It therefore cannot be classified as synthetic test data,
accumulated inventory or real daily discovery from the evidence in the repository. The corpora that do exist in the history are:

| Corpus | Size | Nature |
|---|---|---|
| `bench/fixtures` | 19 synthetic postings + 2 permitted public excerpts, 34 labelled verdicts | hand-labelled benchmark (synthetic and confirmed excerpts) |
| frozen collector snapshot `public/boards` at `09fa535e` | 818 records, 16 boards | real public feeds, frozen 2026-10-30 for evaluation |
| combined evaluation corpus, 2026-10-30 | 1,272 records (818 + 454 from eight further employers) | real public feeds |
| collector output now (`public/status.json`) | 886 listings from 10 of 17 sources attempted in the latest run | real public feeds |
| dashboard database before the incident | about 2,100 jobs, 4,246 qualification rows, 22 MB | accumulated inventory from the collector and the Worker's discovery |

If the 20,380 figure came from a stress-test corpus, it was not committed. The production database could not have held it at the size it
had (22 MB, 2,123 jobs). A read-only inventory by source and by day (diagnose mode) is recorded in `QA_REPORT.md`.

## Current discovery coverage (separate from any historical figure)

* The collector reads the official job-board APIs (Greenhouse, Lever, Ashby) of **17 named employers**, plus two Siemens RSS feeds and six
  captured career pages (about 700 role links that are leads, not postings).
* The Worker's own discovery polls **14 sources** (Greenhouse, Lever, SmartRecruiters boards, Jobicy, Remotive and Hacker News jobs) within a
  fixed daily budget (48 source pages and 120 posting fetches per UTC day).
* This is a curated list of employer feeds, not a crawl of the internet. Coverage grows by adding employers to the source registry.
