-- Additive and idempotent (safe to apply on every release and before every discovery run).
-- State for the daily discovery pipeline's closing rule: a job it added is closed only after it is missing from two
-- consecutive dataset snapshots, and only when that ATS's row count is within 10% of the previous run.
CREATE TABLE IF NOT EXISTS discovery_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS discovery_missing (
  job_id TEXT PRIMARY KEY,
  first_missing_at TEXT NOT NULL DEFAULT (datetime('now'))
);
