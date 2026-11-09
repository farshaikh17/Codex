# Hourly QA schedule, 2026-11-09 (Claude). Technical QA only.

Rule from the owner: the engine never decides whether a job is suitable; the owner does. Production is read-only for QA; deploys only on the owner's say-so.
Each hourly run takes the first unchecked segment, does it, fixes technical defects on branch `ccr-31e055c3-e2y6ub` (with a test), and records
result + evidence here. Before each run: `git fetch`, look at `origin/main` and the `codex/*` branches (ChatGPT's work) and avoid their files.

| # | Segment | Status | Result / evidence |
|---|---|---|---|
| 1 | Worker API: every route's auth, validation, error paths, response shapes | [ ] | |
| 2 | D1 quota and usage: live account reads/writes today (Cloudflare, read-only), budget guards, query costs | [ ] | |
| 3 | Pipelines: last runs of collect, sync, discovery, watchlist, release; failures, drift, concurrency | [ ] | |
| 4 | Data integrity: re-score sample (30 rows per candidate), stale/duplicate/closed rows, guards on applications | [ ] | |
| 5 | Python engine: collectors, dataset discovery, liveness, JobSpy block handling, tests under fault injection | [ ] | |
| 6 | Frontend: every screen desktop and 375 px, filters, pagination, modal, empty and error states | [ ] | |
| 7 | Security and privacy: public API field leaks, CORS, headers, share links, rate limits, secrets in repo | [ ] | |
| 8 | Reliability: outage behaviour, retries, cron under load, idempotency of every import and migration | [ ] | |
| 9 | Reselling readiness: onboarding a new client end to end, isolation, limits, deletion of a client's data | [ ] | |
| 10 | Accessibility and performance: keyboard, contrast, page weight, API latency | [ ] | |
| 11 | Open decisions and merge state: outage backup, profile line, `codex/*` branches vs this branch, conflicts | [ ] | |
| 12 | Final regression: full test suites, browser suites, notes compared with ChatGPT's, summary for the owner | [ ] | |
