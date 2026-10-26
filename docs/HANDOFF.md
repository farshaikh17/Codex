# Current-state handoff

Last updated: 2026-10-26 (branch `builderbranches`, backlog item P2).

## Status labels

Use exactly one of these per claim. Never substitute one for another.

- **Implemented and tested offline**: code plus passing local tests with fixtures; no network.
- **Live collection verified**: real requests to real sources produced correct output (state where: container, Actions branch, `main`).
- **Scheduled execution verified**: an Actions run with event `schedule` on `main` ran, and its outcome is visible in commits or summaries.
- **Consumer access verified**: the intended consumer (ChatGPT task) read the files, per CONSUMER_TEST.md.
- **End-to-end tracker ingestion verified**: data flowed from collection through the consumer into the tracker and was checked.

## State

| Component | Status |
|---|---|
| ATS feed collector on `main` | Live collection verified (Actions push runs on `main`). Scheduled execution verified once: run [40288776346](https://github.com/farshaikh17/Codex/actions/runs/40288776346) (event `schedule`, 07:55 UTC on 2026-10-26, pre-P2 code) collected and committed 456397a. The hourly ticks 02:23–06:23 created no runs at all, and this tick started 32 minutes late. GitHub's schedule is best-effort, so freshness checks matter. |
| Registry + validation + reliable runs (this branch) | Implemented and tested offline (28 tests). Live collection verified in this container against all 10 feeds (scratch output, not committed). Not run in Actions yet: the push trigger is now `main` only, so this branch runs no collection. |
| Posting store (PR #2, other session) | Implemented and tested offline (per its PR). Ingest of this branch's outputs checked offline in a three-way merge. Unmerged. |
| Crawl4AI page fallback (PR #1) | Implemented and tested offline. Live collection verified on `build/crawl4ai` via Actions push runs. Unmerged. No schedule. |
| Consumer access (ChatGPT) | Not verified. |
| Tracker ingestion | Not verified; out of scope. |

## Next

1. Review and merge PR #1, PR #2 and this PR (farshaikh17/Codex#3) in any order. A local three-way test merge was clean, and all suites passed on the merged tree.
2. After merge, dispatch *Collect public job feeds* once and confirm the job summary table. Then watch for the first `schedule` event run.
3. Run CONSUMER_TEST.md from the original chat.
4. Decide on P10 (cron frequency).
5. Compensation inputs (E2a): stacked PR on `builderbranches-compensation`. Retarget it to `main` once #3 merges.
6. E2 (evidence records) and E3+E4 (candidate config and gates) are being built in the PR #2 session. The H benchmark (`builderbranches-benchmark`, stacked on E2a) is how they get measured: `python -m bench score`. Two real-posting labels need a person to confirm them.
