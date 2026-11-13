// Plan B1 (phase 4): employer names. Migration 0021 renames stored rows whose employer is a hiring-system id, never a job someone applied to or
// decided on, and only once; the shortlist then counts and caps by the display name (companyKey() of it) and no longer treats the row as a tenant id.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from './harness.mjs';
import { employerKey, tenantEmployer } from '../scripts/shortlist_select.mjs';
import { companyKey } from '../worker/discovery.ts';

const SQL = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations', '0021_company_display_names.sql'), 'utf8');

test('migration 0021 names the stored tenant ids, skips decided and applied jobs, and is idempotent', () => {
  const { sqlite } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name) VALUES ('sana_ansari','Sana')`);
  const job = (id, company, url) => run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,original_posting_url,is_active,discovered_at) VALUES (?,?,?,?,?,?,1,'2026-11-01T00:00:00Z')`,
    id, 'Maintenance Engineer', company, 'ats', url, url);
  job('j1', 'mdlz', 'https://mdlz.wd3.myworkdayjobs.com/external/job/Baddi-India/x');
  job('j2', 'Fa Espx Saasfaprod1', 'https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1#1');
  job('j3', 'hdga', 'https://hdga.fa.em3.oraclecloud.com/?site_number=Lucyelectric#26081');
  job('j4', 'Egup', 'https://egup.fa.us2.oraclecloud.com/?site_number=CX#1');
  job('j5', 'egup', 'https://jobs.lever.co/egup/1');   // same letters, another host: not Vertiv
  job('j6', 'mdlz', 'https://mdlz.wd3.myworkdayjobs.com/external/job/x2');   // applied to
  job('j7', 'gohighlevel', 'https://jobs.lever.co/gohighlevel/1');   // a person's decision on it
  job('j8', 'Siemens Energy', 'https://jobs.siemens-energy.com/1');
  run(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('a6','sana_ansari','j6','APPLIED')`);
  run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,manual_override_status) VALUES ('sana_ansari','j7','HOLD','HOLD')`);
  sqlite.exec(SQL); sqlite.exec(SQL);
  const names = Object.fromEntries(sqlite.prepare('SELECT id, company FROM jobs').all().map((r) => [r.id, r.company]));
  assert.deepEqual(names, { j1: 'Mondelez International', j2: 'Cummins', j3: 'Lucy Electric', j4: 'Vertiv', j5: 'egup', j6: 'mdlz', j7: 'gohighlevel', j8: 'Siemens Energy' });
});

test('caps and dedupe use the display name: a renamed row and a row stored under the name are one employer', () => {
  assert.equal(employerKey({ company: 'Mondelez International' }), companyKey('Mondelez International'));
  assert.equal(employerKey({ company: 'GoHighLevel' }), employerKey({ company: 'GoHighLevel Inc.' }));
  assert.equal(tenantEmployer('Cummins', 'oracle', 'https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1#1'), false);
  assert.equal(tenantEmployer('Vertiv', 'oracle', 'https://egup.fa.us2.oraclecloud.com/?site_number=CX#1'), false);
  assert.equal(tenantEmployer('Fa Espx Saasfaprod1', 'oracle', 'https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/'), true, 'an unnamed tenant is still kept off the shortlist');
});
