# Current-state handoff

Last updated: 2026-10-26 (branch `builderbranches`, backlog item P2).

## Status labels

Use exactly one of these per claim. Never substitute one for another.

- **Implemented and tested offline**: code plus passing local tests with fixtures; no network.
- **Live collection verified**: real requests to real sources produced correct output (state where: container, Actions branch, `main`).
- **Scheduled execution verified**: an Actions run with event `schedule` on `main` ran, and its outcome is visible in commits or summaries.
- **Consumer access verified**: the intended consumer (ChatGPT task) read the files, per CONSUMER_TEST.md.
- **End-to-end tracker ingestion verified**: data flowed from collection through the consumer into the tracker and was checked.

## State (2026-10-26, evening)

| Component | Where | Status |
|---|---|---|
| ATS feed collector on `main` | `main` | Live collection verified (push runs). Scheduled execution verified once: run 40288776346 (07:55 UTC). GitHub dropped the five earlier hourly ticks |
| P2 registry and reliable runs | farshaikh17/Codex#3 | Implemented and tested offline; live collection verified (local container). Not yet run in Actions |
| E2a compensation inputs | farshaikh17/Codex#4 (on #3) | Implemented and tested offline; live collection verified (local): +125 postings with employer-published pay |
| H benchmark | farshaikh17/Codex#7 (on #4) | Implemented and tested offline. 21 cases, 34 verdicts. Owner rules encoded (commission-only, multi-currency floors); real cases confirmed. Bare "$" rule removed by 2bae921, see below |
| B source discovery | farshaikh17/Codex#10 (on #7) | Implemented and tested offline; live discovery verified (local container: 6 runs over 16 employers, 51 requests through `discover.py`, plus 9 manual requests for the ownership checks). Verified `careers_url` applied for Oyster, Zapier, Weave and Clipboard |
| E8 collector backoff and budgets | `builderbranches-reliability` (on #10) | Implemented and tested offline. PR #2 ingest verified on a scratch merge |
| Posting store, extraction, gates, review queue | farshaikh17/Codex#2 and follow-ups #6, #9 (other session) | Implemented and tested offline (per that session). Scored here at 877b6aa: false READY 0, incorrect exclusions 0, salary 32/34 |
| Crawl4AI page fallback | farshaikh17/Codex#1 (other session) | Implemented and tested offline; live capture verified on its branch. No schedule |
| Follow-ups stacked on mine by others | #5 (on #3), #8 (on #4) | Merge cleanly with my branches; all suites pass on the combined tree |
| Consumer access (ChatGPT) | – | Not verified. Run CONSUMER_TEST.md from the original chat |
| Tracker ingestion | – | Not verified; out of scope |

## Merge order

#1 and #2 (with #6, #9) are independent of mine. Mine merge in order: #3 → #4 → #7 → #10. Retarget each to `main` after the one below it merges. #5 and #8 follow #3 and #4. After #3 merges, one `main` push triggers a full collection. Check its job summary. After #4 merges, expect about 125 `changed` postings with `changed_fields: ["compensation_raw"]`.

## Decided by the owner (2026-10-26)

- A bare "$" means USD only on US-only postings. Given directly by the user in this session, but commit 2bae921 (completion session) removed it from the benchmark as unverified. **Not applied in code now; waiting on the owner to say which stands.**
- Commission-only pay fails a base salary floor.
- Salary floors may be set in several currencies, compared per currency, never converted.
- The GitLab and Zapier benchmark labels are confirmed.
- Oyster, Zapier and Weave `careers_url` are applied. Clipboard's is applied on the owner's instruction, after ownership was verified.
- jobs.twilio.com is allowed. clipboard.com and resilinc.ai are allowed after ownership was verified.
- Five scheduled collections a day at 37 1,6,11,16,21 UTC, without the age-gate skip (owner's commit on `main`).

## Still open

1. Owner review and merge of the PR chain above.
2. CONSUMER_TEST.md from the original chat (consumer access).
3. P10 is done by the owner on `main` (562baaf): five daily runs, no age-gate skip. All four of my PRs were merged with it, and `poll_interval_hours` is now opt-in, so every scheduled run collects every source without its own interval.
4. PR #2 follow-up: US$ range parsing (the last salary disagreement in the benchmark).
5. Boards on JavaScript-only careers pages (GitLab, Remote, Twilio, Resilinc) can't be found from static HTML. That would need PR #1's browser capture, not discovery.
