-- Migration: 0026_read_diet.sql
-- D1 free plan (5,000,000 rows read a day): on 17 Nov the reads ran out and the site answered 503 for hours. D1 bills every row a query
-- steps over, so a query that probes a column without an index reads the whole table each time. Measured on a local D1 copy of production
-- size (dashboard/docs/COST_MODEL_2026-11-09.md, section 6):
--  * idx_app_job: "no application for this job" (NOT EXISTS ... applications a WHERE a.job_id = ...) is asked for every row the still-open
--    check, the closures and the expiry consider; with only the (candidate_id, job_id) index each probe read the whole applications table.
--  * idx_jobs_channel_active_disc: the daily expiry of job-site results, the "listed for 60+ days" note and the tidy-up (scripts/tidy_jobs.mjs) read only
--    the jobs of one channel and state, oldest first, instead of every active job.
--  * idx_cq_override (partial: only rows a person decided on): the taste model's "rows a person decided on" without a scan of every row.
--  * idx_jobs_closed_at (partial: closed jobs only, by closing time): the duplicate check's "closed in the last 180 days" and the tidy-up's
--    "closed 45 to 52 days ago" read those rows only, not every closed job.
-- Indexes only: no row of any table changes. Idempotent (IF NOT EXISTS): replayed on every release.
-- One-time cost: one written row per index entry (about one per job row, plus one per closed job; the override index only for decided rows).
CREATE INDEX IF NOT EXISTS idx_app_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_channel_active_disc ON jobs(source_channel, is_active, discovered_at);
CREATE INDEX IF NOT EXISTS idx_cq_override ON candidate_qualifications(manual_override_status) WHERE manual_override_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_closed_at ON jobs(expired_at) WHERE is_active = 0;
