-- Additive and idempotent (safe to apply on every release).
-- The public site: requests from people who apply on /apply, and operator-editable site settings (brand, contact, prices).
CREATE TABLE IF NOT EXISTS client_requests (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  current_location TEXT,
  target_roles TEXT NOT NULL,
  work_preference TEXT,
  years_experience TEXT,
  linkedin_url TEXT,
  plan TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'CONVERTED', 'DECLINED')),
  candidate_id TEXT,
  source_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_client_requests_status ON client_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_client_requests_source ON client_requests(source_hash, created_at);
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
