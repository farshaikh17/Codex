-- Migration: 0020_farhan_drop_marketing_stretch.sql
-- Owner decision 2026-11-11: Farhan's two Drivetrain marketing roles (Organic Marketing, SEO Content Specialist) sat in Stretch with a status
-- carried over from an old review and no score. They are marketing roles, outside the Tech Ops / CRM / automation target. Moved to HOLD with an
-- owner override so no automatic run puts them back. Touches only those rows, only while they are still Stretch with no override and no application.
-- Idempotent: after it ran, the first statement matches nothing and the history row is not written twice.
UPDATE candidate_qualifications
SET qualification_status = 'HOLD', manual_override_status = 'HOLD',
    manual_override_reason = 'Owner decision 2026-11-11: marketing role, outside the Tech Ops / CRM / automation target; moved out of Stretch',
    last_reverified_at = datetime('now')
WHERE candidate_id = 'farhan_shaikh' AND qualification_status = 'STRETCH_READY' AND manual_override_status IS NULL
  AND job_id IN (SELECT id FROM jobs WHERE company LIKE 'Drivetrain%' AND title IN ('Organic Marketing', 'SEO Content Specialist'))
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_qualifications.candidate_id AND a.job_id = candidate_qualifications.job_id);

INSERT INTO qualification_history (candidate_id, job_id, previous_status, new_status, reason, actor)
SELECT q.candidate_id, q.job_id, 'STRETCH_READY', 'HOLD', q.manual_override_reason, 'Owner'
FROM candidate_qualifications q
WHERE q.candidate_id = 'farhan_shaikh' AND q.manual_override_status = 'HOLD' AND q.manual_override_reason LIKE 'Owner decision 2026-11-11%'
  AND NOT EXISTS (SELECT 1 FROM qualification_history h WHERE h.candidate_id = q.candidate_id AND h.job_id = q.job_id AND h.reason = q.manual_override_reason);
