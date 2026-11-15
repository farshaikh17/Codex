// Wide intake: engine/dataset_discovery.py reads the Worker's Indian and Gulf place lists (INDIA_PLACE, GULF_PLACE) from discovery.ts for its fallback
// selection. The same fixture is checked on both sides (engine/tests/test_wide_select.py), so the two can never disagree on these places.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanaIndiaCity, gulfPlace } from '../worker/discovery.ts';

const cases = JSON.parse(fs.readFileSync(new URL('../../engine/tests/fixtures/place_cases.json', import.meta.url), 'utf8'));

test('place lists: the Worker agrees with the shared fixture (India and Gulf)', () => {
  assert.ok(cases.length >= 10);
  for (const c of cases) {
    assert.equal(sanaIndiaCity(c.location), c.india, `India: ${c.location}`);
    assert.equal(gulfPlace(c.location), c.gulf, `Gulf: ${c.location}`);
  }
});
