import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { seed } from './fixtures.mjs';
import { buildRunRecord, runLogSql, skippedRecord, shortlistRecord } from '../scripts/run_log.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

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

test('a run the budget guard skipped is one small row {skipped: "budget"}, and the CLI writes it without any report files', () => {
  assert.deepEqual(skippedRecord('budget', { kind: 'discovery', event: 'schedule' }), { kind: 'discovery', event: 'schedule', skipped: 'budget' });
  const sql = execFileSync(process.execPath, ['scripts/run_log.mjs', '--skipped', 'budget', '--kind', 'discovery', '--event', 'schedule', '--work', '/nonexistent'], { cwd: path.join(here, '..'), encoding: 'utf8' });
  assert.match(sql, /^INSERT OR REPLACE INTO discovery_state\(key, value, updated_at\) VALUES \('run:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', '\{"kind":"discovery","event":"schedule","skipped":"budget"\}'/);
});

test('GET /api/discovery/daily: a skipped run is counted apart and never becomes "last run"; last_run_at is the newest daily run that did its work', async () => {
  const { sqlite, d1 } = createDb(); seed(sqlite);
  const worker = await loadWorker();
  const put = sqlite.prepare("INSERT INTO discovery_state(key, value) VALUES (?, ?)");
  put.run('run:2026-11-12T21:47:00Z', JSON.stringify({ kind: 'discovery', new_jobs: 40, sources: {} }));
  put.run('run:2026-11-13T09:07:00Z', JSON.stringify({ kind: 'watchlist', new_jobs: 3, sources: {} }));
  put.run('run:2026-11-13T15:13:00Z', JSON.stringify({ kind: 'discovery', event: 'schedule', skipped: 'budget' }));
  const res = await call(worker, makeEnv(d1), 'GET', '/api/discovery/daily', { key: null });
  assert.equal(res.status, 200);
  assert.equal(res.json.last_run_at, '2026-11-12T21:47:00Z', 'the watchlist and the skipped run are not the daily update');
  assert.equal(res.json.last_skipped_at, '2026-11-13T15:13:00Z');
  const d13 = res.json.days.find((d) => d.day === '2026-11-13');
  assert.equal(d13.runs, 1); assert.equal(d13.skipped, 1); assert.equal(d13.new_jobs, 3);
});

test('A7: the shortlist report is stored in the run row as counts, rule names and flags only, and /api/discovery/daily returns the latest', async () => {
  const report = { sana_ansari: { pool: 300, pool_sources: { workday: 120, "x'y": 3 }, READY: { count: 25, employers: 21, max_employer_share: 0.08, reposters: 0, older_than_30_days: 2, swaps: 3, relaxed: ['band_remote_min_2'],
    pool_smaller_than_tier: false, families: { maintenance: 10, electrical: 3 }, bands: { india_onsite: 20, remote: 1 }, band_shortfall: { remote: 1 }, sources: { workday: 9, ats_dataset: 16 }, title: 'Secret Job Title' },
    STRETCH_READY: { count: 25, different: 2, relaxed: ["x'); DROP TABLE jobs;--"] } } };
  const rec = shortlistRecord(report);
  assert.deepEqual(rec.sana_ansari.READY, { count: 25, employers: 21, max_employer_share: 0.08, reposters: 0, older_than_30_days: 2, swaps: 3, different: 0,
    families: { maintenance: 10, electrical: 3 }, bands: { india_onsite: 20, remote: 1 }, band_shortfall: { remote: 1 }, sources: { workday: 9, ats_dataset: 16 }, relaxed: ['band_remote_min_2'], pool_smaller_than_tier: false });
  assert.deepEqual(rec.sana_ansari.pool_sources, { workday: 120, xy: 3 }, 'plan D1: pool rows per source, keys sanitised');
  assert.deepEqual(rec.sana_ansari.STRETCH_READY.sources, {});
  assert.deepEqual(rec.sana_ansari.STRETCH_READY.relaxed, ['xDROPTABLEjobs']);
  assert.ok(!JSON.stringify(rec).includes('Secret'), 'no job text');
  assert.equal(shortlistRecord(null), null);
  const full = buildRunRecord({ shortlist: report }, { kind: 'discovery' });
  assert.equal(full.shortlist.sana_ansari.READY.count, 25);
  assert.ok(!('shortlist' in buildRunRecord({}, {})), 'no report, no field');
  const { sqlite, d1 } = createDb(); seed(sqlite);
  const worker = await loadWorker();
  const put = sqlite.prepare("INSERT INTO discovery_state(key, value) VALUES (?, ?)");
  put.run('run:2026-11-12T21:47:00Z', JSON.stringify({ kind: 'discovery', new_jobs: 1, sources: {}, shortlist: { old: { pool: 1 } } }));
  put.run('run:2026-11-13T21:47:00Z', JSON.stringify({ kind: 'discovery', new_jobs: 1, sources: {}, shortlist: rec }));
  put.run('run:2026-11-13T23:07:00Z', JSON.stringify({ kind: 'watchlist', new_jobs: 3, sources: {} }));
  const res = await call(worker, makeEnv(d1), 'GET', '/api/discovery/daily', { key: null });
  assert.equal(res.status, 200);
  assert.equal(res.json.shortlist.at, '2026-11-13T21:47:00Z');
  assert.equal(res.json.shortlist.report.sana_ansari.READY.families.maintenance, 10);
  const none = await call(worker, makeEnv(createDb().d1), 'GET', '/api/discovery/daily', { key: null });
  assert.equal(none.json.shortlist, null);
});

test('GET /api/discovery/daily: no run recorded gives last_run_at null', async () => {
  const { sqlite, d1 } = createDb(); seed(sqlite);
  const worker = await loadWorker();
  const res = await call(worker, makeEnv(d1), 'GET', '/api/discovery/daily', { key: null });
  assert.equal(res.json.last_run_at, null);
});

test('discovery.yml: early-day triggers, a 20-hour gap, and the budget-skip row job', () => {
  const wf = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'discovery.yml'), 'utf8');
  assert.match(wf, /cron: '13 1,3 \* \* \*'/);
  assert.match(wf, /MIN_GAP_HOURS: '20'/);
  assert.match(wf, /budget_skip: \$\{\{ steps\.g\.outputs\.skip == 'true' && steps\.r\.outputs\.skip != 'true' \}\}/);
  assert.match(wf, /if: \$\{\{ needs\.guard\.outputs\.budget_skip == 'true' \}\}[\s\S]*run_log\.mjs --skipped budget/);
});

test('tenth-man fix: a run whose job had already failed is recorded with failed: true and never becomes last_run_at', async () => {
  const sql = execFileSync(process.execPath, ['scripts/run_log.mjs', '--work', '/nonexistent', '--kind', 'discovery', '--event', 'schedule', '--status', 'failure'], { cwd: path.join(here, '..'), encoding: 'utf8' });
  assert.match(sql, /"failed":true/);
  assert.doesNotMatch(execFileSync(process.execPath, ['scripts/run_log.mjs', '--work', '/nonexistent', '--status', 'success'], { cwd: path.join(here, '..'), encoding: 'utf8' }), /failed/);
  const { sqlite, d1 } = createDb(); seed(sqlite);
  const worker = await loadWorker();
  const put = sqlite.prepare("INSERT INTO discovery_state(key, value) VALUES (?, ?)");
  put.run('run:2026-11-12T15:20:00Z', JSON.stringify({ kind: 'discovery', new_jobs: 40, sources: {} }));
  put.run('run:2026-11-13T15:20:00Z', JSON.stringify({ kind: 'discovery', new_jobs: 0, failed: true, sources: {} }));
  const res = await call(worker, makeEnv(d1), 'GET', '/api/discovery/daily', { key: null });
  assert.equal(res.json.last_run_at, '2026-11-12T15:20:00Z');
});

test('plan H1: the run row carries the D1 rows read and written during the run, only from two same-day snapshots', async () => {
  const { usageDelta } = await import('../scripts/run_log.mjs');
  const start = { day: '2026-11-12', rows_read: 841669, rows_written: 19552 }, end = { day: '2026-11-12', rows_read: 3281301, rows_written: 42893 };
  assert.deepEqual(usageDelta(start, end), { read: 2439632, written: 23341 });
  assert.equal(usageDelta(start, { ...end, day: '2026-11-13' }), null, 'a run across midnight UTC has no figure');
  assert.equal(usageDelta({}, end), null);
  assert.equal(usageDelta(start, null), null);
  assert.equal(usageDelta(end, start), null, 'never negative');
  const rec = buildRunRecord({ usageStart: start, usageEnd: end }, { kind: 'watchlist' });
  assert.deepEqual(rec.d1_rows, { read: 2439632, written: 23341 });
  assert.ok(!('d1_rows' in buildRunRecord({ usageStart: start }, {})));
});

test('plan H1: usage_snapshot prints {} without credentials and never fails', () => {
  const out = execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'usage_snapshot.mjs')], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(out.trim(), '{}');
});
