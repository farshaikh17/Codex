ALTER TABLE cloud_sources ADD COLUMN cursor_token TEXT;
ALTER TABLE cloud_sources ADD COLUMN cursor_started_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_jobs_provenance ON jobs(provenance);
INSERT INTO cloud_sources(id,kind,slug,name,next_due) VALUES
 ('board:jobicy','jobicy','all','Jobicy public jobs',CAST(strftime('%s','now') AS INTEGER)+3600),
 ('board:remotive:operations','remotive','operations','Remotive — operations',-3),
 ('board:remotive:implementation','remotive','implementation','Remotive — implementation',-2),
 ('startup:hnjobs','hnjobs','yc-jobs','Hacker News startup jobs',-1)
ON CONFLICT(id) DO NOTHING;
