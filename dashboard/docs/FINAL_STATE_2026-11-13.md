# Career Job Engine: final state and hand-off (13 Nov 2026)

This replaces the hand-off of 11 Nov. It is written at the end of the build plan `PLAN_DIVERSITY_AND_9_OF_10.md` (phases 0-6). It covers
what is live, what is merged but waiting for a release, the numbers that were measured, what is knowingly left, and the owner's few steps.
Every number has a date. Measure again before relying on one.

**Live site:** https://career-job-engine.farshaikh17.workers.dev. The job seeker's page is at `/app`, the operator's at `/app?operator=1`.
**Live Worker:** commit `8dc3004` (#127, the open tracker), deployed on 13 Nov at 00:10 UTC. The release run's browser check then failed on a
timing wait, which #129 fixed; the after-fingerprint step did not run. `GET /api/version` shows the live commit.
**Rules that still hold:**
- Production changes only through the manual workflow `dashboard-release.yml`, with `rotate_key=false`, at most one release per UTC day.
- Free tools only. No AI review. No automated applications.
- A person's decision or application is never changed by a script.
- No CVs, contact details or secrets in the repository.

## 1. Merged since the 11 Nov hand-off

| Phase | PRs | What it gives Farhan and Sana |
|---|---|---|
| 0 and earlier | #110-#129 | Automatic shortlist; open tracker (no key) with a write limit, note cap and honest notes label; bot blocking; "New today"; taste learning |
| 1, daily machine | #130-#140 | The daily run cannot fail silently: partial writes kept, retries, its own concurrency group, a watchdog, red runs when nothing useful happened, "Not updated today" on the page |
| 2, sorting | #141-#152 | Scoring agrees with the profiles: Indian plant towns, every searched title, two-skill rule, worldwide remote, caps for too senior, wrong platform and office jobs, Gulf details (rules `profile_v13`) |
| 3, variety | #153-#161 | Ready and Stretch chosen from a verified pool with employer, reposter, role-family and place rules; a daily audit |
| 4, names and ranking | #162-#167, #171 | Employer names instead of tenant ids, "N Locations" places, one row for the same job in many cities, duties, mixed titles, spread (rules `profile_v14`) |
| 5, the site | #168, #170, #173, #176 (with its tenth-man fixes) | Phone-first Today screen, one card everywhere, "Did you apply?", Not for me with undo, per-person applications, plain words, counts that agree, back and reload; undo of keyless tracker changes by network |
| 6, alerts and hand-off | #169, #172, #174, #175, this PR | Daily phone message (off until the owner adds a bot token); read budget measured and protected; sources decided by measurement; these docs |

## 2. What needs a production release

The live Worker is still `8dc3004`. Everything the job seeker sees from phases 1, 3 (page side), 4 (migration 0021, stored employer names)
and 5 (the new `/app`, the undo, migration 0022, `/api/today`) reaches the site only with the next release:
1. Wait for a green CI on the head of `main` and for no `discovery.yml` run in progress.
2. Actions -> **Dashboard release to production** -> `mode = preflight`, `confirm_sha` = the full SHA of `main`, `rotate_key = false`.
3. Same with `mode = release`. The release applies migrations 0021 and 0022 (both additive) before the deploy.
4. Check `/api/version` shows that commit, then open `/app` on a phone.

The daily run, the watchlist, the phone message, the undo workflow and the sources need no release; they run from `main`.

## 3. Measured

- **D1 reads (H1; budget guard's analytics lines):** 12 Nov reached 3,281,301 rows read by 21:50 UTC. The daily run alone read about 2.44M
  (841,669 -> 3,281,301 over 21:26-21:50), a watchlist run under 75,000, the rest of the day about 0.7M. 13 Nov reached 1,663,824 by 09:27 with
  no daily run (a release day). The daily run now starts only below 2.0M, re-scores at most 800 rows per person, and records its own cost
  (`d1_rows`) in the run log. Details: `COST_MODEL_2026-11-09.md` section 5.
- **First automatic shortlist (12 Nov, 21:47 UTC):** Farhan Ready 14, Stretch 15, To review 545, Hold 1,223; Sana Ready 25, Stretch 25, To review
  557, Hold 3,210. Phases 2-4 changed the rules after that; the next daily runs re-score the lists (800 rows per person per run).
- **Sources (D1, 13 Nov):** of 22 CRM and automation vendors, 15 answer on Greenhouse, Lever or Ashby, and all those but Webflow are already in
  the daily dataset. Most of Sana's India and Gulf employers that "failed" on 12 Nov are in the dataset through Oracle, Phenom, Cornerstone or
  Darwinbox (Adani 1,043 postings, Honeywell 1,344, Emerson 1,199, ABB 2,282, Linde 968). No fetcher was added. Six Workable search terms were.
  Details: `DISCOVERY_PIPELINE.md`, "Sources by measurement".
- **GitHub schedules are sparse.** The repository's scheduled triggers fire far less often than written: on 13 Nov, up to 19:05 UTC, no
  `discovery.yml` run had started that day and the new watchdog (`discovery-watchdog.yml`) had never run, while other workflows' schedules
  fired a few times (watchlist 09:27 and 17:40, collector sync 08:46 and 18:46). The 20-hour guard, the catch-up triggers and the watchdog exist
  for this; if the page says "Not updated today" in the evening, run **Daily discovery** by hand.
- **Budget on 13 Nov:** 1,847,869 rows read by 17:40 UTC (the watchlist's guard). With the new 2.0M start limit, a daily run triggered later that
  evening may be postponed to the 01:13 / 03:13 UTC triggers; the run row and the phone message say so.
- **H1 changes ran in production:** the 17:40 watchlist run executed the new usage snapshot and "Fetched any postings?" / "Anything new?" steps
  green (it found new postings, so it wrote).

## 4. Checks run for the last phases

- `cd dashboard && npm test` (355 tests at phase 6, including DST, authed fetch and the migration chain) and the Python suite from the repo root
  (`test*.py`, 438 tests), both by exit code, before every push; CI `test` and `verify` green before every merge.
- Phase 5 ran the browser suites locally (browser, features, seeker journey, a11y, faults, production-readonly, site, listing, clients, smoke)
  on desktop and a 375 px phone, with `wrangler dev --local`.
- Every phase passed a separate, read-only tenth-man review (daily machinery, sorting, the person on a phone, in turn); their findings and what
  was done are in the plan, section 10.

## 5. Knowingly left

The full list, with reasons, is in the plan's section 10 (per phase) and section 11 (next product stage). The ones the owner is most likely to meet:
- **Telegram link:** anyone who knows the bot's name and sends `/start sana` in the 24 hours before the link workflow runs would get her daily
  line (first name, two counts, the public link). Run the link workflow right after the person taps Start.
- **Re-score speed:** after a rules bump the stored lists take about five daily runs to be fully re-scored (800 rows per person per run).
- **`d1_rows`** is approximate (other traffic in the same minutes, analytics lag).
- **Gulf jobs from job boards** are rarely verified (those sites refuse the still-open check), so Sana's "5 Gulf in Worth a try" is often
  reported as a shortfall.
- **A US location with the full state name** ("Houston, Texas") is not foreign for Sana's visa-route cap.
- **`?operator=1`** hides the operator screens from the job seeker's page; it does not lock them (changes there still need the key,
  except the open tracker's own actions).
- **Out of scope:** private link per person, self sign-up, other professions, pricing, the operator key, the five held dependency updates.

## 6. Owner steps

1. **Release** (section 2) when CI is green on the head of `main`.
2. **Daily phone message (optional, free):** create a Telegram bot with `@BotFather`, add its token as the repository secret
   `TELEGRAM_BOT_TOKEN`, send each person `https://t.me/<bot>?start=sana_ansari` / `?start=farhan_shaikh`, and run **Link Telegram chats** within
   24 hours. Steps in `RELEASE.md`, "Daily phone message". Email instead: variable `DIGEST_PROVIDER=smtp` and secrets `DIGEST_SMTP_USER`,
   `DIGEST_SMTP_PASSWORD`, `DIGEST_TO`.
3. **Old branches:** run **Delete merged branches**; the rest are listed in the phase 6 hand-off report with a reason each, to delete by hand.
4. **First week:** check that the page says "Updated" every day and that the daily run's summary shows the audit passing (definition of done,
   plan section 13).
