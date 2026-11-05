import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, loadWorker, makeEnv, call, ADMIN_KEY } from './harness.mjs';
import { seed } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = await loadWorker();
const fresh = (extra) => { const { sqlite, d1 } = createDb(); seed(sqlite); return { sqlite, env: makeEnv(d1, extra) }; };
const PUBLIC = new Set(['/api/health', '/api/version', '/api/auth/verify']);

// Every route registered in worker/index.ts, with path parameters filled in.
function routes() {
  const src = fs.readFileSync(path.join(root, 'worker', 'index.ts'), 'utf8');
  return [...src.matchAll(/^router\.(get|post|put|delete)\(\s*'([^']+)'/gm)].map((m) => ({ method: m[1].toUpperCase(), path: m[2].replace(/:[a-zA-Z0-9_]+/g, 'x') }));
}

test('route discovery finds the API surface', () => { assert.ok(routes().length > 40); });

test('every non-public route rejects a request with no key (401) and never reaches its handler', async () => {
  const { env } = fresh();
  for (const r of routes().filter((r) => !PUBLIC.has(r.path))) {
    const res = await call(worker, env, r.method, r.path, { key: null, body: r.method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${r.method} ${r.path} answered ${res.status} without a key`);
    assert.ok(!res.json || Object.keys(res.json).join() === 'error', `${r.method} ${r.path} leaked ${Object.keys(res.json || {})}`);
  }
});

test('a wrong key is 403 on reads and writes; the right key is accepted', async () => {
  const { env } = fresh();
  assert.equal((await call(worker, env, 'GET', '/api/profile', { key: 'wrong' })).status, 403);
  assert.equal((await call(worker, env, 'PUT', '/api/profile?candidate_id=farhan_shaikh', { key: 'wrong', body: { full_name: 'X' } })).status, 403);
  assert.equal((await call(worker, env, 'GET', '/api/profile?candidate_id=sana_ansari')).status, 200);
});

test('unconfigured server key fails closed (503) while health and version stay public', async () => {
  const { env } = fresh({ ADMIN_API_KEY: undefined });
  assert.equal((await call(worker, env, 'GET', '/api/applications', { key: ADMIN_KEY })).status, 503);
  assert.equal((await call(worker, env, 'GET', '/api/health', { key: null })).status, 200);
  assert.equal((await call(worker, env, 'GET', '/api/version', { key: null })).status, 200);
});

test('unauthenticated writes change nothing: applications, overrides and history are preserved', async () => {
  const { sqlite, env } = fresh();
  const snap = () => JSON.stringify([
    sqlite.prepare('SELECT * FROM applications ORDER BY id').all(),
    sqlite.prepare('SELECT * FROM application_history ORDER BY id').all(),
    sqlite.prepare('SELECT candidate_id,job_id,qualification_status,manual_override_status,manual_override_reason FROM candidate_qualifications ORDER BY 1,2').all(),
    sqlite.prepare('SELECT id,full_name,current_location FROM candidates ORDER BY id').all(),
  ]);
  const before = snap();
  await call(worker, env, 'POST', '/api/jobs/j1/qualification-override', { key: null, body: { status: 'INELIGIBLE', reason: 'x', candidate_id: 'farhan_shaikh' } });
  await call(worker, env, 'POST', '/api/applications', { key: null, body: { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'APPLIED' } });
  await call(worker, env, 'PUT', '/api/profile?candidate_id=farhan_shaikh', { key: null, body: { full_name: 'Hijacked' } });
  assert.equal(snap(), before);
});

test('profile: stored education wins, documented fallback is never the generic placeholder, cross-candidate save refused', async () => {
  const { sqlite, env } = fresh();
  const f = await call(worker, env, 'GET', '/api/profile?candidate_id=farhan_shaikh');
  assert.equal(f.json.education, 'BMS in Marketing');
  const s = await call(worker, env, 'GET', '/api/profile?candidate_id=sana_ansari');
  assert.equal(s.json.education, 'B.Tech in Electrical Engineering');
  assert.equal(s.json.full_name, 'Test Sana');
  sqlite.prepare("UPDATE candidates SET education='Stored Value' WHERE id='farhan_shaikh'").run();
  assert.equal((await call(worker, env, 'GET', '/api/profile?candidate_id=farhan_shaikh')).json.education, 'Stored Value');
  const bad = await call(worker, env, 'PUT', '/api/profile?candidate_id=sana_ansari', { body: { id: 'farhan_shaikh', full_name: 'Overwrite' } });
  assert.equal(bad.status, 409);
  assert.equal(sqlite.prepare("SELECT full_name FROM candidates WHERE id='sana_ansari'").get().full_name, 'Test Sana');
});

test('analytics: one scope for every figure, inactive jobs excluded, per candidate', async () => {
  const { env } = fresh();
  const f = (await call(worker, env, 'GET', '/api/analytics?candidate_id=farhan_shaikh')).json;
  assert.equal(f.total_jobs, 4);
  assert.equal(Object.values(f.eligibility_counts).reduce((a, b) => a + b, 0), f.total_jobs);
  assert.deepEqual(f.application_counts, { APPLIED: 1, SAVED: 1 });
  const s = (await call(worker, env, 'GET', '/api/analytics?candidate_id=sana_ansari')).json;
  assert.equal(s.total_jobs, 4);
  assert.deepEqual(s.application_counts, {});
  assert.notDeepEqual(f.eligibility_counts, s.eligibility_counts);
});

test('discovery funnel is computed from the database for the requested candidate (no frozen constants)', async () => {
  const { sqlite, env } = fresh();
  const f = (await call(worker, env, 'GET', '/api/analytics/discovery?candidate_id=farhan_shaikh')).json;
  const s = (await call(worker, env, 'GET', '/api/analytics/discovery?candidate_id=sana_ansari')).json;
  assert.equal(f.candidate_id, 'farhan_shaikh'); assert.equal(s.candidate_id, 'sana_ansari');
  assert.equal(f.scope, 'current_active_inventory');
  assert.equal(f.total_scanned_jobs, 4); assert.equal(f.ready_jobs, 1); assert.equal(f.stretch_ready_jobs, 1);
  assert.equal(s.ready_jobs, 1); assert.equal(s.stretch_ready_jobs, 0);
  assert.equal(f.total_employers, 3);
  assert.deepEqual(f.applications, { total: 2, breakdown: { APPLIED: 1, SAVED: 1 } });
  assert.deepEqual(s.applications, { total: 0, breakdown: {} });
  assert.deepEqual(f.geographic_eligibility, { ELIGIBLE: 3, UNKNOWN: 1, INELIGIBLE: 0 });
  assert.equal(Object.values(f.geographic_eligibility).reduce((a, b) => a + b, 0), f.total_scanned_jobs);
  assert.notEqual(f.total_scanned_jobs, 1161); assert.notEqual(f.geographic_eligibility.UNKNOWN, 752);
  // The numbers follow the data: change a row and the funnel changes.
  sqlite.prepare("UPDATE candidate_qualifications SET qualification_status='READY' WHERE candidate_id='farhan_shaikh' AND job_id='j4'").run();
  assert.equal((await call(worker, env, 'GET', '/api/analytics/discovery?candidate_id=farhan_shaikh')).json.ready_jobs, 2);
});

test('source scorecard: real monitoring state, no placeholder URLs, unmonitored sources are labelled as such', async () => {
  const { env } = fresh();
  const res = (await call(worker, env, 'GET', '/api/analytics/sources-effectiveness?candidate_id=farhan_shaikh')).json;
  const text = JSON.stringify(res);
  assert.ok(!text.includes('example.com'), 'placeholder feed URL present');
  const by = Object.fromEntries(res.sources.map((x) => [x.source_id, x]));
  assert.equal(by['lever:acme'].monitored, true);
  assert.equal(by['lever:acme'].last_status, 'SUCCESS');
  assert.equal(by['lever:acme'].feed_url, 'https://api.lever.co/v0/postings/acme?mode=json&skip=0&limit=50'.replace(/limit=\d+/, 'limit=' + by['lever:acme'].feed_url.match(/limit=(\d+)/)[1]));
  assert.equal(by['greenhouse:beta'].last_status, 'ERROR'); assert.equal(by['greenhouse:beta'].last_error, 'HTTP 500'); assert.equal(by['greenhouse:beta'].consecutive_failures, 3);
  assert.equal(by['lever:idle'].total_jobs, 0); assert.equal(by['lever:idle'].last_status, 'NEVER_RUN');
  const un = by['unattributed:ashby'];
  assert.equal(un.monitored, false); assert.equal(un.last_status, 'NOT_MONITORED'); assert.equal(un.feed_url, null); assert.equal(un.last_latency_ms, null);
  assert.equal(un.total_jobs, 1, 'inactive job must not be counted');
  assert.equal(by['lever:acme'].total_jobs, 2); assert.equal(by['lever:acme'].ready_jobs, 1); assert.equal(by['lever:acme'].high_match_jobs, 1);
  const sana = Object.fromEntries((await call(worker, env, 'GET', '/api/analytics/sources-effectiveness?candidate_id=sana_ansari')).json.sources.map((x) => [x.source_id, x]));
  assert.equal(sana['lever:acme'].ready_jobs, 0); assert.equal(sana['unattributed:ashby'].ready_jobs, 1);
});

test('GET requests never modify application history or manual decisions', async () => {
  const { sqlite, env } = fresh();
  const before = JSON.stringify(sqlite.prepare('SELECT * FROM candidate_qualifications ORDER BY 1,2').all());
  for (const r of routes().filter((r) => r.method === 'GET' && !r.path.includes('x'))) await call(worker, env, 'GET', r.path);
  assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM candidate_qualifications ORDER BY 1,2').all()), before);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM applications').get().c, 2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM application_history').get().c, 1);
});
