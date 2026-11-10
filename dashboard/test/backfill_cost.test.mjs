// Onboarding a client screens every active job for them (POST /api/clients/:id/backfill, 40 per call). Found in review: each call read, probed and sorted EVERY active job
// (the planner used the is_active index and a temp b-tree), so onboarding cost about N*N/10 rows read for N active jobs (measured locally: 11.2 million job rows scanned for 21,120
// jobs). The walk is now by rowid with a cursor: a call reads about 40 jobs. These tests pin the behaviour AND the cost, by counting the job rows the real function visits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { backfillClient, BACKFILL_SELECT } from '../worker/discovery.ts';

const SK = JSON.stringify(['CRM Configuration', 'Workflow Automation']);
function world(active = 205, inactive = 5) {
  const { sqlite, d1 } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id, full_name, primary_skills) VALUES ('new_client', 'New Client', ?)`).run(SK);
  const ins = sqlite.prepare(`INSERT INTO jobs(id, title, company, source_adapter, is_active, discovered_at, description, location_restrictions, workplace_type) VALUES (?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < active + inactive; i++)   // many jobs share a timestamp, as a daily import gives them
    ins.run(`ds:${i}`, `Implementation Manager ${i}`, `Co ${i % 40}`, 'greenhouse', i < active ? 1 : 0, `2026-11-0${1 + (i % 3)}T00:00:00Z`, 'Fully remote role. CRM configuration and workflow automation.', 'Remote - India', 'REMOTE_RESTRICTED');
  let scanned = 0;
  sqlite.function('tick', (_id) => { scanned++; return 1; });   // one argument: the job id
  // the real function, with the job-row loop instrumented: every job row that reaches the WHERE clause is counted
  const counting = { ...d1, prepare: (sql) => d1.prepare(sql.includes('WHERE j.rowid < ?') ? sql.replace('WHERE j.rowid < ?', 'WHERE j.rowid < ? AND tick(j.id)') : sql) };
  return { sqlite, d1, counting, scannedNow: () => scanned, resetScanned: () => { scanned = 0; } };
}
async function walk(w, { useCursor }) {
  let cursor = null, calls = 0, inserted = 0; const perCall = [];
  for (;;) {
    w.resetScanned();
    const r = await backfillClient(w.counting, 'new_client', 40, undefined, useCursor ? cursor : null);
    calls++; inserted += r.inserted; perCall.push(w.scannedNow());
    if (!r.more) { assert.equal(r.next_cursor, null, 'no cursor once finished'); break; }
    assert.ok(Number.isInteger(r.next_cursor) && r.next_cursor > 0, 'a cursor while more remains');
    cursor = r.next_cursor;
    assert.ok(calls < 100, 'the walk must end');
  }
  return { calls, inserted, perCall };
}
const screenedIds = (w) => w.sqlite.prepare(`SELECT job_id FROM candidate_qualifications WHERE candidate_id='new_client' ORDER BY job_id`).all().map((r) => r.job_id);

test('cursor walk screens every active job exactly once, and never an inactive one', async () => {
  const w = world(205, 5);
  const { inserted, calls } = await walk(w, { useCursor: true });
  assert.equal(inserted, 205); assert.equal(calls, 6, '205 jobs in batches of 40');
  assert.equal(screenedIds(w).length, 205);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM candidate_qualifications q JOIN jobs j ON j.id=q.job_id WHERE q.candidate_id='new_client' AND j.is_active=0`).get().n, 0);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM candidate_job_scores WHERE candidate_id='new_client'`).get().n, 205, 'a score row for each');
  const again = await backfillClient(w.d1, 'new_client', 40, undefined, null);
  assert.equal(again.inserted, 0); assert.equal(again.more, false, 'a second full pass has nothing left to do');
});

test('cursor and no-cursor walks end with the same screened jobs (older callers keep working)', async () => {
  const a = world(205, 5), b = world(205, 5);
  await walk(a, { useCursor: true }); const old = await walk(b, { useCursor: false });
  assert.deepEqual(screenedIds(a), screenedIds(b)); assert.equal(old.inserted, 205);
});

test('newest jobs are screened first (highest rowid first)', async () => {
  const w = world(205, 5);
  const r = await backfillClient(w.d1, 'new_client', 40);
  assert.equal(r.inserted, 40);
  const got = new Set(screenedIds(w));
  const newest = w.sqlite.prepare(`SELECT id FROM jobs WHERE is_active = 1 ORDER BY rowid DESC LIMIT 40`).all().map((x) => x.id);
  assert.deepEqual([...got].sort(), newest.sort());
});

test('COST: with the cursor a call visits about one batch of job rows, not the catalogue', async () => {
  const w = world(1000, 40);
  const { calls, inserted, perCall } = await walk(w, { useCursor: true });
  assert.equal(inserted, 1000);
  assert.ok(Math.max(...perCall) <= 41 + 40, `no call may visit more than a batch plus look-ahead of job rows (saw ${Math.max(...perCall)})`);   // inactive rows are skipped inside a batch
  const total = perCall.reduce((s, x) => s + x, 0);
  assert.ok(total <= 1040 + calls, `the whole onboarding visits about N job rows in total (saw ${total} for 1,040 jobs); the previous query visited ${calls} x 1,000 = ${calls * 1000}`);
});

test('the query plan walks by rowid with no sort and no full scan', () => {
  const { sqlite } = createDb();
  const plan = sqlite.prepare('EXPLAIN QUERY PLAN ' + BACKFILL_SELECT).all(2 ** 52, 'c', 'c', 41).map((r) => r.detail).join(' | ');
  assert.match(plan, /SEARCH j USING INDEX idx_jobs_is_active \(is_active=\? AND rowid<\?\)/, plan);
  assert.doesNotMatch(plan, /TEMP B-TREE/, 'ordering by rowid needs no sort: ' + plan);
  assert.doesNotMatch(plan, /SCAN j/, plan);
});

test('the route accepts a cursor, ignores a malformed one, and returns next_cursor', async () => {
  const worker = await loadWorker();
  const w = world(120, 0); const env = makeEnv(w.d1);
  const post = (q) => call(worker, env, 'POST', '/api/clients/new_client/backfill' + q);
  // new_client is not a registered client: register it the way the product does so the route knows the id
  const created = await call(worker, env, 'POST', '/api/clients', { body: { full_name: 'Route Client', role_keywords: ['analyst'], location_mode: 'REMOTE_FROM_HOME', home_country: 'India', visibility: 'private',
    search_profile: { role_keywords: ['analyst'], avoid_keywords: [], location_mode: 'REMOTE_FROM_HOME', home_country: 'India' } } });
  const id = created.json.client.id;
  const first = await call(worker, env, 'POST', `/api/clients/${id}/backfill`);
  assert.equal(first.status, 200); assert.equal(first.json.inserted, 40); assert.equal(first.json.more, true); assert.ok(first.json.next_cursor > 0);
  const second = await call(worker, env, 'POST', `/api/clients/${id}/backfill?cursor=${first.json.next_cursor}`);
  assert.equal(second.status, 200); assert.equal(second.json.inserted, 40); assert.ok(second.json.next_cursor < first.json.next_cursor, 'it moves down the catalogue');
  const junk = await call(worker, env, 'POST', `/api/clients/${id}/backfill?cursor=abc;drop`);
  assert.equal(junk.status, 200, 'a malformed cursor is ignored, not an error');
  void post;
});
