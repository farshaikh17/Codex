-- Additive and idempotent (safe to apply on every release).
-- Client profiles: one row per candidate. visibility 'public' = readable without a key (the two original candidates stay public),
-- 'private' = only with the operator key or that client's share link. search_profile NULL = the built-in rules of the original two.
CREATE TABLE IF NOT EXISTS client_profiles (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  display_title TEXT,
  summary_line TEXT,
  search_profile TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO client_profiles(candidate_id, visibility) SELECT id, 'public' FROM candidates WHERE id IN ('farhan_shaikh', 'sana_ansari');
-- Read-only share links. Only a SHA-256 of the token is stored; the token itself is shown once when the link is created.
CREATE TABLE IF NOT EXISTS client_view_tokens (
  token_hash TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_view_tokens_candidate ON client_view_tokens(candidate_id);
