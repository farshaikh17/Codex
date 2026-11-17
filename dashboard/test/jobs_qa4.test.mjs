// Jobs QA 4 (17 Nov, every job on both live lists judged by two reviewers, an adjudicator and an auditor): the patterns behind the wrong rows on
// Best matches / Worth a try and the right rows hidden in To review, one test per rule, each with the near misses that must keep their place.
// Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, sanaOffField, sanaTradeTitle, languageHardRequired, gigEngagement, farhanOffField, worldwidePlace, sanaIndiaCity, foreignLocation,
  AVOID_TITLE_CAP, UNDER_LEVEL_CAP, LANGUAGE_HARD_GAP, FAR_ABOVE_GAP, VISA_UNLIKELY_CAP, RULES_MARKER } from '../worker/discovery.ts';
import { fitsStretchRule } from '../scripts/shortlist_select.mjs';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'Process Design']), total_years_experience: 9,
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Revenue Operations Specialist', 'Solutions Implementation']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis']), total_years_experience: 9,
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)', 'Power Plant Operations Engineer', 'Energy Efficiency Engineer']) };
const CRM = 'Configure the CRM, design processes and build workflow automation for customers. ';
const PLANT = 'Preventive maintenance, reliability and root cause analysis of boilers, turbines and pumps at a thermal power plant. '.repeat(3);
const ev = (cand, title, location, description = '', remote = /remote/i.test(location), extra = {}) =>
  evaluate(cand, { id: 'x', title, company: 'Acme', url: 'https://e.com/x', location, description, remote, ...extra });

test('marker: the rules changed, so every stored row is re-scored once (profile_v19)', () => {
  assert.equal(RULES_MARKER, 'profile_v19');
});

test('Sana: design, consultancy, product development, product-lab, civil, telecom and seagoing work is another field, read from the description', () => {
  const cases = [
    ['Senior Generator Specialist - Power Systems', 'Chennai, India', 'Join our energy consultancy. Responsible for tendering and detailed design of power plants, design packages and design calculations for synchronous condensers. Reliability of the design.'],
    ['Senior Electrical Engineer (Treatment Plants)', 'Ahmedabad, GJ, IN', 'Design (Concept, FEED and Detail Design) of electrical distribution systems for overseas water treatment plants. Prepare design drawings in AutoCAD. Preventive maintenance philosophy input.'],
    ['Senior Systems Engineer - Solar Trackers', 'Hyderabad, Telangana - IND', 'Support the development of single axis solar trackers: system architecture design, prototype builds and new product introduction (NPI). Reliability targets.'],
    ['Sr. Engineer Reliability Engineering', 'Pune, India', 'Lead product reliability testing and validation activities within the Reliability Lab: DFMEA, accelerated life tests. Root cause analysis of failures.'],
    ['Sr. Manager - Building, Utilities & Other Infra for Press Shop', 'Nagpur, IN', 'Execution of industrial buildings, press foundations, roads and drainage systems; civil works and structural steel for the greenfield utilities block.'],
    ['Manager - Operations & Maintenance', 'Baroda, IN', 'Ensure network uptime for radio and MW; BSS O&M for RAN equipment from Nokia and Ericsson; preventive maintenance of BTS sites.'],
    ['Senior Maintenance Engineer', 'Gulf of Mexico', 'Requires a USCG license as First Assistant Engineer, unlimited motor. Preventive maintenance of the engine room. ' + PLANT],
  ];
  for (const [t, loc, d] of cases) {
    assert.ok(sanaOffField(t, d), `${t}: read as another field`);
    const r = ev(sana, t, loc, d);
    assert.ok(r.score <= AVOID_TITLE_CAP, `${t}: ${r.score}`);
    assert.match(r.qualification_reason, /not the candidate's field/, t);
  }
  // near misses: plant maintenance that mentions a design review or one drawing tool, a commissioning role reading design documents
  for (const [t, loc, d] of [
    ['Maintenance Engineer', 'Bangalore, Karnataka', PLANT + ' Lead project scoping, detailed design and procurement strategy for shutdown jobs; spare parts and breakdown analysis.'],
    ['Senior Engineer - Electrical & Instrumentation', 'Kandla, GJ, in', PLANT + ' Knowledge of AutoCAD and interpretation of electrical drawings. Troubleshooting of PLC and SCADA.'],
    ['Lead Commissioning Engineer - Electrical', 'Doha, Qatar', 'Review electrical design drawings and design documents from design review to final handover; FEED familiarity. ' + PLANT],
    ['Plant Maintenance Supervisor', 'KA, India', PLANT + ' Our ingredients feed people and treat patients.']]) {
    assert.equal(sanaOffField(t, d), null, t);
    assert.ok(ev(sana, t, loc, d).score >= sana.qualification_threshold, t);
  }
});

test('Sana: titles of other job families are capped (procurement, quality, fleet, ESG, BIM, telecom, SAP, advisory); her own analyst titles are not', () => {
  for (const t of ['Buyer (Mechanical, Electrical & Industrial Parts)', 'Deputy Manager - Supplier Quality - Solar', 'Fleet Maintenance Manager', 'Restaurant Maintenance Supervisor',
    'IN-Specialist 3_ESG _Climate & Energy_Advisory_Pune', 'Senior Designer - BIM (Dry Utilities)', 'Manager - TM - BSS O&M', 'SAP S4 HANA Plant Maintenance Lead',
    'Senior Consultant - Energy and Infrastructure (Transactions) Advisory', 'AGM (Energy FP&A)', 'Analyst, Power and Renewables', 'Manager Procurement (Solar EPC)']) {
    assert.ok(sanaOffField(t, PLANT), t);
    assert.ok(ev(sana, t, 'Pune, India', PLANT).score <= AVOID_TITLE_CAP, t);
  }
  for (const t of ['Reliability Analyst', 'Senior Manager- Performance Analyst -Solar', 'Senior Specialist, Sustainability & Energy Solutions', 'Maintenance Manager', 'Utilities Engineer'])
    assert.equal(sanaOffField(t, PLANT), null, t);
});

test('Sana: chargeman, foreman, fitter, mechanic, electrician and O&M tech titles are below her level; supervisors and engineers are not', () => {
  for (const t of ['Chargeman 33KV, Solar Power Plant Operations', 'Maintenance Foremen - Electrical', 'Mechanical Fitters / Boilermakers', 'Power Plant Mechanic',
    'Power Plant Electrician', 'Operations and Maintenance Tech - Renewables', 'Artisan Boilermaker', 'Power Plant Lead Worker']) {
    assert.ok(sanaTradeTitle(t), t);
    const r = ev(sana, t, 'Riyadh, Saudi Arabia', PLANT);
    assert.ok(r.score <= UNDER_LEVEL_CAP, `${t}: ${r.score}`); assert.match(r.qualification_reason, /below the candidate's experience/, t);
  }
  for (const t of ['Maintenance Supervisor', 'Plant Maintenance Supervisor - Mechanical', 'Mechanic Maintenance Engineer', 'Electrical Maintenance Engineer', 'Maintenance Technical Manager']) {
    assert.ok(!sanaTradeTitle(t), t);
    assert.ok(ev(sana, t, 'Pune, India', PLANT).score >= sana.qualification_threshold, t);
  }
});

test('Both: a required language other than English keeps the job below the Worth-a-try floor; a welcomed one does not', () => {
  const tr = ev(sana, 'Utilities Engineer', 'Dubai, United Arab Emirates', PLANT + ' Strong written and verbal communication skills in both Turkish and English.');
  assert.ok(tr.score <= sana.qualification_threshold - LANGUAGE_HARD_GAP, String(tr.score)); assert.match(tr.qualification_reason, /Requires Turkish/);
  const pt = ev(farhan, 'Lead Solutions Engineer (Remote)', 'Remote, Worldwide', CRM.repeat(2) + ' Because of this focus, native or professional fluency in Portuguese is required, alongside excellent English.', true);
  assert.ok(pt.score <= farhan.qualification_threshold - LANGUAGE_HARD_GAP, String(pt.score)); assert.match(pt.qualification_reason, /Requires Portuguese/);
  assert.equal(languageHardRequired('Database Support Engineer (Japanese Speaking)', 'Support customers.'), 'Japanese');
  assert.equal(languageHardRequired('Process Automation Maintenance Engineer', 'Fluent Serbian and good English language knowledge.'), 'Serbian');
  // welcomed, not required; and 'Spanish speaking' in the text is not read as a requirement
  for (const d of ['Fluency in Arabic is an advantage.', 'Fluency in Spanish is a plus.', 'Business proficiency in Thai is preferred.', 'Our Spanish speaking customers love us.', 'Fluent English and Hindi.'])
    assert.equal(languageHardRequired('Reliability Engineer', d), null, d);
  assert.ok(ev(sana, 'Reliability Engineer', 'Dubai, United Arab Emirates', PLANT + ' Fluency in Arabic is an advantage.').score >= sana.qualification_threshold);
});

test('Both: part-time, freelance and independent-contractor gigs are capped (TYPE); benefits boilerplate and full-time roles are not', () => {
  for (const [t, d] of [
    ['Kajabi Website Development & Automation Virtual Assistant', 'Please review the Independent Contractor Opportunity outlined below. ' + CRM],
    ['RevOps Project Manager (Part-Time) for a B2B Agency', CRM],
    ['Finance Systems & Operations Lead', 'Type: Part-time / Fractional Contractor. Hours: Approximately 10-20 hours per week. ' + CRM],
    ['AI Automation Specialist for Podcast Production', 'This freelance opportunity is ideal for someone who combines automation and editing. ' + CRM],
    ['Revenue Operations Manager', 'Why this role is part-time, and what it becomes. ' + CRM]]) {
    assert.ok(gigEngagement(t, d), t);
    const r = ev(farhan, t, 'Remote, Worldwide', d, true);
    assert.ok(r.score <= AVOID_TITLE_CAP, `${t}: ${r.score}`); assert.match(r.qualification_reason, /Part-time, freelance or contractor/);
  }
  for (const d of ['Part-time employees who regularly work 20 or more hours per week are eligible for benefits. ' + CRM, 'This is a full-time, permanent role. ' + CRM, 'Coordinate freelancers and a small creative team. ' + CRM, 'Expect 40 hours per week. ' + CRM])
    assert.ok(!gigEngagement('Marketing Operations Manager', d), d);
});

test('Farhan: "Head of" is far above his level, like director and VP', () => {
  const r = ev(farhan, 'Head of AI Native Operations', 'Remote, Global — Remote', CRM.repeat(3), true);
  assert.ok(r.score <= farhan.qualification_threshold - FAR_ABOVE_GAP, String(r.score)); assert.match(r.qualification_reason, /head-of title, far above/);
  assert.ok(ev(farhan, 'Technical Operations Lead', 'Remote - India', CRM.repeat(3), true).score >= 70);
  // Sana's 'Head of' keeps plan S6 (just below her threshold)
  assert.equal(ev(sana, 'Head of Maintenance', 'Pune, India', PLANT).score, sana.qualification_threshold - 1);
});

test('Farhan: Linux / server operations and production AI engineering are other fields; his own operations and automation roles are not', () => {
  const ops = 'Provide technical support for business critical applications running on Linux based production environments. Perform Linux server health checks, CPU and disk utilization, '
    + 'network connectivity; analyse system logs; install, configure and operate the network and servers. ';
  assert.equal(farhanOffField('Operations Engineer', ops), 'infrastructure operations');
  assert.ok(ev(farhan, 'Operations Engineer', 'KA, India', ops + CRM, true).score <= AVOID_TITLE_CAP);
  const ai = 'Build and maintain RAG pipelines, vector stores, embeddings and retrieval workflows; fine-tune models. ';
  assert.equal(farhanOffField('AI Solutions Engineer (Generative AI & Agentic AI)', ai), 'AI software engineering');
  // near misses: his own titles with the same words, and an operations role that mentions servers once
  assert.equal(farhanOffField('AI Automation Engineer', ai + CRM), null);
  assert.equal(farhanOffField('Senior Implementation Engineer', ops), null);
  assert.equal(farhanOffField('Operations Engineer', 'Coordinate with NOC and network teams; one Linux server. ' + CRM), null);
});

test('Farhan: a remote posting whose title names India among its places is remote from India', () => {
  const r = ev(farhan, 'Marketing Automation Manager - Canada, Spain, India', 'Remote', CRM.repeat(2), true);
  assert.equal(r.eligibility, 'ELIGIBLE');
  assert.notEqual(ev(farhan, 'Marketing Automation Manager - Canada, Spain', 'Remote', CRM.repeat(2), true).eligibility, 'ELIGIBLE');
});

test('Farhan Stretch rule: an unconfirmed job-board row with a worldwide place qualifies like one naming India; "Remote" or "Fully Remote" alone does not', () => {
  const row = (location) => ({ candidate_id: 'farhan_shaikh', active: 1, marked: 1, skill_score: 40, score: 76, threshold: 70, eligibility: 'UNKNOWN', location, description: CRM });
  for (const l of ['Anywhere in the World', 'Remote (Worldwide)', 'Remote, Global', 'Remote (India)', 'Remote (Gurugram, India)']) assert.ok(fitsStretchRule(row(l)), l);
  for (const l of ['Remote', 'Fully Remote', 'Anywhere in the US', 'Global - EMEA', 'Remote - Europe']) assert.ok(!fitsStretchRule(row(l)), l);
  assert.ok(worldwidePlace('Worldwide')); assert.ok(!worldwidePlace('Remote - Canada (Global team)'));
  // Sana's unconfirmed rows are unchanged
  assert.ok(fitsStretchRule({ ...row('Riyadh, Saudi Arabia'), candidate_id: 'sana_ansari', threshold: 60 }));
});

test('Sana place: remote with no India, Asia or worldwide wording, and unread places with text abroad, are capped like on-site jobs abroad', () => {
  const us = ev(sana, 'Lead Engineer - Instrumentation & Controls - Gas Power Generation', 'Remote/Traveling (For Corporate Use Only)',
    PLANT + ' Deliver designs that comply with company, state, and federal regulations. Travel to project sites.', true);
  assert.ok(us.score <= VISA_UNLIKELY_CAP, String(us.score)); assert.match(us.qualification_reason, /nothing showing it is open to someone in India/);
  assert.ok(ev(sana, 'Reliability Engineer', 'Remote', PLANT + ' We hire across India and APAC.', true).score > VISA_UNLIKELY_CAP, 'remote and open to India');
  // an unread place whose text is American; a US state with no comma
  assert.ok(ev(sana, 'Plant Maintenance Engineer', 'Winona', PLANT + ' Pay: $85,000 a year. Little Rock, AR site visits.').score <= VISA_UNLIKELY_CAP);
  assert.ok(ev(sana, 'Engineering Operations Manager - Solar', 'Central Texas; +1 more', PLANT).score <= VISA_UNLIKELY_CAP);
  // an unread Indian town whose text names India is not capped; the Gulf is not capped
  assert.ok(ev(sana, 'Plant Maintenance Engineer', 'Arakkonam', PLANT + ' Our plant in Tamil Nadu, India.').score > VISA_UNLIKELY_CAP);
  assert.ok(ev(sana, 'Maintenance Supervisor', 'ABC-Dubai', PLANT).score > VISA_UNLIKELY_CAP);
  // Indian places written with a PIN code; a location with an underscore is still read
  for (const l of ['Bap, IN, 342301', 'Mandideep, MP, IN, 462 046', 'NASIK, NL, IN, 422113']) {
    assert.ok(sanaIndiaCity(l), l);
    assert.equal(ev(sana, 'Maintenance Manager', l, PLANT).eligibility, 'ELIGIBLE', l);
  }
  assert.ok(foreignLocation('DNU_United States - Remote')); assert.ok(foreignLocation('Brasil')); assert.ok(foreignLocation('Ypenburg, Nederlands'));
});
