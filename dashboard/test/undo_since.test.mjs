// Plan U1: keyless open-tracker writes are tagged with their network's hash, and scripts/undo_since.mjs reverses one network's changes exactly,
// never a change somebody made afterwards, and never anything another network did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv } from './harness.mjs';
import { undoStatements, readSql } from '../scripts/undo_since.mjs';

const F = 'farhan_shaikh';
const worker = await loadWorker();

function world() {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,qualification_threshold,primary_skills) VALUES (?,?,?,?,?)`, F, 'Farhan', 'Mumbai, India', 70, '["CRM Configuration"]');
  for (const id of ['k1', 'k2', 'k3', 'k4']) {
    run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, 'Implementation Manager ' + id, 'Acme', 'lever', 'https://jobs.lever.co/acme/' + id, 1, 'Remote - India', 'Fully remote role.', 'REMOTE', '2026-11-01T00:00:00Z', 'LIVE_PUBLIC');
    run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status) VALUES (?,?,?,?)`, F, id, id === 'k4' ? 'STRETCH_READY' : 'READY', 'ELIGIBLE');
  }
  run(`INSERT INTO applications(id,candidate_id,job_id,status,notes) VALUES ('keep1',?,?,'SAVED','my own note')`, F, 'k2');
  return { sqlite, run, env: makeEnv(d1, { OPEN_TRACKER: 'on' }) };
}
const send = (w, ip, method, path, body) => worker.fetch(new Request('https://test.invalid' + path, {
  method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: body ? JSON.stringify(body) : undefined }), w.env, { waitUntil() {} });
const snapshot = (w) => JSON.stringify({
  q: w.sqlite.prepare('SELECT job_id, qualification_status, manual_override_status, manual_override_reason FROM candidate_qualifications ORDER BY job_id').all(),
  a: w.sqlite.prepare('SELECT id, job_id, status, notes FROM applications ORDER BY job_id').all(),
});
const undo = (w, network, since = '2000-01-01') => {
  const rows = w.sqlite.prepare(readSql({ candidate: F, since, network })).all();
  const { sql } = undoStatements(rows, { candidate: F, since });
  for (const s of sql) w.sqlite.exec(s);
  return sql;
};

test('keyless tracker writes are tagged with a network hash; operator writes are not', async () => {
  const w = world();
  assert.equal((await send(w, '9.9.9.9', 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED' })).status, 200);
  const tags = w.sqlite.prepare('SELECT history_table, client_hash, before_json FROM history_client ORDER BY history_table').all();
  assert.deepEqual(tags.map((t) => t.history_table), ['application_history', 'qualification_history']);
  assert.match(tags[0].client_hash, /^[0-9a-f]{64}$/);
  assert.ok(!tags.some((t) => t.client_hash.includes('9.9.9.9')), 'the address itself is never stored');
  assert.equal(JSON.parse(tags[1].before_json).qualification_status, 'READY');
  // the operator's own change carries no tag
  const op = await worker.fetch(new Request('https://test.invalid/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer unit-test-key-not-a-secret' },
    body: JSON.stringify({ candidate_id: F, job_id: 'k3', status: 'SAVED' }) }), w.env, { waitUntil() {} });
  assert.equal(op.status, 200);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) n FROM history_client').get().n, 2);
  // the list mode sees one network
  const nets = w.sqlite.prepare(readSql({ since: '2000-01-01' })).all();
  assert.equal(nets.length, 1);
  assert.equal(nets[0].changes, 2);
});

test('undo restores every job one network changed, exactly as it was, and leaves another network alone', async () => {
  const w = world();
  const before = snapshot(w);
  // the vandal: applies to k1, deletes the saved k2 (after clearing its note it cannot; so it overrides k2 and k3 instead), saves k4
  await send(w, '6.6.6.6', 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED', notes: 'spam' });
  await send(w, '6.6.6.6', 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'REJECTED' });
  await send(w, '6.6.6.6', 'POST', '/api/jobs/k3/qualification-override', { candidate_id: F, status: 'INELIGIBLE', reason: 'junk junk' });
  await send(w, '6.6.6.6', 'POST', '/api/applications', { candidate_id: F, job_id: 'k4', status: 'SAVED' });
  await send(w, '6.6.6.6', 'POST', '/api/applications', { candidate_id: F, job_id: 'k2', status: 'APPLIED' });
  assert.notEqual(snapshot(w), before);
  const network = w.sqlite.prepare('SELECT DISTINCT client_hash h FROM history_client').get().h;
  const sql = undo(w, network);
  assert.ok(sql.length > 0);
  assert.equal(snapshot(w), before, 'every record is back to what it was, including the note on the saved k2');
  assert.ok(w.sqlite.prepare(`SELECT COUNT(*) n FROM qualification_history WHERE actor = 'owner-undo'`).get().n >= 2, 'each undo is on record');
  // running it again changes nothing
  undo(w, network);
  assert.equal(snapshot(w), before);
});

test('undo never overwrites a change made after the network\'s last one, and ignores other networks', async () => {
  const w = world();
  await send(w, '6.6.6.6', 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'SAVED' });
  await send(w, '6.6.6.6', 'POST', '/api/applications', { candidate_id: F, job_id: 'k3', status: 'SAVED' });
  // Farhan himself (another network) then applies to k1: his change must survive
  await send(w, '1.2.3.4', 'POST', '/api/applications', { candidate_id: F, job_id: 'k1', status: 'APPLIED' });
  const vandal = w.sqlite.prepare(`SELECT hc.client_hash h FROM history_client hc JOIN application_history a ON a.id = hc.history_id AND hc.history_table = 'application_history' WHERE a.job_id = 'k3'`).get().h;
  assert.equal(w.sqlite.prepare('SELECT COUNT(DISTINCT client_hash) n FROM history_client').get().n, 2);
  undo(w, vandal);
  assert.equal(w.sqlite.prepare(`SELECT status FROM applications WHERE job_id='k1'`).get().status, 'APPLIED', 'the later change is kept');
  assert.equal(w.sqlite.prepare(`SELECT qualification_status s FROM candidate_qualifications WHERE job_id='k1'`).get().s, 'APPLIED');
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM applications WHERE job_id='k3'`).get().n, 0, 'the vandal\'s save on k3 is removed');
});

test('an un-save by a network is undone by putting the record back', async () => {
  const w = world();
  w.run(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('s4',?,?,'SAVED')`, F, 'k4');
  const before = snapshot(w);
  assert.equal((await send(w, '6.6.6.6', 'DELETE', `/api/applications/k4?candidate_id=${F}`)).status, 200);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM applications WHERE job_id='k4'`).get().n, 0);
  undo(w, w.sqlite.prepare('SELECT client_hash h FROM history_client').get().h);
  assert.equal(snapshot(w), before);
});
