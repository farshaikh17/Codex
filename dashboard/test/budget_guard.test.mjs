import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../scripts/budget_guard.mjs';

const opt = (event = 'schedule', maxReads = 3500000) => ({ maxReads, event });

test('goes ahead well under the budget', () => assert.equal(decide({ rows_read: 1200000, rows_written: 3000 }, opt()).skip, false));
test('skips at or over the read budget', () => {
  assert.equal(decide({ rows_read: 3500000, rows_written: 0 }, opt()).skip, true);
  assert.equal(decide({ rows_read: 16999919, rows_written: 45769 }, opt()).skip, true);   // the 7 Nov figures
});
test('skips when writes are near the daily limit', () => assert.equal(decide({ rows_read: 10, rows_written: 85000 }, opt()).skip, true));
test('unknown usage: a schedule stays out, a person may go ahead', () => {
  assert.equal(decide(null, opt('schedule')).skip, true);
  assert.equal(decide(null, opt('workflow_dispatch')).skip, false);
});
test('each job has its own ceiling', () => {
  const usage = { rows_read: 3000000, rows_written: 100 };
  assert.equal(decide(usage, opt('schedule', 2500000)).skip, true);
  assert.equal(decide(usage, opt('schedule', 4000000)).skip, false);
});
