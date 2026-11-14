// Plan B1 (phase 4): employer names. Migration 0021 renames stored rows whose employer is a hiring-system id, never a job someone applied to or
// decided on, and only once; the shortlist then counts and caps by the display name (companyKey() of it) and no longer treats the row as a tenant id.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from './harness.mjs';
import { employerKey, tenantEmployer, shortlistTenant, tableName, selectShortlist, MARK } from '../scripts/shortlist_select.mjs';
import { audit } from '../scripts/shortlist_audit.mjs';
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

const SQL23 = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations', '0023_company_names_svkm.sql'), 'utf8');

test('migration 0023 names the SVKM tenant stored with its site, only on its own host, and is idempotent', () => {
  const { sqlite } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name) VALUES ('sana_ansari','Sana')`);
  const job = (id, company, url) => run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,original_posting_url,is_active,discovered_at) VALUES (?,?,?,?,?,?,1,'2026-11-01T00:00:00Z')`,
    id, 'Maintenance Supervisor', company, 'oracle', url, url);
  const host = 'https://fa-elxu-saasfaprod1.fa.ocs.oraclecloud.com/?keyword=&mode=jobs&lang=en&site_number=';
  job('e1', 'Fa Elxu Saasfaprod1 (CX_1001)', host + 'CX_1001#1');
  job('e2', 'Fa Elxu Saasfaprod1 (CX_1016)', host + 'CX_1016#2');
  job('e3', 'Fa Elxu Saasfaprod1 (CX_1001)', 'https://jobs.example/1');   // another host
  job('e4', 'Fa Elxu Saasfaprod1 (CX_1012)', host + 'CX_1012#4');   // applied to
  run(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('a4','sana_ansari','e4','APPLIED')`);
  sqlite.exec(SQL23); sqlite.exec(SQL23);
  const names = Object.fromEntries(sqlite.prepare('SELECT id, company FROM jobs').all().map((r) => [r.id, r.company]));
  assert.deepEqual(names, { e1: 'NMIMS', e2: 'SVKM', e3: 'Fa Elxu Saasfaprod1 (CX_1001)', e4: 'Fa Elxu Saasfaprod1 (CX_1012)' });
});

test('the selector and the audit share one tenant test: the stored name read through the names table (13 Nov run: 7 rows shortlisted, then failed by the audit)', () => {
  const url = 'https://hdga.fa.em3.oraclecloud.com/?site_number=Lucyelectric#26081', other = 'https://abcd.fa.em2.oraclecloud.com/?site_number=CX#1';
  assert.equal(tenantEmployer('Fa Elxu Saasfaprod1 (CX_1001)', 'oracle', 'https://fa-elxu-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1001#1'), true, 'a tenant id with its site');
  assert.equal(tenantEmployer('Hdga', 'jobsite', url), true, 'named like its oraclecloud.com host, whatever the source says');
  assert.equal(tenantEmployer('Wood', 'oracle_hcm', 'https://ehif.fa.em2.oraclecloud.com/x'), false);
  assert.equal(tenantEmployer('bmc', 'lever', 'https://jobs.lever.co/bmc/1'), false);
  assert.equal(tableName('Fa-Elxu-Saasfaprod1 (CX_1001)'), 'NMIMS');
  assert.equal(tableName('hdga'), 'Lucy Electric');
  const now = Date.parse('2026-11-13T12:00:00Z'), fresh = '2026-11-13T00:00:00Z';
  const row = (id, company, stored, u = url) => ({ kind: 'pool', candidate_id: 'sana_ansari', job_id: id, title: 'Maintenance Engineer ' + id, company, stored_company: stored, location: 'Pune, India',
    workplace: 'ONSITE', source: 'oracle', url: u, description: 'x'.repeat(400), active: 1, score: 85, skill_score: 60, eligibility: 'ELIGIBLE', status: 'NEEDS_REVIEW',
    reason: 'Cloud discovery match.', threshold: 60, marked: 1, target_exact: 0, last_verified_at: fresh, discovered_at: fresh });
  // o1: stored 'hdga' (migration not yet applied), the table names it; o2: already renamed; o3: an id the table does not know
  const pool = [row('o1', 'Lucy Electric', 'hdga'), row('o2', 'Lucy Electric', 'Lucy Electric'), row('o3', 'abcd', 'abcd', other)];
  assert.deepEqual(pool.map(shortlistTenant), [false, false, true]);
  const picked = selectShortlist(pool, { now }).changes.filter((c) => c.to !== 'NEEDS_REVIEW').map((c) => c.job_id).sort();
  assert.deepEqual(picked, ['o1', 'o2']);
  // the audit reads the stored names; had all three been shortlisted it fails exactly the row the selector kept off
  const stored = pool.map((r) => ({ kind: 'row', candidate_id: r.candidate_id, job_id: r.job_id, status: 'READY', company: r.stored_company, source: r.source, url: r.url,
    last_verified_at: fresh, active: 1, decided: 0, location: r.location, discovered_at: fresh }));
  assert.deepEqual(audit(stored, { now, relaxed: true }).problems, ['a tenant-id employer is on the shortlist (sana_ansari o3)']);
  assert.ok(MARK);
});
