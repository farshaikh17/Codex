-- 0010: owner-approved ranking change applied to the scores the Worker's conservative discovery screen already stored (2026-11-05).
-- Farhan only. 1) Titles on his avoid list are capped at 40. 2) A posting whose only stated location is outside India, and that does not
-- affirmatively support remote work from India, loses 15 points (floor 0). Only lowers preliminary scores. It never touches eligibility,
-- status, READY rules, rows with a manual override, or scores from the collector's engine (different rule tag). The existence of a tracker
-- record does NOT exclude a job: score changes never touch applications, history or overrides, and the 12 tracker records are understood to be
-- early placeholder listings, so they must not silently keep their jobs out of the correction.
-- Idempotent: each updated row is tagged ranking_v2 in its score_breakdown and is not changed again.
UPDATE candidate_job_scores
SET overall_score = MIN(overall_score, 40),
    score_breakdown = CASE WHEN json_valid(score_breakdown) THEN json_set(score_breakdown, '$.ranking_v2', 'avoid_title_cap') ELSE score_breakdown END
WHERE candidate_id = 'farhan_shaikh'
  AND overall_score > 40
  AND score_breakdown LIKE '%cloud-conservative-review-%'
  AND (NOT json_valid(score_breakdown) OR json_extract(score_breakdown, '$.ranking_v2') IS NULL)
  AND EXISTS (SELECT 1 FROM candidate_qualifications q WHERE q.candidate_id = candidate_job_scores.candidate_id AND q.job_id = candidate_job_scores.job_id
              AND q.manual_override_status IS NULL AND q.qualification_status IN ('NEEDS_REVIEW', 'HOLD'))
  AND job_id IN (SELECT j.id FROM jobs j WHERE
      (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% software engineer %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% software developer %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% software architect %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% backend %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% back end %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% frontend %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% front end %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% full stack %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% fullstack %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% devops %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% sre %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% site reliability %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% machine learning %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% ml engineer %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% ml scientist %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% data scientist %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% ai engineer %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% security engineer %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% security analyst %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% security architect %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% security specialist %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% cyber %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% cybersecurity %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% infosec %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% accountant %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% finance %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% controller %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% payroll %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% customer support %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% support engineer %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% support specialist %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% support representative %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% help desk %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% helpdesk %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% sdet %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% qa engineer %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% test automation %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% engineering manager %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% director of engineering %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% vp of engineering %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.title),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% head of engineering %');

UPDATE candidate_job_scores
SET overall_score = MAX(0, overall_score - 15),
    score_breakdown = CASE WHEN json_valid(score_breakdown) THEN json_set(score_breakdown, '$.ranking_v2', 'foreign_location') ELSE score_breakdown END
WHERE candidate_id = 'farhan_shaikh'
  AND overall_score > 0
  AND score_breakdown LIKE '%cloud-conservative-review-%'
  AND (NOT json_valid(score_breakdown) OR json_extract(score_breakdown, '$.ranking_v2') IS NULL)
  AND EXISTS (SELECT 1 FROM candidate_qualifications q WHERE q.candidate_id = candidate_job_scores.candidate_id AND q.job_id = candidate_job_scores.job_id
              AND q.manual_override_status IS NULL AND q.qualification_status IN ('NEEDS_REVIEW', 'HOLD') AND q.eligibility_status <> 'ELIGIBLE')
  AND job_id IN (SELECT j.id FROM jobs j WHERE j.location_restrictions IS NOT NULL
      AND NOT ((' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% india %' OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% bengaluru %' OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% mumbai %' OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% pune %' OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% hyderabad %' OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% chennai %' OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% delhi %')
      AND ((' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% united states %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% usa %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% u s %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% united kingdom %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% uk %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% london %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% germany %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% berlin %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% munich %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% france %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% paris %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% spain %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% madrid %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% barcelona %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% netherlands %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% amsterdam %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% ireland %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% dublin %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% poland %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% warsaw %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% canada %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% toronto %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% vancouver %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% australia %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% sydney %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% melbourne %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% new york %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% san francisco %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% seattle %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% austin %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% boston %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% chicago %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% denver %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% atlanta %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% los angeles %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% dallas %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% miami %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% emea %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% europe %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% latam %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% mexico %'
      OR (' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(j.location_restrictions),'-',' '),'/',' '),',',' '),'(',' '),')',' '),'.',' '),':',' '),';',' '),'&',' ') || ' ') LIKE '% brazil %'));

-- Sana: a fixed city list cannot establish that a commercial airport is within about 2 hours, so on-site/hybrid roles that the Worker's
-- screen marked ELIGIBLE only because the posting named a listed Indian city become UNKNOWN. Remote roles stay ELIGIBLE. The score drops by the
-- 10 points that eligibility added to role-matched rows. Preliminary rows only; overrides and READY/other statuses are never touched.
UPDATE candidate_job_scores
SET overall_score = MAX(0, overall_score - 10),
    score_breakdown = CASE WHEN json_valid(score_breakdown) THEN json_set(score_breakdown, '$.ranking_v2', 'accessibility_unknown') ELSE score_breakdown END
WHERE candidate_id = 'sana_ansari'
  AND strategy_lane = 'STRONGEST_FIT'
  AND score_breakdown LIKE '%cloud-conservative-review-%'
  AND (NOT json_valid(score_breakdown) OR json_extract(score_breakdown, '$.ranking_v2') IS NULL)
  AND EXISTS (SELECT 1 FROM candidate_qualifications q WHERE q.candidate_id = candidate_job_scores.candidate_id AND q.job_id = candidate_job_scores.job_id
              AND q.manual_override_status IS NULL AND q.qualification_status IN ('NEEDS_REVIEW', 'HOLD')
              AND q.eligibility_status = 'ELIGIBLE' AND q.eligibility_reason = 'Posting is in an accessible Indian location.');

UPDATE candidate_qualifications
SET eligibility_status = 'UNKNOWN',
    eligibility_reason = 'Located in an Indian city. Whether a commercial airport is within about 2 hours of where the candidate would be based is not verified, so accessibility is unknown.'
WHERE candidate_id = 'sana_ansari'
  AND manual_override_status IS NULL
  AND qualification_status IN ('NEEDS_REVIEW', 'HOLD')
  AND eligibility_status = 'ELIGIBLE'
  AND eligibility_reason = 'Posting is in an accessible Indian location.';
