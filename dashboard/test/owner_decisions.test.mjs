// Owner decisions of 2026-11-11 and the review findings that go with them:
//  * moving an application back to Saved / In review / Withdrawn puts the job back in the bucket it came from (it used to stay "APPLIED" and vanish);
//  * an unknown status or job is refused instead of stored / a 500;
//  * the thumbs rating is really stored (and is private: operator only);
//  * migration 0020 moves Farhan's two Drivetrain marketing roles out of Stretch, once, and only those.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDb, loadWorker, makeEnv, ADMIN_KEY } from './harness.mjs';

const F = 'farhan_shaikh';
const worker = await loadWorker();

function world() {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,qualification_threshold,primary_skills) VALUES (?,?,?,?,?)`, F, 'Farhan', 'Mumbai, India', 70, '["CRM Configuration"]');
  const job = (id, title, company = 'Acme') => run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, title, company, 'lever', 'https://jobs.lever.co/acme/' + id, 1, 'Remote - India', 'Fully remote role.', 'REMOTE', '2026-11-01T00:00:00Z', 'LIVE_PUBLIC');
  return { sqlite, d1, run, job, env: makeEnv(d1) };
}
async function req(env, method, p, { body, key = ADMIN_KEY } = {}) {
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://test.invalid' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const qstatus = (w, id) => w.sqlite.prepare('SELECT qualification_status s FROM candidate_qualifications WHERE candidate_id=? AND job_id=?').get(F, id)?.s;

test('moving an application back to Saved restores the job to the bucket it came from', async () => {
  const w = world(); w.job('k1', 'Implementation Manager');
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status) VALUES (?,?,?)`, F, 'k1', 'STRETCH_READY');
  assert.equal((await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'APPLIED' } })).status, 200);
  assert.equal(qstatus(w, 'k1'), 'APPLIED');
  // a later stage change keeps it applied and must not overwrite the remembered earlier bucket
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'INTERVIEWING' } });
  assert.equal(qstatus(w, 'k1'), 'APPLIED');
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'SAVED' } });
  assert.equal(qstatus(w, 'k1'), 'STRETCH_READY', 'back to where it was');
  const hist = w.sqlite.prepare('SELECT previous_status p, new_status n FROM qualification_history WHERE candidate_id=? AND job_id=? ORDER BY id').all(F, 'k1');
  assert.deepEqual(hist.map((h) => `${h.p}>${h.n}`), ['STRETCH_READY>APPLIED', 'APPLIED>STRETCH_READY']);
  // and it can go through the cycle again
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'APPLIED' } });
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'WITHDRAWN' } });
  assert.equal(qstatus(w, 'k1'), 'STRETCH_READY');
});

test('rejected stays out of the lists; with no remembered bucket a restored job goes to To review', async () => {
  const w = world(); w.job('k1', 'Implementation Manager'); w.job('k2', 'Integration Lead');
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status) VALUES (?,?,?)`, F, 'k1', 'READY');
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'APPLIED' } });
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'REJECTED' } });
  assert.equal(qstatus(w, 'k1'), 'APPLIED', 'a rejected application is not a candidate for the Ready list again');
  // a row already marked APPLIED before this change (no history): fall back to To review
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status) VALUES (?,?,?)`, F, 'k2', 'APPLIED');
  w.run(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('old1',?,?,'APPLIED')`, F, 'k2');
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k2', status: 'SAVED' } });
  assert.equal(qstatus(w, 'k2'), 'NEEDS_REVIEW');
});

test('an unknown status or job is refused', async () => {
  const w = world(); w.job('k1', 'Implementation Manager');
  const bad = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'BOGUS' } });
  assert.equal(bad.status, 400); assert.match(bad.text, /status must be one of/);
  const gone = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'nope', status: 'SAVED' } });
  assert.equal(gone.status, 404);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) c FROM applications').get().c, 0, 'nothing was stored');
});

test('the thumbs rating is stored, private, and can be cleared', async () => {
  const w = world(); w.job('k1', 'Implementation Manager');
  const up = await req(w.env, 'POST', '/api/jobs/k1/feedback', { body: { candidate_id: F, rating: 'UP' } });
  assert.equal(up.status, 200); assert.equal(up.json.job.feedback.rating, 'UP');
  assert.equal(w.sqlite.prepare('SELECT rating FROM job_feedback WHERE candidate_id=? AND job_id=?').get(F, 'k1').rating, 'UP', 'really stored');
  assert.equal((await req(w.env, 'GET', `/api/jobs/k1/feedback?candidate_id=${F}`)).json.feedback.rating, 'UP', 'and read back');
  await req(w.env, 'POST', '/api/jobs/k1/feedback', { body: { candidate_id: F, rating: 'DOWN', notes: 'x'.repeat(900) } });
  assert.equal(w.sqlite.prepare('SELECT rating, length(notes) n FROM job_feedback').get().rating, 'DOWN');
  assert.equal(w.sqlite.prepare('SELECT length(notes) n FROM job_feedback').get().n, 500, 'notes are capped');
  assert.equal((await req(w.env, 'GET', `/api/jobs/k1/feedback?candidate_id=${F}`, { key: null })).status, 401, 'a visitor cannot read it');
  assert.equal((await req(w.env, 'POST', '/api/jobs/k1/feedback', { body: { candidate_id: F, rating: 'UP' }, key: null })).status, 401);
  assert.equal((await req(w.env, 'POST', '/api/jobs/k1/feedback', { body: { candidate_id: F, rating: 'LOVE' } })).status, 400);
  assert.equal((await req(w.env, 'POST', '/api/jobs/nope/feedback', { body: { candidate_id: F, rating: 'UP' } })).status, 404);
  const cleared = await req(w.env, 'POST', '/api/jobs/k1/feedback', { body: { candidate_id: F, rating: 'CLEAR' } });
  assert.equal(cleared.json.job.feedback, null);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) c FROM job_feedback').get().c, 0);
  // it does not touch the score or the bucket
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) c FROM candidate_job_scores').get().c, 0);
});

test('migration 0020 moves only the two Drivetrain marketing roles out of Stretch, once', () => {
  const w = world();
  const sql = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations', '0020_farhan_drop_marketing_stretch.sql'), 'utf8');
  w.job('m1', 'Organic Marketing', 'Drivetrain'); w.job('m2', 'SEO Content Specialist', 'Drivetrain'); w.job('m3', 'Organic Marketing', 'Other Co');
  w.job('m4', 'Solutions Consultant - FP&A', 'Drivetrain'); w.job('m5', 'SEO Content Specialist', 'Drivetrain');
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status) VALUES (?,?,?)`, F, id, 'STRETCH_READY');
  w.run(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('a5',?,?,'SAVED')`, F, 'm5');   // a person tracked this one
  w.sqlite.exec(sql); w.sqlite.exec(sql);   // twice: idempotent
  const st = Object.fromEntries(w.sqlite.prepare('SELECT job_id, qualification_status s, manual_override_status o FROM candidate_qualifications').all().map((r) => [r.job_id, `${r.s}/${r.o}`]));
  assert.deepEqual(st, { m1: 'HOLD/HOLD', m2: 'HOLD/HOLD', m3: 'STRETCH_READY/null', m4: 'STRETCH_READY/null', m5: 'STRETCH_READY/null' });
  assert.equal(w.sqlite.prepare("SELECT COUNT(*) c FROM qualification_history WHERE actor='Owner'").get().c, 2, 'one history row each, not repeated');
});
