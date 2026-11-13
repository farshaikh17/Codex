// Plan U3: learning from a person's own marks, gently (scripts/taste_rules.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarks, tasteAdjust, withTasteSentence } from '../scripts/taste_rules.mjs';

const S = 'sana_ansari', F = 'farhan_shaikh';
const m = (rows) => buildMarks(rows.map(([candidate_id, title, company, label]) => ({ candidate_id, title, company, label })));

test('one Not for me: -2 for the same employer and family; two: -5; another family or employer: nothing', () => {
  const one = m([[S, 'Maintenance Engineer', 'NTPC', 'NOT_FOR_ME']]);
  assert.equal(tasteAdjust(one, S, 'Senior Maintenance Engineer', 'NTPC').adj, -2);
  assert.equal(tasteAdjust(one, S, 'Reliability Engineer', 'NTPC').adj, 0, 'another family at the same employer');
  assert.equal(tasteAdjust(one, S, 'Maintenance Engineer', 'Tata Power').adj, 0, 'the same family elsewhere');
  const two = m([[S, 'Maintenance Engineer', 'NTPC', 'NOT_FOR_ME'], [S, 'Mechanical Maintenance Lead', 'NTPC Ltd', 'NOT_FOR_ME']]);
  assert.equal(tasteAdjust(two, S, 'Maintenance Planner', 'NTPC').adj, -5);
});

test('Good match or an application: +3 same employer, +2 same family, within +-5; Saved alone teaches nothing', () => {
  const up = m([[F, 'Implementation Manager', 'GoHighLevel', 'GOOD_MATCH']]);
  assert.equal(tasteAdjust(up, F, 'Onboarding Specialist', 'GoHighLevel').adj, 5);
  assert.equal(tasteAdjust(up, F, 'Revenue Operations Manager', 'GoHighLevel').adj, 3);
  assert.equal(tasteAdjust(up, F, 'Implementation Lead', 'HubSpot').adj, 2);
  assert.equal(tasteAdjust(m([[F, 'Implementation Manager', 'HubSpot', 'APPLIED']]), F, 'Implementation Lead', 'HubSpot').adj, 5);
  assert.equal(tasteAdjust(m([[F, 'Implementation Manager', 'HubSpot', 'SAVED']]), F, 'Implementation Lead', 'HubSpot').adj, 0);
  const mixed = m([[F, 'Implementation Manager', 'Acme', 'NOT_FOR_ME'], [F, 'Implementation Analyst', 'Acme', 'NOT_FOR_ME'], [F, 'CRM Admin', 'Acme', 'GOOD_MATCH']]);
  assert.equal(tasteAdjust(mixed, F, 'Implementation Lead', 'Acme').adj, -2, '-5 + 3');
});

test('reposters and titles in no family are exempt; the reason sentence is replaced, never doubled', () => {
  const down = m([[F, 'Implementation Manager', 'Jobgether', 'NOT_FOR_ME'], [F, 'Implementation Manager', 'Jobgether', 'NOT_FOR_ME']]);
  assert.equal(tasteAdjust(down, F, 'Implementation Manager', 'Jobgether').adj, 0);
  assert.equal(tasteAdjust(m([[F, 'Barista', 'Cafe', 'NOT_FOR_ME']]), F, 'Barista', 'Cafe').adj, 0);
  let r = withTasteSentence('Matches 4 skills. Like roles you saved before.', 'Ranked down: like jobs you marked Not for me at this employer.');
  r = withTasteSentence(r, 'Ranked down: like jobs you marked Not for me at this employer.');
  assert.equal(r, 'Matches 4 skills. Ranked down: like jobs you marked Not for me at this employer.');
  assert.equal(withTasteSentence(r, ''), 'Matches 4 skills.');
});
