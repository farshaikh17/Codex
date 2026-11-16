import test from 'node:test';
import assert from 'node:assert/strict';
import { decideWatchdog } from '../scripts/discovery_watchdog.mjs';

const now = Date.parse('2026-11-12T21:00:00Z');
const at = (h) => new Date(now - h * 3600000).toISOString();
const run = (id, h, o = {}) => ({ id, status: 'completed', conclusion: 'success', created_at: at(h), discover: 'success', ...o });

test('watchdog: starts the daily run only when it is overdue and nothing is running or just tried', () => {
  const d = (runs) => decideWatchdog(runs, { now }).dispatch;
  assert.equal(d([run(1, 5)]), false, 'did its work 5 h ago');
  assert.equal(d([run(1, 23.5)]), false, 'still inside 24 h');
  assert.equal(d([run(1, 25)]), true, 'overdue');
  assert.equal(d([]), true, 'never ran');
  assert.equal(d([{ id: 2, status: 'in_progress', created_at: at(0.2) }, run(1, 30)]), false, 'already running');
  assert.equal(d([{ id: 2, status: 'queued', created_at: at(0.1) }, run(1, 30)]), false, 'already queued');
  assert.equal(d([run(2, 1, { conclusion: 'failure', discover: null }), run(1, 30)]), false, 'a run failed an hour ago: not retried in a loop');
  assert.equal(d([run(2, 4, { conclusion: 'failure', discover: null }), run(1, 30)]), true, 'that failure is 4 h old: try again');
  assert.equal(d([run(2, 2, { discover: 'skipped' }), run(1, 30)]), false, 'a guard-skipped run 2 h ago counts as a recent attempt');
  assert.equal(d([run(2, 5, { discover: 'skipped' }), run(1, 30)]), true, 'a run that skipped its real work does not count as done');
});

test('watchdog (QA 16 Nov): a run the budget guard postponed in the evening is restarted just after the 00:00 UTC read reset', () => {
  const after = Date.parse('2026-11-17T00:10:00Z');
  const h = (x) => new Date(after - x * 3600000).toISOString();
  const r = (id, x, o = {}) => ({ id, status: 'completed', conclusion: 'success', created_at: h(x), discover: 'success', ...o });
  const skip = (id, x) => r(id, x, { discover: 'skipped', budgetSkip: true });
  const d = (runs, t = after) => decideWatchdog(runs, { now: t }).dispatch;
  assert.equal(d([skip(3, 3.6), r(1, 22)]), true, 'skipped at 20:34, last real run 22 h ago: start now, not at 03:34 or after 24 h');
  assert.equal(d([skip(3, 3.6), skip(2, 1.5), r(1, 22)]), true, 'more evening skips change nothing');
  assert.equal(d([skip(3, 3.6), r(1, 12)]), false, 'the last real run is only 12 h old');
  assert.equal(d([skip(4, 0.05), skip(3, 3.6), r(1, 22)]), false, 'a run already started today (and was skipped again): normal rules, no loop');
  assert.equal(d([{ id: 4, status: 'queued', created_at: h(0.05) }, skip(3, 3.6), r(1, 22)]), false, 'already queued');
  assert.equal(d([r(3, 3.6, { discover: 'skipped' }), r(1, 22)]), false, 'a recent-run-guard skip (not the budget) keeps the old rules');
  assert.equal(d([skip(3, 1), r(1, 22)], Date.parse('2026-11-16T21:40:00Z')), false, 'before midnight the reads have not reset: wait');
});
