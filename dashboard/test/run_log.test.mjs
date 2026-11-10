import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { seed } from './fixtures.mjs';
import { buildRunRecord, runLogSql } from '../scripts/run_log.mjs';

test('run record keeps counts only and tolerates missing reports', () => {
  const rec = buildRunRecord({
    apply: { new_jobs: 12, rescored: 2175, closed: 21, reopened: 2, capped: 200, skipped_ineligible: 480, by_status: { x: 1 }, global_hirers: 374 },
    sources: { workday: { read: 868, kept: 276, full_text: 150 }, smartrecruiters: { error: 'boom', read: 0, kept: 0 }, junk: 5 },
    boards: { remoteok: { read: 99, kept: 0 } },
    liveness: { alive: 94, dead: 1, unknown: 5 },
  }, { kind: 'discovery', event: 'schedule' });
  assert.deepEqual(Object.keys(rec).sort(), ['alive', 'capped', 'closed', 'dead', 'event', 'kind', 'new_jobs', 'reopened', 'rescored', 'skipped_ineligible', 'sources', 'unknown']);
  assert.equal(rec.new_jobs, 12); assert.equal(rec.rescored, 2175);
  assert.deepEqual(rec.sources.workday, { read: 868, kept: 276, full_text: 150 });
  assert.equal(rec.sources.smartrecruiters.error, true); assert.equal(rec.sources.remoteok.read, 99); assert.ok(!('junk' in rec.sources));
  const empty = buildRunRecord({}, {});
  assert.equal(empty.new_jobs, 0); assert.deepEqual(empty.sources, {});
});

test('run log SQL is one idempotent, quote-safe statement keyed by the run time', () => {
  const sql = runLogSql({ kind: "d'x", new_jobs: 1 }, new Date('2026-11-10T19:52:30.123Z'));
  assert.match(sql, /^INSERT OR REPLACE INTO discovery_state\(key, value, updated_at\) VALUES \('run:2026-11-10T19:52:30Z', /);
  assert.ok(sql.includes("d''x"));
  assert.equal(sql.trim().split('\n').length, 1);
});

test('GET /api/discovery/daily is public, sums runs per UTC day and returns counts only', async () => {
  const { sqlite, d1 } = createDb(); seed(sqlite);
  const worker = await loadWorker();
  const env = makeEnv(d1);
  const put = sqlite.prepare("INSERT INTO discovery_state(key, value) VALUES (?, ?)");
  put.run('run:2026-11-10T17:30:00Z', JSON.stringify({ new_jobs: 0, rescored: 2000, closed: 21, sources: { workday: { read: 800, kept: 270, full_text: 100 } } }));
  put.run('run:2026-11-10T19:50:00Z', JSON.stringify({ new_jobs: 5, rescored: 175, closed: 1, alive: 90, dead: 2, sources: { workday: { read: 68, kept: 6, full_text: 6 } } }));
  put.run('run:2026-11-09T23:46:00Z', JSON.stringify({ new_jobs: 700, rescored: 0, sources: {} }));
  put.run('snapshot:2026-11-10', JSON.stringify({ secret: 'not a run' }));
  put.run('run:garbage', 'not json');
  const res = await call(worker, env, 'GET', '/api/discovery/daily', { key: null });
  assert.equal(res.status, 200);
  const days = res.json.days;
  assert.deepEqual(days.map((d) => d.day), ['2026-11-10', '2026-11-09']);
  assert.equal(days[0].runs, 2); assert.equal(days[0].new_jobs, 5); assert.equal(days[0].rescored, 2175); assert.equal(days[0].closed, 22);
  assert.deepEqual(days[0].sources.workday, { read: 868, kept: 276, full_text: 106 });
  assert.equal(days[1].new_jobs, 700);
  assert.ok(!JSON.stringify(res.json).includes('secret'), 'only run: rows are read');
});

test('GET /api/discovery/daily answers with no days when the table is missing', async () => {
  const { sqlite, d1 } = createDb(); seed(sqlite);
  sqlite.exec('DROP TABLE IF EXISTS discovery_state');
  const worker = await loadWorker();
  const res = await call(worker, makeEnv(d1), 'GET', '/api/discovery/daily', { key: null });
  assert.equal(res.status, 200); assert.deepEqual(res.json.days, []);
});
