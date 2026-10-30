# Engine v2: career matching and qualification states (branch engine-v2/career-matching)

Built on draft PR #16 (`5991a18`) with PR #15 (discovery/role-search-career-pages) merged in. Not merged to main;
no workflow or schedule change. Candidate profiles stay private (outside Git; `JOB_ENGINE_CANDIDATES`).

- `engine/match.py`: requirement-by-requirement matching of each JD against the private career history
  (experience items: skills, domains, functions, evidence) plus transferable rules. Phrase weights by rarity across
  the batch; a title naming a specialist profession the history does not evidence (software, SDE, database,
  designer, data scientist...) is capped below any min_fit. Titles never establish fit on their own.
- `engine/qualify.py`: per-candidate states REJECT / APPLIED / CLOSED / HOLD / NEEDS_REVIEW / PAY_UNKNOWN /
  HIGH_FIT / VERIFIED_READY / SCREENED from the existing gates plus the match. Unknown pay -> PAY_UNKNOWN;
  unresolved geography/arrangement -> NEEDS_REVIEW; only a gate failure with evidence rejects. Regional copies of
  one title at one employer are grouped with every requisition kept. Outputs are refused inside the repository.
  `python -m engine.qualify --candidates DIR --boards public/boards --extra himalayas.json --out DIR`
- `engine/gates.py` (GATES_VERSION 9): `explicit_country_required` (worldwide/region wording alone is unknown),
  `relocation_countries` (unknown, not fail), existing-foreign-work-rights statements (fail; unknown when an
  eligible place is also named). Consolidated from experiments/recruiter_triage.py v3.
- `engine/candidates.py`: profile keys experience, transferable, relocation_countries, explicit_country_required,
  preferred_cities; rules.match {min_fit, high_fit}. `engine/places.py`: QA, OM, KW, BH; Dubai/Abu Dhabi -> AE.
- `role_search.py`: `as_jobs()` turns Himalayas listings into collector-shaped jobs (full text, aggregator-reported
  pay); `python role_search.py OUT.json "query|country" ...` fetches within a request budget, robots-aware.
