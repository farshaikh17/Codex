# Final build plan: a working product for Farhan and Sana (13 Nov 2026)

**This replaces the 12 Nov draft at the same path.** It was rewritten after three independent "tenth man" reviews attacked
that draft: daily machinery, sorting and the shortlist, and everyday use of the site. Every finding is either fixed in a
phase below or listed in section 10 as knowingly left, with the reason.

**North star (owner, 12-13 Nov):** for the coming week, Farhan (`farhan_shaikh`) and Sana (`sana_ansari`) open the site on a
phone, see the right jobs for them, understand each in seconds, open the posting, and keep track of what they applied to,
with no one babysitting the system. Multi-user sign-up, private links per person, other professions and selling come later
(section 11).

**How to use this plan:**
- Build the phases in order, one pull request per work item or per small group of items.
- Each item names the files, the rule, the tests and its "done" check.
- Section 3 lists the rules that hold for every item.
- Section 4 is the tenth-man step to run before merging each phase.

---

## 1. Where things stand

**Live Worker:** commit `b564312` (11 Nov). `main` is ahead by everything below; the next release ships it.

**Merged on 12-13 Nov (do not rebuild):**

| PR | What |
|---|---|
| #111, #112 | Automatic shortlist |
| #113 | Ready-card source label |
| #114 | Bot blocking |
| #115 | Top-100 screening fixes |
| #116 | Sana's India on-site roles eligible |
| #117 | Ranking v3 and low-match Hold |
| #118 | Open tracker without a key |
| #119 | Discovery watchdog |
| #120 | Taste learning from Good match / Not for me |
| #121 | "New today" |
| #122 | Nine more employers for Sana |
| #123 | Live-shortlist fixes; the shortlist is re-scored with the rules |
| #124, #125 | Branch cleanup button; branches delete themselves on merge |
| #126 | The 12 Nov draft of this plan |
| #127 (open at writing) | Tracker clicks clear only that person's cache; 60 tracker writes an hour per network; 2,000-character note cap; honest notes label; the Worker entry exports nothing but its handler |

The rules marker is `profile_v12`.

**First automatic shortlist on production (12 Nov, 21:47 UTC):**

| | Ready | Stretch | To review | Hold |
|---|---|---|---|---|
| Farhan | 14 | 15 | 545 | 1,223 |
| Sana | 25 | 25 | 557 | 3,210 |

Quality was reasonable at the top. The reviews show it is fragile and incomplete underneath; sections 5-9 fix that.

---

## 2. Phase 0: the release (do first)

1. Merge #127 when its CI is green. It must ship with the open tracker, which is otherwise unprotected.
2. Check CI is green on the head of `main` and that no `discovery.yml` run is in progress.
3. Dispatch `dashboard-release.yml` with `mode=preflight` (no changes) to confirm the Worker still has an
   `ADMIN_API_KEY` secret. A release with no secret and `rotate_key=false` stops early (`dashboard-release.yml` lines 193-198).
   If preflight says the secret is missing, tell the owner in one line and stop. Never ask for a secret in chat.
4. Dispatch `mode=release`, `confirm_sha=<full sha of origin/main>`, `rotate_key=false`. Watch it to the end.
5. Live check, in few calls:
   - `/api/version` shows the new commit and `open_tracker: true`;
   - in a browser on desktop and 375 px: the top bar and "New today" show, and the notes label is the honest one;
   - `curl -A Googlebot` gets 403, and `/robots.txt` says `Disallow: /`.
6. Ignore the line "rotate_key=true first" in the scheduled 00:20 UTC reminder; the owner decided no key.

---

## 3. Rules that hold for every item

**Owner rules**
- Free tools only. No AI review. No automated applications.
- Never commit CVs, contact details, export contents or secrets. Never ask the owner for a secret in chat.
- A person's decision (manual override) and any job with an application are never changed by a script.
- Every UPDATE carries those guards, and every phase has a test that decided and applied rows stay byte-identical.

**Releases**
- Production changes go only through `dashboard-release.yml`, with `rotate_key=false`, at most one release per UTC day.
- Engine, script and workflow changes need no release.

**Git**
- No force-push. Keep the repo `farhan-job-engine` and the branch `improvements`.
- One pull request per item, squash-merged when CI is green.

**Before every push, run exactly what CI runs**
- `cd dashboard && npm test`
- From the repo root, `python3 -c "import unittest,sys; s=unittest.defaultTestLoader.discover('.', pattern='test*.py', top_level_dir='.'); r=unittest.TextTestRunner(verbosity=0).run(s); sys.exit(0 if r.wasSuccessful() else 1)"`. Check the **exit code**: a `| tail` hides a failure.

**Worker or page changes**
- Run `npx wrangler dev --local` and the local browser suites as in `docs/RELEASE.md` (`browser`, `a11y`, `features`, `site`, `faults`, `production-readonly`, smoke), on desktop and mobile, with `OPEN_TRACKER` on.
- The dry-run build does not start the runtime; only `wrangler dev` does. On 13 Nov a numeric export would have stopped the Worker in production.
- Never `export` a value from `worker/index.ts`; put shared code in another module.

**Rules marker**
- After R9 below, the marker lives in one constant. Bump it once per phase that changes `evaluate()` or a scoring rule, never per commit.

**Live API calls**
- Keep them few. To judge sorting, re-score saved samples locally with `evaluate()`.
- Saved samples are in the session scratchpad (`top_*.json`, `live_*.json`). Re-fetch them with at most four calls.

---

## 4. The tenth-man step (owner process, every phase)

Before merging the last pull request of a phase, start one reviewer subagent whose only job is to show how the phase will go wrong.
- Brief it with: this plan's section for the phase, the diff, the north star, and "read-only, no live writes, give evidence for
  every claim, rank by likely × damaging, give the smallest fix".
- Use three angles in turn across phases:
  - **daily machinery:** missed runs, partial writes, budgets, timeouts;
  - **sorting:** invent 30-60 realistic postings per person and find the ones the rules get wrong;
  - **the person on a phone:** run the site locally and use it as they would.
- Fix every high or medium finding before merging, or record it in section 10 with the reason. The builder fixes; the reviewer does not edit.

---

## 5. Phase 1: the daily machine must not fail silently (workflow side; no release)

| Item | Problem (review finding) | Rule | Files | Test / done |
|---|---|---|---|---|
| R1 | The still-open check writes nothing if it runs past its 10-minute step limit, then the shortlist demotes everything unverified after 4 days | `check()`: 8 worker threads, 8 s per-request timeout, an 8-minute deadline after which it returns what it has. The demotion step skips the "verified in 4 days" condition when the latest still-open step verified 0 rows | `engine/liveness.py`, `dashboard/scripts/dataset_apply.mjs` (demotion), `discovery.yml` (pass a flag when verified = 0) | Unit test with a fake slow server: partial results are written. Database test: no demotion when verified = 0 |
| R2 | Employer-site fetchers are tagged as job boards, so their rows are forced to "eligibility unknown" with no verified date and can never reach Ready | In `more_sources.py`, `workday`, `oracle_hcm`, `successfactors`, `smartrecruiters`, `siemens_energy` and `eightfold` produce `board: False` (true boards stay `True`). Their rows get `last_verified_at = now`, normal eligibility and provenance `LIVE_PUBLIC` | `engine/more_sources.py` (`job()` gets a `board` argument), `dashboard/scripts/dataset_apply.mjs` | Test that a Workday row is stored verified with screen eligibility; a remote-board row still UNKNOWN |
| R3 | A failed 2.3 GB dataset download stops the whole daily run, and a stale manifest "succeeds" with 0 new jobs | On download failure write an empty `matches.json`, log it, and continue with boards, more sources, re-score, still-open check and shortlist. Fail the step loudly when the manifest's `generated_at` is older than 48 hours | `.github/workflows/discovery.yml`, `engine/dataset_discovery.py` (`load_manifest`, three tries) | Workflow dry-run with the download step forced to fail |
| R4 | The budget guard can skip the evening run all day, unseen; triggers fire late in the UTC day after a day of reads | Add triggers at `13 1,3 * * *` UTC. Recent-run gap 20 h (was 18). When the guard skips, a tiny job writes a run row `{skipped: "budget"}`. The page shows "Updated <date, time>" from `/api/discovery/daily`, and "Not updated today" in amber when the last real run is over 26 h old | `discovery.yml`, `scripts/run_log.mjs`, `scripts/recent_run_guard.mjs` (MIN_GAP_HOURS 20), page header | Test the run row; browser check of the amber note with a fixture |
| R5 | `more_sources.py` and `remote_boards.py` write only at the end, so a step timeout loses everything; a watchlist run that fetched nothing still counts as done for 7 hours | Write the output file after each source. Stop starting new sources at 80% of a total time budget passed by the workflow. Exit non-zero when every source errored | `engine/more_sources.py`, `engine/remote_boards.py`, `watchlist.yml` | Unit tests for partial output and all-errors exit |
| R6 | Three workflows share one concurrency group; a discovery run queued by the watchdog can be cancelled by a newer queued run | Move the watchdog into its own workflow `discovery-watchdog.yml` (cron `27 */2 * * *`, no concurrency group). Give `discovery.yml` its own group `daily-discovery`. Only the D1-writing steps of watchlist and collector-sync keep `d1-collector-sync` | `.github/workflows/*.yml` | YAML parses; watchdog test unchanged |
| R7 | Every database read in a run is a single unretried call (40-50 per run) | `d1()` tries three times, waiting 5, 20 and 60 s, and only on network or 5xx-type errors | `engine/dataset_discovery.py`, `engine/liveness.py` (shared helper) | Unit test with a fake failing `wrangler` |
| R8 | A run can go green while doing nothing | A final step fails the job when the still-open check had targets but verified 0, or every source errored, or 0 rows were written and the dataset was fresh. This is the audit's first half (the second half is in phase 3) | `discovery.yml`, new `dashboard/scripts/run_health.mjs` | Unit test of the decision |
| R9 | The rules marker is hard-coded in about ten places, including the live Worker | One exported `RULES_MARKER` in `worker/discovery.ts`. Every SQL string and breakdown in `dataset_apply.mjs`, `engine/dataset_discovery.py` (it reads the value from a tiny JSON written at build or from a constant duplicated with a test asserting equality) and `discovery.ts` uses it | as named | A test fails if the string `profile_v` appears outside the constant |
| R10 | The outage backup copy is keyed by URL only, so after a release an old-shape answer can be served to the new page | Add the commit to the backup key | `worker/index.ts` (`backupStore`, `backupServe`) | Existing outage test plus one for the commit key |

---

## 6. Phase 2: sorting must agree with the profiles (one marker bump for the phase)

Tested on about 135 invented postings (scratch scripts `h.mjs`, `f1.mjs`, `s1.mjs`, `x.mjs` in the session scratchpad).
Each item lists the postings it must fix; turn every one into a test row in `dashboard/test/discovery.test.mjs`.

**S1. Indian plant towns count as India.**
- **Problem:** `sanaIndiaCity()` (`discovery.ts` line 132) knows ten metros, so Jamnagar, Vadodara, Mundra, Raigarh, Visakhapatnam, Jharsuguda and "Nagpur, Maharashtra" stay "unknown" and can only reach Stretch.
- **Rule:** extend `INDIA_PLACE` (line 113) with all state and union-territory names, and use `indianPlace()` inside `sanaIndiaCity()`. Add about 60 plant and industrial towns: Jamnagar, Dahej, Bharuch, Hazira, Mundra, Kandla, Vadodara, Ankleshwar, Sanand, Halol, Raigarh, Korba, Bhilai, Angul, Jharsuguda, Talcher, Paradip, Rourkela, Jamshedpur, Bokaro, Dhanbad, Singrauli, Sasan, Vindhyachal, Anpara, Obra, Panipat, Mathura, Bathinda, Ropar, Nashik, Chakan, Ranjangaon, Raigad, Ratnagiri, Tarapur, Chandrapur, Nagpur, Hosur, Ennore, Tuticorin (Thoothukudi), Neyveli, Mettur, Kudankulam, Kakinada, Krishnapatnam, Vizag, Visakhapatnam, Ramagundam, Kothagudem, Bellary (Ballari), Toranagallu, Udupi, Mangaluru (Mangalore), Kochi, Baddi, Haridwar, Pantnagar, Sricity.
- **Postings to fix:** "Senior Engineer - Mechanical Maintenance, Jamnagar"; "Maintenance Engineer, Vadodara".

**S2. Every title the search fetches is recognised as the person's field.**
- **Sana, add to `SANA_ROLE`:** `o ?& ?m|operations (and|&) maintenance|shift (in-?charge|engineer)|rotating|static equipment|mechanical (engineer|maintenance)|thermal|solar|hydro|substation|switchgear|energy manager`.
- **Farhan, add to `FARHAN_ROLE`:** `(technical )?(delivery|program|project) manager|professional services|technical account manager|customer engineer`.
- **Test:** for every search term in `engine/dataset_discovery.py` `BUILTIN` and `engine/more_sources.py` term lists, a sample title built from the term is a role match in `evaluate()`.
- **Postings to fix:** "O&M Engineer – Solar, Rajasthan"; "Shift In-charge, Hyderabad"; "Lead Engineer – Rotating Equipment"; "Delivery Manager (Remote - India)"; "Technical Program Manager"; "Technical Account Manager".

**S3. Held rows come back when the rules widen.**
- **Problem:** rows held as "Outside candidate target role family" never return, even after S2.
- **Rule:** in `dataset_apply.mjs`, after the re-score: a row in HOLD with no override and no application, whose stored reason starts "Outside candidate target role family" but whose fresh `evaluate()` result is a role match, moves to NEEDS_REVIEW. Write a history row with actor `discovery`.
- **Re-score:** for this phase only, include HOLD rows in the re-score export, best old score first, so Sana's 3,210 held rows are re-checked over about three runs.

**S4. One matching word is not enough.**
- **Sana's avoid list:** add `power (bi|apps?|platform|automate|electronics)|developer|sales|marketing|aircraft|aviation|plant[- ]based|analyst` to `SANA_AVOID`.
- **Shortlist:** require `skill_score >= 40` (two matched skills) unless `targetFit()` returns `exact`.
- **Postings to fix:** "Power BI Developer, Pune"; "Energy Sales Manager"; "Aircraft Maintenance Engineer, Delhi"; "Reliability Engineer (EV battery testing)".

**S5. Plain worldwide-remote wording counts.**
- **Rule:** a remote posting whose location says `anywhere|worldwide|global|remote \(global\)|fully remote` is worldwide remote. For Farhan, "Remote - APAC" or "Asia" with no country restriction counts too.
- **Job boards:** board rows stay UNKNOWN (R2 changes only employer sites).
- **Target:** Farhan's goal becomes "Ready + Stretch ≥ 25".
- **Postings to fix:** "Implementation Manager, Remote (Global)"; "…, Anywhere"; "…, Remote - APAC".

**S6. Too senior is capped.**
- **Rule:** when the posting asks more than the candidate's years + 2, or the title has `vp|vice president|chief|plant head|general manager|head of` and no target role names it, cap the score at threshold − 1. That keeps it in To review and out of Ready.
- **Postings to fix:** "VP, Implementation, 15+ years"; "Plant Head, Pune, 20+ years"; "Senior Implementation Manager, 12+ years, team of 25".

**S7. Wrong platform is capped.**
- **Rule:** `platformGap` becomes a cap at 60, not a 20-point deduction.
- **Postings to fix:** "Workday Implementation Lead"; "Salesforce Implementation Consultant".

**S8. Office jobs do not pass Farhan's remote-only rule.**
- **Rule:** "work from home" in the description is not a remote signal unless the posting's remote flag or its location says remote. `hybrid|\d days? (a week )?in (the|our) office|on-?site \d days` in the description makes the job INELIGIBLE for Farhan.
- **Re-score:** may move ELIGIBLE → INELIGIBLE or UNKNOWN when the stored reason was written by the screen. The reason must not start "Manual override" or "You marked", and the job must have no application. Today it only moves UNKNOWN → ELIGIBLE (line 266).

**S9. Gulf details.**
- **Nationals preference:** `preference (will be given )?to \w+ nationals|saudi[sz]ation|emirati[sz]ation|omani[sz]ation` caps the score at 45.
- **Gulf places:** add `, (AE|SA|QA|OM|KW|BH)$`, Ruwais, Mesaieed, Duqm, Salalah and Yanbu to `GULF_PLACE`.
- **Agencies:** `AGENCY_TEXT` no longer matches "for our clients" alone. An engineering firm such as Worley or Fichtner is not a staffing agency; keep the name list.

**S10. Stretch takes the overflow of Ready-quality jobs first.**
- **Problem:** Sana's 26th-best eligible 90-point job waits in To review while Stretch shows 50-59 jobs.
- **Rule:** in the shortlist rule, a job that qualifies for Ready but did not fit in Ready's 25 qualifies for Stretch ahead of the "within 10 below" jobs.

**S11. Sana's other target roles can score.**
- **Rule:** words from the person's own `target_roles` count as skills for scoring when they appear in the description (Energy Efficiency, Decarbonization, Asset Performance, Reliability, Power Plant). They count at most twice.
- **Postings to fix:** "Energy Efficiency Engineer, Remote (worldwide)" (was 58, no skill matched); "Decarbonisation Consultant, Remote - India".

**Done:** the invented postings above all land where the "should be" column says, and a hand check of the re-scored saved samples finds no wrong-field, wrong-level or wrong-place job in the top 25 of either person.

---

## 7. Phase 3: a varied shortlist that cannot hide good jobs

**A1. Pool export.**
- **Function:** new `shortlist_pool(local=None, per_candidate=300)` in `engine/dataset_discovery.py`, run **after** the still-open step.
- **Rows included:** active rows that pass every shortlist condition **except** "verified in 4 days", plus every row currently shortlisted automatically (whatever the 300 limit).
- **Fields:** id, title, company, location, workplace, source, discovered_at, last_verified_at, score, skill score, eligibility, status, reason.
- **Order and checking:** export the pool before the still-open check. The check (R1) verifies pool rows first: the shortlist, then the pool by score, up to 150 per person. The selector then takes only rows verified in the last 4 days.

**A2. Selection.**
- **File:** new `dashboard/scripts/shortlist_select.mjs`, exporting the pure `selectShortlist(pool, opts)` and a CLI that writes **one** SQL file of demotions, promotions and tier moves, applied in one `wrangler d1 execute`.
- **If the export fails,** apply nothing: the lists stay as they are.

**A3. The pick, per person.**
1. Order by score, then 2 points for an incumbent (already shortlisted), then matched skills, then newest. A row found more than 30 days ago counts 5 lower here. This is the only place age is used; nothing is stored.
2. **Ready:** take rows that pass the tier rule (score ≥ threshold, ELIGIBLE, S4 skills) in order, skipping a row when a hard rule says no. Stop at 25.
3. **Stretch:** first the Ready-qualified rows that did not fit (S10), then the tier rule's rows (threshold + UNKNOWN, or ELIGIBLE within 10 below). Same skipping. Stop at 25.
4. **Swap for variety.** For each tier, while a soft rule is broken and a swap candidate exists, replace the lowest-ranked row breaking it with the best row that fixes it. A swap candidate must score at least the threshold + 5 and within 10 of the row it replaces.
5. **Demote** every automatically shortlisted row not selected. Promote or move the selected ones. Write history rows. Every statement keeps the "no override, no application" guards.

**A4. The rules.**

| Rule | Value | Kind |
|---|---|---|
| One posting per employer and title | 1 | hard |
| Per employer per tier | 2 (5 when the employer is named in the person's skills, e.g. GoHighLevel) | soft |
| Per employer, both tiers | 4 | soft, relaxed last |
| Reposting sites (`REPOSTERS` = jobgether, turing, crossover, peopleworth, pavago, paired, braintrust; **not** `agencyPosting()`) | 3 per tier | hard |
| A reposter row with the same title and location as a direct employer's row, and the same first 200 characters of description | dropped | hard |
| Per role family (A5) | at most 40% of the tier's filled rows, minimum allowance 4 | soft |
| Sana, place bands (A6) | Stretch: at least 5 `gulf`, at least 2 `remote`. Ready: at least 2 `remote` | soft, only via swap (score floor above) |
| Farhan, place bands | Ready: at least 3 `remote_global` | soft, only via swap |
| "Something different" | up to 2 places at the end of Stretch, for a row from a role family not on either tier, never `unclassified`, with the same score floor | soft |

When a pool is smaller than the tier (Farhan today), only hard rules apply.

**A5. Role families.**
- **Where:** new `familyOf(candidateId, title)` in `worker/discovery.ts`. The first match in this order wins; no match is `unclassified`. The India Remote page filter keeps `listing.ts` `ROLE_FAMILIES` unchanged.
- **Farhan:**
  1. `revops_crm` `/rev(enue)? ?ops|revenue operations|\bcrm\b|sales op|marketing (ops|operations|automation)|gtm (engineer|operations)/i`
  2. `implementation` `/implement|onboarding|deployment (strategist|manager|lead|specialist)|professional services/i`
  3. `automation_ai` `/automation|\bai\b|workflow|no-?code|low-?code|integration/i`
  4. `technical_delivery` `/technical delivery|delivery (manager|lead)|program manager|project manager/i`
  5. `business_systems` `/business systems|systems (analyst|architect|administrator)|internal tools/i`
  6. `solutions` `/solutions?|technical account|customer engineer/i`
  7. `operations_general` `/operations|chief of staff/i`
- **Sana:**
  1. `maintenance` `/maintenance|o ?& ?m|breakdown|shutdown|turnaround|overhaul|rotating|static equipment/i`
  2. `reliability_asset` `/reliability|asset (performance|management|integrity)|condition monitoring|vibration/i`
  3. `energy_decarb` `/energy (efficiency|manager|management|audit|engineer)|decarboni[sz]|net[- ]?zero|carbon|emission|sustainability/i`
  4. `plant_operations` `/power plant|plant (operations|engineer)|shift (in-?charge|engineer)|control room|boiler|turbine|thermal|hydro|operations engineer/i`
  5. `utilities` `/utilit|hvac|water treatment|compressed air|facilit/i`
  6. `commissioning_projects` `/commissioning|project engineer|projects? manager|construction|erection|site engineer/i`
  7. `electrical` `/electrical|substation|switchgear|transmission|distribution|hvdc|protection/i`
  8. `field_consulting` `/field service|consultant|advisor|specialist/i`
- **Test:** five sample titles per family, including the misfiles found: "Electrical Maintenance Engineer" → maintenance; "Power Plant Operations Engineer" → plant_operations; "Technical Project Manager, Implementations" → implementation.

**A6. Place bands.**
- **Where:** new `placeBand(candidateId, location, workplace, remote, description)` in `worker/discovery.ts`, built on S1, S5 and S9.
- **Bands:** `india_onsite`, `remote` (India or worldwide; for Farhan `remote_global` = worldwide only), `gulf`, `abroad_with_route`, `other`.

**A7. Report.**
- **File:** `work/shortlist.report.json`, per person and tier: count, employers, max employer share, families, bands, rows older than 30 days, swaps made, rules relaxed, and "pool smaller than tier".
- **Where it goes:** `scripts/run_log.mjs` stores it in the run row, and `/api/discovery/daily` returns it.

**A8. Audit (second half of R8).**
- **What:** `dashboard/scripts/shortlist_audit.mjs` runs after the shortlist and fails its step when a hard rule is broken on stored data.
- **Hard rules checked:** more than 2 rows of one employer in a tier without the skills exception, a reposter over its cap, a row unverified for 4 days, a tenant-id employer (B1), or an automatically marked row with an override or an application.
- **Report:** in the run summary.

**Tests:** `dashboard/test/shortlist_select.test.mjs`, pure functions:
- one employer holding the 20 best scores;
- reposters, including a duplicate of a direct posting and a non-duplicate;
- family cap and its relaxation;
- place swaps that respect the score floor;
- "something different" excluding unclassified;
- a small pool (only hard rules apply);
- incumbents keeping their places only through the +2;
- determinism.

Plus one database test of the generated SQL: guards, marks, history, idempotence, and a person's Ready row untouched.

**Done (two consecutive days):** both people, per the report:
- no employer above its cap;
- Ready shows at least 4 families when the pool has them;
- band minimums are met or reported as "pool too small";
- the audit passes.

---

## 8. Phase 4: names, places and ranking (one marker bump, with phase 2 if built together)

**B1. Employer names.**
- **New file:** `engine/company_names.py` with `display_company(raw, source, url)`.
- **Known names (table):** `mdlz` → Mondelez International, `aecom2` → AECOM, `generalmotors` → General Motors, `thermofisher` → Thermo Fisher Scientific, `gohighlevel` → GoHighLevel, `abb` → ABB.
- **Unknown ids (`hdga`, `egup`, `ekkh`, `fa espx saasfaprod1`, `fa emqh saasfaprod1`):** open one stored posting URL each and read the employer from the page title or `og:site_name`. Add only what is verified.
- **At import:** a tenant-looking name (`^fa [a-z]{4} saasfaprod\d$`, or one lowercase token of 5 letters or fewer from Workday or Oracle) tries the page title once. Otherwise it stays raw.
- **Stored rows:** migration `0021_company_display_names.sql` with explicit `UPDATE`s. Add it to `test_migration_chain.py` and to the release workflow's migration list.
- **Caps and dedupe** use `companyKey()` of the display name.

**B2. "N Locations".**
- **Rule:** a location of `^\d+ Locations?$` or empty, with a description that names only places outside India and the Gulf, is abroad for the visa-route cap.
- **Where the source lists places** (Workday `locationsText`, SmartRecruiters), store up to three places instead of the count.

**B3. Same job, many cities.**
- **Rule:** in `split_new()`, a new posting with the same employer and title as a stored active one, differing only by city, is stored once. Append the city to `location_restrictions` ("Pune; Chennai; +3 more").
- **Stored duplicates** are not merged.

**C1. What the job involves.**
- **Rule:** count distinct duty phrases in the description.
- **Farhan:** `configure|implement|onboard(ing)? (customers|clients)|workflow|automation|integrat|zapier|make\.com|n8n|webhook|go-?live|\bsop\b|process (design|improvement)`. "api" and "pipeline" are dropped as too generic.
- **Sana:** `preventive maintenance|breakdown|shutdown|overhaul|rotating equipment|boiler|turbine|\bdcs\b|scada|switchgear|transformer|root cause|\brca\b|reliability|energy audit|energy efficiency|utilities|commissioning|permit to work|condition monitoring|carbon|net[- ]?zero|emission|iso 50001|heat rate|energy management|performance monitoring`.
- **Score:** 6 or more hits +6; 3 to 5 +3. 0 hits gives −8 only when the description is longer than 600 characters and the title is not an exact target role. Never applied below 300 characters.

**C2. Mixed titles.**
- **Rule:** a title joining two unrelated functions ("Sales & Marketing Operations Manager") loses 4, unless a target role is contained exactly.

**C3. Spread.**
- **Rule:** cap the plain ceiling at 92 and add `max(0, min(3, duties − 5))`.
- **Not stored:** no age adjustment is stored; age lives only in A3.

**Tests:** table-driven per rule, using real text from the saved samples plus near misses. The phase 2 caps must still win.

**Before merging:** re-score the saved samples. Record the before and after top 25 of each person in the pull request, with a hand check against their target roles.

---

## 9. Phase 5: the site a job seeker uses (Worker + page; one release)

The third review found the page built for an operator, not a job seeker. Screenshots are in `/tmp/tm/` (session machine).
Package F of the draft (chips, group by employer, filters, diversity line) is **dropped** in favour of these items.

**U1. Protect the open tracker (rest of review finding 1).** #127 adds the rate limit, the note cap and the honest label.
- **Hash on history:** store a hashed client address in each `qualification_history` and `application_history` row written by a keyless request (new column via migration `0022`).
- **Undo script:** add `dashboard/scripts/undo_since.mjs --candidate X --since <iso> --network <hash>`. It writes reverse statements from history rows, for the owner to run through a manual workflow (`undo-changes.yml`, `mode=preview|apply`).
- **Override form:** hide it behind `?operator=1` (U8).

**U2. One "Not for me", everywhere, with undo.**
- **Behaviour:** the card ⊗ and the panel thumb do the same thing.
  - They send feedback DOWN.
  - They move the job to HOLD with reason "You marked this Not for me". This is not an override, and re-score skips reasons starting "You marked".
  - Clearing restores the previous status from `qualification_history`.
- **Undo:** a bottom toast "Hidden · Undo" for 6 seconds, and a "Hidden jobs" list (status HOLD with that reason) with Restore.
- **Remove** the `INELIGIBLE` "Dismissed by reviewer" path from `App.tsx`.

**U3. Learning from it, gently (replaces the draft's E.1).**
- **One DOWN:** −2 for the same employer and family.
- **Two DOWNs in the same employer and family:** −5.
- **Good match or Applied:** +3 for the same employer, +2 for the same family.
- **Limits:** total within ±5. Reposters and `unclassified` are exempt.
- **Reason text:** the sentence "Ranked up/down: like jobs you marked …" is replaced, never appended twice.

**U4. Every action is visible and safe.**
- **Toast:** a fixed bottom toast for success and failure of save, applied, hide and note.
- **Stale writes:** writes send the record's `updated_at`. The server refuses a stale write with 409 "This changed elsewhere; reload". An empty note never silently replaces a non-empty one.

**U5. One Today screen, phone first.** Tapping a name opens that person's Today screen; the first job starts within 200 px of the top. Top to bottom:
1. **Top bar:** one row, about 56 px: a "Farhan | Sana" switch remembered on the device, "Today", and "My applications (n)".
2. **Status line:** "Thu 13 Nov · 4 new since your last visit · 21 more good matches · Updated 21:47". The "new" count uses `localStorage` per device, not the server's "new today"; "Updated" comes from R4.
3. **Nudge,** only when due: "2 follow-ups due".
4. **New since your last visit,** then **Best matches** (Ready), then a collapsed **Worth a try (n)** (Stretch).
5. **Footer link:** "Show everything else (n)" leads to the existing full list.
- **Landing is constant:** no switching between "New today" and Ready from day to day.

**U6. One card everywhere.**
- **Content:**
  - the title in 16 px;
  - "Employer · place · found <date>";
  - one sentence on why, for example "Maintenance engineer · on-site Pune · 6 of your skills";
  - the state when saved or applied.
- **Buttons:** **Open posting**, **Save**, **Not for me**, at 44 px each with 12 px gaps.
- **Same card** on Today, the full list, Ready, Stretch and India Remote.

**U7. "Did you apply?"**
- **When:** after "Open posting" (on return to the tab: `visibilitychange`).
- **Bottom sheet:** "Did you apply? Yes, I applied / Not yet (keep saved) / Not for me". One tap records it.

**U8. Hide everything that is not for a job seeker** unless the address has `?operator=1`:
- operator lock, override and audit, threshold, reverify, export;
- weekly ledgers, analytics, pilot and sync screens, clients, the cohort ledger;
- the "Tracker open" banner, and "changes need the operator key" texts.

**U9. Plain words.**
- **Rename:** apply the rename table in section 12 across the page and the job panel.
- **Panel top:** title, employer, place, the why sentence, Open posting.
- **Collapsed:** everything else goes under "How this was scored".
- **Dates:** "Found 1 Nov" / "3 days ago", in India time.

**U10. Applications are per person.**
- **Title:** "Sana's applications", inside her view.
- **Three groups:** "Saved, not applied" (with Remove), "Applied, waiting" (with follow-up date) and "Finished". One tap changes the stage; notes sit inline.
- **Remove** the cohort ledger from this view.

**U11. Back, reload, bookmark.**
- **Routes:** `/app#sana/today`, `#sana/job/<id>`, `#sana/applications`.
- **Behaviour:** Back closes the panel. Reload returns to the same place.

**U12. Counts agree.**
- **Rule:** one definition per number, computed in one server function and used by every tile, tab and badge.
- **Labels:** "Can apply (confirmed)" becomes "Says it hires in India".
- **Test:** compare every displayed count for one person against that function.

**U13. Load once.**
- **Rule:** wait for `/api/version` before the first data load, and load only the chosen person (review finding 25: every request was made twice).

**U14. Sizes.**
- **Text:** 14 px minimum.
- **Targets:** 44 px with 12 px gaps.
- **Thumbs:** get `aria-pressed`.

**Tests:**
- update `features.e2e.mjs`, `browser.e2e.mjs` and `a11y.e2e.mjs` for the new screen and the renamed labels;
- add a journey test: open the site, Sana, Today, open a posting, "Yes, I applied", see it in her applications, Not for me, Undo, then reload and land on the same screen;
- unit tests for U2-U4 and U12 in `owner_decisions.test.mjs` and `clients.test.mjs`.

**Done:** someone who has never seen the site opens it on a phone and records an application in under a minute, and the tenth-man phone review (section 4) finds no high-severity issue.

---

## 10. Phase 6: alerts, sources, checks and hand-off

**G1. A daily message that reaches a phone (replaces the Atom feed).**
- **Channel:** a Telegram bot message from the daily workflow: "Sana: 4 new jobs today · <link>". The Telegram bot API is free.
- **Owner setup (once):**
  1. create a bot with BotFather;
  2. add the token as repository secret `TELEGRAM_BOT_TOKEN`;
  3. each person taps "Start" on the bot once;
  4. a one-off manual workflow `telegram-link.yml` reads the bot's updates and stores each chat id in `discovery_state` (`telegram:<candidate>`). No address or phone number is committed.
- **Off by default:** the step is skipped while the secret is absent.
- **Email instead or as well:** the same text, sent when the repository variable `DIGEST_PROVIDER` and its secrets exist.
- **Test:** the message builder.

**D1. Sources, by measurement, not by guess.**
- **Method:** probe each candidate source live (one request, a 200 with real rows) and add only what answers. List the rest as "probed, not added".
- **Farhan:** Greenhouse, Lever and Ashby boards of CRM and automation vendors and partners: GoHighLevel, HubSpot, Zapier, Make, n8n, Airtable, ClickUp, monday.com, Pipedrive, ActiveCampaign, Close, Keap, Zoho, Freshworks, Intercom, Calendly, Typeform, Webflow, Notion, Retool, Workato, Tray.io. Also the employers on his lists and applications.
- **Sana:** the India and Gulf plant employers that failed a first probe on 12 Nov (see #122). Use each employer's real career-site host.
- **Search terms:** add Sana's non-maintenance roles (`energy efficiency`, `decarbonization`, `asset performance`, `reliability`, `utilities`, `commissioning`, `energy manager`, `plant engineer`, `O&M`). Add for Farhan `implementation`, `onboarding`, `solutions consultant`, `revenue operations`, `crm`, `automation`, `technical account manager`, `customer engineering`, `business systems`. Every new term must pass the S2 test.
- **Run log:** records per person how many shortlisted and pool rows came from each source.

**H1. Read budget.**
- **Measure:** from the Cloudflare numbers of two normal days, record rows read per day by kind.
- **If over 2.5M:**
  1. raise the list routes' cache TTL to 30 minutes;
  2. make the watchlist skip its export when it found nothing new;
  3. lower the re-score cap to 800 per person.
- **Record it** in `docs/COST_MODEL_2026-11-09.md`.

**H2. Docs.**
- update `DISCOVERY_PIPELINE.md` (all rules in phases 2-3);
- update `RELEASE.md` (open tracker, limits, undo workflow, Telegram);
- write `docs/FINAL_STATE_<date>.md` replacing the 11 Nov one: what is live, the measured numbers, and what is knowingly left.

**H3. Old branches.**
- **Which:** 13 unmerged branches remain (`builderbranches-discovery`, `builderbranches-reliability`, `completion/integration`, `integration/pr1-2-3`, `qa/*`, `review/bounded-collector-live-feed`, `docs/qa-handoff-2026-11-09`, `feat/shared-candidate-alignment`, `fix/qualification-review-bottlenecks`).
- **Check:** run `git log main..<branch>` for each. If every change is superseded, list them for the owner with one line each.
- **Deleting:** needs the owner's go-ahead per branch, because they hold unmerged work.

**Knowingly left**, each with its reason:
- per-person secret links: out of scope until resale;
- exact D1 write totals: measured in H1;
- whether `wrangler d1 execute --file` is atomic: A2 sends one file per step and guards every statement so a partial file is harmless;
- form-encoded cross-site writes: preflight blocks JSON; the 60-an-hour limit bounds the rest.

---

## 11. Out of scope (next product stage)

- private link per person and self sign-up;
- other professions;
- pricing and resale;
- the operator key;
- the five held dependency updates;
- warm introductions to employers.

---

## 12. Rename table (page and job panel)

| Now | Becomes |
|---|---|
| Client dashboards / Dashboard | Home |
| TEST FARHAN WORKSPACE | Farhan's jobs |
| READY-to-Apply Shortlist / READY / Ready to Apply | Best matches |
| Stretch / Stretch Matches | Worth a try |
| Needs Review / To review / Needs checking | More to look through |
| All Apply-Worthy | Best + worth a try |
| Unverified location, score 60+ | Good match, location not stated |
| Can apply (confirmed) / India Remote Opportunities | Says it hires in India |
| India eligibility: not established / ruled out by posting text / eligible per posting text | Doesn't say if India is OK / Posting says not India / Posting says India is OK |
| India Remote Posting Scope: UNKNOWN / INELIGIBLE | Can you work from India? Not stated / No |
| Application Qualification: READY | Why this job is on your list |
| Qualification Reason / Eligibility basis | Why it's here / What the posting says about location |
| Explainable Match Score Breakdown | How well it matches you |
| Relevance / Match / stored score | Match |
| Seniority Alignment / Job: MID vs Target: SENIOR | Level: a bit junior for you (or: at your level) |
| Role Match: Cross-domain alignment | A different kind of role from your usual |
| Experience Requirement MET | Asks for experience you have |
| Published Compensation: Not Disclosed in Posting | Pay: not stated |
| FULL_TIME (REMOTE RESTRICTED) | Full-time · remote, some countries only |
| ASHBY ADAPTER / Real Employer Listing / via Company site | From the employer's own site |
| Discovered | Found |
| Shortlisted by the screen | Picked for you |
| Move to review | Not sure yet |
| Dismiss / Irrelevant / ⊗ | Not for me |
| Inspect Explanations / Open details | See details |
| Open Official Listing / Visit Source Posting | Open the posting |
| No Application URL | No link available |
| Manage Application Pipeline / Application Pipeline Tracker | Your progress on this job / My applications |
| Pipeline Stage | Where are you with this job? |
| Saved for Review / In Review | Saved / Preparing |
| Applied (Manual Submission) | I applied |
| Screening Call / Technical Interviews / Offer Extended / Rejected / Closed | First call / Interviews / Got an offer / Didn't work out |
| Update Pipeline Status | Save |
| Pipeline stages are manual records… | This is your own record; the employer isn't told. |
| Profile | About me |
| Explore the Discovery tab and click "Save" | Tap Save on any job to keep it here |
| Removed (operator only, U8) | Hiring model evidence; Recorded qualification status; Qualified at; Model / Skills Ratio; job ids and adapter tags; Override / Audit Trail; Weekly Cohort Ledger; Weekly Research Target; Open Ready Inventory; Min Match Threshold; Reverify; Unlock Operator Actions |

---

## 13. Definition of done (the whole plan)

1. **Unattended week:** seven consecutive days with a successful daily run and the audit passing. Any skipped day is visible on the page as "Not updated today".
2. **Variety and quality:** both people's lists meet the phase 3 checks. A hand check of each person's top 25 finds no wrong-field, wrong-level or wrong-place job.
3. **List sizes:** Farhan's Ready + Stretch ≥ 25, and Sana's lists contain at least 3 of her non-maintenance target roles.
4. **Learning:** "Not for me" hides with undo and lowers similar jobs the next day; "Good match" raises them.
5. **First-time use:** on a phone, a first-time person records an application in under a minute, and nothing operator-only is visible.
6. **Alerts:** the Telegram message (or email) arrives daily once the owner has done the one-time setup.
7. **Tests and releases:** all suites are green. One release carried phase 5, and each phase passed its tenth-man step.
