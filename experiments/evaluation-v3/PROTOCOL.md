# Evaluation v3 protocol (fixed before the repair was written)

Corpus: the frozen collector snapshot `public/boards` at commit `09fa535e` (16 boards, 818 records; SHA-256 of
every file matches `experiments/evaluation-v2/input-manifest.json`). The 454 extra v2 records were never committed
and cannot be reproduced; one of their sources (Ramboll via SmartRecruiters) is disallowed by that host's
robots.txt, so it is not re-fetched.

Sample: `sample_jobs.py`, seed 20261030, broad public title pools (wider than any implementation's rules), 40
development and 20 holdout jobs per candidate, distinct posting identities. No implementation output is read
when sampling or labelling. Holdout labels are used once, after the repair is final.

Labeller: one reviewer (Claude, the same agent that implements the repair) reading each job's dossier
(`dossiers/<candidate>.md`: title, employer, structured locations, workplace field, description length,
location/remote/authorisation/relocation sentences, mandatory requirement lines, pay lines). This is not an
independent recruiter review; it is a documented, reproducible label set for comparing implementations.

## Labels per job

- `relevance`: `target`, `adjacent` or `not_relevant`, from the candidate's public discovery strategy below.
- `hard_blocker`: a documented, genuine incompatibility stated by the posting, or `none`.
- `unknowns`: unresolved items (skills, tools, certifications, years, geography, pay) that need review. An
  unknown is never a blocker.
- `expected`: `review` (relevant and no hard blocker: must stay reviewable), `exclude` (hard blocker), or
  `not_queued` (not relevant).

## Farhan (strategy: discovery effort, not quotas)

Target: CRM / GoHighLevel configuration, workflows and automations, API/webhook diagnostics, implementation and
onboarding delivery, QA/UAT, delivery coordination. Adjacent: business systems, automation, technical operations,
solutions/professional-services delivery, credible AI implementation or technical product ownership.
Not relevant: software engineering requiring deep independent coding, data science, infrastructure/security,
mechanical/electrical/industrial engineering, finance, marketing, recruiting, quota sales, support-first roles.

Hard blockers (documented rules only): an explicit onsite or hybrid arrangement; the posting limits the role to
places outside India (structured locations all outside India without remote-anywhere scope, or explicit foreign
residency/work authorisation required); support-first/helpdesk primary duty; pure quota-carrying sales.
Not blockers (unknown, reviewable): SQL, specific tools, certifications, EDI/EPM, years of experience, seniority,
missing India evidence for remote/worldwide/APAC wording (insufficient, so unresolved), pay.

## Sana (separate policy; not assumed to exist in any earlier engine)

Target: power/utilities technical consulting, industrial energy efficiency, energy-transition/decarbonisation
delivery, asset performance/reliability advisory, efficiency implementation, technical projects, electrical
maintenance/planning, reliability, industrial utilities, commissioning of electrical/power systems. Adjacent:
other physical-engineering field/project roles where electrical/plant experience transfers. Not relevant: software,
data, IT, sales/BD, marketing, finance, HR, purely mechanical design/drafting with no electrical/plant link.

Geography: Indian cities preferred; other Indian locations, India-engaged remote and overseas relocation are
possible, so an overseas location is unresolved (relocation/authorisation not established), not a blocker.
Hard blockers: a genuinely mandatory credential the profile does not establish where the posting says it is
required by law/regulation (e.g. a mandatory master's degree or BEE certified energy auditor/manager), and an
explicit statement that only existing residents/citizens of another country can be hired.
Not blockers: SAP/CMMS/PLC/modelling tools, certifications described as preferred, years, pay, site load/shifts.

## Metrics

Per implementation and candidate, on the same jobs: wrongly excluded (expected `review`, implementation
excludes or withholds from its review queue), unsuitable recommendations (implementation queues for review but
expected `exclude` or `not_queued`), agreement, plus duplicate/grouping behaviour and source concentration on the
full 818 corpus. Software tests and title relevance are not recruiter acceptance.
