-- Career Job Engine D1 Cloud Database Schema
-- Migration: 0001_initial_schema.sql
-- Cloudflare D1 (SQLite compatible)

-- App metadata / Stage marker
CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Candidates
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    current_location TEXT,
    citizenship TEXT NOT NULL DEFAULT 'India',
    education TEXT,
    primary_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    total_years_experience REAL NOT NULL DEFAULT 0.0,
    target_roles TEXT, -- JSON array
    primary_skills TEXT, -- JSON array
    secondary_skills TEXT, -- JSON array
    target_seniorities TEXT, -- JSON array
    disqualifying_keywords TEXT, -- JSON array
    unsupported_claims TEXT, -- JSON array
    cash_floor_inr_monthly REAL,
    cash_floor_inr_annual REAL,
    min_acceptable_salary_usd REAL,
    qualification_threshold INTEGER NOT NULL DEFAULT 60,
    target_strategy_strongest REAL DEFAULT 70.0,
    target_strategy_bridge REAL DEFAULT 20.0,
    target_strategy_dream REAL DEFAULT 10.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Candidate Strategy Allocation
CREATE TABLE IF NOT EXISTS candidate_strategy (
    candidate_id TEXT PRIMARY KEY,
    strongest_fit_target_pct REAL NOT NULL DEFAULT 70.0,
    bridge_target_pct REAL NOT NULL DEFAULT 20.0,
    dream_target_pct REAL NOT NULL DEFAULT 10.0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

-- Jobs (Curated public job repository)
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    company_url TEXT,
    company_headquarters TEXT,
    source_adapter TEXT NOT NULL,
    source_url TEXT,
    original_posting_url TEXT,
    employment_type TEXT,
    workplace_type TEXT NOT NULL DEFAULT 'REMOTE_RESTRICTED',
    location_restrictions TEXT,
    description TEXT,
    required_skills TEXT,
    salary_published INTEGER DEFAULT 0,
    salary_currency TEXT,
    salary_min REAL,
    salary_max REAL,
    salary_period TEXT,
    salary_raw_text TEXT,
    discovered_at TEXT NOT NULL,
    last_verified_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    content_sha256 TEXT,
    expired_at TEXT,
    source_id TEXT,
    source_channel TEXT DEFAULT 'PUBLIC_ATS',
    provenance TEXT DEFAULT 'LIVE_PUBLIC'
);

CREATE INDEX IF NOT EXISTS idx_jobs_is_active ON jobs(is_active);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_source_adapter ON jobs(source_adapter);
CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at ON jobs(discovered_at);

-- Candidate Qualifications (Candidate-isolated qualification decisions)
CREATE TABLE IF NOT EXISTS candidate_qualifications (
    candidate_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    qualification_status TEXT NOT NULL, -- READY, STRETCH_READY, NEEDS_REVIEW, INELIGIBLE, HOLD, CLOSED, APPLIED
    strategy_lane TEXT NOT NULL DEFAULT 'UNASSIGNED', -- STRONGEST_FIT, BRIDGE, DREAM, UNASSIGNED
    eligibility_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    eligibility_reason TEXT,
    qualification_reason TEXT,
    manual_override_status TEXT,
    manual_override_reason TEXT,
    qualified_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_reverified_at TEXT,
    PRIMARY KEY (candidate_id, job_id),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cq_cand_status ON candidate_qualifications(candidate_id, qualification_status);
CREATE INDEX IF NOT EXISTS idx_cq_cand_lane ON candidate_qualifications(candidate_id, strategy_lane);
CREATE INDEX IF NOT EXISTS idx_cq_job ON candidate_qualifications(job_id);

-- Candidate Job Scores
CREATE TABLE IF NOT EXISTS candidate_job_scores (
    candidate_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    overall_score INTEGER NOT NULL DEFAULT 0,
    skill_score INTEGER NOT NULL DEFAULT 0,
    role_score INTEGER NOT NULL DEFAULT 0,
    strategy_lane TEXT NOT NULL DEFAULT 'UNASSIGNED',
    score_breakdown TEXT, -- JSON
    calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (candidate_id, job_id),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cjs_cand_score ON candidate_job_scores(candidate_id, overall_score DESC);

-- Applications (Real candidate application tracker)
CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SAVED', -- SAVED, SUBMITTED, INTERVIEWING, OFFER, REJECTED, ARCHIVED
    applied_at TEXT,
    application_channel TEXT,
    resume_version TEXT,
    cover_letter_path TEXT,
    notes TEXT,
    rejection_stage TEXT,
    rejection_reason_category TEXT,
    rejection_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_candidate ON applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_cand_job ON applications(candidate_id, job_id);

-- Application History (Audit trail of application state changes)
CREATE TABLE IF NOT EXISTS application_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    application_id TEXT,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    stage TEXT,
    rejection_stage TEXT,
    rejection_reason_category TEXT,
    rejection_notes TEXT,
    notes TEXT,
    actor TEXT,
    source TEXT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_hist_cand_job ON application_history(candidate_id, job_id);

-- Migration Ledger (Tracking cloud synchronization batches)
CREATE TABLE IF NOT EXISTS migration_ledger (
    batch_id TEXT PRIMARY KEY,
    source_env TEXT NOT NULL DEFAULT 'local_sqlite',
    target_env TEXT NOT NULL DEFAULT 'cloudflare_d1',
    exported_at TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0,
    checksum_sha256 TEXT NOT NULL,
    applied_at TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
);
