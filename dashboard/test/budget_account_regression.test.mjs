import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, usageFromAnalytics } from '../scripts/budget_guard.mjs';

const response = groups => ({data:{viewer:{accounts:[{d1AnalyticsAdaptiveGroups:groups}]}}});
test('account-wide aggregate counts reads and writes from all databases', () => {
  const usage = usageFromAnalytics(response([{sum:{rowsRead:3600000,rowsWritten:81000}}]));
  assert.equal(decide(usage,{maxReads:3500000,event:'schedule'}).skip,true);
  assert.equal(decide(usage,{maxReads:4000000,event:'schedule'}).skip,true);
});
test('malformed analytics fails closed for schedules', () => {
  for (const body of [{}, response([{sum:{rowsRead:1}}]), response([{sum:{rowsRead:-1,rowsWritten:0}}]), {errors:[{}]}]) {
    const usage = usageFromAnalytics(body);
    assert.equal(usage,null);
    assert.equal(decide(usage,{maxReads:3500000,event:'schedule'}).skip,true);
  }
});
test('a new day with no analytics groups has zero usage', () => {
  assert.deepEqual(usageFromAnalytics(response([])),{rows_read:0,rows_written:0});
});
