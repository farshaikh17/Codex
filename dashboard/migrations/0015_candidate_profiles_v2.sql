-- Owner-confirmed profiles, 2026-11-07. Applied once (a marker in discovery_state, from 0014), so it is safe on every release
-- and a skill someone removes by hand later is not added back.
-- Skills come from each candidate's own CV and are ADDED to whatever is stored; nothing stored is removed. Years are only raised.
UPDATE candidates
   SET primary_skills = (SELECT json_group_array(value) FROM (
         SELECT value FROM json_each(CASE WHEN json_valid(candidates.primary_skills) THEN CASE WHEN json_type(candidates.primary_skills) = 'array' THEN candidates.primary_skills ELSE '[]' END ELSE '[]' END)
         UNION
         SELECT value FROM json_each('["GoHighLevel","CRM Configuration","Workflow Automation","API & Webhook Integration","AI-assisted workflows","Technical Troubleshooting","Requirements Gathering","Product Implementation","Technical Delivery","Process Design","SOP Development","Stakeholder Management","Technical Team Leadership","Postman"]'))),
       updated_at = datetime('now')
 WHERE id = 'farhan_shaikh' AND NOT EXISTS (SELECT 1 FROM discovery_state WHERE key = 'profiles_v2_applied');
UPDATE candidates
   SET primary_skills = (SELECT json_group_array(value) FROM (
         SELECT value FROM json_each(CASE WHEN json_valid(candidates.primary_skills) THEN CASE WHEN json_type(candidates.primary_skills) = 'array' THEN candidates.primary_skills ELSE '[]' END ELSE '[]' END)
         UNION
         SELECT value FROM json_each('["Power Plant Operations","DCS Monitoring","Electrical Maintenance","Preventive Maintenance","Breakdown Maintenance","Root Cause Analysis","Reliability","Equipment Troubleshooting","Shutdown Planning","Maintenance Planning","Water Treatment","Technical Specifications","Procurement","Contractor Supervision"]'))),
       updated_at = datetime('now')
 WHERE id = 'sana_ansari' AND NOT EXISTS (SELECT 1 FROM discovery_state WHERE key = 'profiles_v2_applied');
UPDATE candidates SET total_years_experience = 9, updated_at = datetime('now')
 WHERE id IN ('farhan_shaikh', 'sana_ansari') AND (total_years_experience IS NULL OR total_years_experience < 9)
   AND NOT EXISTS (SELECT 1 FROM discovery_state WHERE key = 'profiles_v2_applied');
INSERT OR IGNORE INTO discovery_state(key, value) VALUES ('profiles_v2_applied', datetime('now'));
