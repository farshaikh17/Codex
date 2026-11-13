-- Migration: 0021_company_display_names.sql
-- Plan B1 (phase 4): stored jobs whose employer is shown by its hiring-system tenant id get the employer's name. Each name below was read from
-- the employer's own career site (page title or og:site_name) on 13 Nov 2026, or is the plan's table of known ids. New rows are named at import
-- (engine/company_names.py); this file renames the rows already stored.
-- Guards (plan section 3): a job someone applied to, or one with a person's decision on any of its rows, is never changed. Explicit UPDATEs only.
-- Idempotent: a renamed row no longer matches its WHERE clause.
UPDATE jobs SET company = 'Mondelez International' WHERE lower(company) = 'mdlz'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'AECOM' WHERE lower(company) = 'aecom2'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'General Motors' WHERE lower(company) = 'generalmotors'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'Thermo Fisher Scientific' WHERE lower(company) = 'thermofisher'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'GoHighLevel' WHERE company = 'gohighlevel'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'ABB' WHERE company = 'abb'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
-- Oracle Recruiting Cloud tenants: only rows whose posting is on that tenant's own host.
UPDATE jobs SET company = 'Lucy Electric' WHERE lower(company) = 'hdga' AND (source_url LIKE 'https://hdga.fa.%' OR original_posting_url LIKE 'https://hdga.fa.%')
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'Vertiv' WHERE lower(company) = 'egup' AND (source_url LIKE 'https://egup.fa.%' OR original_posting_url LIKE 'https://egup.fa.%')
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'Hormel Foods' WHERE lower(company) = 'ekkh' AND (source_url LIKE 'https://ekkh.fa.%' OR original_posting_url LIKE 'https://ekkh.fa.%')
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'Cummins' WHERE lower(replace(company, '-', ' ')) = 'fa espx saasfaprod1'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'Kent' WHERE lower(replace(company, '-', ' ')) = 'fa emqh saasfaprod1'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'Howmet Aerospace' WHERE lower(replace(company, '-', ' ')) = 'fa exty saasfaprod1'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'Perficient' WHERE lower(replace(company, '-', ' ')) = 'fa etqd saasfaprod1'
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
