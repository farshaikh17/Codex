# Discovery repair results — October 30, 2026

Branch: `experiment/recruiter-triage-v1`. Draft PR #16 remains unmerged.
Baseline: `fea7e5c8af29b920089a9636b6ae3d4369365041`.

## Outcome

Software validation passes. Discovery and filtering are more explicit, but the experiment does **not** pass a complete recruiter acceptance test. No job is verified READY. The strict preliminary review list contains **0 Farhan jobs and 4 Sana jobs**. The four Sana jobs are site-heavy commissioning roles at CAI, not proven matches to the preferred advisory/office direction. Pay, precise commissioning experience and working conditions remain unverified.

The original Google Sheet was read, including all 60 tested decisions, and preserved as the earlier snapshot. No spreadsheet, application tracker, private profile, production file, schedule, application or outreach was changed.

## Executed tests

- CPython 3.14.6 on Windows. Python 3.11/GitHub Actions was not executed.
- `python -m unittest discover -s experiments -p 'test_*.py' -v`: **54/54 passed**, including the original 21 tests.
- Baseline and repaired versions each processed the same **818 committed real records**, then produced **50 diagnostic decisions per candidate**.
- Eight new free employer feeds supplied **454 additional real records**, making **1,272 records across 24 feeds per candidate** in the expanded test. All eight sources succeeded. Ramboll's India query returned all 105 advertised feed records within the 200-record bound; it was not truncated.
- Both repaired 818-record and expanded 1,272-record results were repeated for each candidate with identical output. The final duplicate-conflict test adds no changes to these corpora, which contain zero exact canonical-URL duplicates.
- The published artifacts include 200 labelled review rows: 50 before and 50 after for each person. These contain repeated jobs across the before/after lists; they are not 200 different vacancies. All four lists individually contain 50 distinct job identities.

## Before/after broad relevance on the SAME 818-record input

| Candidate | Baseline relevant in top 50 | Repaired relevant in top 50 | Change |
|---|---:|---:|---:|
| Farhan | 34/50 (68%) | 42/50 (84%) | +16 percentage points |
| Sana | 24/50 (48%) | 30/50 (60%) | +12 percentage points |

This is a **single-reviewer, post-change broad role-domain audit**, not a blind or held-out qualification benchmark. The reviewer is the same agent that implemented the changes. Labels are explicit, keyed to each reviewed posting, and are not calculated from the engine's score. Farhan's broad label includes adjacent technical delivery, professional services and solutions roles, but excludes explicit presales, clerical forms/documents work and unrelated professions. Sana's broad label includes transferable physical engineering, reliability, utilities and commissioning, including one energy forecasting role in the baseline. These broad labels do not establish relevant specialist skills, seniority, salary, country eligibility or actual desirability.

The diagnostic top 50 intentionally contains rejected jobs when needed to exercise and review the filters. It must not be presented as 50 qualified leads. Only the separate, unpadded `shortlist` is an initial review queue, and every member remains HOLD.

## Filtering and shortlist results

| Candidate | Baseline classifications, 818 records | Repaired classifications, 818 records | Expanded classifications, 1,272 records | Expanded preliminary review list |
|---|---|---|---|---:|
| Farhan | 789 HOLD, 29 REJECT | 17 HOLD, 801 REJECT | 25 HOLD, 1,247 REJECT | 0 |
| Sana | 818 HOLD | 39 HOLD, 779 REJECT | 92 HOLD, 1,180 REJECT | 4 |

Many HOLD jobs remain outside the preliminary review list because of unresolved geography, remote-work evidence, specialist requirements or low relevance. REJECT means exclusion by this experiment's target rules, not an employer decision or proof that the person could never do the work. The high rejection volume is not itself a quality metric. False negatives remain possible, especially with unfamiliar titles or incomplete descriptions.

Specific problems corrected:

- Product-manager CRM keywords, software/industrial automation and software/network reliability no longer substitute for the intended profession.
- Remote US/Canada jobs are not treated as India-eligible. Job-specific authorization excerpts are exposed. Conflicting India/foreign-authorization evidence is withheld from the preliminary review list.
- Company-wide remote boilerplate does not prove a job is fully remote. Explicit onsite/hybrid arrangements exclude Farhan. Role-specific India/remote descriptions can supply evidence when structured location is incomplete.
- Regional salary notices remain separate from hiring restrictions. Preferred qualifications are not promoted to mandatory merely by nearby wording.
- Requirements now expose advanced SQL, EDI standards, certifications, specialist design tools/disciplines and unusually high experience demands. This caught unsupported seniority, 15–20-year requirements, EDI requirements and the SQL requirements on HighLevel revenue-operations roles.
- Double-escaped HTML is decoded before stripping tags; list and paragraph boundaries survive. This prevents requirements from being conflated with unrelated preferred qualifications.
- Missing/empty board directories still fail explicitly, and no salary/authorization/experience gaps can produce READY.

## Source diversity: improved coverage, still weak shortlist yield

| Added employer feed | Candidate focus | Real records fetched |
|---|---|---:|
| Workato, Greenhouse | Farhan: automation and implementation | 54 |
| Cleo India, Greenhouse | Farhan: integration delivery | 15 |
| Simpplr, Greenhouse | Farhan: SaaS implementation | 7 |
| Five9, Greenhouse | Farhan: business systems/integrations | 83 |
| Antora, Greenhouse | Sana: industrial heat/decarbonisation | 40 |
| Rondo Energy, Greenhouse | Sana: industrial energy | 14 |
| Commonwealth Fusion Systems, Lever | Sana: physical energy systems | 136 |
| Ramboll India, SmartRecruiters | Sana: India engineering/advisory | 105 |
| **Total** | | **454** |

These are directly retrieved public ATS records, not search snippets, synthetic examples or verified offers. New feed URLs are recorded in `discovery_sources.json` and local discovery logs. Original 818 records retain their October 29 collection dates; the 454 new records were retrieved October 30.

Coverage increased from 16 to 24 employer feeds, and the tested adapter families now include an India-filtered SmartRecruiters route. Source diversity is enforced in preliminary selection with a 20% employer cap, without filling with unrelated records. Actual useful diversity has **not** passed: all four surviving Sana review jobs are still from CAI, and Farhan has no survivor.

In the same-corpus diagnostic top 50, Farhan source count changed 9 to 10 and the largest source fell from 31 to 21 records. Sana source count worsened from 6 to 2 because the relevant remaining physical-engineering roles were concentrated at CAI. The expanded diagnostic samples cover 12 Farhan sources and 4 Sana sources. A source cap cannot create relevant, eligible opportunities that the available feeds do not contain.

## Deduplication

- Exact identity normalizes tracking query parameters, Lever `/apply` URLs and Greenhouse host aliases. All 1,272 current records had different canonical URLs, so **zero actual exact-URL duplicates** were removed.
- Same-employer/same-normalized-title records form a review group, with separate posting IDs, locations, decisions, reasons and evidence retained in `variants`. These are **not asserted to be duplicate vacancies**. The 818-record input forms 715 groups; the expanded input forms 1,123 groups.
- The representative is chosen using its own candidate eligibility evidence. An India regional posting cannot make a US variant eligible. Same-URL records with conflicting geography/arrangement are withheld for primary-posting review instead of combining eligibility.

## Remaining limitations and false-positive/false-negative risks

No live application forms were submitted, and current vacancy acceptance, compensation and employer-specific candidate suitability were not independently verified. Fresh feed presence alone is insufficient for READY. Advertised geography, a description word count and keyword families are imperfect evidence.

Farhan: Cleo's remote implementation posting has an explicit India location in its JD, but specialist EDI standards are not established by candidate evidence. HighLevel revenue-operations roles require advanced SQL. Product Solution Engineer is predominantly support-oriented. Those jobs remain diagnostic HOLDs rather than being advertised as successful matches.

Sana: the four retained commissioning roles are adjacent experience, onsite and potentially travel-heavy. Ramboll's tool/design/seniority demands were surfaced and withheld from the preliminary list. This avoids false positives but can exclude transferable opportunities where an employer would accept equivalent experience. The rules do not yet model that flexibility or all specialist-tool requirements. Overseas roles remain outside the preliminary list without established work permission or supported relocation.

Salary is unknown. The fixed-INR annual threshold helper only runs when a private caller supplies a floor; the batch test does not guess a private minimum, variable-pay basis, FX rate or unstated compensation. No private candidate documents or contacts are checked into the repository.

The next evidence needed for recruiter acceptance is a broader India-focused advisory/business-systems source pool plus independent primary-JD/pay and candidate-experience verification. This run does not justify a production merge.

## Review artifacts

`experiments/evaluation-v2/summary.json`, `manual-role-audit.csv`, `manual-role-audit.json`, `input-manifest.json` and `tests.log` preserve the published results and labels. The local downloadable archive additionally contains full baseline/fixed/expanded diagnostics, all 24 public board inputs, original baseline Python code and the readable HTML report with clickable posting links. The original Google Sheet remains unchanged as the earlier experiment snapshot.
