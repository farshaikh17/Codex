import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { seed } from './fixtures.mjs';
import { jobPayText } from '../frontend/src/jobHelpers.ts';

test('listing and detail preserve the published compensation for either candidate', async () => {
  const { sqlite, d1 } = createDb();
  try {
    seed(sqlite);
    const worker = await loadWorker();
    const update = sqlite.prepare(`UPDATE jobs SET salary_published=?, salary_currency='USD',
      salary_min=?, salary_max=?, salary_period='daily', salary_raw_text=? WHERE id='j1'`);
    const cases = [
      [1, 0, null, null, 'USD from 0 daily'],
      [1, null, 50, null, 'USD up to 50 daily'],
      [1, 0, 50, null, 'USD 0 – 50 daily'],
      [1, 50, 50, null, 'USD 50 daily'],
      [1, 50, 60, '$50–60 plus equity', '$50–60 plus equity'],
      [1, null, null, '{"summary":"USD 200 daily"}', 'USD 200 daily'],
      [0, 50, 60, 'withheld', null],
    ];
    for (const [published, min, max, raw, expected] of cases) {
      update.run(published, min, max, raw);
      const env = makeEnv(d1);
      for (const candidate of ['farhan_shaikh', 'sana_ansari']) {
        for (const path of ['/api/jobs', '/api/jobs/j1']) {
          const response = await call(worker, env, 'GET', path + '?candidate_id=' + candidate);
          assert.equal(response.status, 200);
          const job = path === '/api/jobs' ? response.json.jobs.find(row => row.id === 'j1') : response.json;
          assert.ok(job);
          assert.equal(jobPayText(job), expected);
        }
      }
    }
  } finally {
    sqlite.close();
  }
});
