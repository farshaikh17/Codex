-- Additive and idempotent (safe to apply on every release and before every discovery run).
-- Applications made outside the dashboard (owner decision 2026-11-07). Entered by the operator; daily discovery labels new
-- jobs from an employer that rejected the candidate before. Nothing is hidden because of it.
CREATE TABLE IF NOT EXISTS past_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  role TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('REJECTED', 'NO_RESPONSE', 'APPLIED', 'WITHDRAWN')),
  decided_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_past_applications_candidate ON past_applications(candidate_id);
