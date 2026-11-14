-- Migration: 0024_drop_remotive_source.sql
-- Compliance (14 Nov 2026): the Worker's Remotive reader called remotive.com/api/remote-jobs?search=..., and Remotive's robots.txt
-- disallows "/api/*" and "/*search=" for every agent; no allowed endpoint lists its jobs. Both Remotive searches are switched off.
-- Jobs already stored from Remotive stay as they are (decisions and applications untouched). Idempotent.
UPDATE cloud_sources SET enabled = 0, last_error = 'Off since 14 Nov 2026: robots.txt disallows the API (compliance)'
WHERE kind = 'remotive' AND enabled = 1;
