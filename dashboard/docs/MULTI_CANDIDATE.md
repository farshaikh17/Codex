# Multi-candidate base: profile configs and rule packs

Status: design and first implementation (Discovery, Sorting, Quality). Privacy (moving the two built-in people's profile text out of the
repository) and pricing plans are later phases; nothing here makes them harder (section 9).

## 1. The problem

The engine serves two built-in people, and their rules are code: `evaluate()` in `worker/discovery.ts` branches on
`candidate.id === 'farhan_shaikh'` and `'sana_ansari'` about thirty times, the discovery searches are per-id tables in `engine/*.py`, and
the shortlist has per-id band minimums. Resold clients have a small stored search profile (`client_profiles.search_profile`: keywords and
one of two location modes), but it skips most of the quality rules, so a client gets a much weaker screen. An unknown person (a future
candidate whose field and country we do not know yet) would need new scoring code.

## 2. The idea

A candidate = **profile config** (data, stored in D1) + the **rule packs** it names (code, reusable, parameterised). Scoring, discovery and
the shortlist read the config; no per-person branch is written for a new person.

```
candidate row (skills, target roles, years, threshold)  +  candidate_profile_configs.config (JSON, this document)
          |                                                          |
          +------------------- resolveProfile() ---------------------+
                                     |
     +-------------------------------+-----------------------------------------+
     |                               |                                         |
 evaluateWithProfile()        discovery plan                            shortlist settings
 (worker/profiles/evaluate.ts) (engine/profile_plan.py -> profiles.json) (tier size, band minimums,
  field packs, place policies,  dataset role regex, JobSpy queries,      home-place rule for Worth a try,
  level band, type, language,   Workable / EURES / Adzuna terms,          role families for variety and taste)
  hygiene                       per-person row and import caps
```

## 3. The profile config (schema 1)

Stored as JSON text in `candidate_profile_configs(candidate_id, config, updated_at)` (migration 0028; a table, not a column, because
migrations are replayed on every release and `ALTER TABLE ADD COLUMN` is not idempotent). At most 16 KB. Every pattern is a **plain
phrase**, never a regular expression (the same rule as client search profiles), so a config cannot cause a slow match. Validated by
`parseProfileConfig()` (`worker/profiles/schema.ts`); an invalid config is ignored (the person stays on the old path) and the validator
script says why.

| Field | Meaning | Default |
|---|---|---|
| `schema` | 1 | required |
| `extends` | `legacy:farhan_shaikh` or `legacy:sana_ansari`: start from a built-in pack set (section 5) | none |
| `engine` | `profile` (score with the packs) or `legacy` (the old `evaluate()`) | `profile`; a built-in id needs `profile` explicitly |
| `display_name` | shown in reports | candidate row |
| `field.packs` | field packs: `revops_automation`, `plant_maintenance`, `keyword` | `["keyword"]` |
| `field.role_families` | keys of `shared/role_families.json` (title words and search terms per family) | `[]` |
| `field.excluded_families` | families whose titles are capped like an avoid-list title | `[]` |
| `field.title.must` | a title must contain one of these (or of the families' title words) to be a role match | `[]` |
| `field.title.should` | close-to-target title words (+4, like a target-role word) | `[]` |
| `field.title.avoid` | capped at 40 | `[]` |
| `field.skills.positive` | counted as skills (adds to the candidate row's `primary_skills`) | `[]` |
| `field.skills.required` | if the posting names none of them, the score stays below the Worth-a-try floor | `[]` |
| `field.target_roles` | adds to the candidate row's `target_roles` | `[]` |
| `field.duties` | duty phrases counted in the description (plan C1: +3 / +6 / -8) | the families' duties |
| `level.years` | years of experience | candidate row |
| `level.min` / `level.max` | band: `entry junior mid senior lead manager director executive` | legacy behaviour (section 5) |
| `place` | list of place policies (section 4.2), combined | `[{"policy":"onsite_in","countries":["IN"]},{"policy":"abroad_with_visa"}]` (the old default) |
| `employment_types` | allowed: `FULL_TIME CONTRACT PART_TIME FREELANCE` | `["FULL_TIME","CONTRACT"]` |
| `type.no_va_placements` | virtual-assistant placements and small-business assistant posts are capped | `false` |
| `language.spoken` | languages the person works in; any other required language is capped | `["English"]` |
| `salary.floor` / `salary.preferred` | `{amount, currency, period}` | candidate row's `cash_floor_inr_monthly` |
| `thresholds.qualify` | the Best-matches threshold | candidate row's `qualification_threshold` |
| `thresholds.tier_size` | Best matches / Worth a try size | 25 |
| `shortlist.band_minimums` | `{READY: {band: n}, STRETCH_READY: {...}}` | none |
| `discovery.search_terms` | job-site, Workable, EURES and Adzuna search terms | the families' search terms |
| `discovery.countries` | ISO codes searched on job sites | from the place policies |
| `discovery.employer_boards` | `[{kind: greenhouse/lever/ashby/workable/jazzhr, slug}]` read for this person | `[]` |
| `discovery.jobspy_sites` | `indeed linkedin glassdoor google bayt` | `indeed linkedin` |
| `discovery.max_rows` | dataset rows pre-scored for this person per run | 20,000 |
| `discovery.max_selected` | dataset rows this person may send to the import per run | 400 |

A synthetic example is `dashboard/test/profiles/example_data_analyst_remote_eu.json` (tests only; never seeded).

## 4. Rule packs

All in `worker/profiles/`. Each pack is a parameterised function of the posting signals (`signals.ts`, computed once per posting and
shared by every person) and the resolved profile. `evaluateWithProfile(profile, posting, ctx)` returns exactly the shape of `evaluate()`.

### 4.1 Field packs (`packs.ts`)

| Pack | What it is | From |
|---|---|---|
| `revops_automation` | CRM / RevOps / automation / implementation / builder roles: role rule, hard and soft avoid lists, distinctive target words, duty phrases, infrastructure-ops and AI-software off-field reading, YC bonus, role families | Farhan's branches |
| `plant_maintenance` | plant O&M, reliability, maintenance, energy: role rule, avoid list, product-reliability reading, target-role and title skills, duty phrases, design / lab / civil / telecom / marine off-field reading, trade titles below level, electrical-only and design-only penalties, core-plant bonus, role families | Sana's branches |
| `keyword` | any field: role = the title names a family title word or `title.must`; avoid = `title.avoid` + excluded families; target fit from target roles and `title.should`; duties from `field.duties` or the families; required skills | new |

Several field packs may be listed; the first whose role rule matches the title decides the field-specific rules, and avoid lists add up.

### 4.2 Place policies (`place.ts`), combinable

| Policy | Parameters | Meaning |
|---|---|---|
| `remote_from_country` | `country`, `remote_only` (default true), `worldwide_ok`, `apac_ok`, `skip_employers`, `global_hirer_bonus`, `timezone_penalty`, `foreign_penalty`, `unconfirmed_penalty` | remote work open to someone living in `country`. With `remote_only` an office, hybrid, US-only, EU-only, other-country-only or right-to-work-elsewhere posting is ineligible (Farhan's rule set, for any country) |
| `onsite_in` | `countries` | on site, hybrid or remote in one of these countries is eligible |
| `abroad_with_visa` | `gulf_relocation_counts`, `uk_sponsor_route`, `cap_unworkable` | abroad only with a stated visa route (or, in the Gulf, relocation); with `cap_unworkable` an on-site job abroad with no route, a remote job with no reach to the home country and a right-to-work-elsewhere posting are capped at 45 (Sana's rule set) |

Combination: the first policy that finds the posting eligible wins; otherwise a place restriction (another country only, US / EU only,
right to work elsewhere) makes it ineligible, and so do "not remote" and office days for a `remote_only` policy; otherwise the posting
is "eligibility unknown". The India-specific readings (Indian places, plant towns, Indiana) are used when the home country is
`IN`; another country uses its names, its ISO code and `place_words` from the config.

### 4.3 Level band, type, language, hygiene

* **Level** (`level`): asks for more than years + 2: -15 and capped below the threshold; an executive title not in the target roles:
  capped below the threshold; `max: manager` also keeps director / principal / VP / head-of titles below the Worth-a-try floor (Farhan);
  `min` of `mid` or above caps junior / trainee / intern titles (the old rule: at 5+ years); field packs may add below-level titles (trades).
* **Type**: a part-time / freelance / contractor gig is capped unless `employment_types` allows it; `type.no_va_placements` adds the VA rule.
* **Language**: a required language outside `language.spoken` lowers the score (soft) or keeps it below the Worth-a-try floor (hard).
* **Hygiene** (every person): security clearance and nationals-only postings are ineligible, nationals preference capped, staffing agency
  -5, platform gap capped at 59, mixed titles -4, reposted note, rejected-before note. The shortlist's hygiene rules (reposters at most 3
  per tier, one posting per employer and title, tenant-id employers off, verified open in 4 days, stale rows -5) already work per person.

## 5. The two built-in people as configs (equivalence)

`worker/profiles/legacy.ts` holds `legacy:farhan_shaikh` (`revops_automation` + `remote_from_country(IN)` with every option, `max:
manager`, VA rule, threshold 70, pay floor 1,20,000 a month default and 25 LPA preferred, band minimum 3 worldwide on Best matches) and
`legacy:sana_ansari` (`plant_maintenance` + `onsite_in(IN)` + `abroad_with_visa` with Gulf relocation, UK sponsor route and caps,
threshold 60, band minimums). They hold **no personal data**: skills, target roles, years and threshold still come from the candidate row.

**The old path stays the default.** A person is scored with the packs only when they have a config whose `engine` is `profile`; for the
two built-in ids that needs an explicit `{"schema":1,"extends":"legacy:<id>","engine":"profile"}` row, so production for them is
unchanged until that row is written. `PROFILE_ENGINE=off` in a script's environment turns the new path off everywhere (kill switch).

Equivalence test (`test/profiles_equivalence.test.mjs`, in CI): both legacy configs against `evaluate()` on a generated corpus (about
4,000 postings per person: titles x places x descriptions x remote flags x employers drawn from the rules' own test cases, including the
jobs QA 7 and 8 rules), every field compared (status, lane, eligibility, reason, score, skills, target fit, qualification reason). The
hand-judged set (2,118 stored rows, not in the repository) is checked with
`node --import ./test/register.mjs scripts/quality/equivalence.mjs --rows <rows.json> --candidates <candidates.json>`: **0 mismatches**
against `evaluate()` as of `profile_v23` (#241). When a later change to `evaluate()` is not mirrored in the packs, the CI test fails: mirror
the rule in the pack (most rules are shared through `RULE_PARTS` and the exported helpers, so only the ordering and the inline readings
in `profiles/signals.ts` need care).

## 6. Discovery from the profile

`engine/dataset_discovery.py` writes `work/profiles.json`, which every discovery step reads. For a person with a config,
`engine/profile_plan.py` builds the entry from the config and `shared/role_families.json`:

* dataset prefilter: role regex from the families' title words and `title.must`, exclude regex from `title.avoid` and excluded families
  (plain phrases, escaped), countries from the place policies, mode `REMOTE_FROM_HOME` / `HOME_OR_RELOCATE`;
* `jobspy`: up to 5 (term, location, country, sites) searches: the search terms, in the home country (remote: "<term> remote"), sites from
  the config;
* `workable` (up to 8 terms, remote-only when the place policy is), `workable_places` (up to 6), `eures` (up to 4, European countries only),
  `adzuna` (up to 3, Adzuna countries only), `boards` (up to 10 employer boards);
* `max_rows` and `max_selected`: the per-person bounds below.

The built-in people keep their hand-tuned tables; the steps use a config's lists only when the person has no table entry.

## 7. Quality

* **Onboarding audit** (`scripts/quality/onboarding_audit.mjs`): samples a person's Best matches and Worth a try (from the shortlist pool
  file or an exported rows file) and flags rule-level risks per row: place unknown, an aggregator place contradicting the ATS fields, thin
  text (under 300 characters), reposter, level out of band, weak field match (role match from one family word and no skills), language
  outside the spoken list. Writes a JSON and a Markdown report. Rules only.
* **Judged-set regression** (`scripts/quality/judged_harness.mjs`): any hand-judged sample becomes a permanent test. Format
  (section 7.1). The harness scores every row with the person's current scorer and reports, per verdict, how many
  rows the rules put on the lists; `--assert` fails on a regression against a previous report (`--expect`). The synthetic example's judged
  sample (`test/profiles/judged_example_data_analyst_remote_eu.json`) runs in CI this way.
* **Taste ("Not for me")**: the taste rules group marks by employer and role family; a config's families are registered for
  `familyOf()`, so a new person's marks move their scores like the built-in people's.

### 7.1 Judged-set JSON format (`judged/<candidate>.json`)

```json
{ "schema": 1, "candidate_id": "example_data_analyst_remote_eu", "judged_on": "2026-11-20",
  "rows": [ { "id": "job id", "title": "...", "company": "...", "location": "...", "description": "...", "remote": true,
              "source": "greenhouse", "salary": {"min": null, "max": null, "currency": null, "period": null},
              "verdict": "RIGHT | WRONG | UNSURE", "expect": "listed | not_listed | any", "note": "why" } ] }
```

`expect` defaults from `verdict` (RIGHT -> listed, WRONG -> not_listed). "Listed" means the rules would allow Best matches or Worth a try
(`fitsReady` / `fitsStretchRule` with the row treated as verified).

## 8. Cost of one more person (free plan: 5M reads, 100k writes a day)

Measured / derived from `COST_MODEL_2026-11-09.md` sections 2, 6 and 7 (index entries included).

| Step | Reads per person per day | Writes per person per day | Bound |
|---|---:|---:|---|
| Context export (profile, config, rescore walk, taste, pool) | about 2,000 to 6,000 | 0 | `--rescore-per-candidate 800`, pool 300 |
| Dataset duplicate check of the person's selection | 11 per selected row: at most 4,400 | 0 | `max_selected` 400 |
| Import of new rows | about 25 per row (guards) | 9 per row: at most 3,600 | `max_selected` 400, global `--max-new` 1,500 |
| Re-score after a rules change | about 4 per row | about 8 per row: at most 6,400 | 800 per run |
| Still-open check | about 150 | about 150 | 150 per person |
| Shortlist select + audit | about 1,000 | at most 50 moves x 8 = 400 | 2 tiers x `tier_size` |
| Page views (Today, lists from the stored copy) | about 500 per view, 21,000 for the first view after a change | 1 copy rebuild, about 25 | 30-minute cache |
| Onboarding backfill (once) | about 1 per active job (cursor) | 9 per active job (about 9 x 24,000 = 216,000: **spread over 3+ days**, 40 per call) | `BACKFILL_MAX` 40 |

Steady state: about **15,000 to 40,000 reads** and **at most about 4,500 writes** a day per extra person (a rules-bump day up to about
11,000 writes). Five extra people fit beside today's run (about 0.25 to 0.35M reads, 23,000 writes). The onboarding backfill is the one
large cost: 9 writes per active job, so it must be spread over days (the Clients page already screens in batches).

Run time per person: dataset pre-score `max_rows` 20,000 rows at about 1 ms each (about 20 s on the runner); job sites at most 5 searches
x 2 sites (about 1 to 2 min, inside the step's 10-minute limit); Workable / EURES / Adzuna terms inside `more_sources.py`'s shared time
budget (each source keeps its weighted share).

## 8a. Adding a new person (no code)

1. Create the person as a client (CLIENTS page): candidate row with skills, target roles, years, threshold.
2. Write their config (start from `test/profiles/example_data_analyst_remote_eu.json`), then
   `node --import ./test/register.mjs scripts/profile_config.mjs --candidate <id> --config <file> --out config.sql`: it refuses an invalid
   config with the reasons, prints the packs and places, and writes one guarded upsert. `python engine/profile_plan.py --config <file>`
   prints the searches the daily run will make.
3. Apply `config.sql` with `npx wrangler d1 execute career-job-engine --remote --file=config.sql` (operator). The next daily run searches
   and scores for them; the Clients page's screening (backfill) uses the packs too.
4. After a few days, `scripts/quality/onboarding_audit.mjs` over the shortlist pool; hand-judge a sample into `judged/<id>.json` and keep
   it as a regression (`scripts/quality/judged_harness.mjs --expect`).

## 9. Hard-coded places found (grep `farhan_shaikh` / `sana_ansari`, 20 Nov)

**Parameterised from the config** (a person with a profile config needs no code):

| Where | What | Now |
|---|---|---|
| `worker/discovery.ts` `evaluate()` | about 30 per-id branches (role, avoid, fit, skills, duties, off-field, level, place, VA, gigs, caps) | rule packs (`worker/profiles/`); `evaluate()` itself unchanged |
| `worker/discovery.ts` `familyOf()` | role families per id | a config's families registered in `EXTRA_FAMILIES` |
| `worker/discovery.ts` `persist()`, `backfillClient()` | `evaluate()` | the registered profile scorer (`setProfileScorer`), config read from `candidate_profile_configs` |
| `scripts/dataset_apply.mjs`, `scripts/prescore.mjs` | `evaluate()`, `placeBand(id)` | `scoreCandidate()`, `bandFor()` |
| `scripts/shortlist_select.mjs` | Farhan's home-place rule for Worth a try, `BAND_MINIMUMS`, `TIER_SIZE`, `placeBand(id)` | `place_ok`, `bandMinimumsOf()`, per-person tier size, `bandFor()` |
| `scripts/taste_rules.mjs` | families by id | through `familyOf()` (registered families) |
| `engine/dataset_discovery.py` | profiles for built-in ids and clients only | `profile_plan.plan()` for a config; `max_rows`, `max_selected` |
| `engine/jobsite_discovery.py`, `engine/more_sources.py` | per-id `QUERIES`, `WORKABLE_PLACES`, `EURES_TERMS`, `ADZUNA`, remote-only flag | the profile's `jobspy`, `workable`, `workable_places`, `eures`, `adzuna`, `boards` |
| `worker/index.ts` | client delete list | also deletes `candidate_profile_configs` |

**Left hard-coded on purpose** (each still works for a new person, or only concerns the two built-in people):

| Where | Why it stays |
|---|---|
| `worker/index.ts` `CANDIDATE_FACTS`, display titles, strategy percentages, weekly research target, pay line, `isSana` profile text | the built-in people's own facts: privacy phase |
| `worker/clients.ts` `BUILTIN_IDS` | visibility and the delete guard of the two built-in people (by design) |
| `scripts/dataset_apply.mjs` `PROFILE` lines | the built-in people's summary text: privacy phase |
| `engine/dataset_discovery.py` `BUILTIN`, `PLACE_SETS`; `engine/more_sources.py` `FM_CANDIDATES` | hand-tuned tables of the built-in people (a config uses its own lists) |
| `scripts/shortlist_select.mjs` `placeOut` (#238, Farhan's place facts) | India-specific fact reading; could follow `remote_from_country(IN)` later |
| `engine/collector_importer.py`, `engine/staging_bridge.py`, `engine/daily_message.py`, `scripts/rescore_ranking_v2.mjs`, `scripts/post_deploy_smoke.mjs`, `.github/workflows/undo-changes.yml` | the old collector, the staging bridge, the phone message and one-off or smoke scripts for the built-in people |
| frontend: `App.tsx`, `Navbar.tsx`, `seeker/format.ts` (`PEOPLE`), `DashboardOverview.tsx`, `ProfileModal.tsx`, `AnalyticsView.tsx`, `ReadyDashboardView.tsx`, `IndiaRemoteView.tsx` | the seeker page's person picker lists the built-in pair. Listing people from `/api/candidates` instead is a decision about who may see whom (private clients reach their page by share link), so it waits for the privacy phase; a client already has a page through `/app#view=<token>&candidate=<id>` |

What this design leaves for later:
* **Privacy**: `CANDIDATE_FACTS` and the built-in summaries in `worker/index.ts`, `dataset_apply.mjs`'s profile lines and the migrations'
  skills can move into `candidate_profile_configs` (the config already has room: `display_name`, and any further fields are ignored by
  the scorer) without touching the scoring code. The equivalence test is the safety net for that move.
* **Plans**: per-person caps (`max_rows`, `max_selected`, `tier_size`, search counts) are config fields, so a plan can set them.
* Client search profiles (`client_profiles.search_profile`) keep the old path; a client moves to the packs by getting a config.
* The Worker cron's collector assessment (`assessBacklog`) scores only the two built-in people and stays on the old path.
