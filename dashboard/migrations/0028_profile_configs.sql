-- Migration: 0028_profile_configs.sql
-- Multi-candidate base (dashboard/docs/MULTI_CANDIDATE.md): a person's profile config (schema 1, JSON text, at most 16 KB) names the rule
-- packs that score them, their place policies, level band, thresholds and discovery hints, so a new person needs no new scoring code.
-- A person without a row here (today: everyone) keeps the old evaluate(); the two built-in people move to the packs only when a row says
-- {"schema":1,"extends":"legacy:<id>","engine":"profile"}. No foreign key (the client delete removes the row with the person's other data).
-- No row of any existing table changes. Idempotent (IF NOT EXISTS): replayed on every release. One-time cost: none (the table starts empty).
CREATE TABLE IF NOT EXISTS candidate_profile_configs (
  candidate_id TEXT PRIMARY KEY,
  config TEXT NOT NULL CHECK (length(config) <= 16384),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
