// Plan phase 4, ranking (C1-C3): table-driven checks of each rule, with text taken from the saved samples plus near misses. The phase 2 caps still win.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, dutyCount, dutyAdjust, mixedTitle, MIXED_TITLE_PENALTY, AVOID_TITLE_CAP, spreadBonus, PLAIN_CEILING, SCORE_CEILING, VISA_UNLIKELY_CAP } from '../worker/discovery.ts';

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

test('C2: titles joining two unrelated functions', () => {
  const rows = [
    ['Sales & Marketing Operations Manager', ['sales', 'marketing']], ['Finance and HR Operations Lead', ['finance', 'people']],
    ['Sales and Customer Success Manager', ['sales', 'customer']], ['Marketing / Finance Analyst', ['marketing', 'finance']],
    // near misses: one function, related functions, or operations / engineering with anything
    ['O&M Engineer', null], ['Operations & Maintenance Manager', null], ['Revenue Operations & Sales Ops Manager', null], ['Maintenance & Reliability Engineer', null],
    ['Electrical & Instrumentation Engineer', null], ['Health, Safety & Environment Manager', null], ['Implementation and Onboarding Manager', null],
    ['Customer Success & Operations Manager', null], ['Supply Chain and Procurement Manager', null], ['Data & Analytics Lead', null], ['Implementation Manager', null],
  ];
  for (const [t, want] of rows) assert.deepEqual(mixedTitle(t), want, t);
});

test('C2 in evaluate(): -4 for a mixed title, none when a target role is contained exactly', () => {
  const text = F_SOME + ' ' + pad(FILLER, 500);
  const plain = evaluate(farhan, post('Revenue Operations Manager', text));
  const mixed = evaluate(farhan, post('Sales & Marketing Operations Manager', text));
  assert.equal(plain.score - mixed.score, MIXED_TITLE_PENALTY, `${plain.score} vs ${mixed.score}`);
  assert.match(mixed.qualification_reason, /mixes two functions \(sales and marketing/);
  const target = { ...farhan, target_roles: JSON.stringify(['Sales & Marketing Operations Manager']) };
  assert.doesNotMatch(evaluate(target, post('Sales & Marketing Operations Manager', text)).qualification_reason, /mixes two functions/);
});

test('C3: the spread above the plain ceiling', () => {
  const rows = [[null, 900, 0], [5, 900, 0], [6, 900, 1], [7, 900, 2], [8, 900, 3], [13, 900, 3], [9, 299, 0], [0, 900, 0]];
  for (const [d, len, want] of rows) assert.equal(spreadBonus(d, len), want, JSON.stringify([d, len]));
});

test('C3 in evaluate(): a full-bonus job stops at 92 unless it names many duties; the caps still win; age plays no part', () => {
  const rich = { ...farhan, primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'GoHighLevel', 'Zapier', 'Webhooks', 'SOP']) };
  const full = (desc) => evaluate(rich, post('Senior Implementation Manager', desc + ' ' + pad(FILLER, 400) + ' 5+ years of experience. Fully remote, India.'));
  const three = full('You will configure the CRM with GoHighLevel, own workflows and automation for clients.');
  const many = full(F_RICH + ' CRM configuration with GoHighLevel.');
  assert.equal(three.score, PLAIN_CEILING, 'every bonus, few duties: the plain ceiling');
  assert.equal(many.score, SCORE_CEILING, '11 duties: +3 above it');
  const capped = evaluate(sana, post('Maintenance Engineer', S_RICH + ' Shutdowns, overhauls, SCADA, DCS. ' + pad(FILLER, 400), 'Essen, Germany', false));
  assert.ok(capped.score <= VISA_UNLIKELY_CAP, `visa cap still wins over the spread (${capped.score})`);
  const posting = post('Senior Implementation Manager', F_RICH + ' ' + pad(FILLER, 400));
  assert.equal(evaluate(rich, { ...posting, observedAt: '2020-01-01T00:00:00Z' }).score, evaluate(rich, { ...posting, observedAt: '2026-11-13T00:00:00Z' }).score);
});
