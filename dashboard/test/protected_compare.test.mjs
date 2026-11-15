// Code QA F1 (13 Nov): the release's protected-record comparison. With the open tracker on, a keyless tracker write made while the release
// runs is tagged (history_client) and must not fail a release whose deploy was fine; every other change (operator edit, script, migration,
// a write outside the window, the tracker switched off) still fails it. Uses the real Worker on the in-memory harness database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb, loadWorker, makeEnv, ADMIN_KEY } from './harness.mjs';
import { FINGERPRINT_QUERIES, fingerprintTables, compareProtected, taggedSql, changeLines } from '../scripts/protected_compare.mjs';

const F = 'farhan_shaikh';
const worker = await loadWorker();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function world() {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,qualification_threshold,primary_skills) VALUES (?,?,?,?,?)`, F, 'Farhan', 'Mumbai, India', 70, '["CRM Configuration"]');
  for (const id of ['k1', 'k2', 'k3', 'k4']) {
    run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, 'Implementation Manager ' + id, 'Acme', 'lever', 'https://jobs.lever.co/acme/' + id, 1, 'Remote - India', 'Fully remote role.', 'REMOTE', '2026-11-01T00:00:00Z', 'LIVE_PUBLIC');
    run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status) VALUES (?,?,?,?)`, F, id, 'READY', 'ELIGIBLE');
  }
  run(`UPDATE candidate_qualifications SET manual_override_status = 'HOLD', manual_override_reason = 'owner decided' WHERE job_id = 'k4'`);
  run(`INSERT INTO applications(id,candidate_id,job_id,status,notes) VALUES ('keep1',?,?,'SAVED','my own note')`, F, 'k2');
  run(`INSERT INTO application_history(candidate_id,job_id,application_id,new_status,actor) VALUES (?,?,'keep1','SAVED','Candidate')`, F, 'k2');
  return { sqlite, run, env: makeEnv(d1, { OPEN_TRACKER: 'on' }) };
}
const snap = (w) => fingerprintTables(Object.fromEntries(Object.entries(FINGERPRINT_QUERIES).map(([n, sql]) => [n, w.sqlite.prepare(sql).all()])));
const send = (w, method, p, body, key) => worker.fetch(new Request('https://test.invalid' + p, {
  method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  body: body ? JSON.stringify(body) : undefined }), w.env, { waitUntil() {} });
const windowStart = (w, offset = '-2 minutes') => w.sqlite.prepare(`SELECT datetime('now', ?) AS t`).get(offset).t;
const check = (w, b, since, openTracker = true) => {
  const a = snap(w);
  const tagged = w.sqlite.prepare(taggedSql(since)).all();
  return compareProtected({ before: b.summary, after: a.summary, beforeRows: b.perRow, afterRows: a.perRow, tagged, openTracker });
};

test('fingerprint output keeps the shape the release prints (same tables, same order)', () => {
  const w = world();
  assert.deepEqual(Object.keys(snap(w).summary), ['applications', 'application_history', 'manual_overrides', 'qualifications', 'scores', 'candidate_profile_lists', 'candidates']);
  assert.deepEqual(Object.keys(snap(w).perRow).sort(), ['application_history', 'applications', 'candidates', 'manual_overrides']);
});

test('nothing changed: passes, tracker on or off', () => {
  const w = world(); const b = snap(w); const since = windowStart(w);
  assert.equal(check(w, b, since).ok, true);
  assert.equal(check(w, b, since, false).ok, true);
});

test('keyless tracker writes during the release (apply, un-save, override, Not for me) pass and are listed as tagged', async () => {
  const w = world(); const b = snap(w); const since = windowStart(w);
  assert.equal((await send(w, 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED', notes: 'sent' })).status, 200);
  assert.equal((await send(w, 'POST', '/api/applications', { candidate_id: F, job_id: 'k3', status: 'SAVED' })).status, 200);
  assert.equal((await send(w, 'DELETE', `/api/applications/k3?candidate_id=${F}`)).status, 200);
  assert.equal((await send(w, 'POST', '/api/jobs/k4/qualification-override', { candidate_id: F, status: 'READY', reason: 'changed my mind' })).status, 200);
  assert.equal((await send(w, 'POST', '/api/jobs/k3/feedback', { candidate_id: F, rating: 'DOWN' })).status, 200);
  const res = check(w, b, since);
  assert.equal(res.ok, true, res.lines.join('\n') + '\n' + changeLines(res.changes).join('\n'));
  assert.ok(res.changes.length >= 4 && res.changes.every((c) => c.tagged), JSON.stringify(res.changes));
  assert.ok(res.lines.some((l) => l.includes('changed by the open tracker only')));
  // the same writes with the tracker switched off fail
  assert.equal(check(w, b, since, false).ok, false);
});

test('an operator (keyed) write during the release is not tagged and fails the comparison', async () => {
  const w = world(); const b = snap(w); const since = windowStart(w);
  assert.equal((await send(w, 'POST', '/api/applications', { candidate_id: F, job_id: 'k3', status: 'SAVED' }, ADMIN_KEY)).status, 200);
  const res = check(w, b, since);
  assert.equal(res.ok, false);
  assert.ok(res.changes.some((c) => c.table === 'applications' && c.job_id === 'k3' && !c.tagged));
  assert.ok(changeLines(res.changes).some((l) => l.includes('| k3 |') && l.includes('**no**')));
});

test('a tagged tracker write does not cover an untagged change to another job, a candidate row or an edited history row', async () => {
  const w = world(); const b = snap(w); const since = windowStart(w);
  assert.equal((await send(w, 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED' })).status, 200);
  w.run(`UPDATE applications SET notes = 'edited by a script' WHERE id = 'keep1'`);
  let res = check(w, b, since);
  assert.equal(res.ok, false);
  assert.deepEqual(res.changes.filter((c) => !c.tagged).map((c) => c.key), ['keep1']);

  const w2 = world(); const b2 = snap(w2);
  await send(w2, 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED' });
  w2.run(`UPDATE candidates SET qualification_threshold = 50 WHERE id = ?`, F);
  assert.equal(check(w2, b2, since).ok, false, 'a candidate row is never a tracker change');

  const w3 = world(); const b3 = snap(w3);
  await send(w3, 'POST', '/api/applications', { candidate_id: F, job_id: 'k2', status: 'APPLIED' });
  w3.run(`UPDATE application_history SET notes = 'rewritten' WHERE application_id = 'keep1' AND new_status = 'SAVED'`);
  res = check(w3, b3, since);
  assert.equal(res.ok, false, 'an existing history row edited is never a tracker change, even for a job the tracker touched');
});

test('a tracker write tagged before the release window does not count', async () => {
  const w = world();
  await send(w, 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED' });
  w.run(`UPDATE history_client SET created_at = datetime('now', '-1 day')`);
  const b = snap(w); const since = windowStart(w);
  w.run(`UPDATE applications SET status = 'REJECTED' WHERE job_id = 'k1'`);   // untagged, same job as the old tag
  assert.equal(check(w, b, since).ok, false);
});

test('taggedSql refuses anything but a plain UTC timestamp', () => {
  assert.throws(() => taggedSql("2026-11-14 00:00:00' OR 1=1 --"));
  assert.match(taggedSql('2026-11-14 00:18:00'), /created_at >= '2026-11-14 00:18:00'/);
});

test('command line, as the release runs it: exit 0 for tagged tracker changes, exit 1 for an untagged change, the table in the summary', async () => {
  const w = world(); const b = snap(w); const since = windowStart(w);
  await send(w, 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-'));
  const write = (name, v) => { fs.writeFileSync(path.join(dir, name), JSON.stringify(v)); return path.join(dir, name); };
  const run = () => {
    const a = snap(w);
    const args = ['scripts/protected_compare.mjs', '--before', write('before.json', b.summary), '--after', write('after.json', a.summary),
      '--before-rows', write('before_rows.json', b.perRow), '--after-rows', write('after_rows.json', a.perRow),
      '--tagged', write('tagged.json', w.sqlite.prepare(taggedSql(since)).all()), '--open-tracker', 'on', '--summary', path.join(dir, 'summary.md')];
    return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  };
  let r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /Protected records, field-level[\s\S]*applications/);
  assert.doesNotMatch(r.stdout, /sent|my own note/, 'no field values are printed');
  w.run(`UPDATE applications SET status = 'OFFER' WHERE id = 'keep1'`);
  r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Protected records changed during the release/);
  assert.match(r.stdout, /keep1 \| changed .*\*\*no\*\*/);
  fs.rmSync(dir, { recursive: true, force: true });
});
