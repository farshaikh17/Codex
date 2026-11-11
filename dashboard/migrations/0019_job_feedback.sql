-- Migration: 0019_job_feedback.sql
-- The thumbs up / thumbs down a candidate gives a job in the inspection panel. It used to be echoed back and never stored.
-- A private note per candidate and job; it does not change a score or a ranking. Additive and idempotent.
CREATE TABLE IF NOT EXISTS job_feedback (
    candidate_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('UP', 'DOWN')),
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (candidate_id, job_id),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
