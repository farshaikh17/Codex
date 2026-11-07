// Owner-approved additions of 2026-11-07: pay floor, employers listed as hiring worldwide, rejected-before labels, the
// "easy yes" note, and the past-applications store that feeds them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { seed } from './fixtures.mjs';
import { evaluate, monthlyInr, companyKey, PAY_BELOW_FLOOR_PENALTY, PAY_PREFERRED_BONUS, GLOBAL_HIRER_BONUS, FOREIGN_LOCATION_PENALTY } from '../worker/discovery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const farhan = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'GoHighLevel']), total_years_experience: 9, cash_floor_inr_monthly: 120000 };
const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability']), total_years_experience: 9 };
const post = (extra = {}) => ({ id: 'x', title: 'Implementation Manager', company: 'Acme', url: 'https://example.com/x', location: 'Remote - India', description: 'Fully remote role. CRM Configuration and Workflow Automation.', remote: true, ...extra });

test('monthlyInr converts a published range to rupees a month and ignores anything unusable', () => {
  assert.deepEqual(monthlyInr({ min: 1200000, max: 1800000, currency: 'INR', period: 'year' }), { lo: 100000, hi: 150000 });
  assert.deepEqual(monthlyInr({ min: 25, max: 30, currency: 'USD', period: 'hour' }), { lo: 367625, hi: 441150 });
  assert.deepEqual(monthlyInr({ min: 60000, currency: 'USD', interval: 'per-year-salary' }), { lo: 425000, hi: 425000 });
  for (const bad of [null, {}, { min: 10, currency: 'XYZ', period: 'year' }, { min: 'abc', currency: 'USD', period: 'year' }, { min: 50000, currency: 'USD' }, { min: 0, max: 0, currency: 'INR', period: 'month' }])
    assert.equal(monthlyInr(bad), null, JSON.stringify(bad));
});

test('pay floor: published pay below the floor loses points, the preferred level gains a little, no published pay changes nothing', () => {
  const base = evaluate(farhan, post());
  const low = evaluate(farhan, post({ salary: { min: 600000, max: 900000, currency: 'INR', period: 'year' } }));
  const good = evaluate(farhan, post({ salary: { min: 2600000, max: 3200000, currency: 'INR', period: 'year' } }));
  const mid = evaluate(farhan, post({ salary: { min: 1500000, max: 2000000, currency: 'INR', period: 'year' } }));
  assert.equal(low.score, Math.max(0, base.score - PAY_BELOW_FLOOR_PENALTY)); assert.match(low.qualification_reason, /below the ₹1,20,000\/month floor/);
  assert.equal(good.score, Math.min(95, base.score + PAY_PREFERRED_BONUS)); assert.match(good.qualification_reason, /preferred level/);
  assert.equal(mid.score, base.score, 'between floor and preferred: unchanged');
  assert.equal(low.status, base.status, 'pay never changes the status');
  // the floor falls back to the documented ₹1.2L for Farhan when none is stored; Sana has none, so nothing is compared
  assert.equal(evaluate({ ...farhan, cash_floor_inr_monthly: null }, post({ salary: { min: 600000, max: 900000, currency: 'INR', period: 'year' } })).score, low.score);
  const s1 = evaluate(sana, post({ title: 'Reliability Engineer', salary: { min: 100000, max: 200000, currency: 'INR', period: 'year' } }));
  const s2 = evaluate(sana, post({ title: 'Reliability Engineer' }));
  assert.equal(s1.score, s2.score);
});

test('companyKey matches the same employer across a display name and an ATS slug', () => {
  assert.equal(companyKey('Perion Network Ltd.'), companyKey('perionnetworkltd'));
  assert.equal(companyKey('Zapier, Inc.'), 'zapier');
  assert.equal(companyKey('GitLab'), companyKey('gitlab'));
  assert.equal(companyKey('Procter & Gamble'), companyKey('procterandgamble'));
  assert.equal(companyKey('AI'), '', 'too short to match anything');
});

test('employers listed as hiring worldwide: Farhan gets a small boost and no foreign-location penalty; eligibility is unchanged', () => {
  const ctx = { globalHirers: new Set([companyKey('Zapier')]) };
  const europe = { location: 'Remote - Europe', description: 'CRM Configuration and Workflow Automation.' };
  const plain = evaluate(farhan, post({ ...europe, company: 'Acme' }), ctx);
  const listed = evaluate(farhan, post({ ...europe, company: 'Zapier' }), ctx);
  assert.equal(listed.eligibility, plain.eligibility);
  assert.equal(listed.score, Math.min(95, plain.score + FOREIGN_LOCATION_PENALTY + GLOBAL_HIRER_BONUS), `${listed.score} vs ${plain.score}`);
  assert.match(listed.qualification_reason, /hiring worldwide; confirm India is included/);
  // a US-only remote role stays ineligible even at a listed employer; Sana is not affected
  assert.equal(evaluate(farhan, post({ company: 'Zapier', location: 'Remote - US', description: 'x' }), ctx).status, 'INELIGIBLE');
  assert.doesNotMatch(evaluate(sana, post({ title: 'Reliability Engineer', company: 'Zapier' }), ctx).qualification_reason, /worldwide/);
  // without the list (the Worker's own callers) nothing changes
  assert.equal(evaluate(farhan, post({ ...europe, company: 'Zapier' })).score, plain.score);
});

test('an employer that rejected the candidate before is labelled with the date; nothing is hidden or re-scored', () => {
  const ctx = { rejected: new Map([[companyKey('Euka'), '2026-10-05'], [companyKey('Ambra'), null]]) };
  const r = evaluate(farhan, post({ company: 'Euka' }), ctx), base = evaluate(farhan, post({ company: 'Other' }), ctx);
  assert.match(r.qualification_reason, /Rejected by this employer before \(2026-10-05\)/);
  assert.equal(r.score, base.score); assert.equal(r.status, base.status);
  assert.match(evaluate(farhan, post({ company: 'Ambra Health' }), ctx).qualification_reason, /^(?!.*Rejected)/s, 'a different company name does not match');
  assert.match(evaluate(farhan, post({ company: 'ambra' }), ctx).qualification_reason, /Rejected by this employer before \(date not recorded\)/);
});

test('"easy yes" note names the CV skills the posting asks for, and the experience met', () => {
  const r = evaluate(farhan, post({ description: 'Fully remote role. CRM Configuration, Workflow Automation, GoHighLevel. 5+ years of experience.' }));
  assert.match(r.qualification_reason, /Easy-yes check: 3 of 3 CV skills named \(CRM Configuration, Workflow Automation, GoHighLevel\), meets the 5\+ years asked\./);
  assert.doesNotMatch(evaluate(farhan, post({ title: 'Account Executive' })).qualification_reason, /Easy-yes/, 'not for a title outside the role family');
});

test('past applications: operator-only CRUD with validation; public callers get nothing', async () => {
  const { sqlite, d1 } = createDb(); seed(sqlite);
  const worker = await loadWorker(); const env = makeEnv(d1);
  assert.equal((await call(worker, env, 'GET', '/api/past-applications?candidate_id=farhan_shaikh', { key: null })).status, 401);
  assert.equal((await call(worker, env, 'POST', '/api/past-applications', { key: null, body: { candidate_id: 'farhan_shaikh', company: 'Euka', outcome: 'REJECTED' } })).status, 401);
  for (const [body, why] of [[{ candidate_id: 'nobody', company: 'Euka', outcome: 'REJECTED' }, 'candidate'], [{ candidate_id: 'farhan_shaikh', company: 'E', outcome: 'REJECTED' }, 'company'],
    [{ candidate_id: 'farhan_shaikh', company: 'Euka', outcome: 'MAYBE' }, 'outcome'], [{ candidate_id: 'farhan_shaikh', company: 'Euka', outcome: 'REJECTED', decided_on: '5 Oct' }, 'date']])
    assert.equal((await call(worker, env, 'POST', '/api/past-applications', { body })).status, 400, why);
  const made = await call(worker, env, 'POST', '/api/past-applications', { body: { candidate_id: 'farhan_shaikh', company: '  Euka\u0000 ', role: 'Founding PM', outcome: 'REJECTED', decided_on: '2026-10-05' } });
  assert.equal(made.status, 201); assert.equal(made.json.past_application.company, 'Euka');
  const list = await call(worker, env, 'GET', '/api/past-applications?candidate_id=farhan_shaikh');
  assert.deepEqual(list.json.past_applications.map((r) => [r.company, r.outcome, r.decided_on]), [['Euka', 'REJECTED', '2026-10-05']]);
  assert.equal((await call(worker, env, 'GET', '/api/past-applications?candidate_id=sana_ansari')).json.past_applications.length, 0, 'per candidate');
  assert.equal((await call(worker, env, 'DELETE', `/api/past-applications/${made.json.past_application.id}`)).status, 200);
  assert.equal((await call(worker, env, 'DELETE', '/api/past-applications/abc')).status, 404);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM past_applications').get().n, 0);
});

test('daily apply: rejected employers from the database and the worldwide list reach the screen; job-site rows keep unknown eligibility', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-'));
  const F = 'farhan_shaikh';
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify([{ id: F, primary_skills: farhan.primary_skills, total_years_experience: 9, cash_floor_inr_monthly: 120000, search_profile: null,
    rejected_companies: JSON.stringify([{ company: 'Euka', on: '2026-10-05' }]) }]));
  fs.writeFileSync(path.join(dir, 'gh.json'), JSON.stringify({ keys: [companyKey('Zapier')] }));
  const job = (id, company, location, extra = {}) => ({ id, url: `https://example.com/${id}`, title: 'Implementation Manager', company, ats_type: 'greenhouse', location, is_remote: true,
    description: 'Fully remote role. CRM Configuration and Workflow Automation.', candidates: [F], ...extra });
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ jobs: [job('ds:g:1', 'Euka', 'Remote - India'), job('ds:g:2', 'Zapier', 'Remote - Europe'),
    job('ds:g:3', 'Cheap Co', 'Remote - India', { salary_min: 300000, salary_max: 500000, salary_currency: 'INR', salary_period: 'year' })] }));
  execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/dataset_apply.mjs', '--candidates', path.join(dir, 'candidates.json'), '--in', path.join(dir, 'm.json'),
    '--global-hirers', path.join(dir, 'gh.json'), '--out', path.join(dir, 'a.sql')], { cwd: root });
  const { sqlite } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id,full_name) VALUES (?, 'F')`).run(F);
  sqlite.exec(fs.readFileSync(path.join(dir, 'a.sql'), 'utf8'));
  const reason = (id) => sqlite.prepare('SELECT qualification_reason r FROM candidate_qualifications WHERE job_id=?').get(id).r;
  assert.match(reason('ds:g:1'), /Rejected by this employer before \(2026-10-05\)/);
  assert.match(reason('ds:g:2'), /hiring worldwide/);
  assert.match(reason('ds:g:3'), /below the ₹1,20,000\/month floor/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'a.report.json'), 'utf8')).global_hirers, 1);
});

test('the Python list builder uses the same employer key as the screen, and both list formats parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
  fs.mkdirSync(path.join(dir, 'ri', 'src', 'companies'), { recursive: true });
  const co = (slug, title, region, policy) => fs.writeFileSync(path.join(dir, 'ri', 'src', 'companies', `${slug}.md`), `---\ntitle: "${title}"\nslug: ${slug}\nregion: ${region}\nremote_policy: ${policy}\n---\nText`);
  co('zapier', 'Zapier', 'worldwide', 'fully-remote'); co('acme', 'Acme Ltd', 'americas', 'fully-remote'); co('hyb', 'Hybrid Co', 'worldwide', 'hybrid'); co('apac', 'Apac Labs', 'asia-pacific', 'remote-first');
  fs.writeFileSync(path.join(dir, 'est.md'), 'Company | Business\n--- | ---\n[Perion Network Ltd.](https://perion.com) | Ads\n| [Doist](https://doist.com) | Apps\nNot a row [x](y)\n');
  execFileSync('python3', ['-I', path.join(root, '..', 'engine', 'global_hirers.py'), '--remoteintech', path.join(dir, 'ri'), '--established', path.join(dir, 'est.md'), '--out', dir]);
  const keys = JSON.parse(fs.readFileSync(path.join(dir, 'global_hirers.json'), 'utf8')).keys;
  assert.deepEqual(keys.sort(), [companyKey('Apac Labs'), companyKey('Doist'), companyKey('perionnetworkltd'), companyKey('Zapier')].sort());
});
