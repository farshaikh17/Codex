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

test('the guard line reports rows written as well as rows read, so a write-heavy day is visible in the log', () => {
  const go = decide({ rows_read: 1000, rows_written: 42000 }, { maxReads: 2500000, event: 'schedule' });
  assert.equal(go.skip, false);
  assert.match(go.reason, /rows written today 42,000 of 100,000/);
  const stop = decide({ rows_read: 3000000, rows_written: 5 }, { maxReads: 2500000, event: 'schedule' });
  assert.equal(stop.skip, true);
  assert.match(stop.reason, /rows written today 5 of 100,000/);
});

// QA 3 F4: the daily run (about 2.4M reads) may start only below 1.5M rows read that day, so about 1.1M of the 5M free limit stays for the
// site, the watchlist and a release. The watchdog has no limit of its own: the run it starts passes this same guard.
test('the daily discovery run starts only below 1.5M rows read', async () => {
  const fs = await import('node:fs');
  const wf = fs.readFileSync(new URL('../../.github/workflows/discovery.yml', import.meta.url), 'utf8');
  const limits = [...wf.matchAll(/MAX_READS:\s*'(\d+)'/g)].map((m) => Number(m[1]));
  assert.deepEqual(limits, [1500000]);
  assert.equal(decide({ rows_read: 1499999, rows_written: 0 }, { maxReads: limits[0], event: 'workflow_dispatch' }).skip, false);
  assert.equal(decide({ rows_read: 1500000, rows_written: 0 }, { maxReads: limits[0], event: 'workflow_dispatch' }).skip, true, 'a watchdog start passes the same guard');
  const wd = fs.readFileSync(new URL('../../.github/workflows/discovery-watchdog.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(wd, /MAX_READS/, 'no second, looser limit in the watchdog');
});
