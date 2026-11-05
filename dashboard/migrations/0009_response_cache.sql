-- Read cache for dashboard responses and an index for the latest-successful-run lookup. Additive and idempotent:
-- no existing table or row is changed.
CREATE TABLE IF NOT EXISTS response_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_response_cache_created ON response_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_cloud_runs_status_started ON cloud_discovery_runs(status, started_at DESC);
-- Rows read per UTC day by cache misses (D1's own meta.rows_read), used to cap public load below the free allowance.
CREATE TABLE IF NOT EXISTS read_meter (
  day TEXT PRIMARY KEY,
  rows_read INTEGER NOT NULL DEFAULT 0,
  public_misses INTEGER NOT NULL DEFAULT 0,
  operator_misses INTEGER NOT NULL DEFAULT 0
);
