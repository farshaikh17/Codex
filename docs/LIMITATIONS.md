# Known limitations

- Ten feeds are a migrated coverage trial. Selection rationale wasn't recorded, so every employer's `inclusion.reason` says so. `careers_url`, `job_families` and `geography` are empty until verified with evidence.
- No relevance routing, eligibility assessment, review queue or candidate configuration exists yet (BACKLOG E3–E5). Nothing here marks a job READY.
- Compensation: Greenhouse feeds don't currently request `pay_transparency=true`, so Greenhouse compensation is missing even where the employer publishes it (measured: 106 GitLab jobs). Ashby compensation is requested for one board only. See E2.
- No evidence objects or extraction-quality warnings for ATS postings yet (E2). Descriptions are stored complete, but section structure (mandatory vs preferred) isn't separated.
- `no_longer_listed` reports disappearance from a feed after one successful fetch. It is not confirmed closure, and reopened requisitions aren't detected yet.
- Duplicate detection is per source and requisition id. Cross-URL duplicates are indexed by PR #2's canonical URL but aren't handled in review yet (H, E5).
- Scheduled execution has been verified once (07:55 UTC, 2026-10-26). GitHub dropped the five earlier hourly ticks and started that one 32 minutes late. Consumers must use the staleness rules in OUTPUT_CONTRACT.md.
- The owner's five daily runs each cost at least one runner minute (about 150 a month of the 2,000 free private-repo minutes), down from about 720 for hourly ticks.
- ChatGPT access to this private repository hasn't been verified (see OUTPUT_CONTRACT.md).
- The local lock uses `fcntl`, so local runs are POSIX only. Actions runs rely on the workflow concurrency group.
- Publication is atomic per file and ordered (status last). A reader of the working tree during the moves could see new boards with an old status, but git commits, which are what consumers read, are atomic.
