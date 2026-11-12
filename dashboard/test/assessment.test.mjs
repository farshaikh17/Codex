// The assessment of collector imports: which rows change, to what, and which rows are never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv } from './harness.mjs';
import { assessBacklog, evaluate, ASSESS_EVERY_TICKS } from '../worker/discovery.ts';

const F = 'farhan_shaikh', S = 'sana_ansari';
const FSKILLS = JSON.stringify(['CRM Configuration', 'Workflow Automation', 'Salesforce']);
const SSKILLS = JSON.stringify(['Reliability', 'Plant Engineering', 'Maintenance']);
const UNASSESSED_REASON = '[GITHUB_COLLECTOR] Unassessed public ATS posting from acme-lever; review pending';

function world() {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,citizenship,primary_timezone,total_years_experience,qualification_threshold,primary_skills) VALUES
       (?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?)`, F, 'F', 'India', 'India', 'Asia/Kolkata', 4, 70, FSKILLS, S, 'S', 'India', 'India', 'Asia/Kolkata', 9, 60, SSKILLS);
  const job = (id, title, location, description, { workplace = 'ONSITE', active = 1 } = {}) =>
    run(`INSERT INTO jobs(id,title,company,source_adapter,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id, title, 'Acme', 'lever', active, location, description, workplace, '2026-11-01T00:00:00Z', 'GITHUB_PUBLIC_DISCOVERY');
  // Exactly what engine/collector_importer.py writes for every candidate.
  const imported = (cand, id, extra = {}) => {
    run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,eligibility_reason,qualification_reason,manual_override_status,manual_override_reason)
         VALUES (?,?,?,?,?,?,?,?,?)`, cand, id, extra.status || 'NEEDS_REVIEW', 'UNASSIGNED', 'UNKNOWN', 'Automated collector discovery from acme-lever; employer availability and geographic eligibility unverified',
      extra.reason || UNASSESSED_REASON, extra.override || null, extra.override ? 'human decision' : null);
    run(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES (?,?,0,?)`, cand, id, JSON.stringify({ source: 'github_public_collector', state: 'UNASSESSED', overall_score: 0 }));
  };
  job('a1', 'Implementation Manager', 'Remote - India', 'Fully remote role. CRM Configuration and Workflow Automation for Salesforce customers.', { workplace: 'REMOTE' });
  job('a2', 'Reliability Engineer', 'Mumbai, India', 'Plant reliability and maintenance engineering.');
  job('a3', 'Security Operations Engineer', 'Remote', 'Active secret clearance required. Automation of workflows.', { workplace: 'REMOTE' });
  job('a4', 'Implementation Lead', 'Remote - India', 'CRM Configuration.', { workplace: 'REMOTE' });   // applied to by Farhan
  job('a5', 'Solutions Engineer', 'Remote - India', 'Salesforce.', { workplace: 'REMOTE' });          // human override for Farhan
  job('a6', 'Operations Manager', 'Remote - India', 'Workflow Automation.', { workplace: 'REMOTE', active: 0 });
  job('a7', 'Implementation Consultant', 'Remote - India', 'CRM.', { workplace: 'REMOTE' });         // already assessed by discovery
  for (const c of [F, S]) for (const id of ['a1', 'a2', 'a3', 'a6']) imported(c, id);
  imported(F, 'a4'); run(`INSERT INTO applications(id,candidate_id,job_id,status,notes) VALUES ('app1',?,?,?,?)`, F, 'a4', 'APPLIED', 'note');
  imported(F, 'a5', { status: 'READY', override: 'READY' });
  imported(F, 'a7', { reason: 'Cloud discovery match. Full requirements, pay and experience require review before READY.' });
  return { sqlite, d1, run };
}
const row = (w, c, j) => w.sqlite.prepare(`SELECT q.qualification_status st, q.strategy_lane lane, q.eligibility_status es, q.eligibility_reason er, q.qualification_reason qr, s.overall_score score, s.score_breakdown bd
  FROM candidate_qualifications q JOIN candidate_job_scores s USING(candidate_id, job_id) WHERE q.candidate_id=? AND q.job_id=?`).get(c, j);
const snap = (w) => JSON.stringify(['applications', 'application_history', 'qualification_history', 'candidate_qualifications', 'candidate_job_scores'].map((t) => w.sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));

test('assessment writes exactly what evaluate() decides for each unassessed collector row, for both candidates', async () => {
  const w = world();
  const res = await assessBacklog(w.d1, 40, '2026-11-06T20:00:00Z');
  assert.equal(res.assessed, 6);   // a1, a2, a3 for both candidates; a4 (applied), a5 (override), a6 (inactive), a7 (assessed) are not candidates
  const posting = (id) => { const j = w.sqlite.prepare('SELECT * FROM jobs WHERE id=?').get(id); return { id, title: j.title, url: '', location: j.location_restrictions, description: j.description, remote: /^REMOTE/.test(j.workplace_type) }; };
  for (const [c, skills] of [[F, FSKILLS], [S, SSKILLS]]) for (const id of ['a1', 'a2', 'a3']) {
    const want = evaluate({ id: c, primary_skills: skills }, posting(id)), got = row(w, c, id);
    assert.deepEqual([got.st, got.lane, got.es, got.er, got.qr, got.score], [want.status, want.lane, want.eligibility, want.reason, want.qualification_reason, want.score], `${c} ${id}`);
    assert.equal(JSON.parse(got.bd).assessed_from, 'github_collector');
  }
  // the concrete classes, so a change in evaluate() that breaks them is visible here too
  assert.deepEqual([row(w, F, 'a1').st, row(w, F, 'a1').es, row(w, F, 'a1').lane], ['NEEDS_REVIEW', 'ELIGIBLE', 'STRONGEST_FIT']);
  assert.ok(row(w, F, 'a1').score >= 60, 'three matched skills, remote from India: a real score instead of 0');
  assert.deepEqual([row(w, S, 'a1').st, row(w, S, 'a1').es], ['HOLD', 'ELIGIBLE']);                          // outside Sana's role family
  assert.deepEqual([row(w, S, 'a2').st, row(w, S, 'a2').es], ['NEEDS_REVIEW', 'ELIGIBLE']);                  // on-site in an Indian city: workable (owner decision 2026-11-12)
  assert.deepEqual([row(w, F, 'a2').st], ['INELIGIBLE']);                                                  // not remote: Farhan is remote only (owner rule 2026-11-07)
  for (const c of [F, S]) assert.equal(row(w, c, 'a3').st, 'INELIGIBLE');                                    // clearance requirement
  assert.equal(w.sqlite.prepare("SELECT COUNT(*) n FROM candidate_qualifications WHERE qualification_status IN ('READY','READY_HIGH','STRETCH_READY') AND manual_override_status IS NULL").get().n, 0, 'the screen never promotes anything to READY');
});

test('assessment never touches applied, overridden, inactive or already-assessed rows, or any human record', async () => {
  const w = world();
  const before = Object.fromEntries([['a4', F], ['a5', F], ['a6', F], ['a6', S], ['a7', F]].map(([j, c]) => [c + j, row(w, c, j)]));
  const humans = JSON.stringify(['applications', 'application_history', 'qualification_history'].map((t) => w.sqlite.prepare(`SELECT * FROM ${t}`).all()));
  await assessBacklog(w.d1, 40);
  for (const [k, v] of Object.entries(before)) assert.deepEqual(row(w, k.slice(0, -2), k.slice(-2)), v, k);
  assert.equal(JSON.stringify(['applications', 'application_history', 'qualification_history'].map((t) => w.sqlite.prepare(`SELECT * FROM ${t}`).all())), humans);
});

test('assessment is bounded per batch, finishes the backlog, and a further run changes nothing', async () => {
  const w = world();
  assert.equal((await assessBacklog(w.d1, 2)).assessed, 2);
  assert.equal((await assessBacklog(w.d1, 2)).assessed, 2);
  assert.equal((await assessBacklog(w.d1, 2)).assessed, 2);
  const done = snap(w);
  assert.equal((await assessBacklog(w.d1, 40)).assessed, 0);
  assert.equal(snap(w), done);
});

test('a row assessed here can still be refreshed by discovery and overridden by a human afterwards', async () => {
  const w = world();
  await assessBacklog(w.d1, 40);
  const qr = row(w, F, 'a1').qr;
  assert.ok(/^Cloud discovery match\./.test(qr) || qr === 'Outside candidate target role family; retained for review.', 'the reason uses the texts discovery is allowed to refresh');
  w.run(`UPDATE candidate_qualifications SET manual_override_status='READY', qualification_status='READY' WHERE candidate_id=? AND job_id='a1'`, F);
  const decided = row(w, F, 'a1');
  await assessBacklog(w.d1, 40);
  assert.deepEqual(row(w, F, 'a1'), decided);
});

test('the cron runs an assessment batch every fifth tick only', async () => {
  const worker = await loadWorker();
  const w = world(); const env = makeEnv(w.d1);
  const tick = (n) => worker.scheduled({ scheduledTime: n * 120000 }, env, { waitUntil() {} });
  await tick(ASSESS_EVERY_TICKS * 1000 + 1);
  assert.equal(row(w, F, 'a1').score, 0, 'not an assessment tick');
  await tick(ASSESS_EVERY_TICKS * 1000);
  assert.ok(row(w, F, 'a1').score > 0, 'assessment tick');
});

test('migration 0013 fills empty built-in skills (so the screen can score them) and never overwrites a stored list', async () => {
  const fs = await import('node:fs'); const path = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sql = fs.readFileSync(path.join(root, 'migrations', '0013_candidate_skills.sql'), 'utf8');
  const { sqlite } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id,full_name,primary_skills) VALUES ('farhan_shaikh','F',NULL),('sana_ansari','S','["Kept"]')`).run();
  sqlite.exec(sql);
  const f = JSON.parse(sqlite.prepare(`SELECT primary_skills s FROM candidates WHERE id='farhan_shaikh'`).get().s);
  assert.ok(f.includes('CRM Configuration') && f.length === 6, 'empty column filled with the documented list');
  assert.deepEqual(JSON.parse(sqlite.prepare(`SELECT primary_skills s FROM candidates WHERE id='sana_ansari'`).get().s), ['Kept'], 'a stored list is never overwritten');
  sqlite.exec(sql);
  assert.equal(JSON.parse(sqlite.prepare(`SELECT primary_skills s FROM candidates WHERE id='farhan_shaikh'`).get().s).length, 6, 'idempotent');
  // the point of it: the same relevant posting scores a flat 50 with no stored skills and higher once they are stored
  const posting = { id: 'p', title: 'Implementation Manager', url: '', location: 'Remote - India', description: 'Fully remote role. CRM Configuration and Workflow Automation with GoHighLevel.', remote: true };
  assert.equal(evaluate({ id: 'farhan_shaikh', primary_skills: null }, posting).score, 50, 'the production state before 0013');
  const after = evaluate({ id: 'farhan_shaikh', primary_skills: JSON.stringify(f) }, posting);
  assert.equal(after.score, 74, 'three named skills: 40 + 24 + 10');
  assert.equal(after.status, 'NEEDS_REVIEW', 'still never READY on its own');
});
