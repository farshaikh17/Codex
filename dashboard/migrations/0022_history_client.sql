-- Migration: 0022_history_client.sql
-- Plan U1 (phase 5): the open tracker lets anyone with the link change Farhan's and Sana's tracker without a key. Each history row written by
-- such a keyless request is tagged here with a hash of the network it came from (the same salted SHA-256 of CF-Connecting-IP the rate limit
-- uses; never the address itself), so the owner can undo one network's changes (scripts/undo_since.mjs, workflow undo-changes.yml).
-- before_json keeps what the change replaced, so an undo restores it exactly (the history rows themselves do not record a previous override).
-- A side table, not a new column: the release replays every migration file on each release, and SQLite has no "ADD COLUMN IF NOT EXISTS".
-- Additive and idempotent. Changes no existing row.
CREATE TABLE IF NOT EXISTS history_client (
    history_table TEXT NOT NULL CHECK (history_table IN ('qualification_history', 'application_history')),
    history_id INTEGER NOT NULL,
    client_hash TEXT NOT NULL,
    before_json TEXT,                         -- the changed row as it was before (status, override, notes), for an exact undo
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (history_table, history_id)
);
CREATE INDEX IF NOT EXISTS idx_history_client_hash ON history_client(client_hash, created_at);
