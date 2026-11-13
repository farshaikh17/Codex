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

test('unscreened collector rows are counted apart from To review, in the job list and the overview', async () => {
  const w = world();
  for (const [id, reason] of [['u1', '[GITHUB_COLLECTOR] Unassessed public ATS posting from acme; review pending.'], ['u2', '[GITHUB_COLLECTOR] Unassessed public ATS posting from acme; review pending.'], ['s1', 'Cloud discovery match.']]) {
    w.job(id, 'Implementation Manager ' + id);
    w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,qualification_reason) VALUES (?,?,?,?)`, F, id, 'NEEDS_REVIEW', reason);
  }
  const list = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}`, { key: null });
  assert.equal(list.json.status_counts.NEEDS_REVIEW, 3, 'the status count itself is unchanged');
  assert.equal(list.json.unscreened_count, 2);
  const ov = await req(w.env, 'GET', '/api/dashboard/overview', { key: null });
  const row = (ov.json.candidates || ov.json).find((c) => (c.candidate_id || c.id) === F);
  assert.equal(row.review_count, 3); assert.equal(row.unscreened_count, 2);
});

test('"applied" means the same thing on every screen: applied stages only', async () => {
  const w = world();
  const stages = ['SAVED', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN', 'REVIEWING'];
  stages.forEach((st, i) => {
    w.job('a' + i, 'Implementation Manager ' + i);
    w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status) VALUES (?,?,?,?)`, F, 'a' + i, 'NEEDS_REVIEW', 'ELIGIBLE');
    w.run(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,?)`, 'ap' + i, F, 'a' + i, st);
  });
  const dash = (await req(w.env, 'GET', `/api/candidates/${F}/dashboard`)).json;
  const strat = (await req(w.env, 'GET', `/api/candidates/${F}/strategy`)).json;
  const ov = (await req(w.env, 'GET', '/api/dashboard/overview')).json;
  const ovRow = (ov.candidates || ov).find((c) => (c.candidate_id || c.id) === F);
  const ir = (await req(w.env, 'GET', `/api/india-remote/summary?candidate_id=${F}`)).json;
  assert.deepEqual([dash.applied_count, strat.applied_count, ovRow.applied_count, ir.applied_count], [3, 3, 3, 3], 'APPLIED + INTERVIEWING + OFFER');
  assert.deepEqual([dash.application_records, strat.application_records, ovRow.application_records], [7, 7, 7], 'every tracker record');
});

test('% and _ typed in the job search are literal characters', async () => {
  const w = world();
  w.job('p1', '100% Remote Implementation Lead'); w.job('p2', 'Implementation Lead'); w.job('p3', 'CRM_Admin Lead'); w.job('p4', 'CRMXAdmin Lead');
  for (const id of ['p1', 'p2', 'p3', 'p4']) w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status) VALUES (?,?,?)`, F, id, 'NEEDS_REVIEW');
  const ids = async (q) => ((await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&search=${encodeURIComponent(q)}`)).json.jobs || []).map((j) => j.id).sort();
  assert.deepEqual(await ids('%'), ['p1'], 'a bare % matches only the title that contains one');
  assert.deepEqual(await ids('CRM_Admin'), ['p3'], '_ is not "any character"');
  assert.deepEqual(await ids('Implementation'), ['p1', 'p2']);
});

test('un-saving a job removes its follow-up date', async () => {
  const w = world(); w.job('k1', 'Implementation Manager');
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'SAVED' } });
  assert.equal((await req(w.env, 'PUT', '/api/applications/k1/follow-up', { body: { candidate_id: F, follow_up_at: '2026-12-01' } })).status, 200);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) c FROM application_followups').get().c, 1);
  assert.equal((await req(w.env, 'DELETE', `/api/applications/k1?candidate_id=${F}`)).status, 200);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) c FROM application_followups').get().c, 0, 'no orphan left to come back when the job is saved again');
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) c FROM applications').get().c, 0);
});

// ---- Plan phase 5 -------------------------------------------------------------------------------------------------------------
test('U2: Not for me hides the job (Hold, not an override) and clearing it puts the job back where it was', async () => {
  const w = world(); w.job('n1', 'Implementation Manager'); w.job('n2', 'Implementation Lead');
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,qualification_reason) VALUES (?,?,?,?)`, F, 'n1', 'STRETCH_READY', 'Shortlisted automatically. Matches 3 skills.');
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status) VALUES (?,?,?)`, F, 'n2', 'APPLIED');
  const down = await req(w.env, 'POST', '/api/jobs/n1/feedback', { body: { candidate_id: F, rating: 'DOWN' } });
  assert.equal(down.status, 200, down.text);
  const row = w.sqlite.prepare('SELECT qualification_status s, qualification_reason r, manual_override_status o FROM candidate_qualifications WHERE candidate_id=? AND job_id=?').get(F, 'n1');
  assert.deepEqual([row.s, row.o], ['HOLD', null], 'hidden, and not an override');
  assert.match(row.r, /^You marked this Not for me\. Shortlisted automatically/);
  assert.equal(down.json.job.qualification_status, 'HOLD');
  // the hidden list finds it; the normal list does not
  const hidden = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&hidden=true`);
  assert.deepEqual(hidden.json.jobs.map((j) => j.id), ['n1']);
  assert.ok(!(await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&exclude_dismissed=true`)).json.jobs.some((j) => j.id === 'n1'));
  // a second DOWN does nothing more
  await req(w.env, 'POST', '/api/jobs/n1/feedback', { body: { candidate_id: F, rating: 'DOWN' } });
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM qualification_history WHERE job_id='n1'`).get().n, 1);
  // clearing restores the status and the reason
  await req(w.env, 'POST', '/api/jobs/n1/feedback', { body: { candidate_id: F, rating: 'CLEAR' } });
  const back = w.sqlite.prepare('SELECT qualification_status s, qualification_reason r FROM candidate_qualifications WHERE candidate_id=? AND job_id=?').get(F, 'n1');
  assert.deepEqual([back.s, back.r], ['STRETCH_READY', 'Shortlisted automatically. Matches 3 skills.']);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM job_feedback WHERE job_id='n1'`).get().n, 0);
  // Good match on a hidden job also brings it back
  await req(w.env, 'POST', '/api/jobs/n1/feedback', { body: { candidate_id: F, rating: 'DOWN' } });
  await req(w.env, 'POST', '/api/jobs/n1/feedback', { body: { candidate_id: F, rating: 'UP' } });
  assert.equal(w.sqlite.prepare(`SELECT qualification_status s FROM candidate_qualifications WHERE job_id='n1'`).get().s, 'STRETCH_READY');
  // an applied job is never moved by a mark
  await req(w.env, 'POST', '/api/jobs/n2/feedback', { body: { candidate_id: F, rating: 'DOWN' } });
  assert.equal(w.sqlite.prepare(`SELECT qualification_status s FROM candidate_qualifications WHERE job_id='n2'`).get().s, 'APPLIED');
});

test('U4: a write from an old copy is refused with 409; an empty note never silently replaces a saved one', async () => {
  const w = world(); w.job('s1', 'Implementation Manager');
  const first = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 's1', status: 'SAVED', notes: 'call the recruiter first' } });
  const seen = first.json.application.updated_at;
  const stale = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 's1', status: 'APPLIED', expected_updated_at: '2020-01-01T00:00:00.000Z' } });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /changed elsewhere; reload/);
  assert.equal(w.sqlite.prepare(`SELECT status FROM applications WHERE job_id='s1'`).get().status, 'SAVED');
  // the copy the page last saw is accepted
  const ok = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 's1', status: 'APPLIED', expected_updated_at: seen } });
  assert.equal(ok.status, 200, ok.text);
  // a first save says "there was nothing": null is the expected value
  w.job('s2', 'Implementation Lead');
  assert.equal((await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 's2', status: 'SAVED', expected_updated_at: null } })).status, 200);
  // an empty note is refused while a note is saved; clear_notes deletes it on purpose
  const empty = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 's1', status: 'APPLIED', notes: '  ' } });
  assert.equal(empty.status, 409);
  assert.equal(w.sqlite.prepare(`SELECT notes FROM applications WHERE job_id='s1'`).get().notes, 'call the recruiter first');
  assert.equal((await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 's1', status: 'APPLIED', notes: '', clear_notes: true } })).status, 200);
  assert.equal(w.sqlite.prepare(`SELECT notes FROM applications WHERE job_id='s1'`).get().notes, '');
});
