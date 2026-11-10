-- Additive and idempotent. One optional follow-up date (and short note) per tracked application, so the tracker can flag what is overdue.
-- Operator data: never part of a public answer. Removed with the client when a client is deleted.
CREATE TABLE IF NOT EXISTS application_followups (
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  follow_up_at TEXT NOT NULL,           -- YYYY-MM-DD
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_followups_due ON application_followups(candidate_id, follow_up_at);
