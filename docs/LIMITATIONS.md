# Known limitations

- Ten feeds are a migrated coverage trial. Selection rationale wasn't recorded, so every employer's `inclusion.reason` says so. `careers_url` is verified for Oyster, Zapier, Weave and Clipboard only. `job_families` and `geography` stay empty until verified with evidence.
- No relevance routing, eligibility assessment, review queue or candidate configuration exists yet (BACKLOG E3–E5). Nothing here marks a job READY.
- Compensation is requested from every Greenhouse and Ashby feed. On 2026-10-26 it was present for GitLab 106/239, Clipboard 36/39, Zapier 12/12, Oyster 7/23 and Resilinc (Lever) 2/11, and absent for the other feeds. Absent means the feed didn't publish it; it doesn't mean the employer has no published pay elsewhere. `compensation_raw` is unparsed (E2).
- No evidence objects or extraction-quality warnings for ATS postings yet (E2). Descriptions are stored complete, but section structure (mandatory vs preferred) isn't separated.
- `no_longer_listed` reports disappearance from a feed after one successful fetch. It is not confirmed closure, and reopened requisitions aren't detected yet.
- Duplicate detection is per source and requisition id. Cross-URL duplicates are indexed by PR #2's canonical URL but aren't handled in review yet (H, E5).
- Scheduled execution has been verified once (07:55 UTC, 2026-10-26). GitHub dropped the five earlier hourly ticks and started that one 32 minutes late. Consumers must use the staleness rules in OUTPUT_CONTRACT.md.
- The owner's five daily runs each cost at least one runner minute (about 150 a month of the 2,000 free private-repo minutes), down from about 720 for hourly ticks.
- The benchmark is small: 21 cases, 34 labelled verdicts, 6 collection scenarios. It finds specific failure modes; it isn't a statistical estimate of accuracy on live feeds.
- Discovery reads static HTML only. Boards that a page adds with JavaScript (as GitLab's and Remote's careers pages appear to) aren't seen. Twilio's and Resilinc's careers sites are like that, so their boards aren't found even with the wider scope. Widening `allowed_hosts` needs a recorded basis.
- ChatGPT access to this private repository hasn't been verified (see OUTPUT_CONTRACT.md).
- The local lock uses `fcntl`, so local runs are POSIX only. Actions runs rely on the workflow concurrency group.
- Publication is atomic per file and ordered (status last). A reader of the working tree during the moves could see new boards with an old status, but git commits, which are what consumers read, are atomic.
