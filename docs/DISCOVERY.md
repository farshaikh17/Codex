# Candidate-specific discovery effort

The existing collector covers a small employer set. A successful collection is
not evidence of relevant candidate coverage, completed reviews, or READY jobs.
Discovery strategy belongs to each private candidate configuration and canonical
Sheet. It must not be hard-coded as a shared role list or percentage split.

## Implemented here

Optional `rules.discovery` accepts a `lanes` list. Each lane has a unique `id`,
positive percentage `share`, nonempty `queries` and nonempty `sources` string
lists. Shares must sum to 100; unknown keys are rejected. Source strings are
caller-defined identifiers, not automatically trusted or fetched endpoints.
Existing candidate configurations without discovery remain valid.

`python -m engine.discovery --candidates PRIVATE_DIR --candidate ID --state
PRIVATE_STATE_JSON --batches 10` proposes a weighted sequence of discovery work.
Run that command on one shell line. State is optional and is read-only:

```json
{
  "completed": {"core": 4, "adjacent": 1, "aspirational": 0},
  "paused_sources": {"source-a": "2030-01-02T09:00:00Z"}
}
```

The state keys must match that private configuration. The caller records actually
completed discovery batches in its existing private ledger, over its chosen
allocation window, and supplies those counts next time. Proposed tasks never
advance counters. A timezone-aware cooldown skips a source until its due time.
If every source in one lane is paused, remaining lanes receive capacity and the
unavailable lane is reported. If all sources are paused, unfilled work is explicit.

`engine.run` includes an initial plan in its **private candidate report** when the
candidate has a discovery strategy. That initial report does not load counters or
cooldowns; use the CLI with private state for continuation. Plans never enter the
shared SQLite run history or public posting exports. CLI stdout is private data.
Keep real configurations, queries, source preferences and state outside Git;
the existing candidate loader enforces that boundary for real configurations.

This module performs **no web requests, reviews, eligibility changes, applications
or Sheet writes**. It does not change the collector's schedule or existing queue
claim order. Query/source planning is separate from qualification. Native assistant
workers must use their canonical private Sheet strategies directly; they do not
depend on a local Python process or this private software queue.

## Operational requirements for consumers

1. Save completed unsaved decisions, then start fresh accessible discovery except
   urgent deadlines or employer actions. Check canonical identity/history keys
   before fetching another full JD for a known role.
2. Allocate most planned full-JD selections to unseen relevant roles; resolve due
   conditionals separately. A strategy/audit record must point to the actual
   research cursor rather than erase it.
3. After a failed primary page, try one appropriate official alternate, then save
   failure evidence and a normally 24-hour retry. Honor cooldowns across runs.
   After two distinct identity failures on a source, pause that source and use an
   independent one. Do not end a functioning invocation on blocked carryovers.
4. Treat provisional title/location cards, exact requisitions, primary full JDs,
   exported descriptions, eligibility decisions and READY as separate stages.
5. Report actual effort by lane and source, new versus carryover full reads,
   duplicates skipped before retrieval, exact fresh identities, pay-only blockers,
   other blockers and decisions saved/read back. Missing counters stay unknown.
6. Keep fixed-income stability as a ranking preference when appropriate, without
   adding guaranteed-hour requirements to an independently allowed hourly path.
7. Preserve source hashes and extraction versions. Unseen unchanged records remain
   unseen; missing feed records are not automatically closed vacancies.

## Acceptance and remaining integration

The offline tests verify different allocations, resumable counters, source
failover/cooldowns, malformed configuration rejection and private run-report
isolation. Passing them demonstrates planning behavior, not useful job yield.

Live acceptance requires at least two subsequent research runs per candidate:
deduplicated fresh relevant identities from independent sources, primary full-JD
reviews, recorded blockers and verified canonical persistence. Report shortfalls
even when READY is zero; never loosen eligibility to satisfy a numeric target.

Remaining software work for the development owner:

- Onboard verified employer sources covering distinct responsibility families and
  industries; do not treat the existing ten-employer feed as worldwide coverage.
- Measure incremental plausible fresh-identity yield per source before expanding
  collection volume. Add engineering/industrial/consultancy sources where needed,
  and implementation agencies/non-SaaS sources where needed. Verify URLs, access
  constraints and free functionality before deployment.
- Any future private consumer integration must feed actual completed counters and
  cooldowns into the planner, keep the native Sheets canonical and prove it does
  not duplicate/restart the existing candidate workflow.
- Do not deploy real candidate configuration or the private software queue merely
  because these offline tests pass. No such deployment is part of this change.
