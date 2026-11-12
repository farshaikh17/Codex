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
