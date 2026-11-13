// Plan phase 4, ranking (C1-C3): table-driven checks of each rule, with text taken from the saved samples plus near misses. The phase 2 caps still win.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, dutyCount, dutyAdjust, AVOID_TITLE_CAP } from '../worker/discovery.ts';

const farhan = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'GoHighLevel']), target_roles: JSON.stringify(['Implementation Manager', 'RevOps Manager']),
  total_years_experience: 9, qualification_threshold: 70 };
const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis']), target_roles: JSON.stringify(['Maintenance Engineer', 'Reliability Engineer']),
  total_years_experience: 9, qualification_threshold: 60 };
const pad = (s, n) => (s + ' ').repeat(Math.ceil(n / (s.length + 1))).slice(0, n);
const F_RICH = 'You will configure our CRM, implement onboarding flows, design workflows and automation, integrate tools with Zapier, n8n and webhooks, own go-live and write SOPs for process improvement.';
const F_SOME = 'You will configure the platform, own workflows and run automation for the sales team.';
const S_RICH = 'Lead preventive maintenance, breakdown response and shutdown planning for boilers and turbines; root cause analysis, condition monitoring and reliability programmes.';
const S_SOME = 'Responsible for preventive maintenance of rotating equipment and root cause analysis of failures.';
const FILLER = 'Our company is growing fast and we value ownership, curiosity and kindness. We offer health cover, learning budgets and flexible hours.';
const post = (title, description, location = 'Remote - India', remote = true) => ({ id: 'x', title, url: 'https://example.com/x', location, description, remote });

test('C1: duty phrases are counted once each, per person', () => {
  const rows = [
    ['farhan_shaikh', F_RICH, 11], ['farhan_shaikh', F_SOME, 3], ['farhan_shaikh', 'Our API and data pipeline team.', 0],   // api / pipeline: too generic
    ['farhan_shaikh', 'workflow workflows workflow automation automate', 2],
    ['sana_ansari', S_RICH, 8], ['sana_ansari', S_SOME, 3], ['sana_ansari', 'Join our sales team.', 0],
    ['someone_else', F_RICH, null],
  ];
  for (const [cid, text, n] of rows) assert.equal(dutyCount(cid, text), n, `${cid}: ${text.slice(0, 40)}`);
});

test('C1: the score change by count, text length and exact title', () => {
  const rows = [   // duties, length, exact title -> change
    [6, 800, false, 6], [9, 400, false, 6], [3, 800, false, 3], [5, 300, false, 3], [2, 800, false, 0],
    [0, 601, false, -8], [0, 600, false, 0], [0, 900, true, 0], [6, 299, false, 0], [0, 200, false, 0], [null, 900, false, 0],
  ];
  for (const [d, len, exact, want] of rows) assert.equal(dutyAdjust(d, len, exact), want, JSON.stringify([d, len, exact]));
});

test('C1 in evaluate(): many duties rank above a bare role match; none at all ranks below; the avoid cap still wins', () => {
  const base = evaluate(farhan, post('Operations Manager', pad(FILLER, 700)));
  const rich = evaluate(farhan, post('Operations Manager', F_RICH + ' ' + pad(FILLER, 500)));
  const some = evaluate(farhan, post('Operations Manager', F_SOME + ' ' + pad(FILLER, 500)));
  assert.ok(rich.score > some.score && some.score > base.score, `${rich.score} > ${some.score} > ${base.score}`);
  assert.match(base.qualification_reason, /none of the duties/);
  const exact = evaluate(farhan, post('Implementation Manager', pad(FILLER, 700)));
  assert.doesNotMatch(exact.qualification_reason, /none of the duties/, 'an exact target title is not cut for a text that names no duty');
  const short = evaluate(farhan, post('Operations Manager', 'Remote role. ' + FILLER));
  assert.doesNotMatch(short.qualification_reason, /duties/, 'under 300 characters: no change');
  const avoided = evaluate(farhan, post('Software Engineer, Integrations', F_RICH + ' ' + pad(FILLER, 500)));
  assert.ok(avoided.score <= AVOID_TITLE_CAP, 'the avoid cap still wins');
  const plant = evaluate(sana, post('Maintenance Engineer', S_RICH + ' ' + pad(FILLER, 500), 'Jamnagar, Gujarat, India', false));
  const bare = evaluate(sana, post('Maintenance Engineer', pad(FILLER, 700), 'Jamnagar, Gujarat, India', false));
  assert.ok(plant.score > bare.score, `${plant.score} > ${bare.score}`);
});
