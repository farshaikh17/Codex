// Outage recovery, modelled locally (a SQLite stand-in for D1, a fake Cache API): the free tier's daily limit makes D1 refuse queries until 00:00 UTC. What does a visitor see while it
// is down, and does everything come back by itself afterwards? This is a model of behaviour, not a measurement of Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, ADMIN_KEY } from './harness.mjs';
import { seed } from './fixtures.mjs';

const worker = await loadWorker();
const LIMIT = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
function flaky() {
  const { sqlite, d1 } = createDb(); seed(sqlite);
  let down = false; const boom = () => { throw new Error(LIMIT); };
  const env = makeEnv({ prepare: (s) => (down ? boom() : d1.prepare(s)), batch: (s) => (down ? boom() : d1.batch(s)), exec: (s) => (down ? boom() : d1.exec(s)) });
  return { sqlite, env, setDown: (v) => { down = v; } };
}
const HOST = 'https://outage-recovery-check.invalid';   // own host: the Worker remembers recently stored URLs per instance
const pending = []; const ctx = { waitUntil: (p) => pending.push(p) };
const get = async (env, path, headers = {}) => { const res = await worker.fetch(new Request(HOST + path, { headers }), env, ctx); const text = await res.text(); await Promise.all(pending.splice(0)); return { status: res.status, xcache: res.headers.get('x-cache'), retry: res.headers.get('retry-after'), text }; };
const verify = (env, key, ip) => worker.fetch(new Request(HOST + '/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ key }) }), env, ctx);

test('visitors: a clear 503 with Retry-After while D1 refuses; the same URLs are live again the moment it recovers (no stale copy lingers)', async () => {
  const store = new Map();
  globalThis.caches = { default: { async put(req, res) { store.set(req.url, await res.text()); }, async match(req) { return store.has(req.url) ? new Response(store.get(req.url), { headers: { 'Content-Type': 'application/json' } }) : undefined; } } };
  try {
    const { env, setDown, sqlite } = flaky();
    const before = await get(env, '/api/dashboard/overview'); assert.equal(before.status, 200); assert.notEqual(before.xcache, 'STALE-OUTAGE');
    setDown(true);
    const during = await get(env, '/api/dashboard/overview');                       // a copy was kept: served as STALE-OUTAGE (only where the Cache API works)
    assert.equal(during.status, 200); assert.equal(during.xcache, 'STALE-OUTAGE');
    const uncopied = await get(env, '/api/jobs?candidate_id=farhan_shaikh&limit=3');     // never requested while healthy: nothing to serve, so an honest 503
    assert.equal(uncopied.status, 503); assert.equal(uncopied.retry, '300'); assert.match(uncopied.text, /temporarily unavailable/i);
    assert.equal((await get(env, '/api/health')).status, 503, 'health says so too');
    assert.equal((await get(env, '/api/version')).status, 200, 'version needs no database');
    sqlite.exec(`UPDATE jobs SET title = 'Changed after the outage began' WHERE id = (SELECT id FROM jobs ORDER BY id LIMIT 1)`);
    setDown(false);
    const after = await get(env, '/api/health'); assert.equal(after.status, 200, 'healthy again immediately');
    const live = await get(env, '/api/dashboard/overview'); assert.equal(live.status, 200); assert.notEqual(live.xcache, 'STALE-OUTAGE', 'live data, not the outage copy');
    const jobs = await get(env, '/api/jobs?candidate_id=farhan_shaikh&limit=3'); assert.equal(jobs.status, 200);
  } finally { delete globalThis.caches; }
});

test('login limiter: guessing stays limited during the outage, the right key still works, and the limiter resumes from the table afterwards', async () => {
  const { env, setDown } = flaky(); const ip = '198.51.100.71';
  setDown(true);
  const codes = []; for (let i = 0; i < 10; i++) codes.push((await verify(env, `wrong-${i}`, ip)).status);
  assert.deepEqual(codes, [403, 403, 403, 403, 403, 403, 403, 403, 429, 429]);
  assert.equal((await verify(env, ADMIN_KEY, '198.51.100.72')).status, 200, 'the operator can still sign in during the outage');
  setDown(false);
  assert.equal((await verify(env, ADMIN_KEY, ip)).status, 200, 'after recovery the table is authoritative again: the address that hit the in-memory limit is not stuck');
  const again = []; for (let i = 0; i < 9; i++) again.push((await verify(env, `wrong-after-${i}`, '198.51.100.73')).status);
  assert.deepEqual(again, [403, 403, 403, 403, 403, 403, 403, 403, 429], 'the shared table limits again after recovery');
});

test('cron: skips quietly while D1 refuses and works again on the next tick, with no state left behind', async () => {
  const { env, setDown, sqlite } = flaky();
  const warns = []; const realWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    setDown(true);
    await worker.scheduled({ cron: '*/2 * * * *', scheduledTime: Date.now() }, env, ctx);
    await worker.scheduled({ cron: '*/2 * * * *', scheduledTime: Date.now() + 120000 }, env, ctx);
    assert.equal(warns.filter((w) => /DB_UNAVAILABLE/.test(w)).length, 2, 'each skipped tick is logged once');
    setDown(false);
    await worker.scheduled({ cron: '*/2 * * * *', scheduledTime: Date.now() + 240000 }, env, ctx);   // must not throw
    const lease = sqlite.prepare('SELECT lease_until u FROM cloud_automation WHERE id = 1').get();
    assert.ok(!lease || Number(lease.u) <= Math.floor(Date.now() / 1000) + 5, 'no lease is left held by a tick that was skipped');
  } finally { console.warn = realWarn; }
});

test('the outage copy is keyed by the commit too: after a release the old Worker\'s answer is never served to the new page; the same commit is served', async () => {
  const store = new Map();
  globalThis.caches = { default: { async put(req, res) { store.set(req.url, await res.text()); }, async match(req) { return store.has(req.url) ? new Response(store.get(req.url), { headers: { 'Content-Type': 'application/json' } }) : undefined; } } };
  try {
    const { env, setDown } = flaky();
    const oldEnv = { ...env, GIT_COMMIT: 'aaaaaaa' }, newEnv = { ...env, GIT_COMMIT: 'bbbbbbb' };
    const path = '/api/dashboard/overview?r10=1';
    assert.equal((await get(oldEnv, path)).status, 200);   // the old release answers and keeps a copy
    assert.ok([...store.keys()].some((k) => k.includes('aaaaaaa')), 'the stored key names the commit');
    assert.ok([...store.keys()].every((k) => k.includes('__backup=')), 'no copy keyed by URL alone');
    setDown(true);
    const afterRelease = await get(newEnv, path);
    assert.equal(afterRelease.status, 503, 'the new release does not serve the old release\'s copy');
    assert.notEqual(afterRelease.xcache, 'STALE-OUTAGE');
    const sameRelease = await get(oldEnv, path);
    assert.equal(sameRelease.status, 200); assert.equal(sameRelease.xcache, 'STALE-OUTAGE', 'the release that stored it still serves it');
  } finally { delete globalThis.caches; }
});

test('feed readiness reports a failure even when the metadata lookup succeeds', async () => {
  const { sqlite, d1 } = createDb();
  seed(sqlite);
  const env = makeEnv({
    prepare(sql) {
      if (sql.includes('candidate_qualifications')) throw new Error(LIMIT);
      return d1.prepare(sql);
    },
    batch: (statements) => d1.batch(statements),
  });
  assert.equal((await get(env, '/api/health')).status, 200);
  assert.equal((await get(env, '/api/health?feeds=1')).status, 503);
  assert.equal((await get(makeEnv(d1), '/api/health?feeds=1')).status, 200);
});
