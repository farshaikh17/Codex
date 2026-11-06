-- Additive and idempotent. Lets the Worker find collector-imported rows that were never assessed without scanning every
-- qualification row (partial index: it holds only those rows, so it shrinks to nothing as the backlog is assessed), and
-- answers per-candidate eligibility filters (India Remote) from an index.
CREATE INDEX IF NOT EXISTS idx_cq_unassessed ON candidate_qualifications(candidate_id, job_id)
  WHERE qualification_reason LIKE '[GITHUB_COLLECTOR] Unassessed%';
CREATE INDEX IF NOT EXISTS idx_cq_cand_elig ON candidate_qualifications(candidate_id, eligibility_status);
