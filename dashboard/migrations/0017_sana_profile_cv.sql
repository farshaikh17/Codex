-- Sana's profile, corrected against her own CV (owner-approved 2026-11-07). Her CV shows 9 years in thermal power generation:
-- DCS operation of a 195 MW unit, and maintenance of water-treatment (DM plant, condensate polishing), pumps, compressors,
-- blowers, pressure vessels and cooling towers at a 660 MW plant, plus tenders and contractor coordination. Her B.Tech is electrical,
-- but the maintenance she did was mechanical/process equipment, so "Electrical Maintenance" and "Substation Maintenance" are
-- removed from her skill and role lists. Everything else she or the operator added is kept; the CV-backed entries are added.
-- Runs once (marker in discovery_state); a later hand edit is never undone. Idempotent and additive in spirit.
UPDATE candidates
   SET primary_skills = (SELECT json_group_array(value) FROM (
         SELECT value FROM json_each(CASE WHEN json_valid(candidates.primary_skills) THEN CASE WHEN json_type(candidates.primary_skills) = 'array' THEN candidates.primary_skills ELSE '[]' END ELSE '[]' END)
          WHERE lower(value) NOT LIKE 'electrical maintenance%' AND lower(value) NOT LIKE 'substation%'
         UNION
         SELECT value FROM json_each('["Power Plant Operations","DCS Monitoring","Preventive Maintenance","Breakdown Maintenance","Rotating Equipment Maintenance","Water Treatment (DM Plant, CPU)","Root Cause Analysis","Reliability","Equipment Troubleshooting","Shutdown Planning","Maintenance Planning","Technical Specifications","Tender Documents","Procurement","Contractor Supervision"]'))),
       secondary_skills = (SELECT json_group_array(value) FROM (
         SELECT value FROM json_each(CASE WHEN json_valid(candidates.secondary_skills) THEN CASE WHEN json_type(candidates.secondary_skills) = 'array' THEN candidates.secondary_skills ELSE '[]' END ELSE '[]' END)
          WHERE lower(value) NOT LIKE 'electrical maintenance%' AND lower(value) NOT LIKE 'substation%'
         UNION
         SELECT value FROM json_each('["Thermal Power Generation","Techno-Commercial Evaluation","Vendor Coordination","Engineering Calculations","Technical Reports","Water Chemistry"]'))),
       target_roles = (SELECT json_group_array(value) FROM (
         SELECT value FROM json_each(CASE WHEN json_valid(candidates.target_roles) THEN CASE WHEN json_type(candidates.target_roles) = 'array' THEN candidates.target_roles ELSE '[]' END ELSE '[]' END)
          WHERE lower(value) NOT LIKE 'electrical maintenance%' AND lower(value) NOT LIKE 'substation%'
         UNION
         SELECT value FROM json_each('["Reliability Engineer","Maintenance Engineer (Power Plant)","Power Plant Operations Engineer","Plant Engineer","Asset Performance Specialist","Energy Efficiency Engineer","Decarbonization Engineer"]'))),
       updated_at = datetime('now')
 WHERE id = 'sana_ansari' AND NOT EXISTS (SELECT 1 FROM discovery_state WHERE key = 'sana_profile_cv_v1');
INSERT OR IGNORE INTO discovery_state(key, value) VALUES ('sana_profile_cv_v1', datetime('now'));
