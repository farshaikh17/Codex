// Synthetic, disposable rows. No real postings, people or decisions.
export function seed(sqlite) {
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,citizenship,education,primary_timezone,total_years_experience,qualification_threshold) VALUES
       ('farhan_shaikh','Test Farhan','PRIVATECITY-7f3, India','India',NULL,'Asia/Kolkata',4,70),
       ('sana_ansari','Test Sana','PRIVATECITY-7f3, India','India','B.Tech in Electrical Engineering','Asia/Kolkata',9.2,60)`);
  const job = (id, company, active, src, srcId, salary = 0) =>
    run(`INSERT INTO jobs(id,title,company,source_adapter,source_id,is_active,salary_published,discovered_at) VALUES (?,?,?,?,?,?,?,'2026-11-01T00:00:00Z')`,
        id, 'Role ' + id, company, src, srcId, active, salary);
  const qual = (cand, id, status, elig, override = null) =>
    run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,manual_override_status,manual_override_reason) VALUES (?,?,?,?,?,?)`,
        cand, id, status, elig, override, override ? 'seed decision' : null);
  const score = (cand, id, n) => run(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score) VALUES (?,?,?)`, cand, id, n);

  job('j1', 'Acme', 1, 'lever', 'lever:acme', 1);
  job('j2', 'Acme', 1, 'lever', 'lever:acme');
  job('j3', 'Beta', 1, 'greenhouse', 'greenhouse:beta');
  job('j4', 'Gamma', 1, 'ashby', null);            // arrived through the collector import, no monitored source
  job('j5', 'Gamma', 0, 'ashby', null);            // inactive: must be outside every count
  for (const id of ['j1', 'j2', 'j3', 'j4', 'j5']) {
    qual('farhan_shaikh', id, 'NEEDS_REVIEW', 'UNKNOWN'); qual('sana_ansari', id, 'NEEDS_REVIEW', 'UNKNOWN');
  }
  sqlite.prepare(`UPDATE candidate_qualifications SET qualification_status='READY',eligibility_status='ELIGIBLE' WHERE candidate_id='farhan_shaikh' AND job_id='j1'`).run();
  sqlite.prepare(`UPDATE candidate_qualifications SET qualification_status='STRETCH_READY',eligibility_status='ELIGIBLE' WHERE candidate_id='farhan_shaikh' AND job_id='j2'`).run();
  sqlite.prepare(`UPDATE candidate_qualifications SET qualification_status='INELIGIBLE',eligibility_status='ELIGIBLE',manual_override_status='INELIGIBLE',manual_override_reason='seed decision' WHERE candidate_id='farhan_shaikh' AND job_id='j3'`).run();
  sqlite.prepare(`UPDATE candidate_qualifications SET qualification_status='READY',eligibility_status='ELIGIBLE' WHERE candidate_id='sana_ansari' AND job_id='j4'`).run();
  sqlite.prepare(`UPDATE candidate_qualifications SET eligibility_status='ELIGIBLE' WHERE candidate_id='sana_ansari' AND job_id IN ('j3','j5')`).run();
  for (const [c, id, n] of [['farhan_shaikh','j1',80],['farhan_shaikh','j2',55],['farhan_shaikh','j3',64],['farhan_shaikh','j4',20],['sana_ansari','j4',75],['sana_ansari','j3',40]]) score(c, id, n);

  run(`INSERT INTO applications(id,candidate_id,job_id,status,notes,application_channel,resume_version,cover_letter_path,rejection_notes,rejection_stage,rejection_reason_category) VALUES
       ('app-1','farhan_shaikh','j1','APPLIED','PRIVATE-NOTE-7f3','PRIVATE-CHANNEL-7f3','PRIVATE-RESUME-7f3','PRIVATE-COVER-7f3','PRIVATE-REJECT-7f3','PRIVATE-STAGE-7f3','PRIVATE-CATEGORY-7f3'),
       ('app-2','farhan_shaikh','j2','SAVED','PRIVATE-NOTE-7f3',NULL,NULL,NULL,NULL,NULL,NULL)`);
  run(`INSERT INTO application_history(candidate_id,job_id,application_id,new_status,actor,source) VALUES ('farhan_shaikh','j1','app-1','APPLIED','PRIVATE-ACTOR-7f3','test')`);
  run(`INSERT INTO cloud_sources(id,kind,slug,name,enabled,last_status,last_attempt_at,last_success_at,last_error,failures) VALUES
       ('lever:acme','lever','acme','Acme',1,'SUCCESS','2026-11-04T10:00:00Z','2026-11-04T10:00:00Z',NULL,0),
       ('greenhouse:beta','greenhouse','beta','Beta',1,'ERROR','2026-11-04T11:00:00Z','2026-11-03T11:00:00Z','HTTP 500',3),
       ('lever:idle','lever','idle','Idle',1,'NEVER_RUN',NULL,NULL,NULL,0)`);
  run(`INSERT INTO cloud_discovery_runs(id,trigger_type,run_type,status,started_at,error_message) VALUES ('run-1','CRON','WORK_UNIT','ERROR','2026-11-05T10:00:00Z','PRIVATE-RUNERR-7f3 fetch https://internal.example/x failed')`);
}
