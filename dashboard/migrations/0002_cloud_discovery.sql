CREATE TABLE IF NOT EXISTS cloud_automation (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 day TEXT NOT NULL DEFAULT '', jobs_today INTEGER NOT NULL DEFAULT 0,
 sources_today INTEGER NOT NULL DEFAULT 0, last_success_at TEXT,
 last_error TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO cloud_automation(id) VALUES(1);
CREATE TABLE IF NOT EXISTS cloud_sources (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, cursor INTEGER NOT NULL DEFAULT 0,
 next_due INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
 last_attempt_at TEXT, last_success_at TEXT, last_error TEXT,
 last_status TEXT NOT NULL DEFAULT 'NEVER_RUN', last_seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cloud_sources_due ON cloud_sources(enabled,next_due);
CREATE TABLE IF NOT EXISTS cloud_discovery_queue (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES cloud_sources(id),
 posting_id TEXT NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING', next_due INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL,
 UNIQUE(source_id,posting_id)
);
CREATE INDEX IF NOT EXISTS idx_cloud_queue_due ON cloud_discovery_queue(state,next_due);
CREATE TABLE IF NOT EXISTS cloud_discovery_runs (
 id TEXT PRIMARY KEY, trigger_type TEXT NOT NULL, run_type TEXT NOT NULL,
 source_id TEXT, job_id TEXT, status TEXT NOT NULL,
 started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER,
 jobs_seen INTEGER NOT NULL DEFAULT 0, jobs_new INTEGER NOT NULL DEFAULT 0,
 jobs_updated INTEGER NOT NULL DEFAULT 0, jobs_unchanged INTEGER NOT NULL DEFAULT 0,
 error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_cloud_runs_started ON cloud_discovery_runs(started_at DESC);
CREATE TABLE IF NOT EXISTS cloud_job_evidence (
 job_id TEXT PRIMARY KEY REFERENCES jobs(id), source_id TEXT NOT NULL,
 posting_id TEXT NOT NULL, content_sha256 TEXT NOT NULL, fetched_at TEXT NOT NULL,
 rule_version TEXT NOT NULL, UNIQUE(source_id,posting_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_original_url ON jobs(original_posting_url);
CREATE INDEX IF NOT EXISTS idx_jobs_source_url ON jobs(source_url);
INSERT OR IGNORE INTO cloud_sources(id,kind,slug,name) VALUES
 ('lever:arcadia','lever','arcadia','Arcadia'),
 ('lever:mainspringenergy','lever','mainspringenergy','Mainspring Energy'),
 ('lever:jumpcloud','lever','jumpcloud','JumpCloud'),
 ('lever:highlevel','lever','highlevel','HighLevel'),
 ('lever:zapier','lever','zapier','Zapier'),
 ('lever:iterate','lever','iterate','Iterate'),
 ('greenhouse:gitlab','greenhouse','gitlab','GitLab'),
 ('greenhouse:canonical','greenhouse','canonical','Canonical'),
 ('greenhouse:elastic','greenhouse','elastic','Elastic'),
 ('smartrecruiters:Konecranes','smartrecruiters','Konecranes','Konecranes'),
 ('smartrecruiters:Afry','smartrecruiters','Afry','AFRY'),
 ('smartrecruiters:SGS','smartrecruiters','SGS','SGS');
