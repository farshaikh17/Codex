# Experiment repair v3 — restoring the established review semantics (30 October 2026)

Branch `experiment/recruiter-triage-v1`, draft PR #16. Not merged, not deployed, no workflow or schedule change.
Software validation, frozen-corpus review and recruiter acceptance are separate claims; only the first two are made.

## 1. Baseline availability (what could and could not be recovered)

The attached LOCAL AI Workers archive (engine at `bcce88782120fc8e46cc31c4c8000a7314e8cdea`, `RECOVERY-CHECKPOINT.md`,
`OPERATOR.md`, `README-EFFICIENCY.md`, the 87/87 offline test log, the 24 October run record) was **not present** in
this session: `/mnt/attach` and `/mnt/user-data/uploads` were empty, no repository branch contains those files or
that commit, and no computer folder was shared with the session. Therefore:

- The 87 baseline tests were **not reproduced**, and its wrapper/builder-policy configuration was **not traced**.
- Its DuckDB storage, review receipts, caching and incremental public-review queue were **not inspected**; nothing
  below claims how that engine behaved. The six-request / four-selection / one-completed October 24 run is not
  re-verified.
- The comparison therefore uses the two implementations that exist in Git: the repository engine (`engine/`, the
  established GitHub workflow documented in `docs/ENGINE.md`) and the experiment (`experiments/`, v1 `fea7e5c`, v2
  `a2458ea`). Codex can repeat the local-engine comparison once the archive is available.

## 2. Comparison tied to code

| Behaviour | `engine/` (established) | experiment v2 `a2458ea` | v3 repair |
|---|---|---|---|
| Evidence | `engine/extract.py`: full description split into mandatory/preferred sections, verbatim quotes, field states | own regexes over sentences | reuses `engine.extract.extract` |
| Separate states | `engine/gates.py`: geography, engagement, qualifications, salary, application_history, each pass/fail/unknown | one `shortlist_eligible` boolean mixing relevance, eligibility and qualification gaps | `evidence.states` = relevance / eligibility / qualifications / pay / application_history |
| Unknown qualification | never a fail; `qualifications()` returns unknown until a reviewed decision | SQL, certification, EPM, EDI, 12+ years, director titles, design tools set a "gap" that withholds the job (`recruiter_triage.py` v2 `gaps`, `shortlist_eligible ... and not gaps`) | listed in `qualification_gaps`; job stays in the review queue |
| Relevance | `relevance()`: "priority only; never an exclusion" (`below_relevance_threshold` routing) | `role_match` family `outside target` → `REJECT` (`blocks.append('excluded role family')`) | `outside target` → queue `below_relevance`, status HOLD |
| Geography | `geography()`: clause-level, negation-aware, union of listed places (`engine/places.py`) | country regex list; India only from location or two phrasings | reuses `engine.gates.geography`; Farhan additionally requires India named (APAC/worldwide alone = unresolved) |
| Contradictory residency | negated/conflicting statements → unknown | foreign authorisation + India → withheld | existing foreign work rights + India named → unresolved for manual review; without India → hard blocker |
| Readiness | `ready` only if every required gate passes with evidence | HOLD/REJECT only; "shortlist" = preliminary list | HOLD/REJECT only; shortlist = review queue (tier A clear evidence, tier B unresolved); never READY |
| Requisition identity | `posting_id` = `provider:board:req_id`; canonical URL for duplicates | exact canonical URL; same-title groups keep variants | unchanged (`recruiter_dedup.py`): different requisitions are never merged; variants keep their own evidence |
| Source failure / freshness | store availability states; `freshness()`; failed sources keep jobs as inaccessible | board files read with no source status | `status.json` health attached; failed-source jobs flagged last-known-good |
| Review completion across runs | durable review queue keyed on (candidate, posting, content hash, rules version) (`engine/review.py`) | none: every run re-presents everything | `review_key` = hash(candidate, posting key, content hash, rules version); `--completed` private receipts (refused inside the repo) skip completed reviews; content or rules changes make them due again |
| Candidate isolation | private config outside Git, synthetic fixtures only | per-candidate branches in one function | separate `POLICIES` entries; test proves an onsite India job is reviewable for Sana and rejected for Farhan |
| Discovery source | collector only (`sources.json`) | `discover_public.py` calls the SmartRecruiters API | SmartRecruiters disabled: its robots.txt disallows all agents except LinkedInBot (decision on main, 2026-10-27) |

Not copied: DuckDB storage (the GitHub engine is SQLite by documented decision), the production collector, any
private profile, pay floor or application history.

## 3. What was restored and why

1. **Relevance never rejects** (`candidate_match.py`, `recruiter_triage.py`). v2 rejected 801/818 Farhan records,
   mostly through `excluded role family`, including AI/automation/CRM product ownership, programme management,
   enablement and GTM operations that are in Farhan's documented adjacent strategy. Title checks now order
   specialist professions before CRM/automation keywords (so "Software Development Engineer II - CRM" stays low) and
   admit product roles only when the product is automation, integration, CRM or AI.
2. **Unknown qualifications stay reviewable.** SQL, certifications, EDI/EPM, named tools, years and seniority are
   listed as checks from mandatory requirements (or the unsectioned description, excluding preferred sentences).
   Only documented hard rules reject: Farhan onsite/hybrid, all-foreign locations, existing foreign work rights,
   support-first and quota-sales titles; Sana existing foreign work rights / citizenship-only, and a genuinely
   mandatory master's degree or BEE certification.
3. **Sana's distinct policy** (new, not assumed from any earlier engine): overseas locations are unresolved
   (relocation possible), onsite/hybrid is a preference note, pharma/bioprocess specialisms are outside her families,
   and "(Cx)" is commissioning while "CX Platform" is software.
4. **Engine evidence reuse**: `engine.extract`, `engine.gates.geography`, `engine.places` — no new storage.
5. **Receipts, source health and SmartRecruiters** as in the table.

Defects found and fixed during evaluation (each with a test): leading-bullet "· Eligible to work in Ireland",
"either an SGP citizen or a PR holder", product titles caught by the `marketing` profession rule, "CX" read as
commissioning, preferred sentences counted as requirements.

## 4. Reproduce

```sh
git checkout experiment/recruiter-triage-v1
git archive 09fa535e public/boards | tar -x -C /tmp/frozen          # 818 records; hashes in evaluation-v3/corpus-09fa535e.sha256
python -m unittest discover -s experiments -p 'test_*.py' -v         # 76 tests (Python 3.11 and 3.13)
python -m unittest discover -p 'test_*.py'; python -m unittest discover -s engine/tests -t .   # 264 + 153
python experiments/evaluation-v3/score.py experiments /tmp/frozen/public/boards experiments/evaluation-v3/labels.json dev,india
python experiments/evaluation-v3/score.py experiments /tmp/frozen/public/boards experiments/evaluation-v3/labels.json holdout
# v1/v2: git archive fea7e5c experiments | tar -x -C /tmp/v1 (or a2458ea → /tmp/v2) and pass /tmp/v1/experiments
python experiments/weekend_trial.py --boards /tmp/frozen/public/boards --candidate farhan --limit 50
```

## 5. Same-corpus review evidence (frozen 818 records)

Protocol, sample and 153 labels were committed and pushed **before** the repair (`7d12a24`). Labeller: the
implementing agent, from posting-only dossiers; not an independent recruiter. Nine labels were corrected after a
dossier regex bug hid authorisation sentences (`label-corrections.json`; applied uniformly by re-scanning every
labelled job; scores with original labels are in `summary.json`). Holdout scoring happened once, after the repair.

"Selected" = put in front of a reviewer (v1: top-50 HOLD; v2: preliminary list; v3: review queue).

| Set (corrected labels) | v1 `fea7e5c` | v2 `a2458ea` | v3 repair |
|---|---|---|---|
| Farhan dev + India stratum, 16 reviewable | 2 selected, 14 wrongly excluded, 4 unsuitable, 0/13 blockers rejected | 0 selected, **16 wrongly excluded**, 0 unsuitable, 12/13 | **16 selected**, 0 wrongly excluded, 0 unsuitable, 12/13 |
| Farhan holdout, 2 reviewable | 1, 1, 0, 0/7 | 0, 2, 0, 6/7 | 1, 1, 0, 7/7 |
| Sana dev + India stratum, 11 reviewable | 5, 6, 7, 0/10 | 3, 8, 0, 0/10 | **10**, 1, 0, 10/10 |
| Sana holdout, 5 reviewable | 4, 1, 5, 0/6 | 1, 4, 0, 1/6 | **5**, 0, 0, 6/6 |

Examples v2 wrongly excluded (all now reviewable, unknowns listed): Resilinc *Director, Professional Services*
(India remote; seniority), Drivetrain *Business Analyst - Customer Platform* (SQL), *GTM Operations* (HubSpot/Zapier
automation), HighLevel *Principal/Staff PM - Voice AI* (12+ years), *Sr. PM - Marketing OS, LeadGen* (APIs, webhooks,
CRM integrations), GitLab Bangalore *Technical Program Manager*; Sana: CAI electrical commissioning roles in Europe,
Australia and Tokyo (overseas = unresolved, not excluded) and CAI's India *Commissioning (Cx) Manager* (15+ years).

Remaining errors: Farhan holdout Oyster *Service Delivery Automation Analyst* (EMEA listing vs company-wide
work-from-anywhere wording; v3 rejects on the listing, the label said unresolved); Sana dev CAI Tokyo *Senior Process
Engineer* (bioprocess rule). One Farhan hard blocker is not rejected as such (HighLevel *Product Solution Engineer*,
support-heavy duties without a support title); it is routed `below_relevance`, so it is not recommended either.

**Every repaired recommendation audited** (pre-registered plus post-hoc labels, `posthoc-recommendation-labels.json`):
Farhan review queue 28 = 26 relevant, 2 unsuitable (Clipboard document-onboarding associate, APAC/Philippines;
HighLevel B2C/Events PM). Sana queue 19 = 18 relevant, 1 unsuitable (Cognite Seoul field engineer requiring Python).

Shortlists (limit 50, 20% employer cap, never padded): Farhan **24** (20 tier A India-explicit and remote, 4 tier B),
shortfall 26; HighLevel 10, Drivetrain 5, six other employers. Sana **12** (5 tier A India onsite commissioning, 7
tier B overseas), shortfall 38; **CAI supplies 10 of 12** — the corpus has almost no other physical-engineering
employer. v2's shortlists on the same corpus: Farhan 0, Sana 4 (all CAI).

Grouping: 0 exact canonical-URL duplicates in 818 records; 715 same-title groups. Groups keep every requisition:
e.g. Drivetrain *Solutions Consultant - FP&A* has India, Europe, US and Canada variants; the India one represents the
group on its own evidence and the others keep their own REJECT reasons.

## 6. Validation, live collection, recruiter acceptance

- **Software validation (done):** 76 experiment tests, 264 root and 153 engine tests pass; same frozen corpus for
  every version.
- **Live collection (not done here):** no network collection was run for this repair; the 454 v2 extra records were
  never committed and cannot be replayed; SmartRecruiters is no longer fetched.
- **Recruiter acceptance (not established):** labels are one implementing reviewer's reading of public text.
  Eligibility, pay, application history and qualifications still need the private Sheet review; nothing is
  READY. The v2 68%→84% / 48%→60% figures remain broad role-domain audits, not matching accuracy.
