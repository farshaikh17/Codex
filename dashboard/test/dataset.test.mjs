// The discovery pipeline's write step (scripts/dataset_apply.mjs): runs the SQL it generates against a database with the real
// migrations, and checks which rows it writes, with what, and what it never touches.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = 'farhan_shaikh', S = 'sana_ansari';
const SK_F = JSON.stringify(['CRM Configuration', 'Workflow Automation', 'GoHighLevel']);
const SK_S = JSON.stringify(['Electrical Maintenance', 'Reliability']);

function run(dir, extra = []) {
  const out = path.join(dir, 'apply.sql');
  execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/dataset_apply.mjs', '--candidates', path.join(dir, 'candidates.json'),
    '--in', path.join(dir, 'matches.json'), '--out', out, ...extra], { cwd: root, stdio: 'pipe' });
  return { sql: fs.readFileSync(out, 'utf8'), report: JSON.parse(fs.readFileSync(path.join(dir, 'apply.report.json'), 'utf8')) };
}
function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
  const { sqlite } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id,full_name,primary_skills) VALUES (?,?,?),(?,?,?)`).run(F, 'F', SK_F, S, 'S', SK_S);
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify([{ id: F, primary_skills: SK_F, search_profile: null }, { id: S, primary_skills: SK_S, search_profile: null }]));
  const job = (id, title, location, description, cands, o = {}) => ({ id, url: `https://boards.example/${id}`, title, company: 'Acme', ats_type: 'greenhouse', location, country_iso: 'IN',
    is_remote: /remote/i.test(location), description, posted_at: '2026-11-05', candidates: cands, ...o });
  const matches = { jobs: [
    job('ds:greenhouse:1', 'Implementation Manager', 'Remote - India', 'Fully remote role. You will configure our CRM and own automation of sales workflows.', [F]),
    job('ds:greenhouse:2', 'Maintenance Engineer', 'Pune, India', 'Electrical maintenance and reliability programs for the plant.', [S]),
    job('ds:greenhouse:3', 'Security Operations Engineer', 'Remote - India', 'Active secret clearance required.', [F]),                // ineligible: skipped
    job('ds:greenhouse:4', 'Operations Associate', 'Remote - India', 'General office work.', [F]),                                     // role match, weak: kept or skipped by score
    job('js:naukri:5', 'Implementation Lead', 'Remote - Bengaluru, India', 'Fully remote role. Implementation of CRM automation.', [F], { board: true, ats_type: 'naukri' }),
  ], closed: [] };
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify(matches));
  return { dir, sqlite };
}

test('new jobs are scored by the screen, written once, never READY, and board reports never claim eligibility', () => {
  const w = world();
  const { sql, report } = run(w.dir);
  w.sqlite.exec(sql);
  const q = (c, j) => w.sqlite.prepare(`SELECT q.qualification_status st, q.eligibility_status es, s.overall_score sc, s.score_breakdown bd FROM candidate_qualifications q JOIN candidate_job_scores s USING(candidate_id, job_id) WHERE q.candidate_id=? AND q.job_id=?`).get(c, j);
  assert.equal(q(F, 'ds:greenhouse:1').es, 'ELIGIBLE');
  assert.ok(q(F, 'ds:greenhouse:1').sc >= 60, 'role match with two skills found by key words, remote from India');
  assert.equal(JSON.parse(q(F, 'ds:greenhouse:1').bd).skills_v1, true);
  assert.equal(q(S, 'ds:greenhouse:2').es, 'UNKNOWN', 'on-site in an Indian city: accessibility unverified (owner rule)');
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM jobs WHERE id='ds:greenhouse:3'`).get().n, 0, 'an ineligible posting is not stored');
  assert.equal(q(F, 'js:naukri:5').es, 'UNKNOWN', 'a job-board report never claims eligibility');
  assert.equal(w.sqlite.prepare(`SELECT provenance p, source_channel c FROM jobs WHERE id='js:naukri:5'`).get().p, 'PUBLIC_FEED_UNVERIFIED');
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM candidate_qualifications WHERE qualification_status IN ('READY','READY_HIGH','STRETCH_READY')`).get().n, 0);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM candidate_qualifications WHERE candidate_id=? AND job_id='ds:greenhouse:1'`).get(S).n, 0, 'only the candidates the job was selected for');
  assert.ok(report.new_jobs >= 3 && report.skipped_ineligible === 1, JSON.stringify(report));
  // the same SQL again changes nothing
  const before = JSON.stringify(['jobs', 'candidate_qualifications', 'candidate_job_scores'].map((t) => w.sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
  w.sqlite.exec(sql);
  assert.equal(JSON.stringify(['jobs', 'candidate_qualifications', 'candidate_job_scores'].map((t) => w.sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all())), before);
});

test('an application or a human decision already on a job is never written over', () => {
  const w = world();
  w.sqlite.exec(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at) VALUES ('ds:greenhouse:1','Implementation Manager','Acme','greenhouse',1,'2026-11-01')`);
  w.sqlite.exec(`INSERT INTO applications(id,candidate_id,job_id,status,notes) VALUES ('a1','${F}','ds:greenhouse:1','APPLIED','kept')`);
  w.sqlite.exec(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at) VALUES ('ds:greenhouse:2','Maintenance Engineer','Acme','greenhouse',1,'2026-11-01')`);
  w.sqlite.exec(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,manual_override_status,manual_override_reason) VALUES ('${S}','ds:greenhouse:2','READY','READY','human')`);
  w.sqlite.exec(run(w.dir).sql);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM candidate_qualifications WHERE candidate_id='${F}' AND job_id='ds:greenhouse:1'`).get().n, 0, 'no row next to an application');
  assert.equal(w.sqlite.prepare(`SELECT title FROM jobs WHERE id='ds:greenhouse:1'`).get().title, 'Implementation Manager');
  assert.deepEqual({ ...w.sqlite.prepare(`SELECT qualification_status st, manual_override_status o FROM candidate_qualifications WHERE candidate_id='${S}' AND job_id='ds:greenhouse:2'`).get() }, { st: 'READY', o: 'READY' });
  assert.equal(w.sqlite.prepare(`SELECT notes FROM applications WHERE id='a1'`).get().notes, 'kept');
});

test('closures only touch this pipeline’s jobs, and never one with an application or a decision; the new-job cap holds', () => {
  const w = world();
  for (const [id, ch] of [['ds:x:1', 'ATS_DATASET'], ['ds:x:2', 'ATS_DATASET'], ['ds:x:3', 'ATS_DATASET'], ['lever:acme:9', 'PUBLIC_ATS']])
    w.sqlite.prepare(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at,source_channel) VALUES (?,?,?,?,1,'2026-11-01',?)`).run(id, 'T', 'C', 'greenhouse', ch);
  w.sqlite.exec(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('a2','${F}','ds:x:2','SAVED')`);
  w.sqlite.exec(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,manual_override_status) VALUES ('${F}','ds:x:3','HOLD','HOLD')`);
  const m = JSON.parse(fs.readFileSync(path.join(w.dir, 'matches.json'), 'utf8'));
  m.closed = ['ds:x:1', 'ds:x:2', 'ds:x:3', 'lever:acme:9'];
  fs.writeFileSync(path.join(w.dir, 'matches.json'), JSON.stringify(m));
  const { sql, report } = run(w.dir, ['--max-new', '1']);
  w.sqlite.exec(sql);
  const active = Object.fromEntries(w.sqlite.prepare(`SELECT id, is_active a FROM jobs WHERE id IN ('ds:x:1','ds:x:2','ds:x:3','lever:acme:9')`).all().map((r) => [r.id, r.a]));
  assert.deepEqual(active, { 'ds:x:1': 0, 'ds:x:2': 1, 'ds:x:3': 1, 'lever:acme:9': 1 });
  assert.equal(report.new_jobs, 1, 'the cap holds');
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM jobs WHERE id LIKE 'ds:greenhouse:%' OR id LIKE 'js:%'`).get().n, 1);
});

test('re-score: only screen-owned rows without skills scoring, never a decided or applied row; tagged so it runs once', () => {
  const w = world();
  w.sqlite.exec(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at,description,location_restrictions,workplace_type) VALUES
    ('j1','Implementation Manager','A','lever',1,'2026-11-01','Configure the CRM and automation of workflows.','Remote - India','REMOTE'),
    ('j2','Implementation Manager','A','lever',1,'2026-11-01','Configure the CRM and automation of workflows.','Remote - India','REMOTE')`);
  w.sqlite.exec(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status) VALUES ('${F}','j1','NEEDS_REVIEW'),('${F}','j2','READY')`);
  w.sqlite.exec(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES ('${F}','j1',50,'{"preliminary":true}'),('${F}','j2',50,'{"preliminary":true}')`);
  fs.writeFileSync(path.join(w.dir, 'rescore.json'), JSON.stringify([
    { candidate_id: F, job_id: 'j1', title: 'Implementation Manager', location: 'Remote - India', description: 'Configure the CRM and automation of workflows.', workplace_type: 'REMOTE', score_breakdown: '{"preliminary":true}' },
    { candidate_id: F, job_id: 'j2', title: 'Implementation Manager', location: 'Remote - India', description: 'Configure the CRM and automation of workflows.', workplace_type: 'REMOTE', score_breakdown: '{"preliminary":true}' }]));
  const { sql } = run(w.dir, ['--rescore', path.join(w.dir, 'rescore.json')]);
  w.sqlite.exec(sql);
  const s = (j) => w.sqlite.prepare(`SELECT overall_score sc, score_breakdown bd FROM candidate_job_scores WHERE candidate_id='${F}' AND job_id=?`).get(j);
  assert.ok(s('j1').sc > 50 && JSON.parse(s('j1').bd).skills_v1 === true, JSON.stringify(s('j1')));
  assert.equal(s('j2').sc, 50, 'a READY row is a human-level status: not re-scored');
  const again = run(w.dir, ['--rescore', path.join(w.dir, 'rescore.json')]).sql;
  const once = s('j1').sc;
  w.sqlite.exec(again);
  assert.equal(s('j1').sc, once, 'tagged rows are not re-scored again');
});

test('reopen, two-run closures, job-site expiry and storage clean-up; hostile field values are stored safely', () => {
  const w = world();
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  const ins = w.sqlite.prepare(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at,source_channel,expired_at,description) VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run('ds:r:1', 'T', 'C', 'greenhouse', 0, '2026-10-01', 'ATS_DATASET', '2026-11-05', 'kept text');     // came back: reopen
  ins.run('lever:x:1', 'T', 'C', 'lever', 0, '2026-10-01', 'PUBLIC_ATS', '2026-11-05', null);              // not ours: never reopened
  ins.run('js:old:1', 'T', 'C', 'naukri', 1, old, 'JOB_SITES', null, 'board text');                         // job-site, 40 days: expires
  ins.run('js:old:2', 'T', 'C', 'naukri', 1, old, 'JOB_SITES', null, 'board text');                         // same, but applied to: stays
  ins.run('ds:gone:1', 'T', 'C', 'greenhouse', 0, '2026-09-01', 'ATS_DATASET', old, 'long-closed text');    // closed 40 days ago: text dropped
  w.sqlite.exec(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('a3','${F}','js:old:2','APPLIED')`);
  const m = JSON.parse(fs.readFileSync(path.join(w.dir, 'matches.json'), 'utf8'));
  Object.assign(m, { reopen: ['ds:r:1', 'lever:x:1'], missing_mark: ['ds:m:1'], missing_clear: [], ats_counts: { greenhouse: 178125 } });
  m.jobs.push({ id: 'ds:greenhouse:9', url: 'https://boards.example/9', title: "Implementation Manager \u0000 O'Brien\\", company: 'Acme\u0007 Ltd', ats_type: 'greenhouse',
    location: 'Remote - India', is_remote: true, description: 'Configure the CRM and automation of workflows. ' + 'x'.repeat(20000), salary_min: 'Infinity', salary_summary: 's'.repeat(50000), candidates: [F] });
  m.jobs.push({ id: 'ds:greenhouse:10', url: 'https://x/' + 'a'.repeat(3000), title: 'Implementation Manager', company: 'Acme', ats_type: 'greenhouse', location: 'Remote - India', is_remote: true, description: 'CRM', candidates: [F] });
  fs.writeFileSync(path.join(w.dir, 'matches.json'), JSON.stringify(m));
  w.sqlite.exec(run(w.dir).sql);
  const job = (id) => w.sqlite.prepare('SELECT is_active a, description d, title t, company c, salary_published sp, salary_raw_text st FROM jobs WHERE id = ?').get(id);
  assert.equal(job('ds:r:1').a, 1); assert.equal(job('ds:r:1').d, 'kept text');
  assert.equal(job('lever:x:1').a, 0, 'only this pipeline’s jobs are reopened');
  assert.equal(job('js:old:1').a, 0); assert.equal(job('js:old:2').a, 1, 'a job someone applied to never expires');
  assert.equal(job('ds:gone:1').d, null);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM discovery_missing WHERE job_id='ds:m:1'`).get().n, 1, 'first miss is recorded, not closed');
  assert.equal(JSON.parse(w.sqlite.prepare(`SELECT value FROM discovery_state WHERE key='ats_counts'`).get().value).greenhouse, 178125);
  const h = job('ds:greenhouse:9');
  assert.equal(h.t, "Implementation Manager   O'Brien\\", 'control characters removed, quotes and backslashes kept');
  assert.equal(h.c, 'Acme  Ltd');
  assert.ok(h.d.length <= 6000 && h.st.length <= 300 && h.sp === 0, 'every field bounded; infinite pay is not "published"');
  assert.equal(job('ds:greenhouse:10'), undefined, 'an absurd URL is skipped, not written');
});
