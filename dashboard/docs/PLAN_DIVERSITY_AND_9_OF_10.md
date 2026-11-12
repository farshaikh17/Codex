# Build plan: diversity and the road to 9/10 (written 12 Nov 2026)

This is the complete build plan for the next sessions. It is written so that a builder who has not seen the planning
conversation can carry it out without further design work. Every work package names its files, its rule, its tests and
its "done" check. Nothing here has been built yet unless section 1 says so.

**Scope:** make the product excellent for the two built-in candidates, Farhan (`farhan_shaikh`) and Sana (`sana_ansari`).
Multi-user sign-up, private links and selling are out of scope (see section 9).

**"Diversity" as used here:** the lists a person reads must show a varied set of good options (employers, kinds of
role, places, sources, fresh and older postings), not the same employer or the same kind of job repeated. It is the
owner's request of 12 Nov. If the owner meant something else, only package A changes; B to H stand on their own.

---

## 1. Where things stand (measured 12 Nov, 21:47-22:20 UTC)

Live Worker commit: `b564312` (11 Nov). `main` is far ahead; one release is pending (section 2).

Already merged to `main` on 12 Nov (do not rebuild): automatic shortlist (#111, #112), Ready-card source label (#113),
bot blocking (#114), top-100 screening fixes (#115), Sana India on-site eligible (#116), ranking v3 + low-match Hold
(#117), open tracker without a key (#118), discovery watchdog (#119), taste learning from Good match / Not for me (#120),
"New today" tab (#121), nine more employers for Sana (#122), live-shortlist fixes + shortlist re-score (#123), branch
cleanup button and auto-delete on merge (#124, #125). Rules marker is `profile_v12`.

First automatic shortlist on production (run 16, started by hand; GitHub dropped all four scheduled triggers that day):

| | Ready | Stretch | To review | Hold | Not eligible |
|---|---|---|---|---|---|
| Farhan | 14 | 15 | 545 | 1,223 | 1,224 |
| Sana | 25 | 25 | 557 | 3,210 | 10 |

What the lists look like, and the problems this plan fixes:

1. **Employer concentration.** Farhan Ready: 4 of 14 are Jobgether (a reposting site), 2 GoHighLevel, 2 GitLab. Sana
   Stretch: 5 of 25 are ACWA Power, 3 SOLV Energy. Farhan's top 100 in To review: GoHighLevel 18, Jobgether 16, OpenAI 13.
   The shortlist takes one posting per employer *and title*, but has no cap per employer.
2. **Role monotony.** Sana Ready is almost all "maintenance engineer / manager"; her other target roles (energy
   efficiency, decarbonisation, asset performance, reliability consulting, power plant operations) rarely surface.
   Farhan Ready leans to "AI automation engineer"; implementation, RevOps, technical delivery and business systems are thin.
3. **Place monotony.** Sana Ready is 25 of 25 India on-site. Gulf roles (in her profile) can only reach Stretch, and
   remote roles are absent. Farhan Stretch still holds a London-only role.
4. **Unreadable employer names.** "Hdga", "Egup", "Mdlz", "Fa Espx Saasfaprod1", "Fa Emqh Saasfaprod1", "aecom2",
   "Ekkh": these are Workday / Oracle tenant ids stored as the company name.
5. **Multi-location postings dodge the abroad rule.** "16 Locations", "48 Locations" (US employers) are not recognised
   as abroad, so they sit in Sana's Stretch.
6. **Stale postings.** Farhan's Stretch has a posting found on 5 Aug. Liveness checks 75 rows per person per day.
7. **Ranking still reads mostly the title.** Score = role match + count of profile skill words + bonuses. Scores bunch
   up (Sana: nine rows at 95).
8. **Farhan's list is short** (14 Ready): source coverage for his field is thin outside Lever / Ashby / Greenhouse.
9. **No alert.** They must open the site to learn something new arrived.
10. **Capacity.** Free D1: 5M rows read a day; the public read budget is 2.5M. A release flushes the cache.

Not verified on production yet (verify in package H): taste learning, "New today", open tracker, bot blocking,
low-match Hold on live data, watchdog start.

---

## 2. Before any building: the pending release

One release per UTC day (each release flushes the response cache; three in one day exhausted the read budget twice).

1. `git fetch origin main`; CI on the head of `main` must be green; no `discovery.yml` run in progress.
2. Dispatch `dashboard-release.yml` on `main`: `mode=release`, `confirm_sha=<full sha of origin/main>`, `rotate_key=false`
   (owner decision 12 Nov: no operator key for now).
3. Watch it to the end. On failure read the logs; the workflow prints its rollback steps.
4. Live check, few API calls: `/api/version` shows the new commit and `open_tracker: true`; browser on desktop and 375 px:
   top bar says "Tracker open", Ready view shows "New today", cards show "Shortlisted by the screen"; `curl -A Googlebot`
   gets 403; `/robots.txt` is `Disallow: /`.
5. A scheduled reminder for 00:20 UTC 13 Nov exists and still says "rotate_key=true first": ignore that line.

---

## 3. Rules that hold for every package

* Free tools only. No AI review. No automated applications. No paid APIs.
* Never commit CVs, contact details, export contents or secrets. Never ask the owner to paste a secret.
* Production changes only through `dashboard-release.yml`, `rotate_key=false`, at most one release per UTC day.
  Engine, script and workflow changes need no release: they run from the workflows.
* A person's decision (manual override) and any job with an application are never changed by a script.
* No force-push; keep the repo `farhan-job-engine` and the branch `improvements`.
* One pull request per package, squash-merged when CI is green. Branches delete themselves on merge.
* Before every push run exactly what CI runs:
  * `cd dashboard && npm test`
  * from the repo root: `python3 -c "import unittest,sys; s=unittest.defaultTestLoader.discover('.', pattern='test*.py', top_level_dir='.'); r=unittest.TextTestRunner(verbosity=0).run(s); sys.exit(0 if r.wasSuccessful() else 1)"`
    and check the **exit code** (a `| tail` hides a failure).
* Any change to `evaluate()` or to a scoring rule bumps the rules marker (`profile_v12` → `profile_v13`, in every file
  that names it: `worker/discovery.ts`, `scripts/dataset_apply.mjs`, `engine/dataset_discovery.py`, the tests). The daily
  run then re-scores undecided rows and the automatic shortlist, 1,500 per person per run, best first.
* Frontend or Worker changes: run the local browser suites as in `docs/RELEASE.md` (`browser`, `a11y`, `features`,
  `site`, `faults`, `production-readonly`, smoke) on desktop and mobile, with `OPEN_TRACKER` on.
* Live API calls: keep them few (each uncached call reads thousands of rows). Prefer re-scoring saved samples locally,
  as done on 12 Nov with `evaluate()` over the top 100.
* Attribution lines on commits and pull requests as the session instructs. No model name in repo content.

---

## 4. Work packages

Order: A → B → C → D → E → F → G → H. A to E need no release (workflow side); F and G change the Worker / page and ship
in one release; H is verification. Each package is independent enough to merge alone.

### Package A: a diverse shortlist (the core of this plan)

**Problem:** items 1-3 of section 1. The shortlist is "top 25 by score". Score order alone produces clusters.

**Design:** replace the SQL pick in `dashboard/scripts/dataset_apply.mjs` (the block that starts
`// ---- Automatic shortlist`) with a two-step process: SQL builds a *pool* of qualifying rows, a small pure function
picks from the pool with diversity rules. The demotion step ("no longer qualifies") and the low-match Hold step stay as
they are.

1. **Pool export** (`engine/dataset_discovery.py`, new function `shortlist_pool(local=None, per_candidate=300)`, new CLI
   flag `--shortlist-pool OUT.json`): per candidate, the rows that pass today's shortlist conditions (the `base` and
   `fits` predicates now in `dataset_apply.mjs`: active, verified open in the last 4 days, current rules marker, one
   matched skill, no override, no application, status NEEDS_REVIEW or automatically shortlisted), with: `candidate_id,
   job_id, title, company, location, workplace_type, source_adapter, discovered_at, overall_score, skill_score,
   eligibility_status, qualification_status, qualification_reason`. Ordered by score, limit 300 per person.
   It must run **after** the still-open step in `discovery.yml`, so add a workflow step there (same place the shortlist
   SQL is applied now) and write the selection SQL from the fresh pool.
2. **Selection** (new file `dashboard/scripts/shortlist_select.mjs`, pure function
   `selectShortlist(pool, { threshold, readyMax = 25, stretchMax = 25 })` plus a CLI that reads the pool and candidates
   and writes SQL). For each tier (Ready first, then Stretch from what is left), a greedy pick, best score first, that
   skips a row when taking it would break a cap, then a second pass that fills empty places ignoring the *soft* caps:

   | Rule | Value | Hard / soft |
   |---|---|---|
   | Tier rule (unchanged) | Ready: score ≥ threshold and ELIGIBLE. Stretch: score ≥ threshold and UNKNOWN, or ELIGIBLE and within 10 below | hard |
   | One posting per employer and title (unchanged) | 1 | hard |
   | Per employer, per tier | 2 | soft |
   | Per employer, both tiers together | 3 | hard |
   | Reposting sites and staffing agencies (`agencyPosting()` true, or company key in `REPOSTERS`: jobgether, turing, crossover, peopleworth, pavago, paired, braintrust) | 3 per tier in total | hard |
   | A reposter's row whose title also exists in the pool from a direct employer | dropped | hard |
   | Per role family (see 3) | 40% of the tier (10 of 25) | soft |
   | Per place band (see 4) | minimum places, when enough qualifying rows exist | soft |
   | Postings found more than 30 days ago | 5 per tier | soft |
   | "Something different" places (see 5) | last 3 places of Stretch | soft |

   Soft caps are relaxed in this order when a tier cannot be filled: older postings, role family, place band, per
   employer per tier. Hard caps are never relaxed: a shorter list is correct.
3. **Role families** (`dashboard/worker/listing.ts`, `ROLE_FAMILIES`): today's list is Farhan's. Add, used by both the
   selection and the page: for Sana `maintenance`, `reliability_asset`, `energy_efficiency_decarb`, `power_plant_ops`,
   `commissioning_projects`, `utilities`, `electrical`, `consulting_technical`; for Farhan make sure these exist:
   `implementation`, `automation_ai`, `revops_crm`, `technical_delivery`, `business_systems`, `solutions`,
   `operations_general`. Each is a title regex; a title matching none is `unclassified` (never capped). Export a
   function `familyOf(candidateId, title)` so the script and the Worker agree.
4. **Place bands** (new exported function `placeBand(candidateId, location, workplaceType, remote)` in
   `worker/discovery.ts`, built on `sanaIndiaCity`, `GULF_PLACE`, `foreignLocation`): `india_onsite`, `india_remote`,
   `gulf`, `abroad_with_route`, `remote_global`, `other`. Minimums per person, applied only when that many rows qualify:
   * Sana, Ready (25): at least 3 `india_remote` or `remote_global`. Stretch (25): at least 8 `gulf`, at least 3
     `abroad_with_route`.
   * Farhan, Ready: at least 4 `remote_global` (worldwide remote, not India-specific). No other minimum.
5. **"Something different"**: the last 3 places of Stretch go to the best-scoring pool rows whose role family has no
   row yet in Ready or Stretch for that person (one per family). Their reason gets the suffix " Something different:
   a role family not otherwise on your list." If fewer than 3 exist, the places go back to the normal pick.
6. **Writes:** same marks as now ("Shortlisted automatically. " prefix, `qualification_history` rows, actor
   `discovery`). The CLI emits: demote rows that are shortlisted but not selected; promote selected rows that are not
   shortlisted; move rows between tiers. Each UPDATE is guarded on the row's current status and on "no override, no
   application", so a change made by a person between export and write wins.
7. **Stability:** a row already on the shortlist that still qualifies keeps its place unless a *hard* cap removes it
   (give incumbents +3 in the ordering used for picking). Without this the list churns daily and "New today" loses meaning.
8. **Metric:** the CLI writes `work/shortlist.report.json`: per person and tier `{count, employers, max_employer_share,
   families, bands, older_than_30d, something_different}`. `scripts/run_log.mjs` stores it in the run row; the daily
   card (`/api/discovery/daily`) returns it. This is how diversity is checked from then on.

**Tests** (`dashboard/test/shortlist_select.test.mjs`, pure function, no database): a pool of 60 rows where one
employer has the 20 best scores → at most 2 per tier and 3 in total; reposters capped at 3; reposter duplicate of a
direct posting dropped; family cap holds and relaxes when the pool has only one family; place minimums met when rows
exist and ignored when they do not; incumbents keep their place; hard caps give a shorter list instead of breaking;
"something different" picks distinct unseen families; determinism (same pool → same output). Then one database test in
`test/dataset.test.mjs` for the generated SQL: guards, marks, history rows, idempotent second run, a person's Ready row
untouched. Remove the tests of the old SQL pick that no longer apply; keep the demotion and low-match tests.

**Done when:** on the next production run the report shows, for both people, max employer share ≤ 12% per tier (3 of
25), at least 4 role families in Ready where the pool has them, and the place minimums met or reported as "pool too small".

### Package B: readable employers and true locations

1. **Employer names** (item 4). New file `engine/company_names.py`: `display_company(raw, source_adapter, url)`.
   * A table of known tenant ids → names, seeded from what is in the lists now: `mdlz` → Mondelez International,
     `hdga`, `egup`, `ekkh`, `fa espx saasfaprod1`, `fa emqh saasfaprod1`, `aecom2` → AECOM, `generalmotors` → General
     Motors, `thermofisher` → Thermo Fisher Scientific, `gohighlevel` → GoHighLevel, `abb` → ABB. For the unknown ones
     (`hdga`, `egup`, `ekkh`, the two `fa … saasfaprod1`) open one stored posting URL each and read the employer name
     from the page title; put the result in the table. Do not guess.
   * A fallback: when the name looks like a tenant id (`^fa [a-z]{4} saasfaprod\d$`, or one lowercase token of ≤ 5
     letters from workday / oracle), try the posting page's `<title>` / `og:site_name` once at import; otherwise keep
     the raw value.
   * Apply at import (`engine/more_sources.py` `job()`, `engine/dataset_discovery.py` `clean()`), and once to stored
     rows: a migration `0021_company_display_names.sql` with explicit `UPDATE jobs SET company = … WHERE company = …`
     statements for the table (idempotent; add it to `test_migration_chain.py` and to the explicit migration list in
     `dashboard-release.yml`).
   * The employer key used for caps and dedupe is `companyKey()` of the *display* name.
2. **Multi-location postings** (item 5). `foreignLocation()` in `worker/discovery.ts` treats "N Locations" as unknown.
   Rule: when the location is `^\d+ Locations?$` (or empty) and the description names only places outside India and
   the Gulf (reuse `FOREIGN_NAME`, `FOREIGN_STATE`), treat it as abroad for the "no visa route" cap. Where the source
   gives a location list (Workday `locationsText`, SmartRecruiters `location`), store the first three places instead
   of the count (`engine/more_sources.py` `workday()`).
3. **Same job, many cities.** In `split_new()` (`engine/dataset_discovery.py`) and the write step, a new posting with
   the same employer and title as a stored active one, differing only in city, is stored once: keep the first, append
   the other city to `location_restrictions` ("Pune; Chennai; +3 more") and do not create another job row. Stored
   duplicates are not merged (no deletes); the shortlist's per-employer-title rule already hides them.
4. Bump the rules marker (2 changes `evaluate()` inputs).

**Tests:** `engine/tests/test_company_names.py`; `dashboard/test/discovery.test.mjs` for "16 Locations" with a US-only
description (capped for Sana) and with an India place in the description (not capped); `engine/tests/test_split_new.py`
for the multi-city merge. **Done when:** no employer on either shortlist is a tenant id, and no "N Locations" US
posting is on Sana's lists.

### Package C: ranking that reads the posting (item 7)

All in `worker/discovery.ts` `evaluate()`; each is a small, explainable adjustment with its sentence in the reason.
Bump the marker once for the package.

1. **Duties match.** Per person a short list of duty phrases (not skill names), matched in the description:
   * Farhan: `configure|implement|onboard(ing)? customers|workflow(s)?|automation(s)?|integrat(e|ion)|crm|pipeline|
     zapier|make\.com|n8n|api|webhook|go-?live|sop|process (design|improvement)`.
   * Sana: `preventive maintenance|breakdown|shutdown|overhaul|rotating equipment|boiler|turbine|dcs|scada|switchgear|
     transformer|root cause|rca|reliability|energy audit|energy efficiency|utilities|commissioning|permit to work|
     condition monitoring`.
   Count distinct hits: 6 or more +6, 3 to 5 +3, 0 with a description longer than 600 characters −8 ("the posting
   does not describe this kind of work"). Never applied when the description is shorter than 300 characters.
2. **Title precision.** A title that contains two or more unrelated functions ("Sales & Marketing Operations
   Manager", "Customer Support & Automation Lead") gets −4 unless a target role is contained exactly.
3. **Seniority ceiling.** For a 9-year candidate, "Director", "VP", "Head of" with a stated requirement above their
   years, or a team-size requirement ("lead a team of 20+"), −6 (was only handled through "asks for N+ years").
4. **Score spread.** After all adjustments, cap the plain ceiling at 92 and add `min(3, matched duties − 5)` so equal
   95s separate. The shortlist's tie-breaks stay.
5. **Age.** A posting found more than 45 days ago loses 3; more than 90 days, 6 (stored score, with the reason
   "Posted long ago"). Needs `discovered_at` passed into `evaluate()` (`Posting.observedAt` exists; pass it from the
   re-score export too).

**Tests:** one table-driven test per rule with a real posting text from each person's list and a near miss; the
existing "caps still win" tests must still pass. **Check before merging:** re-score the saved live samples (top 100
and both shortlists; the method is in section 3) and read the top 25 of each person by hand against their target
roles; record the before / after counts in the pull request.

### Package D: more and fresher sources (items 6 and 8)

1. **Farhan: sources.** Probe each candidate live (as on 12 Nov: one request, a 200 with real rows) and add only those
   that answer; list the rest in the pull request as "probed, not added":
   * Ashby / Greenhouse / Lever boards of companies in his field that are not in the open dataset: build the list from
     the *employers already on his Ready and Stretch lists and in his applications* plus CRM / automation vendors and
     their partners (GoHighLevel, HubSpot, Zapier, Make, n8n, Airtable, ClickUp, monday.com, Pipedrive, ActiveCampaign,
     Close, Keap, Zoho, Freshworks, Intercom, Calendly, Typeform, Webflow, Notion, Retool, Workato, Tray.io). For each,
     find its board (`boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`) and register it where employer boards are
     registered today (the collector's source registry read by `collect.yml`, and `engine/discovery_sources.json`;
     read both first and follow the existing entries' shape).
   * Remote boards with public feeds not yet read: Remotive API, Jobicy API, Working Nomads (already), 4 Day Week,
     NoDesk, Remote.co RSS, Dynamite Jobs, Otta is login-only (skip). Add to `engine/remote_boards.py`.
   * YC Work at a Startup needs a login: skip. `hnhiring` is already read.
2. **Sana: sources.** Continue the 12 Nov method for India / Gulf plant and energy employers on Workday, Oracle HCM
   (`*.fa.*.oraclecloud.com` sites: probe `/hcmRestApi/resources/latest/recruitingCEJobRequisitions`), SuccessFactors
   RSS, SmartRecruiters, Darwinbox public career pages (`<tenant>.darwinbox.in/ms/candidate/careers`): Adani, L&T,
   JSW, Tata Steel, Hindalco, UltraTech, Vedanta, Reliance, Thermax, Siemens India, ABB India, Schneider, Cummins
   India, Bajaj, Mahindra, Ather, Ola Electric, ReNew, Greenko, Sterlite Power, Suzlon, Adani Green, NTPC (state
   portal only: skip), ADNOC, Aramco, SABIC, Ma'aden, QatarEnergy, DEWA, EWEC, Alfanar, Petrofac, McDermott, Worley,
   Technip Energies, Saipem, Wood (already), Bechtel, Fluor (already). Several failed a first probe on 12 Nov (see
   #122); try their actual career-site hosts, not guessed ones.
3. **Search terms.** `SF_TERMS` and the per-person title terms in `more_sources.py` are maintenance-heavy for Sana. Add
   her other target roles: `energy efficiency`, `decarbonization`, `asset performance`, `reliability`, `utilities`,
   `commissioning`, `energy manager`, `plant engineer`, `O&M`. For Farhan add: `implementation`, `onboarding`,
   `solutions consultant`, `revenue operations`, `crm`, `automation`, `technical account manager`, `customer
   engineering`, `business systems`.
4. **Freshness.** `engine/liveness.py`: raise `PER_CANDIDATE` from 75 to 150 and order so that (a) the automatic
   shortlist, (b) the shortlist *pool* (package A), (c) the rest by score are checked in that order. Keep the 10-minute
   step limit; measure the step's duration in the first run and lower the number if it exceeds 6 minutes.
5. **Source mix in the run log:** per person, how many shortlisted and pool rows came from each source; it shows
   whether a new source actually reaches the lists.

**Tests:** the list assertions in `test_more_sources.py`; fixture tests for any new fetcher. **Done when:** Farhan's
Ready list reaches 20 or more on two consecutive days without relaxing the rules, and at least 3 of Sana's non-
maintenance target roles appear in her lists.

### Package E: learning that is visible and fast (extends #120)

1. The taste model needs 10 decisions with both kinds before it switches on. Until then use **direct signals**, in
   the taste pass of `dataset_apply.mjs` (same `taste_adj` mechanism, total still within ±5):
   * "Not for me" on a job → other active jobs of the same employer with the same role family −5; three "Not for me"
     in one role family → that family −3 for that person.
   * "Good match" or Applied → same employer +3, same role family +2.
   * The export `taste_rows()` already carries title and company; add `job_id` and the role family.
2. **Reason text:** when `taste_adj` is not 0 the stored reason ends with "Ranked up: like jobs you marked Good match"
   or "Ranked down: like jobs you marked Not for me" (replace, never append twice: strip an existing sentence first).
3. **Not for me removes the job from the lists** for that person: the feedback route (`POST /api/jobs/:id/feedback`,
   `worker/index.ts`) with `DOWN` also moves an undecided, unapplied job to HOLD with reason "You marked this Not for
   me" (history row, actor `candidate`); clearing the rating restores the previous status from `qualification_history`
   (the same mechanism the application route uses). This is a Worker change: ships with package F's release.

**Tests:** extend `discovery_v3.test.mjs` (direct signals with fewer than 10 decisions; no double counting; reason
sentence replaced), `owner_decisions.test.mjs` (Not for me → Hold → clear → restored; decided and applied rows refuse).

### Package F: daily flow on the page (Worker + frontend; one release with E.3 and G)

1. **Default landing per person:** opening a person's dashboard lands on "New today" when it has rows, else Ready.
2. **Why this job, in one line:** each card shows up to three chips from the score breakdown: matched skills count,
   "Target role", "At your level", "Remote from India" / "On-site India" / "Gulf", "New today", "Something
   different". Data is already in `score_breakdown` / reason; add `place_band` and `role_family_key` to the job JSON in
   `GET /api/jobs` (computed with the package A functions, no new query).
3. **Group by employer toggle** in Ready / Stretch: collapses several rows of one employer into one card with a count.
4. **Filter chips** above the list: role family and place band (server-side: `role_family` already exists for India
   Remote; add `place_band`; both become part of the cache key in `CACHE_PARAMS`).
5. **Tracker nudges:** an Applied job with no follow-up date and no change for 7 days shows "No reply yet: follow up?"
   (computed in the page from `applied_at`; no new table).
6. **Diversity line** on the daily card: "Ready: 25 jobs from 19 employers, 5 kinds of role" from the run report.
7. Accessibility and mobile checks as in the suites; add checks to `test/e2e/features.e2e.mjs` for 1-5.

### Package G: alerts without an address (item 9)

No email address is on file and none may be committed, so:

1. **A private feed per person:** `GET /api/feed/:candidate.xml?k=<token>` returns an Atom feed of that person's
   Ready and Stretch jobs found or shortlisted in the last 7 days (title, employer, place, score, link to the site).
   The token is a random value stored in `discovery_state` (key `feed_token:<candidate>`), created by a migration-free
   lazy insert on first request by an unlocked operator, or printed once by a workflow step; without the right token
   the route answers 404. The page shows "Get alerts" with the feed link and two lines on using it (any feed reader
   app; most phone readers notify). Robots rule already blocks crawlers; the bot filter must let feed readers through
   on this one path.
2. **Optional email, off by default:** a workflow step `Send daily digest` that runs only when the repository
   *variable* `DIGEST_PROVIDER` and the *secrets* it needs exist (for example a free Resend or Brevo key and
   `DIGEST_TO_FARHAN` / `DIGEST_TO_SANA`). It sends "Your N new jobs today" with the top 5. The plan only wires it;
   the owner adds the secrets in GitHub when they want it. Nothing is asked in chat.

**Tests:** Worker test for the feed (404 without token, valid Atom with it, only that person's rows, no private
fields); a unit test of the digest text builder; the send step itself is skipped in CI.

### Package H: verification, capacity and hand-off

1. **Production checks after the release of F/G** (one day after, few calls): the items listed as "not verified" in
   section 1, each with what was seen. Use the run report for diversity numbers instead of sampling the API.
2. **Read budget:** from the Cloudflare numbers of two normal days, record rows read per day by source (public reads,
   daily run, watchlist, Worker cron). If the daily total exceeds 2.5M, apply in this order: raise the response-cache
   TTL for list routes to 30 minutes; make the watchlist run skip its export when no new posting was found; lower the
   re-score per-person cap from 1,500 to 800. Record the result in `docs/COST_MODEL_2026-11-09.md`.
3. **Quality gate that stays:** add `dashboard/scripts/shortlist_audit.mjs` (run in the daily workflow after the
   shortlist): fails the *step* (not the run) and writes a warning in the summary when a hard rule is broken on stored
   data (tenant-id employer on a list, more than 3 rows of one employer, a reposter over its cap, a posting not
   verified in 4 days, a row with an override or application carrying the automatic mark). This is the standing check
   that the lists stay good without a person reading them.
4. **Docs:** update `docs/DISCOVERY_PIPELINE.md` (shortlist rules, diversity table, sources added), `docs/RELEASE.md`
   (open tracker, feed), and write `docs/FINAL_STATE_<date>.md` replacing the 11 Nov one: what is live, measured
   numbers, what is knowingly left.
5. **Old branches:** 13 unmerged branches from October / early November remain (`builderbranches-*`,
   `completion/integration`, `integration/pr1-2-3`, `qa/*`, `review/*`, `docs/qa-handoff-2026-11-09`,
   `feat/shared-candidate-alignment`, `fix/qualification-review-bottlenecks`). For each, `git log main..<branch>`;
   if every change is superseded on `main`, list it for the owner with one line why. Deleting them needs the owner
   (the agent cannot delete unmerged branches); the cleanup button does not touch them.

---

## 5. Decisions already taken (do not reopen)

* Shortlist is automatic; Ready = threshold + eligible; Stretch = threshold + eligibility to confirm, or eligible and
  up to 10 below; 25 each (12 Nov).
* Sana: on-site India is workable (eligible). Abroad outside the Gulf needs an explicit visa route; relocation alone
  counts only in the Gulf (12 Nov).
* No operator key for now; the tracker is open without one (`OPEN_TRACKER = "on"`); bots are blocked (12 Nov).
* No AI review; thumbs and tracker actions are the learning signal.

## 6. Defaults for open points (use these; the owner can change them later)

| Point | Default used by this plan |
|---|---|
| Per-employer cap | 2 per tier, 3 in total |
| Role-family cap | 40% of a tier |
| Sana's Gulf minimum in Stretch | 8 of 25 |
| Farhan's worldwide-remote minimum in Ready | 4 |
| "Something different" places | 3, in Stretch only |
| Email digest | wired but off until the owner adds secrets |
| Thresholds | unchanged (Farhan 70, Sana 60) |

## 7. Risks and how each package guards against them

* **Lists get worse, not more varied.** Soft caps relax in a fixed order; hard caps only ever shorten a list;
  incumbents keep their place; package C is checked by hand on saved samples before merging.
* **Daily churn.** Incumbent bonus (+3) in the pick; "New today" counts only rows new to the list.
* **Writes.** A marker bump re-scores up to 1,500 rows per person per run (about 6,000 row writes); the free limit is
  100,000 a day. Bump once per package, not per commit.
* **Reads.** The pool export reads about 600 rows; the audit reads the two shortlists; both are once a day.
* **A person's decisions.** Every UPDATE keeps the guards "no override, no application"; tests assert byte-identical
  rows for decided jobs in every package.
* **Wrong employer names.** Only table entries verified from the posting page are written; unknown ids stay raw.

## 8. Definition of done for the whole plan

1. Run report, two consecutive days, both people: ≤ 3 rows per employer across Ready + Stretch; ≥ 4 role families in
   Ready when the pool has them; place minimums met or reported "pool too small"; no tenant-id employer names; no
   posting unverified for 4 days.
2. Farhan Ready ≥ 20 on both days; Sana's lists contain at least 3 of her non-maintenance target roles.
3. A hand check of the top 25 of each list against the profile finds no wrong-field, below-level or unworkable-place
   job (record the check in the final-state document).
4. Marking "Not for me" removes a job and visibly lowers similar ones the next day; "Good match" raises similar ones.
5. The feed works for both people; the page shows "New today" first when it has rows.
6. All suites green; one release carried F, G and E.3; the audit step is in the daily workflow and passes.

## 9. Out of scope (later, separate plan)

Private link per person, self sign-up, other professions, pricing, the operator key, the five held dependency
updates, warm introductions to employers, and the visual redesign beyond package F ("10/10 UI").
