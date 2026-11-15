-- Migration: 0023_company_names_svkm.sql
-- Plan B1 (phase 4), after 0021: the Oracle Recruiting Cloud tenant fa-elxu-saasfaprod1 is SVKM's (career sites read on 14 Nov 2026: CX_1001 "NMIMS",
-- CX_1012 "SVKM Central Office", CX_1016 "SVKM"). The dataset stored it with its site, 'Fa Elxu Saasfaprod1 (CX_1001)', which 0021 did not read.
-- New rows are named at import (engine/company_names.py); this file renames the rows already stored, only on that tenant's own host.
-- Guards (plan section 3): a job someone applied to, or one with a person's decision on any of its rows, is never changed. Explicit UPDATEs only.
-- Idempotent: a renamed row no longer matches its WHERE clause.
UPDATE jobs SET company = 'NMIMS' WHERE lower(replace(company, '-', ' ')) = 'fa elxu saasfaprod1 (cx_1001)'
  AND (source_url LIKE 'https://fa-elxu-saasfaprod1.fa.%' OR original_posting_url LIKE 'https://fa-elxu-saasfaprod1.fa.%')
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
UPDATE jobs SET company = 'SVKM' WHERE lower(replace(company, '-', ' ')) IN ('fa elxu saasfaprod1 (cx_1012)', 'fa elxu saasfaprod1 (cx_1016)', 'fa elxu saasfaprod1')
  AND (source_url LIKE 'https://fa-elxu-saasfaprod1.fa.%' OR original_posting_url LIKE 'https://fa-elxu-saasfaprod1.fa.%')
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL);
