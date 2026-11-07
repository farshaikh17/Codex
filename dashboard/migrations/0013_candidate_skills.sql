-- Additive and idempotent (safe to apply on every release).
-- The discovery screen scores 8 points per primary skill found in a posting, but nothing in the product ever wrote
-- primary_skills for the two built-in candidates (no seed, no importer; the profile editor does not write it), so every
-- role match scored a flat 40/50 and could never reach a 70 threshold. These are the candidates' own documented skills,
-- the same lists /api/profile already shows for them. Only an empty column is filled; a stored list is never overwritten.
UPDATE candidates
   SET primary_skills = '["GoHighLevel","AI-assisted workflows","API troubleshooting","CRM Configuration","Workflow Automation","Technical Team Leadership"]',
       updated_at = datetime('now')
 WHERE id = 'farhan_shaikh' AND (primary_skills IS NULL OR trim(primary_skills) IN ('', '[]', 'null'));
UPDATE candidates
   SET primary_skills = '["Electrical Maintenance","Industrial Maintenance","Power Plant Operations","Reliability","Plant Engineering","Equipment Troubleshooting"]',
       updated_at = datetime('now')
 WHERE id = 'sana_ansari' AND (primary_skills IS NULL OR trim(primary_skills) IN ('', '[]', 'null'));
