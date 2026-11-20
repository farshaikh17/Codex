-- Migration: 0027_cheap_views.sql
-- An uncached Today page or job list read about 90,000 to 100,000 D1 rows for one person (measured on a local D1 copy of production size,
-- dashboard/docs/COST_MODEL_2026-11-09.md section 7): every count, facet and page re-read all of that person's screening rows, and every
-- tracker action made that person's next view uncached. Now the person's list is kept as a small derived copy (worker/snapshot.ts):
--  * seeker_snapshot: per person, part 0 (state: cache generation, code version, build time, a write token) and parts 1..n (the rows of the
--    person's list and Hidden jobs, a few fields each, as JSON). Built from the same predicates as the list queries; valid only under the
--    current cache generation, the same code version and for the response cache's own time limit (30 minutes for visitors, 10 for the
--    operator), so it is never staler than a cached answer was. Counts, facets, pages and the twin grouping are computed from it.
--  * seeker_dirty: a (person, job) pair a tracker action changed. The next read re-reads that job alone and corrects the copy, so an
--    action no longer costs a rebuild.
--  * idx_cq_not_for_me (partial: only jobs a person marked Not for me): the Hidden jobs count and list without reading every Hold row.
-- No row of any existing table changes. Idempotent (IF NOT EXISTS): replayed on every release.
-- One-time cost: one written row per Not-for-me row for the index; the tables start empty.
CREATE TABLE IF NOT EXISTS seeker_snapshot (
  candidate_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT -1,
  version TEXT NOT NULL DEFAULT '',
  built_at INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL DEFAULT '',
  parts INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (candidate_id, part)
);
CREATE TABLE IF NOT EXISTS seeker_dirty (
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_cq_not_for_me ON candidate_qualifications(candidate_id)
  WHERE qualification_status = 'HOLD' AND qualification_reason LIKE 'You marked this Not for me%';
