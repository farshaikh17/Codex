-- Career Job Engine D1 Cloud Database Schema
-- Migration: 0007_qualification_history.sql
-- Persistent audit history for candidate qualification overrides

CREATE TABLE IF NOT EXISTS qualification_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qh_cand_job ON qualification_history(candidate_id, job_id);
CREATE INDEX IF NOT EXISTS idx_qh_changed_at ON qualification_history(changed_at);
