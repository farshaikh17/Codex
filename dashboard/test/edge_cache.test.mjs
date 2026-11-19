// Edge cache in front of the D1 response cache (D1 read diet, 17 Nov): an anonymous public read is answered from the Cache API or the
// isolate's memory without reading D1 (X-Cache: EDGE); operator, share-link, include_test and "give me a fresh answer" requests never use it;
// errors and 503s are never kept; any change through the Worker (tracker action, operator edit) is seen at once; a release starts empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, ADMIN_KEY } from './harness.mjs';
import { seed } from './fixtures.mjs';

const worker = await loadWorker();
let commit = 0;
function world(extra = {}) {
  const { sqlite, d1 } = createDb(); seed(sqlite);
  let reads = 0, down = false;
  const counted = { ...d1, prepare: (s) => { if (down) throw new Error('D1_ERROR: Your account has exceeded D1\'s free tier daily row read limit'); reads++; return d1.prepare(s); },
    batch: (s) => { if (down) throw new Error('D1_ERROR: unavailable'); return d1.batch(s); } };
  // EDGE_CACHE unset: the edge layer is on, as in production. A commit of its own per world, so no test sees another's entries.
  const env = makeEnv(counted, { RESPONSE_CACHE: 'on', EDGE_CACHE: undefined, OPEN_TRACKER: 'on', GIT_COMMIT: `edge-test-${++commit}`, ...extra });
  return { sqlite, env, reads: () => reads, resetReads: () => { reads = 0; }, setDown: (v) => { down = v; } };
}
async function get(env, path, headers = {}) {
  const res = await worker.fetch(new Request('https://edge.invalid' + path, { headers }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, xcache: res.headers.get('x-cache'), text };
}
async function post(env, path, body, headers = {}) {
  const res = await worker.fetch(new Request('https://edge.invalid' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: res.status, text: await res.text() };
}

test('hit: the repeat of an anonymous public read is served from the edge and reads nothing from D1', async () => {
  const w = world();
  const path = '/api/jobs?candidate_id=farhan_shaikh&limit=20';
  const first = await get(w.env, path);
  assert.equal(first.status, 200); assert.equal(first.xcache, 'MISS');
  w.resetReads();
  const again = await get(w.env, path);
  assert.equal(again.xcache, 'EDGE'); assert.equal(again.text, first.text, 'the same answer');
  assert.equal(w.reads(), 0, 'an edge hit prepares no D1 statement at all');
  // a D1 cache hit (another isolate's edge would be empty) also fills the edge
  const other = '/api/today?candidate_id=sana_ansari';
  assert.equal((await get(w.env, other)).xcache, 'MISS');
  assert.equal((await get(w.env, other)).xcache, 'EDGE');
});

test('bypass: operator key, share link, include_test, a fresh-answer request and unknown clients never use the edge', async () => {
  const w = world();
  const path = '/api/applications?candidate_id=farhan_shaikh';
  // the operator's answer (with private fields) is never stored for, or served to, anyone else
  const op = await get(w.env, path, { Authorization: `Bearer ${ADMIN_KEY}` });
  assert.equal(op.status, 200); assert.notEqual(op.xcache, 'EDGE');
  assert.notEqual((await get(w.env, path, { Authorization: `Bearer ${ADMIN_KEY}` })).xcache, 'EDGE', 'operator reads are never edge answers');
  const anon = await get(w.env, path);
  assert.equal(anon.xcache, 'MISS', 'the first anonymous read is computed, not the operator\'s answer');
  assert.equal((await get(w.env, path)).xcache, 'EDGE');
  for (const headers of [{ 'X-View-Token': 'v1_' + 'a'.repeat(48) }, { 'Cache-Control': 'no-cache' }, { 'Cache-Control': 'max-age=0' }, { Pragma: 'no-cache' }]) {
    assert.notEqual((await get(w.env, path, headers)).xcache, 'EDGE', JSON.stringify(headers));
  }
  assert.notEqual((await get(w.env, path + '&include_test=true')).xcache, 'EDGE', 'include_test never');
  assert.notEqual((await get(w.env, path + '&include_test=true')).xcache, 'EDGE');
  const unknown = await get(w.env, '/api/jobs?candidate_id=someone_else');
  assert.equal(unknown.status, 400); assert.notEqual((await get(w.env, '/api/jobs?candidate_id=someone_else')).xcache, 'EDGE', 'an error is never kept');
});

test('a 503 is never kept: after an outage the next read is computed again', async () => {
  const w = world();
  const path = '/api/today?candidate_id=farhan_shaikh';
  w.setDown(true);
  const out = await get(w.env, path);
  assert.equal(out.status, 503);
  w.setDown(false);
  const back = await get(w.env, path);
  assert.equal(back.status, 200); assert.equal(back.xcache, 'MISS', 'the outage answer was not stored');
});

test('invalidation: a tracker action is seen on the very next read, for the same and the other person', async () => {
  const w = world();
  const apps = '/api/applications?candidate_id=farhan_shaikh', jobs = '/api/jobs?candidate_id=sana_ansari&limit=20';
  await get(w.env, apps); await get(w.env, jobs);
  assert.equal((await get(w.env, apps)).xcache, 'EDGE'); assert.equal((await get(w.env, jobs)).xcache, 'EDGE');
  const saved = await post(w.env, '/api/applications', { candidate_id: 'farhan_shaikh', job_id: 'j3', status: 'SAVED' });
  assert.ok(saved.status < 300, saved.text);
  const after = await get(w.env, apps);
  assert.notEqual(after.xcache, 'EDGE', 'the edge entry from before the action is not served');
  assert.ok(after.text.includes('"j3"'), 'the saved job is in the answer');
  assert.notEqual((await get(w.env, jobs)).xcache, 'EDGE', 'every edge entry of this isolate is dropped');
  assert.equal((await get(w.env, apps)).xcache, 'EDGE', 'and is cached again afterwards');
});

test('an operator edit drops the edge entries; a release (new commit) never serves the previous code\'s entries', async () => {
  const w = world();
  const path = '/api/candidates';
  await get(w.env, path); assert.equal((await get(w.env, path)).xcache, 'EDGE');
  const r = await worker.fetch(new Request('https://edge.invalid/api/profile?candidate_id=farhan_shaikh', { method: 'PUT', headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'Test Farhan' }) }), w.env, { waitUntil() {} });
  assert.ok(r.status < 500);
  assert.notEqual((await get(w.env, path)).xcache, 'EDGE');
  await get(w.env, path); assert.equal((await get(w.env, path)).xcache, 'EDGE');
  assert.notEqual((await get({ ...w.env, GIT_COMMIT: w.env.GIT_COMMIT + '-next' }, path)).xcache, 'EDGE', 'a new release starts with an empty edge');
});

test('entries expire after five minutes', async () => {
  const w = world();
  const path = '/api/today?candidate_id=farhan_shaikh';
  await get(w.env, path); assert.equal((await get(w.env, path)).xcache, 'EDGE');
  const realNow = Date.now;
  Date.now = () => realNow() + 301 * 1000;
  try { assert.notEqual((await get(w.env, path)).xcache, 'EDGE'); } finally { Date.now = realNow; }
});

test('Cache API: entries and the generation are stored there (per data centre), with a five-minute lifetime', async () => {
  const store = new Map();
  globalThis.caches = { default: {
    async put(req, res) { store.set(typeof req === 'string' ? req : req.url, { body: await res.text(), cc: res.headers.get('Cache-Control') }); },
    async match(req) { const e = store.get(typeof req === 'string' ? req : req.url); return e ? new Response(e.body) : undefined; } } };
  try {
    const w = world();
    const path = '/api/jobs?candidate_id=farhan_shaikh&limit=5';
    await get(w.env, path);
    const entry = [...store.entries()].find(([k]) => k.includes('/__edge-cache/') && !k.endsWith('/generation'));
    assert.ok(entry, 'the answer is in the Cache API'); assert.match(entry[1].cc, /max-age=300/);
    assert.ok(!entry[0].includes(ADMIN_KEY));
    await post(w.env, '/api/applications', { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'SAVED' });
    assert.ok(store.has('https://edge.invalid/__edge-cache/generation'), 'a change raises the data centre\'s generation');
    // another isolate in the same data centre (empty memory) learns the new generation from the Cache API and does not serve the old entry
    const gen = Number(store.get('https://edge.invalid/__edge-cache/generation').body);
    assert.ok(!entry[0].includes(`/__edge-cache/${gen}/`), 'the old entry is under the old generation');
  } finally { delete globalThis.caches; }
});
