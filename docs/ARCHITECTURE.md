# Architecture (current)

```
sources.json ──registry.py validate──> enabled sources
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
- Collection never decides eligibility, fit or READY. Downstream assessment (backlog P5/P6) is separate and per candidate.
- The registry holds public employer facts. Candidate preferences can't be stored in it: unknown keys are rejected.
- Official ATS JSON feeds come first. Browser capture (PR #1) is a manual fallback for employers without a feed.
- A failed source keeps its previous jobs with their original `observed_at`. Absence from a feed is reported (`no_longer_listed`). It is not treated as closure.
- Not-due sources are carried forward without requests. Their jobs are marked `change: not_checked` so they aren't reviewed again.
- One run is one `run_id`, written to every board file it produced and to `index.json` and `status.json`.

Concurrency: the workflow uses concurrency group `public-job-collection`. Local runs take an `flock` on `.collect.lock`. The publish step rebases onto the current branch and pushes without force.

Dependencies: Python standard library only for collection. Crawl4AI is confined to PR #1's `requirements-crawl.txt` and workflow.
