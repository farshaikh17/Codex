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
const PUBLIC = new Set(['/api/health', '/api/version', '/api/auth/verify', '/api/brand']);

// Every route registered in worker/index.ts, with path parameters filled in.
function routes() {
  const src = fs.readFileSync(path.join(root, 'worker', 'index.ts'), 'utf8');
  return [...src.matchAll(/^router\.(get|post|put|delete)\(\s*'([^']+)'/gm)].map((m) => ({ method: m[1].toUpperCase(), path: m[2].replace(/:[a-zA-Z0-9_]+/g, 'x') }));
}

test('route discovery finds the API surface', () => { assert.ok(routes().length > 40); });

// Routes a visitor may read without a key; the router's allowlist must be exactly this list.
const PUBLIC_READ = [
  '/api/candidates', '/api/candidates/x/strategy', '/api/candidates/x/dashboard', '/api/candidates/x/jobs', '/api/candidates/x/applications',
  '/api/dashboard/overview', '/api/jobs', '/api/jobs/x', '/api/jobs/x/explanation', '/api/applications', '/api/india-remote/summary',
  '/api/india-remote/jobs', '/api/analytics', '/api/analytics/discovery', '/api/analytics/sources-effectiveness', '/api/qualification/metrics',
  '/api/cohorts/metrics', '/api/profile', '/api/sources', '/api/automation/status', '/api/export',
];
const isPublicRead = (r) => r.method === 'GET' && PUBLIC_READ.includes(r.path);

test('every protected route (all writes, audit and sync surfaces) rejects a request with no key (401) and never reaches its handler', async () => {
  const { env } = fresh();
  const protectedRoutes = routes().filter((r) => !PUBLIC.has(r.path) && !isPublicRead(r));
  assert.ok(protectedRoutes.some((r) => r.method !== 'GET') && protectedRoutes.some((r) => r.method === 'GET'));
  for (const r of protectedRoutes) {
    const res = await call(worker, env, r.method, r.path, { key: null, body: r.method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${r.method} ${r.path} answered ${res.status} without a key`);
    assert.ok(!res.json || Object.keys(res.json).join() === 'error', `${r.method} ${r.path} leaked ${Object.keys(res.json || {})}`);
  }
});

test('the public read list matches the registered routes (a new GET route is protected until it is listed on purpose)', () => {
  const have = new Set(routes().filter((r) => r.method === 'GET').map((r) => r.path));
  for (const p of PUBLIC_READ) assert.ok(have.has(p), `${p} is not a registered GET route`);
  const src = fs.readFileSync(path.join(root, 'worker', 'index.ts'), 'utf8');
  const listed = (src.match(/PUBLIC_READ_PATTERNS: RegExp\[\] = \[([\s\S]*?)\n\];/) || [])[1] || '';
  assert.equal(listed.split('\n').filter((l) => l.trim().startsWith('/')).length, 16);
  for (const bad of ['history', 'qualification-audit', 'runs', 'backups', 'sync', 'meta', 'pilot', 'canonical-sync', 'url-checks']) assert.ok(!listed.includes(bad), `${bad} must stay protected`);
});

test('public viewing: every public read works with no key, returns data, and holds no private field or value', async () => {
  const { env } = fresh();
  const forbidden = ['PRIVATE-NOTE-7f3', 'PRIVATE-CHANNEL-7f3', 'PRIVATE-RESUME-7f3', 'PRIVATE-COVER-7f3', 'PRIVATE-REJECT-7f3', 'PRIVATE-ACTOR-7f3', 'PRIVATECITY-7f3',
    'PRIVATE-STAGE-7f3', 'PRIVATE-CATEGORY-7f3', 'PRIVATE-RUNERR-7f3', 'internal.example', 'seed decision', 'RRVUNL', 'Mianro', 'Chhabra', 'Bengaluru', '120000', '1,20,000', 'cash_floor', 'pay_line', 'employment_history', 'location_preferences',
    'notice_period', 'HTTP 500', unitSecret()];
  const hits = [];
  for (const base of PUBLIC_READ) for (const cid of ['farhan_shaikh', 'sana_ansari']) {
    const p = base.replace('/jobs/x', '/jobs/j1').replace('/candidates/x', '/candidates/' + cid);
    const url = p + (p.includes('?') ? '&' : '?') + 'candidate_id=' + cid;
    const res = await call(worker, env, 'GET', url, { key: null });
    assert.equal(res.status, 200, `${url} answered ${res.status} to a visitor: ${JSON.stringify(res.json).slice(0, 120)}`);
    const text = JSON.stringify(res.json);
    for (const f of forbidden) if (text.includes(f)) hits.push(`${url} contains ${f}`);
    if (/"(notes|actor|resume_version|cover_letter_path|rejection_notes|application_channel|manual_override_reason|error_message|rejection_stage|rejection_reason_category)"/.test(text)) hits.push(`${url} has a private key`);
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) hits.push(`${url} has an email address`);
  }
  assert.deepEqual(hits, []);
});

function unitSecret() { return ADMIN_KEY; }

test('public viewing shows the intended content: both candidates, jobs, applications without notes, analytics, a limited profile', async () => {
  const { env } = fresh();
  const cands = (await call(worker, env, 'GET', '/api/candidates', { key: null })).json;
  assert.deepEqual(cands.map((c) => c.id).sort(), ['farhan_shaikh', 'sana_ansari']);
  assert.ok(cands.every((c) => c.current_location === 'India' && !('cash_floor_inr_monthly' in c)));
  const jobs = (await call(worker, env, 'GET', '/api/jobs?candidate_id=farhan_shaikh', { key: null })).json;
  assert.ok(jobs.jobs.length > 0 && jobs.status_counts.READY === 1);
  const apps = (await call(worker, env, 'GET', '/api/applications?candidate_id=farhan_shaikh', { key: null })).json;
  assert.equal(apps.count, 2); assert.equal(apps.applications[0].application.status !== undefined, true);
  const prof = (await call(worker, env, 'GET', '/api/profile?candidate_id=sana_ansari', { key: null })).json;
  assert.equal(prof.public_view, true); assert.match(prof.education, /B\.Tech/); assert.ok(prof.total_years_experience > 8);
  assert.ok(!('employment_history' in prof) && !('pay_line' in prof));
  const an = (await call(worker, env, 'GET', '/api/analytics?candidate_id=sana_ansari', { key: null })).status;
  assert.equal(an, 200);
  // the operator still gets the full record
  const op = (await call(worker, env, 'GET', '/api/profile?candidate_id=sana_ansari')).json;
  assert.equal(op.employment_history[0].employer, 'RRVUNL');
  const opApps = (await call(worker, env, 'GET', '/api/applications?candidate_id=farhan_shaikh')).json;
  assert.ok(JSON.stringify(opApps).includes('PRIVATE-NOTE-7f3'));
});

test('a visitor cannot read audit trails or operational surfaces, and cannot write anything', async () => {
  const { sqlite, env } = fresh();
  for (const u of ['/api/applications/app-1/history?candidate_id=farhan_shaikh', '/api/jobs/j1/qualification-audit?candidate_id=farhan_shaikh', '/api/automation/runs', '/api/meta', '/api/backups', '/api/sync/activity-logs', '/api/canonical-sync/status'])
    assert.equal((await call(worker, env, 'GET', u, { key: null })).status, 401, u);
  const snap = () => JSON.stringify([sqlite.prepare('SELECT * FROM applications ORDER BY id').all(), sqlite.prepare('SELECT * FROM application_history').all(),
    sqlite.prepare('SELECT * FROM candidate_qualifications ORDER BY 1,2').all(), sqlite.prepare('SELECT * FROM candidates ORDER BY id').all(),
    sqlite.prepare('SELECT * FROM cloud_automation').all(), sqlite.prepare('SELECT COUNT(*) c FROM jobs').get()]);
  const before = snap();
  const writes = [['POST', '/api/applications', { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'APPLIED' }], ['POST', '/api/candidates/farhan_shaikh/applications', { job_id: 'j4', status: 'APPLIED' }],
    ['POST', '/api/jobs/j1/feedback?candidate_id=farhan_shaikh', { rating: 'LIKE' }], ['POST', '/api/jobs/j1/qualification-override', { status: 'INELIGIBLE', reason: 'x', candidate_id: 'farhan_shaikh' }],
    ['PUT', '/api/profile?candidate_id=farhan_shaikh', { full_name: 'Hijacked' }], ['POST', '/api/profile/import-resume', { text: 'x' }], ['POST', '/api/automation/pause', {}], ['POST', '/api/automation/resume', {}],
    ['PUT', '/api/automation/config', { is_enabled: false }], ['POST', '/api/automation/trigger', {}], ['POST', '/api/fixtures/reload', {}], ['POST', '/api/qualification/reverify', {}]];
  for (const [m, u, b] of writes) { const r = await call(worker, env, m, u, { key: null, body: b }); assert.equal(r.status, 401, `${m} ${u} -> ${r.status}`); }
  for (const [m, u, b] of writes) { const r = await call(worker, env, m, u, { key: 'wrong-key', body: b }); assert.equal(r.status, 403, `${m} ${u} wrong key -> ${r.status}`); }
  assert.equal(snap(), before);
});

test('internal error text is never returned to anyone (500 is generic)', async () => {
  const { sqlite, env } = fresh();
  sqlite.exec('DROP TABLE jobs');
  const pub = await call(worker, env, 'GET', '/api/jobs?candidate_id=farhan_shaikh', { key: null });
  const op = await call(worker, env, 'GET', '/api/jobs?candidate_id=farhan_shaikh');
  for (const r of [pub, op]) { assert.equal(r.status, 500); assert.equal(r.json.error, 'Internal error. The request was not completed.'); }
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
  assert.equal(f.json.education, 'BMS in Marketing, NM College (University of Mumbai), 2017');
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
const callFrom = async (env, ip, key, method = 'GET', p = '/api/profile?candidate_id=farhan_shaikh') => {
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
  for (let i = 0; i < 3; i++) await verify('192.0.2.2', 'bad' + i);
  assert.equal(sqlite.prepare('SELECT failures FROM auth_failures').get().failures, 3);
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM auth_failures').all()).includes('192.0.2'), 'raw client address must not be stored');
});

test('a missing limiter table never locks the operator out and never weakens authentication', async () => {
  const { sqlite, env } = fresh();
  sqlite.exec('DROP TABLE auth_failures');
  assert.equal((await callFrom(env, '203.0.113.50', ADMIN_KEY)).status, 200);
  for (let i = 0; i < 12; i++) assert.equal((await callFrom(env, '203.0.113.50', 'nope')).status, 403);
  assert.equal((await callFrom(env, '203.0.113.50', null)).status, 200, 'a visitor with no key can still read public pages');
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

test('candidate isolation: scoped routes require a known candidate_id and never default to Farhan', async () => {
  const { env } = fresh();
  for (const p of ['/api/profile', '/api/jobs', '/api/applications', '/api/analytics', '/api/analytics/discovery', '/api/analytics/sources-effectiveness',
                   '/api/qualification/metrics', '/api/cohorts/metrics', '/api/india-remote/summary', '/api/india-remote/jobs']) {
    const none = await call(worker, env, 'GET', p);
    assert.equal(none.status, 400, `${p} without candidate_id answered ${none.status}`);
    const bad = await call(worker, env, 'GET', p + (p.includes('?') ? '&' : '?') + 'candidate_id=someone_else');
    assert.equal(bad.status, 400, `${p} with an unknown candidate answered ${bad.status}`);
  }
  for (const body of [{ job_id: 'j1', status: 'SAVED' }, { candidate_id: 'nobody', job_id: 'j1', status: 'SAVED' }]) {
    assert.equal((await call(worker, env, 'POST', '/api/applications', { body })).status, 400);
  }
  assert.equal((await call(worker, env, 'POST', '/api/jobs/j1/qualification-override', { body: { status: 'READY', reason: 'because' } })).status, 400);
});

test('limiter: concurrent wrong guesses are counted exactly; X-Forwarded-For cannot pick a fresh bucket; idle rows are trimmed', async () => {
  const { sqlite, env } = fresh();
  const attempt = (xff, i) => worker.fetch(new Request('https://test.invalid/api/profile?candidate_id=farhan_shaikh', { headers: { 'CF-Connecting-IP': '203.0.113.99', 'X-Forwarded-For': xff, Authorization: 'Bearer g' + i } }), env, { waitUntil() {} }).then((r) => r.status);
  const statuses = await Promise.all(Array.from({ length: 30 }, (_, i) => attempt('10.0.0.' + i, i)));
  assert.equal(statuses.filter((s) => s === 403).length, 8, 'exactly 8 wrong guesses may be answered 403');
  assert.equal(statuses.filter((s) => s === 429).length, 22);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM auth_failures').get().c, 1, 'rotating X-Forwarded-For created extra buckets');
  assert.ok(sqlite.prepare('SELECT failures FROM auth_failures').get().failures >= 8);
  sqlite.prepare("INSERT INTO auth_failures VALUES ('stale',3,1,1,NULL)").run();
  for (let i = 0; i < 300; i++) await worker.fetch(new Request('https://test.invalid/api/profile?candidate_id=farhan_shaikh', { headers: { 'CF-Connecting-IP': '198.51.100.' + (i % 250) + '.' + i, Authorization: 'Bearer n' + i } }), env, { waitUntil() {} });
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM auth_failures WHERE ip_hash='stale'").get().c, 0, 'rows idle for a day must be trimmed');
});

test('overview and metrics: active-only inventory, applied stage vs tracker records, no placeholder fallbacks', async () => {
  const { sqlite, env } = fresh();
  const o = (await call(worker, env, 'GET', '/api/dashboard/overview')).json;
  assert.equal(o.total_jobs_tracked, 5); assert.equal(o.active_jobs_count, 4);
  assert.equal(o.farhan.ready_count, 1); assert.equal(o.farhan.stretch_count, 1);
  assert.equal(o.farhan.application_records, 2); assert.equal(o.farhan.applied_count, 1, 'only the APPLIED stage counts as applied');
  assert.equal(o.sana.application_records, 0);
  sqlite.prepare("UPDATE jobs SET is_active=0 WHERE id='j1'").run();                         // closing a READY job removes it from inventory
  const m = (await call(worker, env, 'GET', '/api/qualification/metrics?candidate_id=farhan_shaikh')).json;
  assert.equal(m.ready_inventory, 0); assert.equal(m.stretch_ready_inventory, 1);
  assert.equal((await call(worker, env, 'GET', '/api/dashboard/overview')).json.farhan.ready_count, 0);
  const empty = createDb(); const e = (await call(worker, makeEnv(empty.d1), 'GET', '/api/dashboard/overview')).json;
  assert.equal(e.total_jobs_tracked, 0); assert.equal(e.active_jobs_count, 0, 'an empty database must not report invented totals');
  const c = (await call(worker, env, 'GET', '/api/cohorts/metrics?candidate_id=farhan_shaikh')).json;
  assert.ok(JSON.stringify(c).length > 10);
});

test('profile facts: experience is computed from dates for both candidates, no private text without the key', async () => {
  const { env } = fresh();
  const s = (await call(worker, env, 'GET', '/api/profile?candidate_id=sana_ansari')).json;
  const years = (Date.now() - Date.UTC(2017, 8, 1)) / (365.25 * 86400000);
  assert.ok(Math.abs(s.total_years_experience - years) < 0.11, `${s.total_years_experience} vs ${years}`);
  assert.match(s.years_basis, /computed from career start 2017-09/);
  assert.deepEqual(s.employment_history.map((e) => [e.employer, e.from, e.to]), [['RRVUNL', '2017-09', '2025-02'], ['RRVUNL', '2025-02', null]]);
  assert.match(s.pay_line, /unknown/i);
  const f = (await call(worker, env, 'GET', '/api/profile?candidate_id=farhan_shaikh')).json;
  const fyears = (Date.now() - Date.UTC(2017, 5, 1)) / (365.25 * 86400000);   // career start from his CV (2017-06)
  assert.ok(Math.abs(f.total_years_experience - fyears) < 0.11, `${f.total_years_experience} vs ${fyears}`); assert.match(f.years_basis, /computed from career start 2017-06/);
  assert.equal(f.education, 'BMS in Marketing, NM College (University of Mumbai), 2017');
  assert.equal(f.employment_history.length, 6);
  assert.equal(f.employment_history[0].employer, 'Mianro Systems');
  assert.match(f.pay_line, /1,20,000/); assert.match(f.pay_line, /\$25\/hour/);
  const anon = await call(worker, env, 'GET', '/api/profile?candidate_id=sana_ansari', { key: null });
  assert.equal(anon.status, 200); assert.ok(!JSON.stringify(anon.json).includes('RRVUNL'));
});

// ---- review round 2 -------------------------------------------------------------------------------------------
test('a browser repeating the SAME stale key in parallel counts once; different guesses each count', async () => {
  const { sqlite, env } = fresh();
  const hit = (key) => worker.fetch(new Request('https://test.invalid/api/profile?candidate_id=farhan_shaikh', { headers: { 'CF-Connecting-IP': '203.0.113.201', Authorization: 'Bearer ' + key } }), env, { waitUntil() {} }).then((r) => r.status);
  const burst = await Promise.all(Array.from({ length: 7 }, () => hit('stale-old-key')));
  assert.deepEqual(new Set(burst), new Set([403]));
  assert.equal(sqlite.prepare('SELECT failures FROM auth_failures').get().failures, 1, 'seven identical requests must cost one attempt');
  assert.equal(await hit(ADMIN_KEY), 200, 'the real key still works after a stale-key burst');
  for (let i = 0; i < 7; i++) await hit('guess-' + i);                                  // seven different guesses
  assert.equal(sqlite.prepare('SELECT failures FROM auth_failures').get().failures, 8);
  assert.equal(await hit('guess-8'), 429);
  assert.equal(await hit(ADMIN_KEY), 429);
  assert.ok(!sqlite.prepare('SELECT last_key_hash FROM auth_failures').get().last_key_hash.includes('guess'), 'a wrong key must not be stored');
});

test('path-scoped candidate routes reject unknown candidates and a body that disagrees with the path', async () => {
  const { sqlite, env } = fresh();
  for (const p of ['/api/candidates/unknown/jobs', '/api/candidates/unknown/applications', '/api/candidates/unknown/strategy', '/api/candidates/unknown/dashboard'])
    assert.equal((await call(worker, env, 'GET', p)).status, 400, p);
  assert.equal((await call(worker, env, 'GET', '/api/candidates/sana_ansari/strategy')).status, 200);
  const before = sqlite.prepare('SELECT COUNT(*) c FROM applications').get().c;
  const mismatch = await call(worker, env, 'POST', '/api/candidates/sana_ansari/applications', { body: { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'SAVED' } });
  assert.equal(mismatch.status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM applications').get().c, before, 'nothing may be saved on a mismatch');
});

test('profile save keeps stored values for fields not sent and rejects malformed bodies', async () => {
  const { sqlite, env } = fresh();
  const before = sqlite.prepare("SELECT current_location, total_years_experience, qualification_threshold FROM candidates WHERE id='sana_ansari'").get();
  const ok = await call(worker, env, 'PUT', '/api/profile?candidate_id=sana_ansari', { body: { full_name: 'Test Sana Renamed' } });
  assert.equal(ok.status, 200);
  const after = sqlite.prepare("SELECT full_name, current_location, total_years_experience, qualification_threshold FROM candidates WHERE id='sana_ansari'").get();
  assert.equal(after.full_name, 'Test Sana Renamed');
  assert.equal(after.current_location, before.current_location); assert.equal(after.total_years_experience, before.total_years_experience); assert.equal(after.qualification_threshold, before.qualification_threshold);
  const bad = await worker.fetch(new Request('https://test.invalid/api/profile?candidate_id=sana_ansari', { method: 'PUT', headers: { Authorization: 'Bearer ' + ADMIN_KEY, 'Content-Type': 'application/json' }, body: '{not json' }), env, { waitUntil() {} });
  assert.equal(bad.status, 400);
});

// ---- public viewing release ---------------------------------------------------------------------------------------
test('the version endpoint reports the deployed commit when the release provides it', async () => {
  const { env } = fresh({ GIT_COMMIT: 'abc123def', DEPLOYED_AT: '2026-11-05T00:00:00Z' });
  const v = (await call(worker, env, 'GET', '/api/version', { key: null })).json;
  assert.equal(v.commit, 'abc123def'); assert.equal(v.deployed_at, '2026-11-05T00:00:00Z');
  assert.equal((await call(worker, fresh().env, 'GET', '/api/version', { key: null })).json.commit, 'unknown');
});

test('the read-only public profile summary cannot be saved back over a stored record', async () => {
  const { sqlite, env } = fresh();
  const pub = (await call(worker, env, 'GET', '/api/profile?candidate_id=farhan_shaikh', { key: null })).json;
  const before = JSON.stringify(sqlite.prepare('SELECT * FROM candidates ORDER BY id').all());
  const r = await call(worker, env, 'PUT', '/api/profile?candidate_id=farhan_shaikh', { body: pub });   // even the operator cannot save it
  assert.equal(r.status, 400);
  assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM candidates ORDER BY id').all()), before);
});

test('an operator key sent with a public read still returns the operator view; a wrong key on a public read is refused and counted', async () => {
  const { env } = fresh();
  const op = await call(worker, env, 'GET', '/api/candidates');
  assert.match(JSON.stringify(op.json), /PRIVATECITY-7f3/);
  assert.ok(op.json.every((c) => 'cash_floor_inr_monthly' in c), 'the operator view keeps the pay fields');
  assert.equal((await call(worker, env, 'GET', '/api/candidates', { key: 'wrong' })).status, 403);
});

test('a visitor-origin CORS preflight is answered and no public route sets credentials', async () => {
  const { env } = fresh();
  const res = await worker.fetch(new Request('https://test.invalid/api/jobs', { method: 'OPTIONS', headers: { Origin: 'https://example.org' } }), env, { waitUntil() {} });
  assert.equal(res.status, 204);
  assert.ok(!res.headers.get('Access-Control-Allow-Credentials'));
});

test('weekly target: 100 for Farhan counts only distinct jobs that became READY in the current NY week; older READY and STRETCH_READY are separate', async () => {
  const { sqlite, env } = fresh();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const old = new Date(Date.now() - 12 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const set = (id, st, at) => sqlite.prepare(`UPDATE candidate_qualifications SET qualification_status=?, qualified_at=? WHERE candidate_id='farhan_shaikh' AND job_id=?`).run(st, at, id);
  set('j1', 'READY', now);            // new this week
  set('j2', 'STRETCH_READY', now);    // stretch is separate
  set('j3', 'READY', old);            // older READY inventory
  const m = (await call(worker, env, 'GET', '/api/qualification/metrics?candidate_id=farhan_shaikh', { key: null })).json;
  assert.equal(m.weekly_research_target, 100);
  assert.equal(m.new_qualified_this_week, 1, 'only the job that became READY this week');
  assert.equal(m.stretch_ready_inventory, 1);
  assert.ok(m.ready_inventory >= 1);
  assert.equal(m.timezone || 'America/New_York', 'America/New_York');
});

// ---- D1 incident (2026-11-05): read cache, controlled unavailability, version header ----
const raw = async (env, p, key) => worker.fetch(new Request('https://test.invalid' + p, { headers: key ? { Authorization: `Bearer ${key}` } : {} }), env, { waitUntil() {} });
const cached = (extra) => fresh({ RESPONSE_CACHE: 'on', GIT_COMMIT: 'commit-a', ...extra });

test('read cache: a repeat public read is served from the cache with the same stripped body', async () => {
  const { env } = cached();
  const a = await raw(env, '/api/applications?candidate_id=farhan_shaikh');
  const b = await raw(env, '/api/applications?candidate_id=farhan_shaikh');
  assert.equal(a.headers.get('x-cache'), 'MISS'); assert.equal(b.headers.get('x-cache'), 'HIT');
  const [ta, tb] = [await a.text(), await b.text()];
  assert.equal(ta, tb);
  assert.ok(!/PRIVATE-NOTE-7f3|"notes"/.test(tb));
});

test('read cache: public and operator answers never cross, and each candidate keeps its own entry', async () => {
  const { env } = cached();
  const op = await (await raw(env, '/api/applications?candidate_id=farhan_shaikh', ADMIN_KEY)).text();
  assert.ok(op.includes('PRIVATE-NOTE-7f3'), 'operator view carries notes');
  const pub = await raw(env, '/api/applications?candidate_id=farhan_shaikh');
  assert.equal(pub.headers.get('x-cache'), 'MISS', 'a public read must not reuse the operator entry');
  assert.ok(!(await pub.text()).includes('PRIVATE-NOTE-7f3'));
  const op2 = await raw(env, '/api/applications?candidate_id=farhan_shaikh', ADMIN_KEY);
  assert.equal(op2.headers.get('x-cache'), 'HIT'); assert.ok((await op2.text()).includes('PRIVATE-NOTE-7f3'));
  const sana = await raw(env, '/api/applications?candidate_id=sana_ansari');
  assert.equal(sana.headers.get('x-cache'), 'MISS', 'another candidate never reuses Farhan\'s entry');
  // a wrong key on a public read is refused, never answered from the cache
  assert.equal((await raw(env, '/api/applications?candidate_id=farhan_shaikh', 'wrong-key')).status, 403);
});

test('read cache: an operator change invalidates it, and the change answers with the new values (not a cached copy)', async () => {
  const { env } = cached();
  await raw(env, '/api/profile?candidate_id=farhan_shaikh', ADMIN_KEY);
  await raw(env, '/api/profile?candidate_id=farhan_shaikh');
  assert.equal((await raw(env, '/api/profile?candidate_id=farhan_shaikh', ADMIN_KEY)).headers.get('x-cache'), 'HIT');
  const put = await call(worker, env, 'PUT', '/api/profile?candidate_id=farhan_shaikh', { body: { candidate_id: 'farhan_shaikh', full_name: 'Changed Name' } });
  assert.ok(put.status < 400, `profile save answered ${put.status}`);
  assert.ok(JSON.stringify(put.json).includes('Changed Name'), 'the save answers with the saved profile');
  for (const key of [ADMIN_KEY, null]) {
    const r = await raw(env, '/api/profile?candidate_id=farhan_shaikh', key);
    assert.equal(r.headers.get('x-cache'), 'MISS');
  }
  assert.ok((await (await raw(env, '/api/profile?candidate_id=farhan_shaikh', ADMIN_KEY)).text()).includes('Changed Name'));
});

test('read cache: a read that was in flight during an operator change cannot put old data back', async () => {
  const { sqlite, env } = cached();
  const gen = () => sqlite.prepare('SELECT generation FROM cache_state WHERE id = 1').get().generation;
  // The slow reader looked up the cache (and so the generation) before the change...
  const before = gen();
  await call(worker, env, 'PUT', '/api/profile?candidate_id=farhan_shaikh', { body: { candidate_id: 'farhan_shaikh', full_name: 'Changed Name' } });
  assert.ok(gen() > before);
  // ...and stores its old answer afterwards, stamped with the generation it saw.
  sqlite.prepare('INSERT OR REPLACE INTO response_cache(key, body, created_at, generation) VALUES (?, ?, ?, ?)')
    .run('commit-a:public:/api/profile?candidate_id=farhan_shaikh', '{"full_name":"OLD"}', Math.floor(Date.now() / 1000), before);
  const r = await raw(env, '/api/profile?candidate_id=farhan_shaikh');
  assert.equal(r.headers.get('x-cache'), 'MISS'); assert.ok(!(await r.text()).includes('OLD'));
});

test('read cache: unknown parameters and refused requests create no entries', async () => {
  const { sqlite, env } = cached();
  for (let i = 0; i < 20; i++) await raw(env, `/api/sources?z=${i}`);
  for (let i = 0; i < 10; i++) await raw(env, `/api/profile?candidate_id=farhan_shaikh&offset=${i}`);
  for (let i = 0; i < 10; i++) await raw(env, '/api/profile?candidate_id=bogus');
  for (let i = 0; i < 10; i++) await raw(env, `/api/jobs/nonexistent-${i}?candidate_id=farhan_shaikh`);
  const n = sqlite.prepare('SELECT COUNT(*) n FROM response_cache').get().n;
  assert.equal(n, 2, `expected one entry each for /api/sources and Farhan's profile, found ${n}`);
});

test('read cache: no entries are written once the daily write allowance for the cache is used', async () => {
  const { sqlite, env } = cached();
  sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, cache_writes) VALUES (?, ?)').run(new Date().toISOString().slice(0, 10), 3000);
  const r = await raw(env, '/api/applications?candidate_id=farhan_shaikh&status=APPLIED');   // an optional variant, not a core page load
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM response_cache').get().n, 0);
});

test('read cache and meter do not depend on a deploy-time variable (a plain wrangler deploy cannot switch them off)', async () => {
  const { sqlite, env } = cached({ GIT_COMMIT: undefined });
  const a = await raw(env, '/api/candidates'); const b = await raw(env, '/api/candidates');
  assert.equal(a.headers.get('x-cache'), 'MISS'); assert.equal(b.headers.get('x-cache'), 'HIT');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM response_cache').get().n, 1);
  sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, rows_read) VALUES (?, ?)').run(new Date().toISOString().slice(0, 10), 2_500_000);
  assert.equal((await raw(env, '/api/jobs?candidate_id=farhan_shaikh&search=%25')).status, 503, 'the budget applies without a commit too');
});

test('read cache: entries are scoped to the deployed commit and expire', async () => {
  const { sqlite, env } = cached();
  await raw(env, '/api/candidates');
  assert.equal((await raw({ ...env, GIT_COMMIT: 'commit-b' }, '/api/candidates')).headers.get('x-cache'), 'MISS', 'a new release starts with its own entries');
  sqlite.exec('UPDATE response_cache SET created_at = created_at - 1801');
  assert.equal((await raw(env, '/api/candidates')).headers.get('x-cache'), 'MISS', 'a public entry older than 30 minutes is recomputed');
});

test('read cache: a missing cache table only means no caching', async () => {
  const { sqlite, env } = cached();
  sqlite.exec('DROP TABLE response_cache');
  const r = await raw(env, '/api/candidates');
  assert.equal(r.status, 200);
});

test('database unavailable: every public read answers a controlled 503 with Retry-After, never a crash or internal text', async () => {
  const { env } = fresh();
  const msg = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit (simulated)";
  const failing = { prepare() { const s = { bind: () => s, first: async () => { throw new Error(msg); }, all: async () => { throw new Error(msg); }, run: async () => { throw new Error(msg); } }; return s; }, async batch() { throw new Error(msg); } };
  const down = { ...env, DB: failing, RESPONSE_CACHE: 'on' };
  for (const base of [...PUBLIC_READ, '/api/health']) {
    const p = base.replace('/jobs/x', '/jobs/j1').replace('/candidates/x', '/candidates/farhan_shaikh');
    const r = await raw(down, p + (p.includes('?') ? '&' : '?') + 'candidate_id=farhan_shaikh');
    const text = await r.text();
    assert.equal(r.status, 503, `${p} answered ${r.status}: ${text.slice(0, 100)}`);
    assert.ok(r.headers.get('retry-after'));
    assert.ok(!/D1_ERROR|simulated|SQL/i.test(text), `${p} leaked internal error text`);
  }
  assert.equal((await raw(down, '/api/version')).status, 200, 'version does not need the database');
});

test('every API answer names the commit that produced it', async () => {
  const { env } = fresh({ GIT_COMMIT: 'commit-a' });
  for (const p of ['/api/version', '/api/candidates', '/api/meta']) assert.equal((await raw(env, p)).headers.get('x-worker-commit'), 'commit-a');
});

test('read meter: once the public share is used, visitors get the last answer or a clear 503; the operator is not blocked', async () => {
  const { sqlite, env } = cached();
  await raw(env, '/api/candidates');
  sqlite.exec('UPDATE response_cache SET created_at = created_at - 7200');
  sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, rows_read) VALUES (?, ?)').run(new Date().toISOString().slice(0, 10), 2_500_000);
  const stale = await raw(env, '/api/candidates');
  assert.equal(stale.status, 200); assert.equal(stale.headers.get('x-cache'), 'STALE');
  const none = await raw(env, '/api/analytics?candidate_id=farhan_shaikh');
  assert.equal(none.status, 503); assert.ok(Number(none.headers.get('retry-after')) > 0);
  assert.equal((await none.json()).status, 'limited');
  assert.equal((await raw(env, '/api/analytics?candidate_id=farhan_shaikh', ADMIN_KEY)).status, 200, 'operator reads still work');
});

test('only D1 availability failures become 503; programming errors stay a generic 500', async () => {
  const { env } = fresh();
  const throwing = (msg) => ({ ...env, DB: { prepare() { const s = { bind: () => s, first: async () => { throw new Error(msg); }, all: async () => { throw new Error(msg); }, run: async () => { throw new Error(msg); } }; return s; } } });
  for (const msg of ["Cannot read properties of undefined (reading 'limit')", "D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'", 'D1_ERROR: too many SQL variables'])
    assert.equal((await raw(throwing(msg), '/api/candidates')).status, 500, msg);
  for (const msg of ['D1 DB is overloaded. Requests queued for too long.', 'D1_ERROR: Network connection lost.'])
    assert.equal((await raw(throwing(msg), '/api/candidates')).status, 503, msg);
});

test('read cache: the India Remote list is never served for another page, search or sort', async () => {
  const { env } = cached();
  const ids = async (q) => (await (await raw(env, '/api/india-remote/jobs?candidate_id=farhan_shaikh' + q)).json()).jobs?.map((j) => j.id);
  const first = await ids('&limit=1&offset=0');
  const second = await ids('&limit=1&offset=1');
  const again = await ids('&limit=1&offset=1');
  assert.deepEqual(second, again);
  if (first?.length && second?.length) assert.notDeepEqual(first, second, 'page 2 must not repeat page 1');
});

test('read cache: values outside the known sets are answered uncached, and core page loads stay cached after the write cap', async () => {
  const { sqlite, env } = cached();
  for (let i = 0; i < 15; i++) await raw(env, `/api/applications?candidate_id=farhan_shaikh&status=x${i}`);
  for (let i = 0; i < 5; i++) await raw(env, `/api/jobs?candidate_id=farhan_shaikh&search=a`);        // one character: not cacheable
  for (let i = 0; i < 5; i++) await raw(env, `/api/jobs?candidate_id=farhan_shaikh&offset=${1001 + i}`);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM response_cache').get().n, 0);
  await raw(env, '/api/applications?candidate_id=farhan_shaikh&status=APPLIED');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM response_cache').get().n, 1, 'a known status is cached');
  sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, cache_writes) VALUES (?, ?)').run(new Date().toISOString().slice(0, 10), 999999);
  await raw(env, '/api/analytics?candidate_id=farhan_shaikh');
  await raw(env, '/api/applications?candidate_id=farhan_shaikh&status=REJECTED');
  const keys = sqlite.prepare('SELECT key FROM response_cache').all().map((r) => r.key);
  assert.ok(keys.some((k) => k.includes('/api/analytics?candidate_id=farhan_shaikh')), 'a core page load is still cached');
  assert.ok(!keys.some((k) => k.includes('status=REJECTED')), 'an optional variant is not');
});

// ---- review of PR #26 ----------------------------------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
const entries = (sqlite) => sqlite.prepare('SELECT COUNT(*) n FROM response_cache').get().n;

test('read meter: uncacheable public reads (odd search, India Remote list) are budgeted too; the operator is not blocked', async () => {
  const { sqlite, env } = cached();
  sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, rows_read) VALUES (?, ?)').run(today(), 2_500_000);
  for (const u of ['/api/jobs?candidate_id=farhan_shaikh&search=%25%25', '/api/jobs?candidate_id=farhan_shaikh&search=a', '/api/jobs?candidate_id=farhan_shaikh&limit=500',
    '/api/india-remote/jobs?candidate_id=farhan_shaikh', '/api/india-remote/jobs?candidate_id=farhan_shaikh&search=zzz'])
    assert.equal((await raw(env, u)).status, 503, `${u} must stop at the budget`);
  assert.equal((await raw(env, '/api/jobs?candidate_id=farhan_shaikh&search=%25%25', ADMIN_KEY)).status, 200);
});

test('read meter: an uncacheable public read records its rows (once, not twice, through the India Remote hand-off)', async () => {
  const { sqlite, env } = cached();
  const wrapStmt = (st) => ({ bind: (...a) => wrapStmt(st.bind(...a)), first: async () => (await st.all()).results[0] ?? null,
    all: async () => ({ ...(await st.all()), meta: { rows_read: 6000 } }), run: (...a) => st.run(...a) });
  const db = { ...env.DB, prepare: (sql) => wrapStmt(env.DB.prepare(sql)), batch: (x) => env.DB.batch(x) };
  await raw({ ...env, DB: db }, '/api/jobs?candidate_id=farhan_shaikh&search=a');
  const one = sqlite.prepare('SELECT rows_read FROM read_meter WHERE day = ?').get(today())?.rows_read || 0;
  assert.ok(one >= 6000, `a one-character search must be metered, got ${one}`);
  sqlite.exec('DELETE FROM read_meter');
  await raw({ ...env, DB: db }, '/api/india-remote/jobs?candidate_id=farhan_shaikh');
  const viaHandoff = sqlite.prepare('SELECT rows_read FROM read_meter WHERE day = ?').get(today())?.rows_read || 0;
  assert.ok(viaHandoff > 0 && viaHandoff <= one * 1.2, `hand-off metered once: ${viaHandoff} vs ${one}`);
});

test('read cache: percent-encoded aliases of one path share one entry; the write cap applies to job pages; invalid ids are not cached', async () => {
  const { sqlite, env } = cached();
  for (const u of ['/api/jobs/j1', '/api/jobs/%6a1', '/api/jobs/%6A1', '/api/candidates/farhan%5Fshaikh/jobs', '/api/candidates/farhan_shaikh/jobs', '/api/candidates/FARHAN_SHAIKH/jobs'])
    await raw(env, u + (u.includes('/candidates/') ? '' : '?candidate_id=farhan_shaikh'));
  const keys = sqlite.prepare('SELECT key FROM response_cache').all().map((r) => r.key);
  assert.equal(keys.filter((k) => k.includes('/api/jobs/j1')).length, 1, JSON.stringify(keys));
  assert.equal(keys.filter((k) => k.includes('/candidates/farhan_shaikh/jobs')).length, 1, JSON.stringify(keys));
  assert.ok(!keys.some((k) => /%6|FARHAN/.test(k)));
  sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, cache_writes) VALUES (?, ?)').run(today(), 3000);
  const before = entries(sqlite);
  await raw(env, '/api/jobs/j2?candidate_id=farhan_shaikh'); await raw(env, '/api/jobs/j2/explanation?candidate_id=farhan_shaikh');
  assert.equal(entries(sqlite), before, 'job pages obey the daily write cap');
  await raw(env, '/api/sources');
  assert.ok(entries(sqlite) > before, 'a core page still caches after the cap');
});

test('read cache: common searches are cached (normalised), odd ones are not', async () => {
  const { sqlite, env } = cached();
  const a = await raw(env, '/api/jobs?candidate_id=farhan_shaikh&search=Role'); const b = await raw(env, '/api/jobs?candidate_id=farhan_shaikh&search=role');
  assert.equal(a.headers.get('x-cache'), 'MISS'); assert.equal(b.headers.get('x-cache'), 'HIT');
  assert.equal(await a.text(), await b.text());
  const n = entries(sqlite);
  for (const q of ['%25', 'a', '%20role', 'role%20', 'x'.repeat(31), '<script>']) await raw(env, `/api/jobs?candidate_id=farhan_shaikh&search=${q}`);
  assert.equal(entries(sqlite), n);
});

test('read cache: over budget, an old answer is never served across an operator change', async () => {
  const { sqlite, env } = cached();
  await raw(env, '/api/applications?candidate_id=farhan_shaikh');                       // warm
  await call(worker, env, 'POST', '/api/applications', { body: { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'SAVED' } });  // operator change
  sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, rows_read) VALUES (?, ?)').run(today(), 2_500_000);
  assert.equal((await raw(env, '/api/applications?candidate_id=farhan_shaikh')).status, 503, 'the pre-change entry must not be served as STALE');
});

test('read cache: if the cache cannot be invalidated the operator change is refused, not applied', async () => {
  const { sqlite, env } = cached();
  const failUpdate = (sql) => /UPDATE cache_state/.test(sql);
  const db = { ...env.DB, prepare: (sql) => { if (failUpdate(sql)) throw new Error('D1_ERROR: internal error in D1'); return env.DB.prepare(sql); }, batch: (x) => env.DB.batch(x) };
  const before = sqlite.prepare('SELECT COUNT(*) n FROM applications').get().n;
  const res = await call(worker, { ...env, DB: db }, 'POST', '/api/applications', { body: { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'SAVED' } });
  assert.ok(res.status >= 500, `got ${res.status}`);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM applications').get().n, before);
});

test('read cache: the cached path leaks nothing private (every public route, twice, second from the cache)', async () => {
  const { env } = cached();
  const forbidden = ['PRIVATE-NOTE-7f3', 'PRIVATE-CHANNEL-7f3', 'PRIVATE-RESUME-7f3', 'PRIVATE-COVER-7f3', 'PRIVATE-REJECT-7f3', 'PRIVATE-ACTOR-7f3', 'PRIVATECITY-7f3',
    'PRIVATE-STAGE-7f3', 'PRIVATE-CATEGORY-7f3', 'PRIVATE-RUNERR-7f3', 'internal.example', 'seed decision', 'RRVUNL', 'Mianro', 'cash_floor', 'pay_line', 'employment_history'];
  const urls = PUBLIC_READ.flatMap((base) => ['farhan_shaikh', 'sana_ansari'].map((cid) => {
    const p = base.replace('/jobs/x', '/jobs/j1').replace('/candidates/x', '/candidates/' + cid); return p + (p.includes('?') ? '&' : '?') + 'candidate_id=' + cid; }));
  for (const u of urls) await raw(env, u, ADMIN_KEY);                       // warm the OPERATOR entries first
  const hits = [];
  for (const pass of [1, 2]) for (const u of urls) {
    const r = await raw(env, u); const t = await r.text();
    for (const f of forbidden) if (t.includes(f)) hits.push(`pass ${pass} ${u} (${r.headers.get('x-cache')}) contains ${f}`);
  }
  assert.deepEqual(hits, []);
});

test('read meter: a miss records the rows D1 reports for it', async () => {
  const { sqlite, env } = cached();
  // Stand-in for D1's meta: every read reports 6,000 rows, so the meter flushes at once.
  const wrapStmt = (st) => ({ bind: (...a) => wrapStmt(st.bind(...a)), first: async () => (await st.all()).results[0] ?? null,
    all: async () => ({ ...(await st.all()), meta: { rows_read: 6000 } }), run: (...a) => st.run(...a) });
  const db = { ...env.DB, prepare: (sql) => wrapStmt(env.DB.prepare(sql)), batch: (x) => env.DB.batch(x) };
  await raw({ ...env, DB: db }, '/api/candidates');
  const m = sqlite.prepare('SELECT rows_read, public_misses FROM read_meter WHERE day = ?').get(new Date().toISOString().slice(0, 10));
  assert.ok(m && m.rows_read >= 6000, `meter recorded ${JSON.stringify(m)}`);
  assert.ok(m.public_misses >= 1);
});

// ---- re-review of the fixes ---------------------------------------------------------------------------------------
test('limiter: repeating the identical wrong key writes nothing, so it cannot spend the free write allowance', async () => {
  const { sqlite, env } = cached();
  const hit = () => worker.fetch(new Request('https://test.invalid/api/applications?candidate_id=farhan_shaikh', { headers: { Authorization: 'Bearer same-wrong-key', 'CF-Connecting-IP': '203.0.113.9' } }), env, { waitUntil() {} });
  assert.equal((await hit()).status, 403);
  sqlite.exec('UPDATE auth_failures SET updated_at = 1');                    // marker: any further write would change it
  for (let i = 0; i < 20; i++) assert.equal((await hit()).status, 403);
  assert.equal(sqlite.prepare('SELECT updated_at, failures FROM auth_failures').get().updated_at, 1, 'the row was rewritten by a repeated identical key');
  assert.equal(sqlite.prepare('SELECT failures FROM auth_failures').get().failures, 1);
  const other = await worker.fetch(new Request('https://test.invalid/api/applications?candidate_id=farhan_shaikh', { headers: { Authorization: 'Bearer another-wrong-key', 'CF-Connecting-IP': '203.0.113.9' } }), env, { waitUntil() {} });
  assert.equal(other.status, 403);
  assert.equal(sqlite.prepare('SELECT failures FROM auth_failures').get().failures, 2, 'a different wrong key still counts');
});

test('read meter: with the budget used up, every public read route that is not warm answers 503; the cache switch does not disable the budget', async () => {
  for (const extra of [{}, { RESPONSE_CACHE: 'off' }]) {
    const { sqlite, env } = cached(extra);
    sqlite.prepare('INSERT OR REPLACE INTO read_meter(day, rows_read) VALUES (?, ?)').run(today(), 2_500_000);
    const urls = PUBLIC_READ.flatMap((base) => ['farhan_shaikh', 'sana_ansari'].map((cid) => {
      const p = base.replace('/jobs/x', '/jobs/j1').replace('/candidates/x', '/candidates/' + cid); return p + (p.includes('?') ? '&' : '?') + 'candidate_id=' + cid; }));
    for (const u of urls) assert.equal((await raw(env, u)).status, 503, `${u} (${JSON.stringify(extra)})`);
  }
});

test('read cache: one transient failure to invalidate is retried and the operator change goes through', async () => {
  const { sqlite, env } = cached();
  let failed = false;
  const db = { ...env.DB, prepare: (sql) => {
    const st = env.DB.prepare(sql);
    if (/UPDATE cache_state/.test(sql) && !failed) return { run: async () => { failed = true; throw new Error('D1_ERROR: internal error in D1'); } };
    return st; }, batch: (x) => env.DB.batch(x) };
  const res = await call(worker, { ...env, DB: db }, 'POST', '/api/applications', { body: { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'SAVED' } });
  assert.equal(res.status, 200); assert.ok(failed);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM applications WHERE job_id = 'j4'").get().n, 1);
});

test('search normalisation is lossless: Role and role return the same jobs when nothing is cached', async () => {
  const { env } = cached({ RESPONSE_CACHE: 'off' });
  const ids = async (q) => (await (await raw(env, `/api/jobs?candidate_id=farhan_shaikh&search=${q}`)).json()).jobs.map((j) => j.id).join();
  assert.equal(await ids('Role'), await ids('role')); assert.ok((await ids('role')).length > 0);
});

test("Sana's profile keeps remote-preferred and her Middle East / Europe relocation options; the airport wording is a preference to verify", async () => {
  const { env } = fresh();
  const op = (await call(worker, env, 'GET', '/api/profile?candidate_id=sana_ansari')).json;
  const prefs = op.location_preferences.join(' | ');
  assert.match(prefs, /Remote \(preferred\)/); assert.match(prefs, /Middle East/); assert.match(prefs, /Europe/);
  assert.match(prefs, /commercial airport is within about 2 hours/); assert.match(prefs, /not established by the city name/);
  assert.ok(!/Bengaluru|Hyderabad|Chennai/.test(prefs), 'no fixed city list');
  assert.equal(op.relocation_interest, true);
});

test('outage backup: the last good PUBLIC answer is kept outside D1 and served while D1 refuses reads; never health, operator or errors', async () => {
  const store = new Map();
  globalThis.caches = { default: { async put(req, res) { store.set(req.url, await res.text()); }, async match(req) { return store.has(req.url) ? new Response(store.get(req.url), { headers: { 'Content-Type': 'application/json' } }) : undefined; } } };
  try {
    const pending = [];
    const get = (env, p, key) => worker.fetch(new Request('https://test.invalid' + p, { headers: key ? { Authorization: `Bearer ${key}` } : {} }), env, { waitUntil: (x) => pending.push(x) });
    const { env } = fresh({ GIT_COMMIT: 'commit-a' });
    const msg = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit (simulated)";
    const failing = { prepare() { const s = { bind: () => s, first: async () => { throw new Error(msg); }, all: async () => { throw new Error(msg); }, run: async () => { throw new Error(msg); } }; return s; }, async batch() { throw new Error(msg); } };
    const down = { ...env, DB: failing };
    // nothing stored yet: the same controlled 503 as before
    assert.equal((await get(down, '/api/candidates')).status, 503);
    // a good public read stores a copy
    const good = await get(env, '/api/candidates'); assert.equal(good.status, 200);
    const goodBody = await good.text(); await Promise.all(pending);
    assert.ok([...store.keys()].some((k) => k.endsWith('/api/candidates')), 'stored outside D1');
    assert.ok(![...store.keys()].some((k) => /health|version/.test(k)), 'health and version are never stored');
    // D1 now refuses reads: the stored copy is served, marked, as a 200
    const stale = await get(down, '/api/candidates');
    assert.equal(stale.status, 200); assert.equal(stale.headers.get('x-cache'), 'STALE-OUTAGE'); assert.equal(await stale.text(), goodBody);
    // a URL that was never stored still gets the honest 503; health tells the truth
    assert.equal((await get(down, '/api/analytics?candidate_id=farhan_shaikh')).status, 503);
    assert.equal((await get(down, '/api/health')).status, 503);
    // an operator answer is never stored or served from the backup
    store.clear(); pending.length = 0;
    await get(env, '/api/candidates', ADMIN_KEY); await Promise.all(pending);
    assert.equal(store.size, 0, 'operator reads are not backed up');
    assert.equal((await get(down, '/api/candidates', ADMIN_KEY)).status, 503);
  } finally { delete globalThis.caches; }
});

test('resume import is honest: no invented profile for any pasted text', async () => {
  const { env } = fresh();
  const r = await worker.fetch(new Request('https://test.invalid/api/profile/import-resume', { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Jane Doe, welder, 20 years, Rust' }) }), env, { waitUntil() {} });
  assert.equal(r.status, 501);
  const body = await r.json();
  assert.equal(body.status, 'not_implemented'); assert.ok(!body.parsed, 'no parsed profile'); assert.ok(!/Farhan|Python|TypeScript/i.test(JSON.stringify(body)));
});

test('QA: junk paging parameters never cause a 500 on the job lists', async () => {
  const { env } = fresh();
  for (const q of ['limit=-5&offset=abc', 'limit=abc', 'limit=0&offset=-9', 'offset=NaN', 'limit=1e9']) {
    for (const p of ['/api/jobs?candidate_id=farhan_shaikh&', '/api/candidates/farhan_shaikh/jobs?']) {
      const res = await call(worker, env, 'GET', p + q, { key: null });
      assert.ok(res.status < 500, `${p}${q} -> ${res.status}`);
    }
  }
});

test('QA: a visitor never gets the full built-in degree line (college, year), even when the stored education is empty; the operator still does', async () => {
  const { sqlite, env } = fresh();
  sqlite.exec(`UPDATE candidates SET education = NULL`);
  for (const id of ['farhan_shaikh', 'sana_ansari']) {
    const pub = await call(worker, env, 'GET', `/api/profile?candidate_id=${id}`, { key: null });
    assert.equal(pub.status, 200);
    const t = JSON.stringify(pub.json);
    assert.ok(!/NM College|Rajasthan Technical|University of Mumbai/.test(t) && !/\b20\d\d\b/.test(`${pub.json.education} ${pub.json.education_short}`), `${id}: public profile leaks the degree line: ${pub.json.education}`);
    assert.ok(pub.json.education && pub.json.education === pub.json.education_short, `${id}: falls back to the short label`);
    const op = await call(worker, env, 'GET', `/api/profile?candidate_id=${id}`, { key: ADMIN_KEY });
    assert.ok(/College|University/.test(op.json.education), `${id}: the operator view keeps the full line`);
  }
});

// QA 2026-11-09 (segment 8): behaviour while D1 itself refuses queries (daily quota, outage).
const downEnv = (msg) => { const { sqlite, d1 } = createDb(); seed(sqlite); const boom = () => { throw new Error(msg); }; return makeEnv({ ...d1, prepare: boom, batch: boom, exec: boom }); };
const DB_DOWN = "D1_ERROR: Exceeded the number of rows read allowed on the free tier";
const verify = (env, key, ip) => worker.fetch(new Request('https://test.invalid/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ key }) }), env, { waitUntil() {} });

test('QA: with D1 down the login limiter still limits guessing (per isolate), the right key still works from another address, and X-Forwarded-For is ignored', async () => {
  const env = downEnv(DB_DOWN), ip = '203.0.113.201';
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await verify(env, `wrong-${i}`, ip)).status);
  assert.deepEqual(codes, [403, 403, 403, 403, 403, 403, 403, 403, 429, 429], 'eight wrong keys, then locked out, although D1 is unavailable');
  assert.equal((await verify(env, ADMIN_KEY, ip)).status, 429, 'locked address: even the right key waits');
  assert.equal((await verify(env, ADMIN_KEY, '203.0.113.202')).status, 200, 'another address is not affected, and the operator can still sign in during the outage');
  const spoof = await worker.fetch(new Request('https://test.invalid/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, 'X-Forwarded-For': '198.51.100.9' }, body: JSON.stringify({ key: 'wrong-new' }) }), env, { waitUntil() {} });
  assert.equal(spoof.status, 429, 'a spoofed X-Forwarded-For does not give a fresh bucket');
});
test('QA: repeating the identical wrong key is not a new guess when D1 is down (same rule as the table)', async () => {
  const env = downEnv(DB_DOWN), ip = '203.0.113.211';
  for (let i = 0; i < 12; i++) assert.equal((await verify(env, 'same-wrong-key', ip)).status, 403);
});
test('QA: the cron skips a tick quietly while D1 is unavailable, but still fails loudly on any other error', async () => {
  const quiet = console.warn; const seen = []; console.warn = (...a) => seen.push(a.join(' '));
  try {
    await worker.scheduled({ cron: '*/2 * * * *', scheduledTime: Date.now() }, downEnv(DB_DOWN), { waitUntil() {} });
    assert.ok(seen.some((l) => /DB_UNAVAILABLE/.test(l)), 'the outage is logged once');
  } finally { console.warn = quiet; }
  await assert.rejects(() => worker.scheduled({ cron: '*/2 * * * *', scheduledTime: Date.now() }, downEnv('a programming error'), { waitUntil() {} }), /programming error/);
});

// QA 2026-11-09 (segment 9): removing a client on request.
test('QA: DELETE /api/clients/:id erases the client and everything tied to them, and nothing else', async () => {
  const { sqlite, env } = fresh();
  const mk = async (name) => (await call(worker, env, 'POST', '/api/clients', { body: { full_name: name, role_keywords: ['analyst'], location_mode: 'REMOTE_FROM_HOME', home_country: 'India', visibility: 'private',
    search_profile: { role_keywords: ['analyst'], avoid_keywords: [], location_mode: 'REMOTE_FROM_HOME', home_country: 'India' } } })).json.client.id;
  const a = await mk('Client Alpha'), b = await mk('Client Beta');
  for (const id of [a, b]) {
    assert.equal((await call(worker, env, 'POST', `/api/clients/${id}/backfill`)).status, 200);
    sqlite.prepare(`INSERT INTO client_requests(id, full_name, email, phone, target_roles, plan, status, candidate_id) VALUES (?,?,?,?,?,?,?,?)`).run('req-' + id, 'N ' + id, id + '@example.com', '999', 'Analyst', 'starter', 'CONVERTED', id);
    sqlite.prepare(`INSERT OR REPLACE INTO response_cache(key, body, created_at, generation) VALUES (?, '{}', 1, 0)`).run(`https://x/api/jobs?candidate_id=${id}`);
  }
  const link = (await call(worker, env, 'POST', `/api/clients/${a}/share-links`, { body: {} })).json;
  sqlite.prepare(`INSERT INTO applications(id, candidate_id, job_id, status) SELECT 'app-a', ?, job_id, 'APPLIED' FROM candidate_qualifications WHERE candidate_id = ? LIMIT 1`).run(a, a);
  const tables = sqlite.prepare("SELECT m.name t FROM sqlite_master m WHERE m.type='table' AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name='candidate_id')").all().map((r) => r.t);
  const count = (t, id) => sqlite.prepare(`SELECT COUNT(*) n FROM ${t} WHERE candidate_id = ?`).get(id).n;
  const betaBefore = Object.fromEntries(tables.map((t) => [t, count(t, b)]));
  const builtinBefore = Object.fromEntries(tables.map((t) => [t, count(t, 'farhan_shaikh')]));
  assert.equal((await call(worker, env, 'DELETE', `/api/clients/${a}`, { key: null })).status, 401, 'operator only');
  assert.equal((await call(worker, env, 'DELETE', '/api/clients/farhan_shaikh')).status, 400, 'a built-in candidate cannot be deleted');
  assert.equal((await call(worker, env, 'DELETE', '/api/clients/nobody_here')).status, 400, 'unknown client');
  const del = await call(worker, env, 'DELETE', `/api/clients/${a}`);
  assert.equal(del.status, 200); assert.equal(del.json.deleted, true); assert.ok(del.json.rows_removed.candidate_qualifications > 0 && del.json.rows_removed.applications === 1 && del.json.rows_removed.client_requests === 1, JSON.stringify(del.json));
  for (const t of tables) assert.equal(count(t, a), 0, `${t} still holds rows for the deleted client`);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM candidates WHERE id = ?').get(a).n, 0);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM response_cache WHERE key LIKE ?`).get('%' + a + '%').n, 0, 'cached answers about the client are gone');
  for (const t of tables) { assert.equal(count(t, b), betaBefore[t], `${t}: another client is untouched`); assert.equal(count(t, 'farhan_shaikh'), builtinBefore[t], `${t}: built-ins untouched`); }
  const gone = await worker.fetch(new Request(`https://test.invalid/api/jobs?candidate_id=${a}`, { headers: { 'X-View-Token': link.token } }), env, { waitUntil() {} });
  assert.equal(gone.status, 400, 'its share link no longer works');
  assert.equal((await call(worker, env, 'DELETE', `/api/clients/${a}`)).status, 400, 'a second delete is a clean "unknown client", not an error');
});
