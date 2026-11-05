-- Failed operator-key attempts per client, for the built-in lockout (no paid Cloudflare rule needed).
-- Additive and safe to leave in place on rollback. ip_hash is a SHA-256 of the client address, never the address.
-- last_key_hash is a truncated hash of the last wrong key, so a browser retrying the SAME stale key many times in
-- parallel counts once, while guessing different keys counts every time.
CREATE TABLE IF NOT EXISTS auth_failures (
  ip_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_key_hash TEXT
);
