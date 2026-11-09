import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../scripts/recent_run_guard.mjs';

const NOW = Date.parse('2026-11-08T21:07:00Z');
const run = (id, startedAt, jobs) => ({ id, run_started_at: startedAt, jobs });
const opt = (o = {}) => ({ now: NOW, minGapHours: 7, realJob: 'watch', event: 'schedule', ...o });

test('a real run inside the gap makes a new trigger a no-op', () => {
  const r = decide([run(1, '2026-11-08T17:00:00Z', [{ name: 'guard', conclusion: 'success' }, { name: 'watch', conclusion: 'success' }])], opt());
  assert.equal(r.skip, true);
});
test('a run whose real job was skipped (budget guard) does not count, so the next trigger catches up', () => {
  const r = decide([run(2, '2026-11-08T20:00:00Z', [{ name: 'guard', conclusion: 'success' }, { name: 'watch', conclusion: 'skipped' }])], opt());
  assert.equal(r.skip, false);
});
test('a real run older than the gap means the work is due (a dropped trigger is caught up)', () => {
  const r = decide([run(3, '2026-11-08T10:04:00Z', [{ name: 'watch', conclusion: 'success' }])], opt());
  assert.equal(r.skip, false); assert.match(r.reason, /due/);
});
test('no earlier real run: go', () => assert.equal(decide([], opt()).skip, false));
test('a manual run is always allowed', () => {
  const r = decide([run(4, '2026-11-08T21:00:00Z', [{ name: 'watch', conclusion: 'success' }])], opt({ event: 'workflow_dispatch' }));
  assert.equal(r.skip, false);
});
test('only the newest real run decides', () => {
  const r = decide([run(5, '2026-11-08T20:00:00Z', [{ name: 'watch', conclusion: 'failure' }]), run(6, '2026-11-08T19:00:00Z', [{ name: 'watch', conclusion: 'success' }])], opt());
  assert.equal(r.skip, true, 'the failed run is ignored; the success 2 h ago counts');
});
