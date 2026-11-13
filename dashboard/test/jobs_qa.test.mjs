// Jobs QA of 13 Nov (100 jobs per person, hand-judged): the scoring gaps it found, one test per finding. Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { evaluate, avoidedTitle, foreignLocation, gulfPlace, abroadByDescription, onsiteByText, yearsRequired, yearsCeiling, sanaTitleSkills, targetFit,
  bareForeignCode, AVOID_TITLE_CAP, UNDER_LEVEL_CAP, VISA_UNLIKELY_CAP } from '../worker/discovery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const farhan = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation']), total_years_experience: 9,
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Revenue Operations Specialist', 'Solutions Implementation']) };
const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance']), total_years_experience: 9,
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)', 'Power Plant Operations Engineer', 'Energy Efficiency Engineer']) };
const CRM = 'Configure the CRM and build workflow automation for customers.';
const PLANT = 'Preventive maintenance and reliability of boilers, turbines and pumps at a thermal power plant. '.repeat(3);
const ev = (cand, title, location, description = '', remote = /remote/i.test(location)) =>
  evaluate(cand, { id: 'x', title, company: 'Acme', url: 'https://e.com/x', location, description, remote });

test('Farhan: remote within another country or region is ruled out like the US; India, APAC and worldwide wording still count', () => {
  for (const loc of ['Remote (Mexico)', 'Remote (Romania)', 'Remote (United Kingdom)', 'Germany', 'Remote - EMEA', 'Remote (Johannesburg, South Africa)']) {
    const r = ev(farhan, 'Implementation Consultant', loc, CRM, true);
    assert.equal(r.eligibility, 'INELIGIBLE', loc); assert.equal(r.status, 'INELIGIBLE', loc); assert.match(r.reason, /another country or region only/, loc);
  }
  for (const loc of ['Remote, India', 'India (Remote)', 'Remote - APAC', 'Remote (Worldwide)', 'Anywhere', 'Remote'])
    assert.notEqual(ev(farhan, 'Implementation Consultant', loc, CRM, true).eligibility, 'INELIGIBLE', loc);
  assert.notEqual(ev(farhan, 'Implementation Consultant', 'Remote (Germany)', CRM + ' We hire remotely in India and Germany.', true).eligibility, 'INELIGIBLE', 'the text names India');
  assert.notEqual(ev(farhan, 'Implementation Consultant', 'Remote (Germany)', CRM + ' Remote worldwide, any time zone.', true).eligibility, 'INELIGIBLE', 'the text says worldwide');
  // Sana is not affected (she may relocate)
  assert.notEqual(ev(sana, 'Reliability Engineer', 'Remote (United Kingdom)', PLANT, true).status, 'INELIGIBLE');
});

test('Farhan: titles of other fields are capped, and operations / solutions / architect alone no longer make a title close to his targets', () => {
  for (const t of ['Senior Solutions Architect', 'Engineering Manager - Solutions Engineering', 'Infrastructure Operations Engineer', 'Staff Engineer - CRM & Automation',
    'Sr. Product Manager - Integrations', 'Territory Operations Manager', 'Senior ATQC - Automation Frameworks', 'Commercial Operations Specialist'])
    assert.ok(ev(farhan, t, 'Remote - India', CRM).score <= AVOID_TITLE_CAP, t);
  for (const t of ['Commercial Operations Specialist (RevOps)', 'Implementation Manager', 'Technical Operations Lead', 'Revenue Operations Specialist', 'Solutions Consultant'])
    assert.ok(!avoidedTitle('farhan_shaikh', t), t);
  const generic = new Set(['senior', 'lead', 'manager', 'engineer', 'specialist', 'technical', 'operations', 'solutions', 'architect']);
  assert.equal(targetFit('Infrastructure Operations Engineer', farhan.target_roles, generic), null);
  assert.equal(targetFit('CRM Implementation Lead', farhan.target_roles, generic), 'word');
  assert.match(ev(farhan, 'Infrastructure Automation Lead', 'Remote - India', CRM).qualification_reason, /^(?!.*close to one of)/s, 'no +4 for a shared "operations"');
  assert.match(ev(farhan, 'Revenue Operations Manager', 'Remote - India', CRM).qualification_reason, /close to one of the candidate's target roles/, 'a distinctive word still counts');
  // Sana keeps 'operations' as a word of her targets ('Power Plant Operations Engineer')
  assert.equal(targetFit('Operations Engineer', sana.target_roles), 'word');
});

test('on-site and hybrid wording in the posting wins over the source\'s remote flag', () => {
  for (const d of ['The position is based in Bengaluru, India.', 'Great team. #LI-Onsite', '#LI-Hybrid', 'Hybrid working with two days a week from our London office.', 'You will work 3 days a week at our Pune office.'])
    assert.equal(onsiteByText(d), true, d);
  for (const d of ['This position is based in India and is fully remote.', 'The position is based remotely in India.', 'We offer flexible hybrid working and a home office budget.',
    'This is not a hybrid role; the position is fully remote.', 'You will travel to customer sites two days a month.', ''])
    assert.equal(onsiteByText(d), false, d);
  const carcutter = ev(farhan, 'Customer Support & Automation Lead', 'Bengaluru, Karnataka, India', CRM + ' The position is based in Bengaluru.', true);
  assert.equal(carcutter.eligibility, 'INELIGIBLE'); assert.match(carcutter.reason, /remote/i);
  const xelix = ev(farhan, 'Senior Partner Implementations Consultant', 'London, United Kingdom', CRM + ' Hybrid working with two days a week from our London office.', true);
  assert.equal(xelix.eligibility, 'INELIGIBLE');
  assert.equal(ev(farhan, 'Implementation Manager', 'Bengaluru, Karnataka, India', CRM + ' The position is based in India and is fully remote.', true).eligibility, 'ELIGIBLE');
  // for Sana, an on-site job abroad stored as remote is on site: the visa-route cap applies
  assert.ok(ev(sana, 'Reliability Engineer', 'Houston, TX', PLANT + ' #LI-Onsite', true).score <= VISA_UNLIKELY_CAP);
});

test('the daily import stores a posting whose text places it in an office as on site, not remote', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-'));
  const S = 'sana_ansari';
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify([{ id: S, primary_skills: sana.primary_skills, target_roles: sana.target_roles, total_years_experience: 9, search_profile: null }]));
  const j = (id, description) => ({ id, url: `https://example.com/${id}`, title: 'Reliability Engineer', company: 'Co ' + id, ats_type: 'lever', location: 'Pune, India', is_remote: true, description, candidates: [S] });
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ jobs: [j('ds:q:1', PLANT + ' The position is based in Pune.'), j('ds:q:2', PLANT + ' Fully remote.')] }));
  execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/dataset_apply.mjs', '--candidates', path.join(dir, 'candidates.json'), '--in', path.join(dir, 'm.json'), '--out', path.join(dir, 'a.sql')], { cwd: root });
  const { sqlite } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id,full_name) VALUES (?, 'S')`).run(S);
  sqlite.exec(fs.readFileSync(path.join(dir, 'a.sql'), 'utf8'));
  const wt = Object.fromEntries(sqlite.prepare('SELECT id, workplace_type w FROM jobs').all().map((r) => [r.id, r.w]));
  assert.deepEqual(wt, { 'ds:q:1': 'ONSITE', 'ds:q:2': 'REMOTE_RESTRICTED' });
});

test('experience asks: "12+ years in software engineering" and decimals are read', () => {
  assert.equal(yearsRequired('You bring 12+ years in software engineering and hands-on architecture.'), 12);
  assert.equal(yearsRequired('8 years of plant maintenance.'), 8);
  assert.equal(yearsRequired('1.5+ years of experience in sales operations.'), 1.5);
  assert.equal(yearsRequired('Founded 12 years ago; 20 years in business.'), 0, 'company age is not an ask');
  assert.equal(yearsRequired('We need 5+ years of experience in CRM.'), 5);
  assert.equal(yearsCeiling('1-1.5 years of experience in GTM operations'), 1.5);
  assert.equal(yearsCeiling('2 to 4 years'), 4);
  const turing = ev(farhan, 'Technical Delivery Lead', 'India - Remote', CRM + ' 12+ years in software engineering.');
  assert.match(turing.qualification_reason, /Asks for 12\+ years/); assert.ok(turing.score < 70, 'kept below his threshold');
  assert.ok(ev(farhan, 'GTM Operations', 'India - Remote', CRM + ' 1-1.5 years of experience.').score <= UNDER_LEVEL_CAP, 'pitched well below 9 years');
});

test('Sana: wrong-field titles (segment manager, IT technical consultants) are capped; her own consultant titles are not', () => {
  for (const t of ['Segment Manager - Power Generation', 'Java + Angular- Senior Technical Consultant', 'Azure Databricks - Lead Technical Consultant', 'Snowflake+DBT_Lead Technical Consultant',
    'SFMC -Technical Consultant', 'Senior Technical Consultant - Security GRC', 'Technical Consultant – Shift Lead (Devices Tenant Migration)', 'Senior Technical Consultant'])
    assert.ok(avoidedTitle('sana_ansari', t), t);
  for (const t of ['Technical Consultant - Power Plants', 'Energy Technical Consultant', 'Technical Consultant – Water Treatment', 'Reliability Engineer', 'Maintenance Manager'])
    assert.ok(!avoidedTitle('sana_ansari', t), t);
  // live shortlist review: consulting / IT architecture and marine or yacht electrical posts
  for (const t of ['IN_Manager_Business Architect /Digital Architecture _Energy resilience and Decarbonisation_Advisory_Gurgaon', 'Enterprise Architect - Utilities', 'Marine Electrical Engineer', 'Yacht Electrician'])
    assert.ok(avoidedTitle('sana_ansari', t), t);
});

test('Sana: design and study posts rank below maintenance and O&M posts, and stay on the list', () => {
  const design = ev(sana, 'Primary Design Engineer - Electrical', 'Savli, Gujarat, India', PLANT), study = ev(sana, 'Power System Study Senior Expert', 'Mumbai, India', PLANT);
  const maint = ev(sana, 'Maintenance Engineer', 'Savli, Gujarat, India', PLANT);
  assert.match(design.qualification_reason, /Design or study role/); assert.match(study.qualification_reason, /Design or study role/);
  assert.ok(design.score < maint.score && study.score < maint.score);
  assert.ok(study.score > AVOID_TITLE_CAP, 'reduced, not capped');
  assert.doesNotMatch(ev(sana, 'Maintenance Design Engineer', 'Savli, Gujarat, India', PLANT).qualification_reason, /Design or study role/);
});

test('US places in the forms the rules missed: "AR - Little Rock", and "nationwide", dollar salaries or "City, ST" in the text', () => {
  for (const l of ['AR - Little Rock', 'TX - Houston', 'Little Rock, AR']) assert.equal(foreignLocation(l), true, l);
  for (const l of ['TN - Chennai', 'MH - Pune', 'GA - Panaji, Goa', 'Pune, India']) assert.equal(foreignLocation(l), false, l);
  assert.equal(abroadByDescription('48 Locations', 'Commissioning manager for utility-scale solar, travel nationwide.'), true);
  assert.equal(abroadByDescription('3 Locations', 'Boiler and machinery inspections. Pay range $85,000 - $110,000.'), true);
  assert.equal(abroadByDescription('', 'Based at our office in Little Rock, AR.'), true);
  for (const d of ['CTC ₹12,00,000 per annum. Rs. 50,000 a month.', 'Sites in Pune, MH and Chennai, TN; nationwide presence across India.', 'Reduce CO2, NOx and SOx emissions.', ''])
    assert.equal(abroadByDescription('3 Locations', d), false, d);
  assert.ok(ev(sana, 'Risk Control Consultant Boiler and Machinery', 'AR - Little Rock', PLANT).score <= VISA_UNLIKELY_CAP);
});

test('bare two-letter country codes from the job-site feed: abroad unless an Indian state code; "SA" alone is the Gulf', () => {
  for (const c of ['SE', 'EG', 'UZ', 'DE', 'SA', 'US']) assert.equal(foreignLocation(c), true, c);
  for (const c of ['IN', 'MH', 'KA', 'TN', 'GJ', 'MP', 'OR', 'HP', 'AP', 'UP', 'DL', 'WB', 'Se', 'sa', 'ABC']) assert.equal(foreignLocation(c), false, c);
  assert.equal(bareForeignCode(' SE '), true); assert.equal(bareForeignCode('MH, India'), false);
  for (const c of ['SA', 'AE', 'QA', ' SA ']) assert.equal(gulfPlace(c), true, c);
  for (const c of ['Adelaide, SA', 'Johannesburg, SA', 'SAS']) assert.equal(gulfPlace(c), false, c);
  assert.ok(ev(sana, 'Senior Electrical Engineer', 'EG', PLANT).score <= VISA_UNLIKELY_CAP, 'Egypt with no visa route');
  assert.ok(ev(sana, 'Reliability Engineer', 'SE', PLANT).score <= VISA_UNLIKELY_CAP, 'Sweden with no visa route');
  assert.ok(ev(sana, 'Reliability Engineer', 'SA', PLANT).score > VISA_UNLIKELY_CAP, 'Saudi Arabia is a Gulf route');
  assert.ok(ev(sana, 'Reliability Engineer', 'MH', PLANT).score > VISA_UNLIKELY_CAP, 'an Indian state code is India');
});

test('Sana: operator and field officer posts are below her level; her own operations-engineer target is not', () => {
  for (const t of ['Field Operator - Turbine', 'Control Room Operator', 'Boiler Operators', 'Field Officer - Power Plant'])
    assert.ok(ev(sana, t, 'Dahej, Gujarat, India', PLANT).score <= UNDER_LEVEL_CAP, t);
  for (const t of ['Power Plant Operations Engineer', 'Reliability Engineer - Grid Operator', 'Maintenance Engineer'])
    assert.ok(ev(sana, t, 'Dahej, Gujarat, India', PLANT).score > UNDER_LEVEL_CAP, t);
});

test('Sana: a posting with no (or a very short) description counts the field phrases in its title as skills, at most two', () => {
  assert.deepEqual(sanaTitleSkills('Deputy Manager - Operations & Maintenance', []), ['O&M']);
  assert.deepEqual(sanaTitleSkills('Energy Audit & ESCO Project Manager', []), ['Energy Audit', 'Energy Efficiency']);
  assert.deepEqual(sanaTitleSkills('Reliability Engineer II', ['Reliability']), [], 'not counted twice');
  const bare = ev(sana, 'O&M Engineer – Adani Power Raigarh', 'Raigarh, Chhattisgarh, India', '');
  assert.ok(bare.skills.includes('O&M') && bare.score >= 60, `an exact-field title reaches her threshold with no description (${bare.score})`);
  const dm = ev(sana, 'Deputy Manager - Operations & Maintenance', 'Raigarh, Chhattisgarh, India', '');
  assert.ok(dm.score >= 60, `${dm.score}`);
  const long = ev(sana, 'Deputy Manager - Operations & Maintenance', 'Raigarh, Chhattisgarh, India', 'Office administration. '.repeat(40));
  assert.ok(!long.skills.includes('O&M'), 'a full description is judged on its own words');
  assert.ok(ev(sana, 'Office Manager', 'Raigarh, Chhattisgarh, India', '').skills.length === 0, 'a title outside her field gains nothing');
  assert.ok(ev(sana, 'Segment Manager - Power Plant O&M', 'Raigarh, Chhattisgarh, India', '').score <= AVOID_TITLE_CAP, 'the avoid list still wins');
});
