// The tidy-up (scripts/tidy_jobs.mjs) deletes the screening rows of jobs long closed or long hidden by the rules for everyone. These tests pin
// its safety: a job anyone acted on (application, history, follow-up, rating, override, Ready / Stretch, a person's history entry) keeps all its
// rows; jobs, applications, application_history, follow-ups, ratings, overrides and candidates are never changed; a run is bounded; a second
// run changes nothing; and it reads through the index instead of scanning (deleting job rows was rejected: the foreign-key checks scan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './harness.mjs';
import { batchSql, tidySql, idsFromWrangler } from '../scripts/tidy_jobs.mjs';

const NOW = '2026-12-31T00:00:00.000Z';
const HID = '2026-11-15T00:00:00.000Z';   // 46 days before NOW: inside the open jobs' window
const OLD = '2026-11-13T00:00:00.000Z', RECENT = '2026-12-20T00:00:00.000Z', ANCIENT = '2026-09-01T00:00:00.000Z';   // OLD: 48 days before NOW
const TIDIED = ['gone1', 'gone2', 'hidden1'];

function world() {
  const { sqlite } = createDb();
  sqlite.exec(`INSERT INTO candidates(id, full_name) VALUES ('farhan_shaikh','F'),('sana_ansari','S')`);
  const job = sqlite.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,discovered_at,last_verified_at,is_active,expired_at,source_channel) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const qual = sqlite.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_reason,manual_override_status) VALUES (?,?,?,?,?)`);
  const score = sqlite.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score) VALUES (?,?,50)`);
  const hist = sqlite.prepare(`INSERT INTO qualification_history(candidate_id,job_id,previous_status,new_status,reason,actor) VALUES (?,?,'NEEDS_REVIEW','HOLD','x',?)`);
  const add = (id, { active = 0, disc = OLD, exp = OLD, ver = null, ch = 'ATS_DATASET', status = 'NEEDS_REVIEW', override = null, elig = null } = {}) => {
    job.run(id, 'T ' + id, 'Co', 'greenhouse', 'https://e.com/' + id, disc, ver, active, active ? null : exp, ch);
    for (const c of ['farhan_shaikh', 'sana_ansari']) { qual.run(c, id, status, elig, override); score.run(c, id); hist.run(c, id, 'discovery'); }
  };
  // tidied
  add('gone1'); add('gone2', { ch: 'JOB_SITES' }); add('hidden1', { active: 1, disc: HID, status: 'INELIGIBLE' });
  // kept: too recent, other channels, open and wanted, verified lately, the office-days reading
  add('recent_gone', { exp: RECENT }); add('recent_disc', { active: 1, disc: RECENT, status: 'INELIGIBLE' });
  add('worker_job', { ch: 'PUBLIC_ATS' }); add('collector_job', { ch: 'GITHUB_COLLECTOR' });
  add('open_review', { active: 1, disc: HID, status: 'NEEDS_REVIEW' }); add('closed_long_ago', { exp: ANCIENT, disc: ANCIENT });   // past its window: left alone
  add('verified_recently', { active: 1, disc: HID, status: 'INELIGIBLE', ver: RECENT });
  add('office_days', { active: 1, disc: HID, status: 'INELIGIBLE', elig: 'Hybrid or set office days (3 a week)' });
  // kept: someone acted on it
  add('applied'); add('app_history'); add('followup'); add('rated'); add('override', { override: 'HOLD' }); add('ready', { status: 'READY' });
  add('stretch', { status: 'STRETCH_READY' }); add('person_history');
  sqlite.exec(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('a1','sana_ansari','applied','REJECTED');
    INSERT INTO application_history(candidate_id,job_id,new_status,actor) VALUES ('farhan_shaikh','app_history','SAVED','seeker');
    INSERT INTO application_followups(candidate_id,job_id,follow_up_at) VALUES ('farhan_shaikh','followup','2026-12-01');
    INSERT INTO job_feedback(candidate_id,job_id,rating) VALUES ('sana_ansari','rated','DOWN');
    INSERT INTO qualification_history(candidate_id,job_id,previous_status,new_status,reason,actor) VALUES ('farhan_shaikh','person_history','NEEDS_REVIEW','HOLD','x','Candidate');`);
  return sqlite;
}
// the workflow's two steps: one read query that chooses, then the deletes for what it chose
const run = (sqlite, opts = {}) => {
  const ids = sqlite.prepare(batchSql({ now: NOW, ...opts })).all().map((r) => r.id);
  const sql = tidySql(ids); if (sql) sqlite.exec(sql);
  return ids;
};
const jobsWith = (sqlite, t) => sqlite.prepare(`SELECT DISTINCT job_id AS v FROM ${t} ORDER BY 1`).all().map((r) => r.v);
const untouchable = (sqlite) => ['jobs', 'applications', 'application_history', 'application_followups', 'job_feedback', 'candidates']
  .map((t) => JSON.stringify(sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all())).join('|')
  + JSON.stringify(sqlite.prepare(`SELECT * FROM candidate_qualifications WHERE manual_override_status IS NOT NULL ORDER BY 1, 2`).all())
  + JSON.stringify(sqlite.prepare(`SELECT * FROM qualification_history WHERE actor <> 'discovery' ORDER BY id`).all());

test('deletes exactly the screening rows of old, untouched pipeline jobs and keeps everything anyone acted on', () => {
  const sqlite = world();
  const before = untouchable(sqlite);
  const allJobs = jobsWith(sqlite, 'candidate_qualifications');
  assert.deepEqual(run(sqlite).sort(), TIDIED);
  for (const t of ['candidate_qualifications', 'candidate_job_scores', 'qualification_history'])
    assert.deepEqual(jobsWith(sqlite, t), allJobs.filter((j) => !TIDIED.includes(j)), t);
  assert.equal(untouchable(sqlite), before, 'jobs, applications, history, follow-ups, ratings, overrides, a person\'s history and candidates are untouched');
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM jobs WHERE id IN ('gone1','gone2','hidden1')`).get().n, 3, 'the job rows stay: the importer still knows them');
});

test('a second run changes nothing (idempotent), and a run is bounded', () => {
  const sqlite = world();
  run(sqlite);
  const after = ['candidate_qualifications', 'candidate_job_scores', 'qualification_history'].map((t) => sqlite.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  assert.deepEqual(run(sqlite), [], 'nothing left to choose');
  assert.deepEqual(['candidate_qualifications', 'candidate_job_scores', 'qualification_history'].map((t) => sqlite.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n), after);
  const s2 = world();
  run(s2, { maxJobs: 1 });
  assert.equal(jobsWith(s2, 'candidate_qualifications').filter((j) => TIDIED.includes(j)).length, 2, 'at most --max-jobs jobs per run');
  assert.equal(jobsWith(s2, 'candidate_job_scores').filter((j) => TIDIED.includes(j)).length, 2, 'the same job in every statement');
  assert.equal(tidySql([]), '', 'nothing chosen, nothing written');
  assert.throws(() => batchSql({ days: 7 }), /at least 30/);
  assert.deepEqual(idsFromWrangler('noise [{"results":[{"id":"a"},{"id":"b"}],"success":true}]'), ['a', 'b']);
});

test('a job someone acts on between the choice and the delete keeps its rows', () => {
  const sqlite = world();
  const ids = sqlite.prepare(batchSql({ now: NOW })).all().map((r) => r.id);
  sqlite.exec(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('late','farhan_shaikh','gone1','SAVED')`);
  sqlite.exec(tidySql(ids));
  assert.ok(jobsWith(sqlite, 'candidate_qualifications').includes('gone1'));
  assert.ok(jobsWith(sqlite, 'candidate_job_scores').includes('gone1'));
  assert.ok(!jobsWith(sqlite, 'candidate_qualifications').includes('gone2'));
});

test('the choice reads through indexes only; no job row is deleted, so no foreign-key check scans the tables that reference jobs', () => {
  const sqlite = world();
  const plan = (sql) => sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');
  const choose = plan(batchSql({ now: NOW }));
  assert.match(choose, /idx_jobs_closed_at/); assert.match(choose, /idx_jobs_channel_active_disc/);
  assert.doesNotMatch(choose, /SCAN (j|h|u|f|candidate_qualifications|qualification_history)\b/, choose);
  const sql = tidySql(['gone1', 'gone2']);
  assert.doesNotMatch(sql, /DELETE FROM jobs\b/);
  for (const st of sql.split(';\n').filter((x) => x.trim())) assert.doesNotMatch(plan(st), /SCAN (candidate_qualifications|candidate_job_scores|qualification_history)\b/, st.slice(0, 60));
});
