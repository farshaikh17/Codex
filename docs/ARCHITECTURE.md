# Architecture (current)

```
employers.json + sources.json ──registry.py validate──> enabled sources
                                         │
GitHub Actions hourly tick ──> collect.py --trigger schedule
                                         │ due_sources(): last checked_at + poll_interval_hours (15 min slack)
                                         ├─ none due ──> "skipped" job summary, exit 0, no requests, no file changes
                                         └─ due ──> one HTTPS GET per due source (no redirects, host-pinned, 25 MB cap, 2 s spacing)
                                                     adapters.normalize ──> public jobs + content_hash + change
                                                     staged in .collect-staging-*/, then moved: boards → index.json → status.json
                                         publish step commits public/ (also after failures)
```

Principles:
- `sources.json` stays a JSON list of source objects, because the posting store in farshaikh17/Codex#2 iterates it as a list. Employer facts are in `employers.json`, so editing them doesn't trigger a collection.
- Collection never decides eligibility, fit or READY. Downstream assessment (backlog E3–E5) is separate and per candidate.
- The registry holds public employer facts. Candidate preferences can't be stored in it: unknown keys are rejected.
- Official ATS JSON feeds come first. Browser capture (PR #1) is a manual fallback for employers without a feed.
- A failed source keeps its previous jobs with their original `observed_at`. Absence from a feed is reported (`no_longer_listed`). It is not treated as closure.
- Not-due sources are carried forward without requests. Their status entry is the latest real attempt, copied unchanged, with `attempted_this_run: false`. Their jobs are marked `change: not_checked` so they aren't reviewed again.
- Downstream: farshaikh17/Codex#2 (`engine/store.py`) ingests `status.json` and the boards into an SQLite posting store with version history. It is the storage layer for assessment and review queues.
- One run is one `run_id`, written to every board file it produced and to `index.json` and `status.json`.

Concurrency: the workflow uses concurrency group `public-job-collection`. Local runs take an `flock` on `.collect.lock`. The publish step rebases onto the current branch and pushes without force.

Dependencies: Python standard library only for collection. Crawl4AI is confined to PR #1's `requirements-crawl.txt` and workflow.
