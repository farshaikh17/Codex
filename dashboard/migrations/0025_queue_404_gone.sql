-- Migration: 0025_queue_404_gone.sql
-- QA 16 Nov 2026: since 6 Nov (commit 1577608) a queued posting the employer's ATS answers HTTP 404 for ends as GONE, not FAILED. Queue rows
-- that failed with HTTP 404 before that change (the old greenhouse:elastic postings) still read FAILED. This marks them GONE the same way.
-- Queue table only: no job is closed here (the Worker's own 404 path closes a stored job, with its guards, the next time it sees one).
-- Applications, history, overrides and candidates are untouched. Idempotent: a second run finds no FAILED 404 row.
UPDATE cloud_discovery_queue
SET state = 'GONE', last_error = 'Posting removed upstream (HTTP 404)', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE state = 'FAILED' AND last_error LIKE '%HTTP 404%';
