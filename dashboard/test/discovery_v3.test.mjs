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

test('Y Combinator companies that are hiring: a small boost and a note for Farhan role-matches only', async () => {
  const { YC_BONUS } = await import('../worker/discovery.ts');
  const ctx = { yc: new Map([[companyKey('Acme AI'), 'Winter 2024']]) };
  const base = evaluate(farhan, post({ company: 'Other' }), ctx), yc = evaluate(farhan, post({ company: 'Acme AI' }), ctx);
  assert.equal(yc.score, Math.min(95, base.score + YC_BONUS)); assert.match(yc.qualification_reason, /Y Combinator company \(Winter 2024\), currently hiring/);
  assert.doesNotMatch(evaluate(farhan, post({ company: 'Acme AI', title: 'Account Executive' }), ctx).qualification_reason, /Y Combinator/, 'not for a title outside the role family');
  assert.doesNotMatch(evaluate(sana, post({ title: 'Reliability Engineer', company: 'Acme AI' }), ctx).qualification_reason, /Y Combinator/);
});

test('a job-board posting whose own text rules the candidate out is not stored; others keep unknown eligibility', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brd-'));
  const F = 'farhan_shaikh';
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify([{ id: F, primary_skills: farhan.primary_skills, total_years_experience: 9, search_profile: null }]));
  const b = (id, location) => ({ id, url: `https://example.com/${id}`, title: 'Implementation Manager', company: 'C' + id, ats_type: 'weworkremotely', location, is_remote: true,
    description: 'CRM Configuration and Workflow Automation.', candidates: [F], board: true });
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ jobs: [b('js:w:1', 'USA Only'), b('js:w:2', 'Anywhere in the World')] }));
  execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/dataset_apply.mjs', '--candidates', path.join(dir, 'candidates.json'), '--in', path.join(dir, 'm.json'), '--out', path.join(dir, 'a.sql')], { cwd: root });
  const { sqlite } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id,full_name) VALUES (?, 'F')`).run(F);
  sqlite.exec(fs.readFileSync(path.join(dir, 'a.sql'), 'utf8'));
  assert.deepEqual(sqlite.prepare('SELECT job_id, eligibility_status e FROM candidate_qualifications ORDER BY job_id').all().map((r) => [r.job_id, r.e]), [['js:w:2', 'UNKNOWN']]);
});

test('developer roles of any kind are on Farhan\'s avoid list', () => {
  for (const t of ['Zoho CRM Developer', 'Guidewire Integration Developer', 'Senior AI Developer - Finance Automation', 'Salesforce CRM Administrator'])
    assert.ok(evaluate(farhan, post({ title: t })).score <= 40, t);
  assert.ok(evaluate(farhan, post({ title: 'Implementation Manager' })).score > 40);
});

test('one role posted in 3+ places by one employer is written once (best copy); two copies are both kept; stored copies are closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
  const F = 'farhan_shaikh';
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify([{ id: F, primary_skills: farhan.primary_skills, total_years_experience: 9, search_profile: null }]));
  const j = (id, company, location) => ({ id, url: `https://example.com/${id}`, title: 'Implementation Manager', company, ats_type: 'lever', location, is_remote: true,
    description: 'Fully remote role. CRM Configuration and Workflow Automation.', candidates: [F] });
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ jobs: [j('ds:a:1', 'Agg', 'Remote - Chile'), j('ds:a:2', 'Agg', 'Remote - India'), j('ds:a:3', 'Agg', 'Remote - Greece'),
    j('ds:b:1', 'Two', 'Remote - India'), j('ds:b:2', 'Two', 'Remote - Spain')] }));
  const { sqlite } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id,full_name) VALUES (?, 'F')`).run(F);
  // copies already stored from an earlier run: three of one role, one with an application
  const ins = sqlite.prepare(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at,source_channel) VALUES (?,?,?,?,?,?,?)`);
  for (const id of ['old:1', 'old:2', 'old:3']) ins.run(id, 'Ops Lead', 'Old Co', 'lever', 1, '2026-11-01', 'ATS_DATASET');
  sqlite.exec(`INSERT INTO applications(candidate_id,job_id,status) VALUES ('${F}','old:3','APPLIED')`);
  execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/dataset_apply.mjs', '--candidates', path.join(dir, 'candidates.json'), '--in', path.join(dir, 'm.json'), '--out', path.join(dir, 'a.sql')], { cwd: root });
  sqlite.exec(fs.readFileSync(path.join(dir, 'a.sql'), 'utf8'));
  const active = sqlite.prepare(`SELECT id FROM jobs WHERE is_active = 1 ORDER BY id`).all().map((r) => r.id);
  assert.deepEqual(active.filter((x) => x.startsWith('ds:a')), ['ds:a:2'], 'the India copy scores best and is the one kept');
  assert.deepEqual(active.filter((x) => x.startsWith('ds:b')), ['ds:b:1', 'ds:b:2']);
  assert.deepEqual(active.filter((x) => x.startsWith('old')), ['old:1', 'old:3'], 'one stored copy stays, and one with an application is never closed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'a.report.json'), 'utf8')).collapsed_copies, 2);
});
