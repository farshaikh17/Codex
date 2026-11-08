// Owner-confirmed candidate rules of 2026-11-07: Farhan remote only (any country, never US-only), builder roles, wider avoid list;
// Sana's energy-transition targets; experience fit; migration 0015; the re-score applying the rules to earlier undecided rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { evaluate, avoidedTitle, usOnlyLocation, yearsRequired, EXPERIENCE_OVER_PENALTY, EXPERIENCE_MATCH_BONUS } from '../worker/discovery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const farhan = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation']), total_years_experience: 9 };
const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability', 'Root Cause Analysis']), total_years_experience: 9 };
const post = (title, location = 'Remote', description = 'CRM Configuration and Workflow Automation role.', company = 'Acme') =>
  ({ id: 'x', title, company, url: 'https://example.com/x', location, description, remote: /remote/i.test(location) });

test('Farhan: a role that is not remote, or is hybrid, or is remote within the US only, is ineligible; remote elsewhere is not', () => {
  for (const [loc, desc] of [['Bengaluru, India', 'On-site role.'], ['Hybrid - Pune, India', 'CRM work.'], ['London, United Kingdom', 'Office based.']]) {
    const r = evaluate(farhan, post('Implementation Manager', loc, desc));
    assert.equal(r.status, 'INELIGIBLE', loc); assert.match(r.reason, /not a remote role/i);
  }
  for (const loc of ['Remote - US', 'Remote, United States', 'Remote (Austin, TX)', 'US Remote']) {
    const r = evaluate(farhan, post('Implementation Manager', loc));
    assert.equal(r.status, 'INELIGIBLE', loc); assert.match(r.reason, /united states only/i);
  }
  for (const loc of ['Remote', 'Remote - India', 'Remote - Europe', 'Remote, London, United Kingdom', 'Remote - US or Canada', 'Remote (Worldwide)', 'Remote, Sydney, Australia'])
    assert.notEqual(evaluate(farhan, post('Implementation Manager', loc)).status, 'INELIGIBLE', loc);
  assert.equal(evaluate(farhan, post('Implementation Manager', 'Remote', 'CRM Configuration. This is a fully remote role open worldwide; remote worldwide.')).eligibility, 'ELIGIBLE');
  // a remote statement in the description counts even when the location field does not say remote
  assert.notEqual(evaluate(farhan, post('Implementation Manager', 'India', 'This is a fully remote role. CRM Configuration.')).status, 'INELIGIBLE');
  assert.equal(usOnlyLocation('Remote, excluding the US'), false); assert.equal(usOnlyLocation('Remote - India'), false);
  // Sana is open to on-site roles anywhere: none of this applies to her
  assert.notEqual(evaluate(sana, post('Reliability Engineer', 'Houston, TX', 'Reliability role, on-site.')).status, 'INELIGIBLE');
});

test('Farhan: an employer he asked to skip is ineligible', () => {
  assert.equal(evaluate(farhan, post('Implementation Manager', 'Remote', 'CRM.', 'Ajaia')).status, 'INELIGIBLE');
  assert.notEqual(evaluate(farhan, post('Implementation Manager', 'Remote', 'CRM.', 'Ajax Systems')).status, 'INELIGIBLE');
});

test('Farhan: the wider avoid list and the builder roles', () => {
  for (const t of ['Business Analyst', 'Deal Desk Specialist', 'Account Executive', 'Sales Development Representative', 'Salesforce Administrator', 'HubSpot Developer', 'Junior Implementation Specialist', 'Operations Intern', 'Data Engineer', 'Administrative Assistant'])
    assert.ok(avoidedTitle('farhan_shaikh', t), t);
  for (const t of ['Implementation Manager', 'Internal Operations Manager', 'International Operations Lead', 'Chief of Staff', 'CRM Administrator'])
    assert.ok(!avoidedTitle('farhan_shaikh', t), t);
  for (const t of ['Chief of Staff', "Founder's Office Associate", 'Founders Associate', 'GTM Engineer', 'Go-to-Market Engineer', 'AI Operations Lead', 'Founding Operations Generalist'])
    assert.equal(evaluate(farhan, post(t, 'Remote - India')).lane, 'STRONGEST_FIT', t);
  assert.equal(evaluate(farhan, post('Account Executive', 'Remote - India')).lane, 'UNASSIGNED');
});

test("Sana: energy efficiency, decarbonization, sustainability and technical consulting are in her role family", () => {
  for (const t of ['Decarbonization Consultant', 'Decarbonisation Lead', 'Energy Efficiency Engineer', 'Sustainability Engineer', 'Clean Tech Project Engineer', 'Net Zero Programme Manager', 'Technical Consultant – Process Industries'])
    assert.equal(evaluate(sana, post(t, 'Remote', 'Reliability work.')).lane, 'STRONGEST_FIT', t);
  assert.equal(evaluate(sana, post('Software Consultant', 'Remote', 'x')).lane, 'UNASSIGNED');
});

test('experience fit: a posting asking for far more than the candidate has loses points; one the candidate meets gains a little', () => {
  assert.equal(yearsRequired('We need 5+ years of experience in CRM.'), 5);
  assert.equal(yearsRequired('3-5 years of relevant experience; ideally 10+ years experience in operations.'), 10);
  assert.equal(yearsRequired('Minimum 7 years’ experience.'), 7);
  assert.equal(yearsRequired('A 401k and 20 days of leave. Founded 12 years ago.'), 0, 'numbers that are not experience requirements');
  const base = evaluate(farhan, post('Implementation Manager', 'Remote - India', 'CRM Configuration and Workflow Automation.'));
  const meets = evaluate(farhan, post('Implementation Manager', 'Remote - India', 'CRM Configuration and Workflow Automation. 5+ years of experience.'));
  const over = evaluate(farhan, post('Implementation Manager', 'Remote - India', 'CRM Configuration and Workflow Automation. 15+ years of experience.'));
  assert.equal(meets.score, Math.min(95, base.score + EXPERIENCE_MATCH_BONUS)); assert.match(meets.qualification_reason, /Meets the stated 5\+ years/);
  assert.equal(over.score, Math.max(0, base.score - EXPERIENCE_OVER_PENALTY)); assert.match(over.qualification_reason, /Asks for 15\+ years/);
  assert.equal(meets.status, 'NEEDS_REVIEW', 'still never READY on its own');
  // unknown experience: no change either way
  assert.equal(evaluate({ ...farhan, total_years_experience: null }, post('Implementation Manager', 'Remote - India', 'CRM Configuration and Workflow Automation. 15+ years of experience.')).score,
    evaluate({ ...farhan, total_years_experience: null }, post('Implementation Manager', 'Remote - India', 'CRM Configuration and Workflow Automation.')).score);
});

test('migration 0015 adds the CV skills to what is stored, raises years only, and runs once', () => {
  const m14 = fs.readFileSync(path.join(root, 'migrations', '0014_discovery_state.sql'), 'utf8');
  const m15 = fs.readFileSync(path.join(root, 'migrations', '0015_candidate_profiles_v2.sql'), 'utf8');
  const { sqlite } = createDb();
  sqlite.exec(m14);
  sqlite.exec(`DELETE FROM discovery_state WHERE key = 'profiles_v2_applied'`);   // the harness already applied every migration to an empty table
  sqlite.prepare(`INSERT INTO candidates(id,full_name,primary_skills,total_years_experience) VALUES ('farhan_shaikh','F','["GoHighLevel","Hand Added"]',4),('sana_ansari','S','not json',12)`).run();
  sqlite.exec(m15);
  const get = (id) => sqlite.prepare('SELECT primary_skills s, total_years_experience y FROM candidates WHERE id=?').get(id);
  const f = JSON.parse(get('farhan_shaikh').s), s = JSON.parse(get('sana_ansari').s);
  assert.ok(f.includes('Hand Added') && f.includes('Postman') && f.filter((x) => x === 'GoHighLevel').length === 1, JSON.stringify(f));
  assert.ok(s.includes('DCS Monitoring') && s.length === 14, 'an unreadable stored value is treated as empty, not an error');
  assert.equal(get('farhan_shaikh').y, 9); assert.equal(get('sana_ansari').y, 12, 'years are never lowered');
  // someone removes a skill by hand afterwards: a later release does not add it back
  sqlite.prepare(`UPDATE candidates SET primary_skills='["GoHighLevel"]' WHERE id='farhan_shaikh'`).run();
  sqlite.exec(m15);
  assert.deepEqual(JSON.parse(get('farhan_shaikh').s), ['GoHighLevel']);
});

test('re-score applies the current rules to earlier undecided rows: a non-remote role becomes ineligible for Farhan; decided rows stay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-'));
  const { sqlite } = createDb();
  const F = 'farhan_shaikh';
  sqlite.prepare(`INSERT INTO candidates(id,full_name,primary_skills,total_years_experience) VALUES (?,?,?,9)`).run(F, 'F', farhan.primary_skills);
  sqlite.exec(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at,description,location_restrictions,workplace_type) VALUES
    ('o1','Implementation Manager','A','lever',1,'2026-11-01','CRM Configuration on site.','Pune, India','ONSITE'),
    ('o2','Implementation Manager','B','lever',1,'2026-11-01','CRM Configuration on site.','Pune, India','ONSITE'),
    ('o3','Implementation Manager','C','lever',1,'2026-11-01','CRM Configuration on site.','Pune, India','ONSITE')`);
  sqlite.exec(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,manual_override_status) VALUES ('${F}','o1','NEEDS_REVIEW',NULL),('${F}','o2','NEEDS_REVIEW','READY'),('${F}','o3','HOLD',NULL)`);
  sqlite.exec(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES ('${F}','o1',50,'{"preliminary":true,"skills_v1":true}'),('${F}','o2',50,'{"preliminary":true}'),('${F}','o3',50,'{"preliminary":true}')`);
  sqlite.exec(`INSERT INTO applications(candidate_id,job_id,status) VALUES ('${F}','o3','APPLIED')`);
  const rows = ['o1', 'o2', 'o3'].map((id) => ({ candidate_id: F, job_id: id, title: 'Implementation Manager', company: 'A', location: 'Pune, India', description: 'CRM Configuration on site.', workplace_type: 'ONSITE', score_breakdown: '{"preliminary":true}' }));
  fs.writeFileSync(path.join(dir, 'rescore.json'), JSON.stringify(rows));
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify([{ id: F, primary_skills: farhan.primary_skills, total_years_experience: 9, search_profile: null }]));
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ jobs: [] }));
  execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/dataset_apply.mjs', '--candidates', path.join(dir, 'candidates.json'), '--in', path.join(dir, 'm.json'),
    '--rescore', path.join(dir, 'rescore.json'), '--out', path.join(dir, 'a.sql')], { cwd: root });
  sqlite.exec(fs.readFileSync(path.join(dir, 'a.sql'), 'utf8'));
  const q = (id) => sqlite.prepare(`SELECT qualification_status st, eligibility_status es, eligibility_reason er FROM candidate_qualifications WHERE candidate_id='${F}' AND job_id=?`).get(id);
  assert.deepEqual([q('o1').st, q('o1').es], ['INELIGIBLE', 'INELIGIBLE'], 'skills_v1 rows are re-checked once more under the new rules');
  assert.match(q('o1').er, /not a remote role/i);
  assert.equal(q('o2').st, 'NEEDS_REVIEW', 'a human override is never touched');
  assert.equal(q('o3').st, 'HOLD', 'a job someone applied to is never touched');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'a.report.json'), 'utf8')).rescored_ineligible, 3, 'planned for all three; the SQL guards decide');
});

test('migration 0017 removes the electrical/substation maintenance claims from Sana only, keeps hand-added entries, runs once', () => {
  const m14 = fs.readFileSync(path.join(root, 'migrations', '0014_discovery_state.sql'), 'utf8');
  const m17 = fs.readFileSync(path.join(root, 'migrations', '0017_sana_profile_cv.sql'), 'utf8');
  const { sqlite } = createDb();
  sqlite.exec(m14);
  sqlite.exec(`DELETE FROM discovery_state WHERE key = 'sana_profile_cv_v1'`);
  sqlite.prepare(`INSERT INTO candidates(id,full_name,primary_skills,secondary_skills,target_roles) VALUES
    ('sana_ansari','S','["Electrical Maintenance","Substation Maintenance","Industrial Maintenance","Hand Added"]','["Electrical Maintenance Planning","HVAC & Utility Systems"]','["Electrical Maintenance Engineer","Substation Maintenance Engineer","Plant Engineer"]'),
    ('farhan_shaikh','F','["Electrical Maintenance"]',NULL,NULL)`).run();
  sqlite.exec(m17);
  const get = (id) => { const r = sqlite.prepare('SELECT primary_skills p, secondary_skills s, target_roles t FROM candidates WHERE id=?').get(id); return { p: JSON.parse(r.p), s: JSON.parse(r.s), t: JSON.parse(r.t) }; };
  const s = get('sana_ansari');
  for (const list of [s.p, s.s, s.t]) assert.ok(!list.some((x) => /^(electrical maintenance|substation)/i.test(x)), JSON.stringify(list));
  assert.ok(s.p.includes('Hand Added') && s.p.includes('Industrial Maintenance') && s.p.includes('Rotating Equipment Maintenance') && s.p.includes('DCS Monitoring'));
  assert.ok(s.s.includes('HVAC & Utility Systems') && s.t.includes('Plant Engineer') && s.t.includes('Energy Efficiency Engineer'));
  const f = sqlite.prepare('SELECT primary_skills p, secondary_skills s FROM candidates WHERE id=?').get('farhan_shaikh');
  assert.equal(f.p, '["Electrical Maintenance"]', 'another candidate is untouched'); assert.equal(f.s, null);
  // a hand edit afterwards is not undone by a later release
  sqlite.prepare(`UPDATE candidates SET primary_skills='["Only This"]' WHERE id='sana_ansari'`).run();
  sqlite.exec(m17);
  assert.deepEqual(get('sana_ansari').p, ['Only This']);
});

test('inspection panel: a discovery row (quick screen only) is told apart from a fully assessed one', async () => {
  const { isQuickScreen } = await import('../frontend/src/quickScreen.ts');
  assert.equal(isQuickScreen({ preliminary: true, matched_skills: ['Reliability'] }), true);
  assert.equal(isQuickScreen({ preliminary: true, experience_assessment: { status: 'MET' } }), false);
  assert.equal(isQuickScreen({ preliminary: true, skill_matches_detailed: [{ skill: 'x' }] }), false);
  assert.equal(isQuickScreen({ primary_ratio: 0.5 }), false, 'older rows without the preliminary flag keep the full panel');
  assert.equal(isQuickScreen(null), false); assert.equal(isQuickScreen(undefined), false);
});
