# Current-state handoff

Last updated: 2026-10-26 (branch `builderbranches`, backlog item P2).

## Status labels

Use exactly one of these per claim. Never substitute one for another.

- **Implemented and tested offline**: code plus passing local tests with fixtures; no network.
- **Live collection verified**: real requests to real sources produced correct output (state where: container, Actions branch, `main`).
- **Scheduled execution verified**: an Actions run with event `schedule` on `main` ran, and its outcome is visible in commits or summaries.
- **Consumer access verified**: the intended consumer (ChatGPT task) read the files, per CONSUMER_TEST.md.
- **End-to-end tracker ingestion verified**: data flowed from collection through the consumer into the tracker and was checked.

## State (2026-10-26 ~23:00 UTC)

Status labels as defined above. Exact heads are in `docs/COORDINATION.md` on `build/crawl4ai` (release report).

| Component | Where | Status |
|---|---|---|
| ATS feed collector on `main` | `main` `e812b42` | Live collection verified (push runs on `main`). Scheduled execution verified twice on the old hourly cron (07:55, 15:17). **Not yet verified on the owner's five-daily cron** (`562baaf`): the 21:37 UTC slot created no run |
| P2 registry and reliable runs, with #5 manifest | #3 `0c76b85` | Implemented and tested offline. Mixed-generation rejection verified with the real publish step in a scratch repo |
| E2a compensation inputs, with #8 Ashby tiers | #4 `c4e38fc` | Implemented and tested offline; live collection verified (container, scratch only) |
| H benchmark | #7 `2bae921` | Implemented and tested offline; labels partly provisional (below) |
| B discovery, E8 backoff | #10, #11 | Implemented and tested offline; **parked** |
| Store, extraction, gates, queue, outputs, Sheets interface | #2 `23922ab` (other session) | Implemented and tested offline; candidate policy provisional |
| Crawl4AI page fallback | #1 (other session) | Implemented and tested offline; live capture verified on its branch; no schedule |
| Consumer access (ChatGPT) | – | Interactive authenticated read works (GPT Master). **Automated consumer access not verified** |
| Tracker ingestion | – | Not verified. The Sheets adapter is a fake; no live Sheets writes |

## Provisional candidate-policy rules

None of these blocks integrating the collector, store or extraction. Each lives only in the candidate gates or the benchmark labels, and can be changed there alone. "Owner (direct)" means the owner told a worker session directly; the GPT Master has not recorded it.

| Rule | Source | In code now | Where | Affected tests and features |
|---|---|---|---|---|
| A bare `$` is USD on US-only postings | Owner (direct, per this session's notes); the GPT Master treated it as unverified | **No.** Removed in gates version 7 (`4cc3fce`) and in the benchmark (`2bae921`) | `engine/gates.py` `_currency`; `bench/score.py` `validate()` | `screening_cases.py` `bare_dollar_*`; bench labels `remote-us-only`, `range-spans-threshold`/cand-in, `already-applied`, `remote-unspecified`, `contract-role`/cand-us; acceptance real-snapshot READY path (`not_run` while the rule is off) |
| Commission-only pay fails a base salary floor | Owner (direct) | Yes (gates version 4, `897ddbe`) | `engine/gates.py` `commission_only` | commission-only screening cases; bench `commission-only` |
| Salary floors in several currencies, compared per currency | Owner (direct) | Yes (gates version 5, `877b6aa`) | `engine/candidates.py` config schema; `engine/gates.py` | `test_salary_floors_one_per_currency`; bench cand-in floors; `bench/engine_adapter.py` |
| Pay limited to residents elsewhere is not compared | Owner (direct), with the multi-currency rule | Yes (gates version 5) | `engine/gates.py` `residency_limit` | `residents_of_us_only_not_compared` |
| Amounts in millions or billions are never pay | Owner (direct) | **No.** Replaced in gates version 8 / extractor version 4 (`23922ab`) by a context rule (company figures are not pay; real pay in millions is), per the owner's completion instruction | `engine/extract.py` `COMPANY_FIGURE` | `CompanyFigureAndCodedDollarTests`; `company_revenue_not_pay`, `real_pay_in_millions` |
| Employer-published estimates are provisional evidence, never deciding | GPT Master decision | Yes (gates version 7, `640a8fb`) | `engine/gates.py` `EMPLOYER_ESTIMATE` | `EstimateTests`; `employer_estimate_*` cases |
| GitLab and Zapier benchmark cases confirmed | Owner (direct) | Yes (`human_confirmed`) | `bench/fixtures/cases.json` | gating metrics in `bench` |
| Careers URLs (Oyster, Zapier, Weave, Clipboard) and allowed hosts | Owner (direct) | On #10 only (parked) | `employers.json` on #10 | #10 tests |

Until the owner and the GPT Master settle these against the canonical Sheets, treat every salary pass, fail or READY as provisional.

## Next

1. The owner reviews and merges, in order: #1, #3, #4, #2, then #7 (see the release report in `docs/COORDINATION.md` on `build/crawl4ai`). #5, #6, #8 and #9 are folded in and can be closed. #10 and #11 stay parked.
2. Confirm that the five-daily cron fires on `main`. The first slot was 21:37 UTC; the next is 01:37 UTC.
3. The owner and the GPT Master settle the provisional rules above against the canonical Sheets.
4. Run CONSUMER_TEST.md for automated consumer access.
