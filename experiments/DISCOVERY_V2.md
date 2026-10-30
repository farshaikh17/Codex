# Candidate discovery experiment v2

This manual, read-only experiment lives only on `experiment/recruiter-triage-v1`.
Do not merge it, enable schedules, or use its outputs as application decisions.

## Run

Python standard library only. No keys, paid APIs, AI services, applications or messages.

```sh
python -m unittest discover -s experiments -p 'test_*.py' -v
python experiments/discover_public.py --output evaluation-v2/new-boards
python experiments/weekend_trial.py --candidate farhan --limit 50
python experiments/weekend_trial.py --candidate sana --limit 50
```

Discovery explicitly fetches the curated public employer feeds in `experiments/discovery_sources.json`. The source registry explains candidate-specific reasons. It does not change the production `sources.json`. Greenhouse and Lever feeds are read in full within a 15 MB response bound. SmartRecruiters is India-only and bounded to two 100-record pages; its board artifact records the total and whether truncated. Errors are recorded and never replaced with invented jobs. No anti-bot bypass or paid fallbacks are used.

To reproduce a before/after evaluation, obtain the experiment Python files from baseline commit `fea7e5c8af29b920089a9636b6ae3d4369365041` in a separate local directory named `before-v2`. Keep the same `public/boards` snapshot for both versions. Then:

```sh
python experiments/evaluate_discovery.py --baseline before-v2 --boards public/boards --new-boards evaluation-v2/new-boards --output evaluation-v2/results
```

The test run on October 30 fetched 454 records from eight additional employers and evaluated the combined 1,272-record corpus for each candidate. See `DISCOVERY_V2_RESULTS.md` for results and limitations.

## Output meaning

- `sample`: up to N diagnostic review groups, including rejected jobs when necessary for testing. This is NOT a suitable-jobs list.
- `shortlist`: only role-relevant groups that clear the preliminary geography, arrangement and known qualification-gap gates. It is not padded to N. Every item remains HOLD.
- `shortfall`: the honest gap between N and the number of preliminary review groups found.
- `evidence`: advertised geography/arrangement, qualification gaps and selected supporting excerpts. Evidence remains attached to the original regional posting.
- `variants`: separate same-employer/same-title requisitions. These are grouped for review, not declared the same vacancy. The representative is chosen using its own evidence; eligibility is never combined across regions.
- `exact_url_duplicates`: true canonical-URL duplicates only. Tracking parameters, Lever `/apply`, and Greenhouse host aliases are normalized. Different requisition IDs are retained.

Selection caps one employer at 20% of the requested size (minimum two). No unrelated jobs are added to achieve source diversity. The available shortlist may still come from one employer.

## Candidate and eligibility boundaries

Role families separate business-systems delivery from generic CRM/product/software titles and physical energy/reliability from software infrastructure. Descriptions support role-specific geography and requirements; company-wide remote boilerplate is insufficient. Overseas authorization and relocation remain unestablished unless the supplied record establishes them. Farhan's fully remote requirement is enforced; Sana's onsite work is flagged for preference review rather than automatically excluded.

Specialist software, certifications, EDI, SQL, design disciplines and unusually high experience requirements can hold a job out of the preliminary shortlist. These are conservative evidence gaps, not assertions that the candidate cannot learn or perform the job. The full HOLD diagnostic output remains available so false exclusions can be reviewed.

The optional `minimum_fixed_annual_inr` argument to `triage()` accepts a caller-supplied private floor and only compares explicit fixed INR annual amounts. The batch CLI deliberately does not guess a private floor, FX rate or unstated salary. No actual compensation was verified in this run.

No private CV, contact information, compensation preferences or application ledger is persisted by the experiment. Runtime discovery uses role-family preferences, not the candidates' private documents.
