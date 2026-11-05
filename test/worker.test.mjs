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

test('india-remote queue follows the requested candidate (no forced Farhan)', async () => {
  const { env } = fresh();
  const f = await call(worker, env, 'GET', '/api/india-remote/jobs?candidate_id=farhan_shaikh');
  const s = await call(worker, env, 'GET', '/api/india-remote/jobs?candidate_id=sana_ansari');
  assert.ok(f.json.jobs.length > 0 && s.json.jobs.length > 0);
  assert.ok(f.json.jobs.every((j) => j.candidate_id === 'farhan_shaikh'));
  assert.ok(s.json.jobs.every((j) => j.candidate_id === 'sana_ansari'), 'Sana received another candidate\'s rows');
  assert.notDeepEqual(f.json.jobs.map((j) => j.id).sort(), s.json.jobs.map((j) => j.id).sort());
});

test('a disabled route is not an auth failure (410, not 403), and /auth/verify compares the key safely', async () => {
  const { env } = fresh();
  assert.equal((await call(worker, env, 'POST', '/api/fixtures/reload', { body: {} })).status, 410);
  assert.equal((await call(worker, env, 'POST', '/api/auth/verify', { key: null, body: { key: ADMIN_KEY } })).status, 200);
  assert.equal((await call(worker, env, 'POST', '/api/auth/verify', { key: null, body: { key: ADMIN_KEY + 'x' } })).status, 403);
  assert.equal((await call(worker, env, 'POST', '/api/auth/verify', { key: null, body: { key: '' } })).status, 400);
});

test('source scorecard application counts come from the applications table', async () => {
  const { env } = fresh();
  const by = Object.fromEntries((await call(worker, env, 'GET', '/api/analytics/sources-effectiveness?candidate_id=farhan_shaikh')).json.sources.map((x) => [x.source_id, x]));
  assert.equal(by['lever:acme'].applications_count, 2);
  assert.equal(by['lever:acme'].interviews_count, 0);
  assert.equal(by['greenhouse:beta'].applications_count, 0);
});

// ---- guess limiter -------------------------------------------------------------------------------------------
const callFrom = async (env, ip, key, method = 'GET', p = '/api/profile') => {
  const headers = { 'CF-Connecting-IP': ip };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await worker.fetch(new Request('https://test.invalid' + p, { method, headers }), env, { waitUntil() {} });
  return { status: res.status, retry: res.headers.get('Retry-After') };
};

test('repeated wrong keys lock that client out (429 + Retry-After), even for the correct key; other clients are unaffected', async () => {
  const { env } = fresh();
  for (let i = 0; i < 8; i++) assert.equal((await callFrom(env, '203.0.113.7', 'guess' + i)).status, 403);
  const locked = await callFrom(env, '203.0.113.7', 'guess9');
  assert.equal(locked.status, 429); assert.ok(Number(locked.retry) > 0 && Number(locked.retry) <= 900);
  assert.equal((await callFrom(env, '203.0.113.7', ADMIN_KEY)).status, 429, 'correct key must not be an oracle during lockout');
  assert.equal((await callFrom(env, '198.51.100.9', ADMIN_KEY)).status, 200, 'another client is not locked');
});

test('lockout also covers /api/auth/verify, expires with the window, and a good unlock clears the count', async () => {
  const { sqlite, env } = fresh();
  const verify = (ip, key) => worker.fetch(new Request('https://test.invalid/api/auth/verify', { method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }), env, { waitUntil() {} }).then((r) => r.status);
  for (let i = 0; i < 8; i++) assert.equal(await verify('192.0.2.1', 'bad' + i), 403);
  assert.equal(await verify('192.0.2.1', ADMIN_KEY), 429);
  sqlite.prepare('UPDATE auth_failures SET window_start = window_start - 1000').run();           // window elapsed
  assert.equal(await verify('192.0.2.1', ADMIN_KEY), 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM auth_failures').get().c, 0, 'success clears the counter');
  for (let i = 0; i < 3; i++) await verify('192.0.2.2', 'bad');
  assert.equal(sqlite.prepare('SELECT failures FROM auth_failures').get().failures, 3);
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM auth_failures').all()).includes('192.0.2'), 'raw client address must not be stored');
});

test('a missing limiter table never locks the operator out and never weakens authentication', async () => {
  const { sqlite, env } = fresh();
  sqlite.exec('DROP TABLE auth_failures');
  assert.equal((await callFrom(env, '203.0.113.50', ADMIN_KEY)).status, 200);
  for (let i = 0; i < 12; i++) assert.equal((await callFrom(env, '203.0.113.50', 'nope')).status, 403);
  assert.equal((await callFrom(env, '203.0.113.50', null)).status, 401);
});

// ---- joins cannot inflate counts ----------------------------------------------------------------------------
test('several application records for one job cannot inflate source, funnel or summary counts', async () => {
  const { sqlite, env } = fresh();
  const read = async () => ({
    src: (await call(worker, env, 'GET', '/api/analytics/sources-effectiveness?candidate_id=farhan_shaikh')).json.sources.map((x) => [x.source_id, x.total_jobs, x.ready_jobs, x.eligible_jobs]).sort(),
    funnel: (await call(worker, env, 'GET', '/api/analytics/discovery?candidate_id=farhan_shaikh')).json,
    summary: (await call(worker, env, 'GET', '/api/india-remote/summary?candidate_id=farhan_shaikh')).json,
    analytics: (await call(worker, env, 'GET', '/api/analytics?candidate_id=farhan_shaikh')).json,
  });
  const before = await read();
  sqlite.exec('DROP INDEX IF EXISTS idx_app_cand_job');                                         // worst case: no unique index at all
  for (let i = 0; i < 4; i++) sqlite.prepare("INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,?)").run('dup-' + i, 'farhan_shaikh', 'j1', i % 2 ? 'REJECTED' : 'INTERVIEWING');
  const after = await read();
  assert.deepEqual(after.src, before.src, 'per-source job counts changed');
  assert.equal(after.funnel.total_scanned_jobs, before.funnel.total_scanned_jobs);
  assert.equal(after.funnel.ready_jobs, before.funnel.ready_jobs);
  assert.deepEqual(after.summary, before.summary);
  assert.equal(after.analytics.total_jobs, before.analytics.total_jobs);
  assert.equal(after.analytics.application_counts.APPLIED, 1); // application RECORDS are counted as records
  const acme = (await call(worker, env, 'GET', '/api/analytics/sources-effectiveness?candidate_id=farhan_shaikh')).json.sources.find((x) => x.source_id === 'lever:acme');
  assert.equal(acme.total_jobs, 2); assert.equal(acme.applications_count, 2 + 4); assert.equal(acme.interviews_count, 1); assert.equal(acme.rejections_count, 1);
});

test('the job list and its total are not multiplied by duplicate application rows', async () => {
  const { sqlite, env } = fresh();
  const before = (await call(worker, env, 'GET', '/api/jobs?candidate_id=farhan_shaikh&limit=50')).json;
  sqlite.exec('DROP INDEX IF EXISTS idx_app_cand_job');
  for (let i = 0; i < 3; i++) sqlite.prepare("INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,?)").run('d' + i, 'farhan_shaikh', 'j1', 'REJECTED');
  const after = (await call(worker, env, 'GET', '/api/jobs?candidate_id=farhan_shaikh&limit=50')).json;
  assert.equal(after.total, before.total); assert.equal(after.jobs.length, before.jobs.length);
  assert.deepEqual(after.status_counts, before.status_counts);
});
