import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { seed } from './fixtures.mjs';

const worker = await loadWorker();
const fresh = () => { const { sqlite, d1 } = createDb(); seed(sqlite); return { sqlite, env: makeEnv(d1) }; };
const tracked = (sqlite) => sqlite.prepare("SELECT candidate_id, job_id FROM applications LIMIT 1").get();

test('follow-up dates are operator-only: no key means 401 for both the write and the list', async () => {
  const { sqlite, env } = fresh(); const t = tracked(sqlite);
  const w = await call(worker, env, 'PUT', `/api/applications/${t.job_id}/follow-up`, { key: null, body: { candidate_id: t.candidate_id, follow_up_at: '2030-01-01' } });
  assert.equal(w.status, 401);
  const r = await call(worker, env, 'GET', `/api/follow-ups?candidate_id=${t.candidate_id}`, { key: null });
  assert.equal(r.status, 401);
});

test('an operator sets, lists, changes and clears a follow-up date; bad input is refused', async () => {
  const { sqlite, env } = fresh(); const t = tracked(sqlite);
  const put = (body) => call(worker, env, 'PUT', `/api/applications/${t.job_id}/follow-up`, { body: { candidate_id: t.candidate_id, ...body } });
  assert.equal((await put({ follow_up_at: '2030-02-30' })).status, 400, 'a date that does not exist');
  assert.equal((await put({ follow_up_at: 'next week' })).status, 400);
  assert.equal((await put({ follow_up_at: 20300101 })).status, 400);
  const ok = await put({ follow_up_at: '2030-03-01', note: '  ping the recruiter  ' });
  assert.equal(ok.status, 200); assert.equal(ok.json.follow_up_at, '2030-03-01'); assert.equal(ok.json.note, 'ping the recruiter');
  let list = await call(worker, env, 'GET', `/api/follow-ups?candidate_id=${t.candidate_id}`);
  assert.equal(list.status, 200); assert.equal(list.json.items.length, 1);
  assert.deepEqual(Object.keys(list.json.items[0]).sort(), ['company', 'follow_up_at', 'job_id', 'note', 'status', 'title']);
  assert.equal((await put({ follow_up_at: '2030-04-01' })).status, 200, 'changing the date replaces the row');
  list = await call(worker, env, 'GET', `/api/follow-ups?candidate_id=${t.candidate_id}`);
  assert.equal(list.json.items.length, 1); assert.equal(list.json.items[0].follow_up_at, '2030-04-01'); assert.equal(list.json.items[0].note, null);
  assert.equal((await put({ follow_up_at: null })).json.cleared, true);
  list = await call(worker, env, 'GET', `/api/follow-ups?candidate_id=${t.candidate_id}`);
  assert.equal(list.json.items.length, 0);
});

test('a follow-up needs a tracked application and a known candidate', async () => {
  const { sqlite, env } = fresh(); const t = tracked(sqlite);
  const none = await call(worker, env, 'PUT', '/api/applications/no-such-job/follow-up', { body: { candidate_id: t.candidate_id, follow_up_at: '2030-01-01' } });
  assert.equal(none.status, 404);
  const bad = await call(worker, env, 'PUT', `/api/applications/${t.job_id}/follow-up`, { body: { candidate_id: 'nobody', follow_up_at: '2030-01-01' } });
  assert.ok(bad.status === 400 || bad.status === 404, 'unknown candidate refused');
});

test('follow-up dates never appear in a public answer', async () => {
  const { sqlite, env } = fresh(); const t = tracked(sqlite);
  await call(worker, env, 'PUT', `/api/applications/${t.job_id}/follow-up`, { body: { candidate_id: t.candidate_id, follow_up_at: '2031-05-05', note: 'PRIVATE-FOLLOWUP-NOTE-9' } });
  for (const p of [`/api/applications?candidate_id=${t.candidate_id}`, `/api/jobs?candidate_id=${t.candidate_id}&limit=50`, `/api/dashboard/overview?candidate_id=${t.candidate_id}`, '/api/candidates']) {
    const res = await worker.fetch(new Request('https://test.invalid' + p), env, { waitUntil() {} });
    const text = await res.text();
    assert.ok(!text.includes('2031-05-05') && !text.includes('PRIVATE-FOLLOWUP-NOTE-9') && !text.includes('follow_up'), `${p} leaks nothing`);
  }
});

test('without the table (migration not applied yet) the list is empty, not an error', async () => {
  const { sqlite, env } = fresh(); const t = tracked(sqlite);
  sqlite.exec('DROP TABLE application_followups');
  const res = await call(worker, env, 'GET', `/api/follow-ups?candidate_id=${t.candidate_id}`);
  assert.equal(res.status, 200); assert.deepEqual(res.json.items, []);
});
