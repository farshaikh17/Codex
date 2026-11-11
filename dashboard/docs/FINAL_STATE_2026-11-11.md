# Career Job Engine: final state and handoff (11 Nov 2026)

Written at the end of the completion pass of 10-11 Nov 2026. It says what is live, what was checked and how, what is knowingly left,
and what the owner should try by hand. Every number is dated; re-measure before relying on one.

**Live site:** https://career-job-engine.farshaikh17.workers.dev (public, read-only; changes need the operator key).
**Live commit:** see `GET /api/version`. At the time of writing: `b564312a12ce1f19c29d37afe8cbbd5089ff6102`.
**Rules that still hold:** production changes only through the manual workflow `dashboard-release.yml` (`rotate_key=false`); free tools only;
no AI review; no automated applications; a person's decisions and applications are never overwritten; no CVs or contact details in the repo.

## 1. What changed on 10-11 Nov

| PR | What |
|---|---|
| #84 | "Find people at this company" links, follow-up dates with an overdue flag, skill list per job, Jobspresso and WeWorkRemotely DevOps boards |
| #95, #96 | Migration-chain test covers every migration; workspace card says Applied (same as the Dashboard); Farhan avoids cyber and finance/legal/procurement operations roles |
| #97, #101 | Browser suite for the new features; release browser check waits for the READY count |
| #98 | **Privacy:** a visitor could read a private client by naming a visible candidate in the query and the private one in the path. Closed, with a regression test |
| #99 | Typed notes survive a refresh; the Ready list keeps its tab and search; a failed Save no longer blanks the screen; Stretch card opens Stretch; local-date follow-ups; keyboard and dialog fixes |
| #100 | Collector sync no longer resets rows the Worker assessed or zeroes scores of overridden / applied rows; its push trigger runs on `main` only |
| #102 | Owner decisions: thumbs rating is stored (private); moving an application back to Saved restores the job's bucket; Farhan's two Drivetrain marketing roles left Stretch |
| #103 | To review shows collector imports the screen has not judged yet apart ("+ N not screened yet"); one definition of "applied" everywhere; search wildcards, orphan follow-ups, cohort label, outage backup; exact-duplicate rule includes location; watchlist scoring; guards and workflow safety |

| #105 | The daily run screens first-import rows the current screen never scored (see section 3). No release needed: it runs from the workflow |

## 2. How it was checked

* **Unit and integration:** `cd dashboard && npm test` (244 tests, plus DST, authed-fetch and the migration chain 0001-0020); `python3 -m unittest discover -s engine/tests` (191 tests).
* **Builds:** `npm run build:frontend`, `npm run build:worker` (dry run), `npx tsc --noEmit -p frontend`.
* **Real browser, local Worker, desktop and mobile** (commands in `RELEASE.md`): main 31, accessibility 33, faults 14, site 20, listing 48, clients 18, features 31.
* **Live, read-only, desktop and mobile:** `production-readonly.e2e.mjs` 33/33 after each release, and a click-through of every public screen, card, tab and job panel with no console error, failed request or sideways scroll.
* **Three independent code reviews** (Worker, frontend, engine and workflows). Every finding was checked against the code before acting; one was wrong
  (`rescore_ranking_v2.mjs` examining tracked jobs is intended and tested) and was not changed.

## 3. Measured (11 Nov 2026)

* **D1 use at 21:57 UTC**, before the daily run's own writes: 1,666,354 rows read (free allowance 5,000,000; the guard's ceiling is 2,500,000) and 15,506 rows written (allowance 100,000).
* **Daily run** (started 21:57 UTC after GitHub dropped the earlier triggers; the guard caught it up): 296 new jobs, old rows re-scored, 10 closed, 10 reopened.
* **Buckets at 22:35 UTC:** Farhan READY 1, Stretch 0, To review 1,561 (856 with a score); Sana READY 2, Stretch 0, To review 2,186 (1,525 with a score).
* **Collector imports waiting to be screened: 0 for both** (live overview, 23:17 UTC, commit `b564312`). The Worker drained that backlog.
* **The score-0 rows that remain in To review** (about 705 for Farhan, 661 for Sana) are a different kind. A sample of Farhan's taken on 10 Nov shows rows from the
  first import on 26 Oct, reason "Preserved verified Farhan status with strategy lane mapping", lane NOT_FIT, no score breakdown. Nothing ever scored them.
  #105 makes the daily run screen such rows (at most 1,000 per person per run). Sana's were not in that sample, so their kind is unconfirmed; the selection is by
  state (undecided, never scored), not by reason, so it covers hers if they are the same. **Check after the next daily run** that both counts fell.
* **Correction:** on 10-11 Nov these rows were reported to the owner as "not screened yet collector rows draining slowly". That was wrong for the ones that remain.

## 4. Knowingly left

1. **Operator-only screens were never tried on the live site** (no key in this environment). They pass in the local browser suites. Checklist in section 5.
2. **Thumbs rating does not change ranking.** It is stored and shown. Making it move a score needs a design, because every re-score overwrites stored scores.
3. **Score-0 rows in To review** (section 3): fixed in code by #105 but not yet seen working on production data. Verify after the next daily run.
4. **Dependencies.** Open and deferred: `actions/checkout` 7, `actions/setup-python` 7, `actions/upload-artifact` 7, `actions/cache` 6, `wrangler` 4.158. Their tests pass, but they change the actions used
   by the workflows that push commits and deploy, and that path cannot be tested from a PR. Merge one at a time and watch one scheduled run and one `preflight` release run.
   Closed: TypeScript 7, Vite 8, plugin-react 6 (they break the build; they need one planned migration).
5. **One release a day.** Every release flushes the response cache, and the release's own browser check plus any live click-through then run on cold
   misses. Three releases on 11 Nov used up the public daily read budget (2.5M rows) twice; visitors without the key saw "capacity used up" until 00:00 UTC.
6. **Not measured:** the outage backup on a custom domain (the Cache API is probably inert on workers.dev); how many jobs arrive on a weekend.
7. **Merged branches** were not deleted; branch deletion is blocked for the agent. Harmless.
8. **Smaller items:** the Ready cards open a job from the title or "Inspect Explanations", not from the card body; the job title there is not keyboard-focusable (the button is).

## 5. Owner checklist (about 5 minutes, on the live site, with the operator key)

1. Unlock (lock icon, top right). A wrong key should say so; the right key closes the window.
2. Open a job. Click **Good match**: it should stay highlighted. Reload the page and open the same job: still highlighted. Click it again to clear.
3. In the same panel type a note, then click a thumb: the note you typed must still be there. Save.
4. Save a job to the tracker, open **Applications**, set a follow-up date in the past: an "Overdue" flag and a banner appear. Clear the date: both go.
5. Set that application to **Applied**: the job leaves the Ready / Stretch lists. Set it back to **Saved**: the job returns to the list it came from.
6. Un-save a job that is only saved: it leaves the tracker.
7. Sign out. The page keeps working as a visitor and shows no notes.

If any step does not behave as written, that is a bug: note the step and the job.

## 6. Ideas not built (free, no AI)

* A language check for Sana: flag or drop postings written in a language she has not declared (French and Chinese postings appear in her list).
* A "quiet for N days" nudge for applied jobs with no follow-up date.
* A summary of the skills named most often across the best jobs that the profile does not list.
* Closing-date flags.
