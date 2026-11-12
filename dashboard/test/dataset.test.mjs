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

test('new jobs are scored by the screen, written once, shortlisted only by the rule, and board reports never claim eligibility', () => {
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
  // Ready / Stretch only through the automatic shortlist rule: confirmed eligibility and a score at the threshold is Ready, unconfirmed is Stretch.
  const short = w.sqlite.prepare(`SELECT q.candidate_id c, q.job_id j, q.qualification_status st, q.eligibility_status es, s.overall_score sc, q.qualification_reason r FROM candidate_qualifications q JOIN candidate_job_scores s USING(candidate_id, job_id) WHERE q.qualification_status IN ('READY','READY_HIGH','STRETCH_READY')`).all();
  assert.ok(short.length >= 1 && short.some((x) => x.j === 'ds:greenhouse:1' && x.st === 'READY'), JSON.stringify(short));
  for (const x of short) {
    assert.match(x.r, /^Shortlisted automatically\. /, 'marked, so it can be told from a person\'s decision');
    assert.ok(x.st === 'READY' ? x.es === 'ELIGIBLE' && x.sc >= 60 : x.st === 'STRETCH_READY' && (x.es === 'UNKNOWN' ? x.sc >= 60 : x.sc >= 50 && x.sc < 60), JSON.stringify(x));
  }
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

// QA 2026-11-09 (segment 4): the re-score SQL on a randomized mix of row states. Whatever the mix, protected rows must not change, only the
// two score tables may change, every changed row carries the marker, and running the same SQL again changes nothing.
test('re-score property: 400 random rows; applied, overridden, non-review and already-tagged rows never change; second run is a no-op', () => {
  let seed = 20261109; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const w = world();
  const STATUS = ['NEEDS_REVIEW', 'NEEDS_REVIEW', 'HOLD', 'READY', 'READY_HIGH', 'STRETCH_READY', 'INELIGIBLE'];
  const DESC = ['Configure the CRM and automation of workflows. Fully remote.', 'Active secret clearance required. Remote.', 'Electrical maintenance and reliability for the plant.',
    'On-site role. Not remote.', 'We offer visa sponsorship. Reliability programs.', 'US residents only. CRM automation.'];
  const insJob = w.sqlite.prepare(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at,description,location_restrictions,workplace_type) VALUES (?,?,?,?,?,?,?,?,?)`);
  const insQ = w.sqlite.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,manual_override_status,eligibility_status,eligibility_reason,qualification_reason) VALUES (?,?,?,?,?,?,?)`);
  const insS = w.sqlite.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES (?,?,?,?)`);
  const insA = w.sqlite.prepare(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,?)`);
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const cid = i % 2 ? F : S, job = `p${i}`, title = cid === F ? 'Implementation Manager' : 'Maintenance Engineer', loc = pick(['Remote - India', 'Pune, India', 'Remote', 'Houston, TX']);
    const desc = pick(DESC), st = pick(STATUS), ov = rnd() < 0.15 ? pick(['READY', 'INELIGIBLE']) : null, tagged = rnd() < 0.2, app = rnd() < 0.15;
    insJob.run(job, title, 'Co', 'lever', 1, '2026-11-01', desc, loc, 'REMOTE');
    insQ.run(cid, job, st, ov, 'UNKNOWN', 'orig-reason', 'orig-qual');
    insS.run(cid, job, 50, tagged ? '{"preliminary":true,"profile_v9":true}' : '{"preliminary":true}');
    if (app) insA.run(`a${i}`, cid, job, 'APPLIED');
    // an application by the OTHER candidate on the same job must not protect this row's score
    rows.push({ candidate_id: cid, job_id: job, title, location: loc, description: desc, workplace_type: 'REMOTE', score_breakdown: tagged ? '{"preliminary":true,"profile_v9":true}' : '{"preliminary":true}', _st: st, _ov: ov, _tagged: tagged, _app: app });
  }
  const snap = () => ({ q: w.sqlite.prepare(`SELECT * FROM candidate_qualifications ORDER BY 1,2`).all(), s: w.sqlite.prepare(`SELECT * FROM candidate_job_scores ORDER BY 1,2`).all(),
    jobs: JSON.stringify(w.sqlite.prepare(`SELECT * FROM jobs ORDER BY id`).all()), apps: JSON.stringify(w.sqlite.prepare(`SELECT * FROM applications ORDER BY id`).all()) });
  const key = (r) => r.candidate_id + '|' + r.job_id;
  fs.writeFileSync(path.join(w.dir, 'matches.json'), JSON.stringify({ jobs: [], closed: [] }));   // re-score only: no new jobs
  const before = snap();
  fs.writeFileSync(path.join(w.dir, 'rescore.json'), JSON.stringify(rows.map(({ _st, _ov, _tagged, _app, ...r }) => r)));
  const sql = run(w.dir, ['--rescore', path.join(w.dir, 'rescore.json')]).sql;
  w.sqlite.exec(sql);
  const after = snap();
  assert.equal(after.jobs, before.jobs, 'jobs table untouched by the re-score');
  assert.equal(after.apps, before.apps, 'applications untouched');
  const bq = new Map(before.q.map((r) => [key(r), r])), bs = new Map(before.s.map((r) => [key(r), r]));
  let changedScores = 0, changedQuals = 0;
  for (const r of rows) {
    const k = key(r), q0 = bq.get(k), s0 = bs.get(k), q1 = after.q.find((x) => key(x) === k), s1 = after.s.find((x) => key(x) === k);
    const protectedRow = r._app || r._ov !== null || !['NEEDS_REVIEW', 'HOLD'].includes(r._st);
    if (protectedRow) { assert.deepEqual(q1, q0, `qualification row must not change: ${k} ${JSON.stringify({ app: r._app, ov: r._ov, st: r._st })}`); assert.deepEqual(s1, s0, `score row must not change: ${k}`); continue; }
    if (r._tagged) { assert.deepEqual(s1, s0, `already-tagged score must not change: ${k}`); }
    else { assert.equal(JSON.parse(s1.score_breakdown).profile_v9, true, `re-scored row carries the marker: ${k}`); changedScores++; }
    if (JSON.stringify(q1) !== JSON.stringify(q0)) {
      changedQuals++;
      assert.ok(['NEEDS_REVIEW', 'HOLD'].includes(q0.qualification_status) && q0.manual_override_status === null, `only undecided review rows may change: ${k}`);
      assert.ok(q1.qualification_status === q0.qualification_status || q1.qualification_status === 'INELIGIBLE', `status may only move to INELIGIBLE: ${k}`);
    }
  }
  assert.ok(changedScores > 20 && changedQuals > 5, `the mix exercised the update paths (scores ${changedScores}, quals ${changedQuals})`);
  w.sqlite.exec(sql);
  assert.deepEqual(snap(), after, 'running the same SQL again changes nothing');
});

test('first-import rows the current screen never scored are screened fully, first-import Ready included; decided and applied rows are never touched', () => {
  const w = world();
  const db = w.sqlite;
  const job = (id, title, loc, desc) => db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, title, 'Acme', 'ashby', 'https://jobs.example/' + id, 1, loc, desc, 'REMOTE', '2026-10-26T00:00:00Z', 'LIVE_PUBLIC');
  const qual = (id, status, o = {}) => db.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,eligibility_reason,qualification_reason,manual_override_status) VALUES (?,?,?,?,?,?,?,?)`)
    .run(F, id, status, 'NOT_FIT', o.elig || 'UNKNOWN', o.eligReason || null, 'Preserved verified Farhan status with strategy lane mapping', o.override || null);
  const REMOTE = 'Fully remote role, open to candidates in India. You will configure our CRM and own workflow automation.';
  job('L1', 'Senior Brand Designer', 'Remote - India', 'Design our brand.');                 qual('L1', 'NEEDS_REVIEW');                         // wrong role, no score row
  job('L2', 'Implementation Manager', 'Remote - India', REMOTE);                             qual('L2', 'NEEDS_REVIEW');                         // right role, empty score row
  db.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES (?,?,0,'{}')`).run(F, 'L2');
  job('L3', 'Senior Brand Designer', 'Remote - India', 'Design.');                           qual('L3', 'NEEDS_REVIEW', { override: 'NEEDS_REVIEW' });   // a person decided
  job('L4', 'Senior Brand Designer', 'Remote - India', 'Design.');                           qual('L4', 'NEEDS_REVIEW');                         // has an application
  db.prepare(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('ap4',?,?,'SAVED')`).run(F, 'L4');
  job('L5', 'Senior Brand Designer', 'Remote - India', 'Design.');                           qual('L5', 'READY');                                // first-import Ready, wrong role
  db.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES (?,?,61,'{"rule":"old-engine"}')`).run(F, 'L5');
  job('L7', 'Senior Brand Designer', 'Remote - India', 'Design.');                           qual('L7', 'READY', { override: 'READY' });         // a person's Ready
  job('L6', 'Senior Brand Designer', 'Remote - India', 'Design.');                           qual('L6', 'NEEDS_REVIEW', { elig: 'ELIGIBLE', eligReason: 'India affirmative verified' });
  const before = (id) => JSON.stringify([db.prepare('SELECT * FROM candidate_qualifications WHERE job_id=?').get(id), db.prepare('SELECT * FROM candidate_job_scores WHERE job_id=?').get(id) || null]);
  const keep = Object.fromEntries(['L3', 'L4', 'L7'].map((id) => [id, before(id)]));
  const row = (id, title, desc) => ({ candidate_id: F, job_id: id, cur_score: 0, title, company: 'Acme', location: 'Remote - India', description: desc, workplace_type: 'REMOTE', score_breakdown: null, provenance: 'LIVE_PUBLIC', source_adapter: 'ashby', legacy: 1 });
  fs.writeFileSync(path.join(w.dir, 'rescore.json'), JSON.stringify([row('L1', 'Senior Brand Designer', 'Design our brand.'), row('L2', 'Implementation Manager', REMOTE),
    row('L3', 'Senior Brand Designer', 'Design.'), row('L4', 'Senior Brand Designer', 'Design.'), row('L5', 'Senior Brand Designer', 'Design.'), row('L6', 'Senior Brand Designer', 'Design.'), row('L7', 'Senior Brand Designer', 'Design.')]));
  const { sql, report } = run(w.dir, ['--rescore', path.join(w.dir, 'rescore.json')]);
  assert.equal(report.rescreened_legacy, 7, 'all seven were planned; the SQL guards decide what is written');
  db.exec(sql); db.exec(sql);   // twice: idempotent
  const q1 = db.prepare('SELECT qualification_status s, strategy_lane l FROM candidate_qualifications WHERE job_id=?');
  const s1 = db.prepare('SELECT overall_score o, score_breakdown b FROM candidate_job_scores WHERE job_id=?');
  assert.equal(q1.get('L1').s, 'HOLD', 'a role outside the target leaves To review');
  assert.match(s1.get('L1').b, /legacy_rescreen/, 'and gets a score row from the current screen');
  assert.equal(q1.get('L2').s, 'NEEDS_REVIEW'); assert.equal(q1.get('L2').l, 'STRONGEST_FIT');
  assert.ok(s1.get('L2').o > 0, `a fitting role stays in To review with a real score (${s1.get('L2').o})`);
  for (const id of ['L3', 'L4', 'L7']) assert.equal(before(id), keep[id], `${id} (override / application / a person's Ready) is byte-identical`);
  assert.equal(q1.get('L5').s, 'HOLD', 'a Ready row from the first import that the screen rules out leaves Ready');
  assert.equal(s1.get('L5').o, 0); assert.match(s1.get('L5').b, /legacy_rescreen/);
  const l6 = db.prepare('SELECT qualification_status s, eligibility_status e, eligibility_reason r FROM candidate_qualifications WHERE job_id=?').get('L6');
  assert.deepEqual([l6.s, l6.e, l6.r], ['HOLD', 'ELIGIBLE', 'India affirmative verified'], 'a verified eligibility is kept; the role still decides the bucket');
  const hist = db.prepare(`SELECT job_id j, previous_status p, new_status n FROM qualification_history WHERE actor='discovery' ORDER BY job_id`).all();
  assert.deepEqual(hist.map((h) => `${h.j}:${h.p}>${h.n}`), ['L1:NEEDS_REVIEW>HOLD', 'L5:READY>HOLD', 'L6:NEEDS_REVIEW>HOLD', 'ds:greenhouse:1:NEEDS_REVIEW>READY'], 'one history row per moved job, not repeated');
});

test('a row whose stored reason says it is outside the role family moves to Hold; decided and applied rows stay', () => {
  const w = world(); const db = w.sqlite;
  const OUT = 'Outside candidate target role family; retained for review.';
  const add = (id, status, reason, o = {}) => {
    db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,discovered_at) VALUES (?,?,?,?,?,1,?)`).run(id, 'Field Service Engineer', 'Acme', 'lever', 'https://x.example/' + id, '2026-11-01T00:00:00Z');
    db.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?)`).run(S, id, status, reason, o.override || null);
    if (o.app) db.prepare(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,'SAVED')`).run('ap' + id, S, id);
  };
  add('o1', 'NEEDS_REVIEW', OUT); add('o2', 'NEEDS_REVIEW', OUT + ' On-site abroad with no visa sponsorship.');
  add('o3', 'NEEDS_REVIEW', OUT, { override: 'NEEDS_REVIEW' }); add('o4', 'NEEDS_REVIEW', OUT, { app: true });
  add('o5', 'NEEDS_REVIEW', 'Cloud discovery match. Full requirements, pay and experience require review before READY.'); add('o6', 'READY', OUT);
  const { sql } = run(w.dir);
  db.exec(sql); db.exec(sql);
  const st = Object.fromEntries(db.prepare(`SELECT job_id j, qualification_status s FROM candidate_qualifications WHERE job_id LIKE 'o%'`).all().map((r) => [r.j, r.s]));
  assert.deepEqual(st, { o1: 'HOLD', o2: 'HOLD', o3: 'NEEDS_REVIEW', o4: 'NEEDS_REVIEW', o5: 'NEEDS_REVIEW', o6: 'READY' });
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM qualification_history WHERE new_status='HOLD' AND actor='discovery' AND job_id LIKE 'o%'`).get().c, 2, 'one history row each, not repeated');
});

test('stored Workable jobs wrongly marked remote are corrected; genuinely remote ones stay', () => {
  const w = world(); const db = w.sqlite;
  const add = (id, adapter, loc) => db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,workplace_type,location_restrictions,discovered_at) VALUES (?,?,?,?,?,1,'REMOTE_RESTRICTED',?,?)`)
    .run(id, 'Maintenance Engineer', 'Acme', adapter, 'https://x.example/' + id, loc, '2026-11-07T00:00:00Z');
  add('w1', 'workable', 'Norton Canes, United Kingdom'); add('w2', 'workable', 'Remote (Pune, India)'); add('w3', 'lever', 'Norton Canes, United Kingdom');
  const { sql } = run(w.dir); db.exec(sql); db.exec(sql);
  const wt = Object.fromEntries(db.prepare(`SELECT id, workplace_type t FROM jobs WHERE id LIKE 'w_'`).all().map((r) => [r.id, r.t]));
  assert.deepEqual(wt, { w1: 'UNKNOWN', w2: 'REMOTE_RESTRICTED', w3: 'REMOTE_RESTRICTED' });
});

test('automatic shortlist: tiers, the cap of 25, stale and unscreened rows stay out, a row that stops qualifying returns, decisions are never touched', () => {
  const w = world();
  const db = w.sqlite;
  fs.writeFileSync(path.join(w.dir, 'matches.json'), JSON.stringify({ jobs: [], closed: [] }));
  const NOW = new Date().toISOString(), OLD = new Date(Date.now() - 6 * 86400000).toISOString();
  const V8 = '{"preliminary":true,"profile_v9":true}';
  const add = (id, score, elig, o = {}) => {
    db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,discovered_at,last_verified_at) VALUES (?,?,?,?,?,?,?,?)`).run(id, 'T ' + id, 'Acme', 'ashby', 'https://jobs.example/' + id, o.active ?? 1, OLD, o.verified ?? NOW);
    db.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?,?)`).run(F, id, o.status || 'NEEDS_REVIEW', elig, o.reason ?? 'Cloud discovery match.', o.override || null);
    db.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,score_breakdown) VALUES (?,?,?,?,?)`).run(F, id, score, o.skill ?? 40, o.bd || V8);
    if (o.app) db.prepare(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,'SAVED')`).run('ap' + id, F, id);
  };
  add('r1', 80, 'ELIGIBLE'); add('r2', 60, 'ELIGIBLE');                       // Ready
  add('s1', 75, 'UNKNOWN'); add('s2', 55, 'ELIGIBLE');                        // Stretch: eligibility to confirm / just under the threshold
  add('n1', 59, 'UNKNOWN'); add('n2', 49, 'ELIGIBLE');                        // below both rules
  add('n3', 90, 'ELIGIBLE', { verified: OLD });                               // not verified open recently
  add('n4', 90, 'ELIGIBLE', { bd: '{"preliminary":true}' });                  // not screened under the current rules
  add('n5', 90, 'ELIGIBLE', { skill: 0 });                                    // title match only, no profile skill named
  add('n6', 90, 'ELIGIBLE', { active: 0 });                                   // closed
  add('n7', 90, 'ELIGIBLE', { status: 'HOLD' });                              // Hold is not promoted
  add('d1', 90, 'ELIGIBLE', { override: 'NEEDS_REVIEW' }); add('d2', 90, 'ELIGIBLE', { app: true });   // a person's decision / an application
  add('d3', 10, 'UNKNOWN', { status: 'READY', override: 'READY', reason: 'Shortlisted automatically. Cloud discovery match.' });   // confirmed by a person
  add('d4', 10, 'UNKNOWN', { status: 'READY', reason: 'Strongest Fit verified match (61%)' });         // Ready without the mark: not ours to demote
  add('x1', 20, 'ELIGIBLE', { status: 'READY', reason: 'Shortlisted automatically. Cloud discovery match.' });   // shortlisted earlier, score since fell
  add('x2', 70, 'ELIGIBLE', { status: 'STRETCH_READY', reason: 'Shortlisted automatically. Cloud discovery match.' });   // eligibility since confirmed: moves up
  for (let i = 0; i < 30; i++) add('b' + String(i).padStart(2, '0'), 51 + i % 3, 'ELIGIBLE');           // 30 more Stretch candidates: only the cap fits
  add('t1', 85, 'ELIGIBLE'); add('t2', 84, 'ELIGIBLE'); add('t3', 83, 'ELIGIBLE');                         // the same job in three cities
  for (const id of ['t2', 't3']) db.prepare(`UPDATE jobs SET title = 'T t1' WHERE id = ?`).run(id);
  const st = () => Object.fromEntries(db.prepare(`SELECT job_id j, qualification_status s FROM candidate_qualifications WHERE candidate_id=?`).all(F).map((r) => [r.j, r.s]));
  const { sql } = run(w.dir);
  db.exec(sql);
  const a = st();
  assert.deepEqual([a.r1, a.r2, a.x2], ['READY', 'READY', 'READY']);
  assert.deepEqual([a.t1, a.t2, a.t3], ['READY', 'NEEDS_REVIEW', 'NEEDS_REVIEW'], 'one place per employer and title: the best-scored twin');
  assert.deepEqual([a.s1, a.s2], ['STRETCH_READY', 'STRETCH_READY']);
  for (const id of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'd1', 'd2', 'x1']) assert.equal(a[id], 'NEEDS_REVIEW', id);
  assert.equal(a.n7, 'HOLD'); assert.equal(a.d3, 'READY'); assert.equal(a.d4, 'READY');
  assert.equal(Object.values(a).filter((s) => s === 'STRETCH_READY').length, 25, 'at most 25 Stretch per person, best first');
  assert.equal(a.s1, 'STRETCH_READY', 'the best score is inside the cap');
  const reason = (id) => db.prepare(`SELECT qualification_reason r FROM candidate_qualifications WHERE job_id=?`).get(id).r;
  assert.equal(reason('r1'), 'Shortlisted automatically. Cloud discovery match.');
  assert.equal(reason('x1'), 'Cloud discovery match.', 'the mark is removed when a row leaves the shortlist');
  assert.equal(reason('x2'), 'Shortlisted automatically. Cloud discovery match.', 'moved up a tier: marked once, not twice');
  const hist = db.prepare(`SELECT job_id j, previous_status p, new_status n FROM qualification_history WHERE actor='discovery' AND job_id IN ('r1','x1','x2') ORDER BY id`).all().map((h) => `${h.j}:${h.p}>${h.n}`);
  assert.deepEqual(hist.sort(), ['r1:NEEDS_REVIEW>READY', 'x1:READY>NEEDS_REVIEW', 'x2:NEEDS_REVIEW>READY', 'x2:STRETCH_READY>NEEDS_REVIEW']);
  // the same SQL again, and a fresh run on the result, change nothing
  const snap = () => JSON.stringify([db.prepare('SELECT * FROM candidate_qualifications ORDER BY 1,2').all(), db.prepare('SELECT COUNT(*) n FROM qualification_history').get()]);
  const before = snap();
  db.exec(sql); db.exec(run(w.dir).sql);
  const strip = (x) => x.replace(/"last_reverified_at":"[^"]*"/g, '');
  assert.equal(strip(snap()), strip(before));
  // a shortlisted posting that is no longer verified open drops back to review
  db.prepare(`UPDATE jobs SET last_verified_at = ? WHERE id = 'r1'`).run(OLD);
  assert.doesNotMatch(run(w.dir, ['--no-shortlist']).sql, /Shortlisted automatically/, 'the watchlist run skips the step');
  const split = path.join(w.dir, 'shortlist.sql');
  const sp = run(w.dir, ['--shortlist-out', split]);
  assert.doesNotMatch(sp.sql, /Shortlisted automatically/, 'with --shortlist-out the step leaves the main file');
  assert.match(fs.readFileSync(split, 'utf8'), /Shortlisted automatically[\s\S]*generation = generation \+ 1/, 'and goes to its own file, which refreshes the public cache');
  db.exec(run(w.dir).sql);
  assert.equal(st().r1, 'NEEDS_REVIEW');
});
