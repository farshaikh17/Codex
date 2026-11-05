-- Read cache for dashboard responses, its generation counter, a per-day read meter, and an index for the
-- latest-successful-run lookup. Additive and idempotent: no existing table or row is changed.
CREATE TABLE IF NOT EXISTS response_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_response_cache_created ON response_cache(created_at);
-- Raised by every operator change; a cached entry is fresh only if it was computed under the current generation.
CREATE TABLE IF NOT EXISTS cache_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO cache_state(id, generation) VALUES (1, 0);
-- Rows read by cache misses (D1's own meta.rows_read) and cache entries written, per UTC day.
CREATE TABLE IF NOT EXISTS read_meter (
  day TEXT PRIMARY KEY,
  rows_read INTEGER NOT NULL DEFAULT 0,
  public_misses INTEGER NOT NULL DEFAULT 0,
  operator_misses INTEGER NOT NULL DEFAULT 0,
  cache_writes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cloud_runs_status_started ON cloud_discovery_runs(status, started_at DESC);
