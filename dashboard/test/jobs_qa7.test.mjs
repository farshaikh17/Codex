// Jobs QA 7 (20 Nov): every job on both live lists (80) re-judged by two reviewers; 33 should not have been shown. Each rule has positive cases in
// paraphrased wording and the near misses that keep their score. Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, internalOnly, usRemoteByText, officeByPlaceText, farhanEngineeringField, farhanBelowLevel, farhanStretchOnly, sanaOtherProfession,
  sanaStretchOnly, sanaAbroadUnread, foreignLocation, postingUrlKey, AVOID_TITLE_CAP, UNDER_LEVEL_CAP, VISA_UNLIKELY_CAP, RULES_MARKER } from '../worker/discovery.ts';
import { selectShortlist, keepTwins, notRemoteFromIndia } from '../scripts/shortlist_select.mjs';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, total_years_experience: 9,
  primary_skills: JSON.stringify(['HubSpot', 'Workflow Automation', 'CRM Configuration', 'Zapier', 'Process Design', 'API Integrations']),
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Automation Specialist', 'Revenue Operations Specialist']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, total_years_experience: 9,
  primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis', 'Boilers', 'Turbines']),
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)']) };
const CRM = 'Own HubSpot workflow automation and CRM configuration, connect tools with Zapier and API integrations, and document every process design. '.repeat(3);
const INDIA = 'This is a fully remote role open to candidates based in India. ';
const PLANT = 'Lead preventive maintenance of boilers and turbines at our power plant, run root cause analysis on breakdowns, plan shutdowns and overhauls, and keep the utilities running. '.repeat(3);
const evF = (title, location, description, o = {}) => evaluate(farhan, { id: 'x', title, company: o.company || 'Acme', url: 'https://e.com/x', location, description, remote: o.remote ?? true, source: o.source || 'greenhouse', board: o.board });
const evS = (title, location, description, o = {}) => evaluate(sana, { id: 'x', title, company: o.company || 'Acme Power', url: 'https://e.com/x', location, description, remote: false, source: o.source || 'successfactors', board: o.board });
const FLOOR_F = farhan.qualification_threshold - 10, FLOOR_S = sana.qualification_threshold - 10;

test('marker: the rules changed, so every stored row is re-scored once (profile_v22, bumped again by later rule changes)', () => {
  assert.match(RULES_MARKER, /^profile_v(?:2[2-9]|[3-9]\d)$/);
});

test('both: a posting open only to the employer\'s own staff is ruled out; an open call is not', () => {
  for (const d of ['To encourage internal talent growth, we seek applications from interested employees for this role.', 'Internal candidates only.',
    'This vacancy is open to internal applicants only.', 'This is an internal posting.'])
    assert.ok(internalOnly(d), d);
  for (const d of ['We welcome applications from all qualified candidates.', 'Internal candidates are also encouraged to apply.', 'This role is not open to internal candidates only; anyone may apply.',
    'Our employees enjoy flexible hours.'])
    assert.equal(internalOnly(d), false, d);
  assert.equal(evS('Deputy Manager - Maintenance', 'Pune, India', PLANT + 'We seek applications from interested employees for this role.').eligibility, 'INELIGIBLE');
  assert.equal(evF('Implementation Manager', 'Remote - India', CRM + INDIA + 'Internal candidates only.').eligibility, 'INELIGIBLE');
  assert.notEqual(evS('Deputy Manager - Maintenance', 'Pune, India', PLANT).eligibility, 'INELIGIBLE');
});

test('Farhan: the text keeps the job in the United States whatever an aggregator\'s worldwide tag says; India, a global hiring line or an employer\'s Indian place wins', () => {
  for (const d of ['Headquarters: Burlington, MA OR US Remote. ' + CRM, CRM + 'LOCATION Remote position within the United States, with occasional travel to our office.',
    CRM + 'The US base salary range for this role is $130K-$200K. We offer a comprehensive US benefits package and a 401(k) match.', CRM + 'Remote-US.'])
    assert.ok(usRemoteByText(d), d);
  for (const d of [CRM + 'We hire globally; 401(k) for US staff.', CRM + 'Remote position within the United States or India.', CRM + 'You do not need to be US Remote; anywhere works.',
    CRM + 'Our customers are mostly in the US.', CRM + 'We are remote-first across APAC; US benefits for US hires.'])
    assert.equal(usRemoteByText(d), false, d);
  assert.equal(evF('Technical Program Manager, Customer Onboarding', 'Anywhere in the World', 'Headquarters: Burlington, MA OR US Remote. ' + CRM + 'Generous 401k match.', { source: 'weworkremotely' }).eligibility, 'INELIGIBLE');
  assert.equal(evF('Implementation Manager', 'Fully Remote', CRM + 'LOCATION Remote position within the United States.', { source: 'ashby' }).eligibility, 'INELIGIBLE');
  assert.equal(evF('Marketing Operations', 'Remote (Worldwide)', CRM + 'The US base salary range for this role is $130K-$200K, with a comprehensive US benefits package.', { source: 'realworkfromanywhere' }).eligibility, 'INELIGIBLE');
  // near misses: the employer's own place names India (an aggregator's does not count), or the text hires from India
  assert.notEqual(evF('Implementation Manager', 'Remote - India', CRM + 'We offer a 401(k) plan to US staff.', { source: 'lever' }).eligibility, 'INELIGIBLE');
  assert.equal(evF('Implementation Manager', 'Remote, India', CRM + 'Remote-US.', { source: 'indeed' }).eligibility, 'INELIGIBLE');
  assert.notEqual(evF('Implementation Manager', 'Anywhere in the World', CRM + 'Remote within the United States, Canada or India.', { source: 'weworkremotely' }).eligibility, 'INELIGIBLE');
});

test('Farhan: a "<City> Office" place, a hybrid Location line, a Workday office type and "Work Location: <city>" with office working are not remote', () => {
  assert.equal(evF('GTM Engineer', 'Bengaluru Office', CRM + INDIA).eligibility, 'INELIGIBLE');
  assert.notEqual(evF('GTM Engineer', 'Remote (home office), India', CRM + INDIA).eligibility, 'INELIGIBLE');
  for (const d of ['Job description: GTM Engineer. Location: Bangalore, Hybrid. ' + CRM, CRM + 'Remote type: Hybrid: Work in Office Part-Time.',
    'We offer a blended approach to office working, encouraging you to connect in one of our thriving offices. ' + CRM + 'Work Location : Pune , Maharashtra, India.'])
    assert.ok(officeByPlaceText(d), d);
  for (const d of ['Location: Bangalore (Remote). ' + CRM, 'We offer a blended approach to office working for our office teams. ' + CRM + 'Work Location: Remote, India.',
    CRM + 'Work Location: Pune. You will work from home.', 'Location: Remote; this is not a hybrid role. ' + CRM])
    assert.equal(officeByPlaceText(d), false, d);
  assert.equal(evF('GTM Engineer, Digital Workers', 'Remote, India', 'Location: Bangalore, Hybrid. ' + CRM).eligibility, 'INELIGIBLE');
  assert.equal(evF('ERP & Integration Specialist', 'India Remote', 'We offer a blended approach to office working. ' + CRM + 'Work Location: Pune, Maharashtra, India.').eligibility, 'INELIGIBLE');
});

test('Farhan: an engineering seat asking real programming, telecom radio specialism or ERP administration in years is another field (capped below Worth a try)', () => {
  for (const d of ['We need not only an exceptional developer but a product thinker.', '3+ years of back-end development experience in at least one programming language.',
    '5+ years of software or integration engineering experience.', '12+ years in software engineering or technical consulting.', 'Strong programming skills in Python, JavaScript/TypeScript.',
    'Strong Python programming and REST API skills.'])
    assert.equal(farhanEngineeringField('AI Automation Engineer', CRM + d), 'software engineering', d);
  assert.equal(farhanEngineeringField('Customer Solutions Manager', CRM + 'You have a strong history with Telecom RF & Machine Learning.'), 'telecom radio (RF) specialist');
  assert.equal(farhanEngineeringField('ERP & Integration Specialist', CRM + '5+ years of dual functional and technical NetSuite administration.'), 'finance ERP administration');
  for (const d of ['Light scripting in Python or JavaScript is a plus.', '2+ years of experience with low-code automation tools.', 'Experience with NetSuite implementation projects.',
    'You do not need software engineering experience; 3+ years of operations experience.', 'Experience with RF tags in a warehouse.', 'Strong proficiency in JavaScript.'])
    assert.equal(farhanEngineeringField('Automation Specialist', CRM + d), null, d);
  const r = evF('Sr. AI/Automation Engineer', 'Remote - India', CRM + INDIA + '3+ years of back-end development experience.');
  assert.ok(r.score <= AVOID_TITLE_CAP && r.score < FLOOR_F, `${r.score}`);
  assert.match(r.qualification_reason, /software engineering work/);
});

test('Farhan: a recent-graduate post and a 2-year outreach specialist post are below his level', () => {
  assert.equal(farhanBelowLevel('Solutions Consultant', 'Recent graduate or early-career candidate in Computer Science.', 0), 'a recent-graduate or early-career post');
  assert.equal(farhanBelowLevel('Onboarding Specialist', '2+ years in customer onboarding. Remote with high email and phone volume.', 0), 'an outreach post asking at most 2 years');
  for (const [t, d, n] of [['Solutions Consultant', 'You will mentor early-career team members.', 0], ['Senior Onboarding Specialist', '2+ years. High email and phone volume.', 0],
    ['Onboarding Specialist', '5+ years in customer onboarding. High email and phone volume.', 0], ['Onboarding Specialist', '2+ years in customer onboarding of enterprise accounts.', 0],
    ['Implementation Manager', 'We do not hire recent graduates for this role.', 0]])
    assert.equal(farhanBelowLevel(t, d, n), null, `${t}: ${d}`);
  const r = evF('Onboarding Specialist', 'Remote - India', CRM + INDIA + '2+ years in customer onboarding. Remote with high email and phone volume.');
  assert.ok(r.score <= UNDER_LEVEL_CAP, `${r.score}`);
});

test('Farhan: an SQL/BI analyst, a Salesforce developer, a certified-iPaaS and a coding pre-sales seat stay a stretch (Worth a try at most)', () => {
  assert.equal(farhanStretchOnly('Sr. Revenue Operations Analyst', 'Advanced proficiency in SQL; experience with a BI tool (Tableau, Looker).'), 'an SQL and BI reporting post');
  assert.equal(farhanStretchOnly('Sales & Marketing Operations Manager', 'Hands-on proficiency with Salesforce Flow, Apex, SOQL and Lightning Web Components.'), 'a Salesforce developer seat (Apex)');
  assert.equal(farhanStretchOnly('Senior Workato Integration Engineer', 'Workato certification required (Automation Pro or higher).'), 'an integration post that requires a vendor certification');
  assert.equal(farhanStretchOnly('Solutions Engineer', 'Strong proficiency in JavaScript and SQL.'), 'a technical seat asking strong programming proficiency');
  for (const [t, d] of [['Revenue Operations Manager', 'Advanced SQL; experience with a BI tool.'], ['Revenue Operations Analyst', 'Build dashboards in HubSpot.'],
    ['Salesforce Operations Manager', 'Configure Salesforce Flow; Apex is not required.'], ['Integration Engineer', 'Workato certification preferred.'], ['Integration Engineer', 'A Workato certification is a plus.']])
    assert.equal(farhanStretchOnly(t, d), null, `${t}: ${d}`);
  const r = evF('Senior Workato Integration Engineer', 'India (Remote)', CRM + INDIA + 'Workato certification required.');
  assert.equal(r.eligibility, 'ELIGIBLE');
  assert.ok(r.score === farhan.qualification_threshold - 1, `${r.score}`);
  assert.match(r.qualification_reason, /a stretch, kept off Best matches/);
  // a job-board row is stored unconfirmed (already Worth a try at most): not capped, so it is not hidden
  const b = evF('Senior Workato Integration Engineer', 'India (Remote)', CRM + INDIA + 'Workato certification required.', { board: true });
  assert.ok(b.score >= farhan.qualification_threshold, `${b.score}`);
});

test('Sana: other professions that share her words are capped below Worth a try', () => {
  const cases = [
    ['Implementation Engineer - Renewable Energy', 'Lead the implementation of our AI-powered industrial analytics platform and configure analytical models.', 'software platform implementation'],
    ['Building Performance & Energy Analytics Engineer', 'Energy analytics for buildings.', 'data and analytics'],
    ['Energy Engineer', 'Publish dashboards in Power BI and Tableau from AWS and Azure IoT data.', 'data and analytics'],
    ['Lead Electrical & Instrumentation Engineer', '8-15 years of design and project execution experience in an engineering or product-based organization.', 'design, product or consultancy'],
    ['Maintenance Lead', 'Oversee maintenance across all outlets: QSR, restaurants, cafés and retail.', 'retail and restaurant upkeep'],
    ['Plant Manager', 'Manage the construction plant and equipment used in oil and gas projects.', 'construction equipment fleet'],
    ['Electrical Specialist - Crane Maintenance', 'Expertise in RTG, RMG and STS crane electrical systems at a container terminal.', 'container-terminal cranes'],
    ['Lead - Field Instrumentation', "Bachelor's degree in C&I or Electronics & Communication.", 'control and instrumentation'],
    ['Deputy Manager - SCADA', 'We are seeking an OT cybersecurity expert: implement VPNs and firewalls; CERT-In directives.', 'OT cybersecurity'],
    ['Mechanical Maintenance Engineer', 'Spindle overhauling, ball screws and LM guides, machine geometry and backlash correction.', 'machine-tool (CNC) overhaul'],
  ];
  for (const [t, d, want] of cases) {
    assert.equal(sanaOtherProfession(t, PLANT + d), want, t);
    const r = evS(t, 'Pune, India', PLANT + d);
    assert.ok(r.score <= AVOID_TITLE_CAP && r.score < FLOOR_S, `${t}: ${r.score}`);
  }
  for (const [t, d] of [['Implementation Engineer - Commissioning', 'Commission boilers on site.'], ['Reliability Engineer', 'Report KPIs on a dashboard.'],
    ['Maintenance Manager', 'Plant maintenance in a cement plant; product quality.'], ['Maintenance Engineer', 'Maintain the plant canteen and retail store.'],
    ['Lead - Field Instrumentation', "Bachelor's degree in Electrical Engineering."], ['Lead Electrical & Instrumentation Engineer', "Bachelor's degree in C&I or Electronics & Communication."],
    ['SCADA Engineer', 'Cybersecurity awareness for plant staff.'], ['Mechanical Maintenance Engineer', 'Replace bearings on the spindle of the coal mill.'],
    ['Maintenance Engineer', 'Maintain the crane at the turbine hall (EOT crane).']])
    assert.equal(sanaOtherProfession(t, PLANT + d), null, `${t}: ${d}`);
});

test('Sana: discrete-line machine work, a narrow specialism, building facilities, a licence trade post, a head title or a stated ceiling stay a stretch', () => {
  const cases = [
    ['Assistant Manager - Electrical Maintenance', 'CNC grinding machines, VMC & HMC, servo motors and drives; read PLC ladder logic.', 'Acme', 'machine and robot-line maintenance in discrete manufacturing'],
    ['Deputy Manager - Wind O & M', 'The Deputy Manager - Converter Specialist troubleshoots converters, IGBTs and DC links.', 'Acme', 'a power-electronics converter specialism'],
    ['Assistant Manager - Reliability Engineering', 'Certification: Vibration Analyst Level II or above.', 'Acme', 'a vibration-analyst certification'],
    ['Field Service Engineer-HVDC', 'Maintain HVDC converter stations.', 'Acme', 'HVDC transmission service'],
    ['Commissioning Engineer - BESS', 'Commission battery systems.', 'Acme', 'battery storage'],
    ['Reliability Engineer', 'Reliability of our client buildings, BAS and EMS.', 'Jll', 'building facilities for a real-estate services firm'],
    ['Electrical Maintenance Engineer', 'Diploma in Electrical with "C" License.', 'Acme', 'an electrical-licence trade post'],
    ['Head Turbine & Auxiliaries', 'Grade M4.', 'Acme', 'a head, director or plant-manager post'],
    ['Senior Director, Energy & Utilities', 'Campus utilities.', 'Acme', 'a head, director or plant-manager post'],
    ['L3 Manager Utilities', 'Experience Minimum: 5 Maximum: 8.', 'Acme', 'a stated experience ceiling below her years'],
    ['Manager Utilities', 'Age Limit Minimum: 27 Maximum: 32.', 'Acme', 'an age limit'],
  ];
  for (const [t, d, co, want] of cases) {
    assert.equal(sanaStretchOnly(t, PLANT + d, co, 9), want, t);
    const r = evS(t, 'Pune, India', PLANT + d, { company: co });
    assert.equal(r.eligibility, 'ELIGIBLE', t);
    assert.ok(r.score <= sana.qualification_threshold - 1 && r.score >= FLOOR_S, `${t}: ${r.score} stays on Worth a try`);
  }
  for (const [t, d, co] of [['Maintenance Engineer', 'Maintain the CNC workshop lathe.', 'Acme'], ['Deputy Manager - Wind O & M', 'Turbine gearbox and blade maintenance.', 'Acme'],
    ['Reliability Engineer', 'Vibration analysis on rotating machinery.', 'Acme'], ['Field Service Engineer', 'Service HVDC and HVAC equipment.', 'Acme'],
    ['Reliability Engineer', 'Reliability of the boiler house buildings.', 'Acme Power'], ['Deputy Head - Maintenance', 'Lead the team.', 'Acme'], ['Head Office Maintenance Engineer', 'x', 'Acme'],
    ['Manager Utilities', 'Experience Minimum: 8 Maximum: 12.', 'Acme'], ['Manager Utilities', 'Average age of our fleet is 12 years.', 'Acme']])
    assert.equal(sanaStretchOnly(t, PLANT + d, co, 9), null, `${t}: ${d}`);
});

test('Sana: a supervisor post asking at most 4 years is below her level; one asking more, or an engineer-and-supervisor post, is not', () => {
  assert.ok(evS('Maintenance Supervisor', 'Pune, India', PLANT + "Bachelor's degree or 4+ years of applicable experience. 3+ years of experience.").score <= UNDER_LEVEL_CAP);
  assert.ok(evS('Maintenance Supervisor', 'Pantnagar, India', PLANT + '5+ years of experience in plant maintenance.').score > UNDER_LEVEL_CAP);
  assert.ok(evS('Electrical Engineer and Facilities Maintenance Supervisor', 'Doha, Qatar', PLANT + '3+ years of experience.').score > UNDER_LEVEL_CAP);
});

test('Sana: an abroad place the rules cannot read is abroad when the text, the employer\'s name or the source says so', () => {
  const capped = (loc, d, o) => evS('Maintenance Manager', loc, PLANT + d, o).score <= VISA_UNLIKELY_CAP;
  assert.ok(capped('Pessione', 'Salary Range from 50.000 to 60.000. Contractual Level CCNL Industria Alimentare.'), 'a European salary and an Italian contract');
  assert.ok(capped('Pantin', 'This role requires fluent English and good French proficiency would be an advantage.'), 'a European language asked');
  assert.ok(capped('', 'JOB TITLE: PLANT MANAGER Location: Port Harcourt. Daily operations of the plant.', { company: 'WorkNigeria' }), 'a country in the employer\'s name');
  assert.ok(capped('', 'Provides reliability engineering for chemical plant operations.', { company: 'Unknown', source: 'builtin' }), 'a builtin.com row with no place or employer');
  assert.ok(foreignLocation('San José') && foreignLocation('Zürich'), 'accents are read');
  // near misses: an Indian or Gulf place in the text, a known Indian place, an employer with a name, a description with no foreign cue
  assert.equal(sanaAbroadUnread('Kolind ka Bas', PLANT + 'Wind farm in Rajasthan, India.', 'ReNew', 'successfactors'), false);
  assert.equal(sanaAbroadUnread('', PLANT + 'Location: Pune.', 'Unknown', 'builtin'), false);
  assert.equal(sanaAbroadUnread('', PLANT, 'Evonik', 'builtin'), false);
  assert.equal(sanaAbroadUnread('Plant 3', PLANT, 'Acme', 'successfactors'), false);
  assert.ok(!capped('Pune, India', 'Salary Range from 50.000 to 60.000.'));
});

test('one posting URL across sources: tracking parameters, the host\'s www and a trailing slash do not count; the job\'s own parameters and fragment do', () => {
  const a = 'https://jobs.engie.com/job/Bap-Solar-Asset-Manager-State-Lead-342301/1376676255/', b = a + '?feedId=null&utm_source=J2WRSS&utm_medium=rss&utm_campaign=J2W_RSS';
  assert.equal(postingUrlKey(a), postingUrlKey(b));
  assert.equal(postingUrlKey('https://www.e.com/jobs/1?utm_source=x'), postingUrlKey('https://e.com/jobs/1/'));
  assert.notEqual(postingUrlKey('https://e.com/job-detail?gh_jid=1'), postingUrlKey('https://e.com/job-detail?gh_jid=2'));
  assert.notEqual(postingUrlKey('https://t.fa.em2.oraclecloud.com/?site_number=CX#1'), postingUrlKey('https://t.fa.em2.oraclecloud.com/?site_number=CX#2'));
  assert.equal(postingUrlKey('not a url'), '');
});

const NOW = Date.parse('2026-11-20T12:00:00Z'), FRESH = '2026-11-20T00:00:00Z';
const pool = (id, o = {}) => ({ kind: 'pool', candidate_id: 'sana_ansari', job_id: id, title: 'Solar Asset Manager- State Lead', company: 'ENGIE', stored_company: 'ENGIE', location: 'Bap, IN, 342301',
  workplace: 'ONSITE', source: 'successfactors', url: 'https://jobs.engie.com/job/1376676255/', description: 'x'.repeat(400), active: 1, score: 90, skill_score: 60, eligibility: 'ELIGIBLE',
  status: 'NEEDS_REVIEW', reason: 'Cloud discovery match.', threshold: 60, marked: 1, target_exact: 0, last_verified_at: FRESH, discovered_at: FRESH, ...o });
const picked = (rows, opts = {}) => selectShortlist(rows, { now: NOW, ...opts }).changes.filter((c) => c.to !== 'NEEDS_REVIEW').map((c) => c.job_id).sort();

test('selector: one posting stored twice (URLs differ only by tracking parameters, employer written two ways) is shown once; a careers page shared by two jobs is not merged', () => {
  const rows = [pool('ds:a'), pool('js:b', { company: 'ENGIE INFORMATION TECHNOLOGIES SA', stored_company: 'ENGIE INFORMATION TECHNOLOGIES SA', workplace: 'UNKNOWN',
    url: 'https://jobs.engie.com/job/1376676255/?feedId=null&utm_source=J2WRSS&utm_medium=rss' })];
  assert.equal(picked(rows).length, 1);
  assert.equal(keepTwins(rows, NOW).length, 1);
  const shared = [pool('p1', { title: 'Maintenance Engineer', url: 'https://e.com/careers' }), pool('p2', { title: 'Reliability Engineer', company: 'Other', stored_company: 'Other', url: 'https://e.com/careers' })];
  assert.deepEqual(picked(shared), ['p1', 'p2']);
});

test('selector: the employer\'s own record from today\'s still-open check keeps a hybrid, on-site or US-only job off Farhan\'s lists, not off Sana\'s', () => {
  assert.ok(notRemoteFromIndia({ workplace: 'HYBRID', countries: ['India'] }));
  assert.ok(notRemoteFromIndia({ workplace: 'REMOTE', countries: ['United States'] }));
  assert.equal(notRemoteFromIndia({ workplace: 'REMOTE', countries: ['India'] }), false);
  assert.equal(notRemoteFromIndia({ location: 'India' }), false);
  const f = (id) => pool(id, { candidate_id: 'farhan_shaikh', title: 'GTM Engineer ' + id, company: 'Co' + id, stored_company: 'Co' + id, threshold: 70, score: 85, workplace: 'REMOTE_RESTRICTED', location: 'India', url: `https://e.com/${id}` });
  const facts = { f1: { workplace: 'HYBRID', location: 'Bengaluru Office', countries: ['India'] }, f2: { workplace: 'REMOTE', countries: ['India'] }, s1: { workplace: 'ONSITE', countries: ['India'] } };
  assert.deepEqual(picked([f('f1'), f('f2'), pool('s1', { url: 'https://e.com/s1' })], { facts }), ['f2', 's1']);
});

// ---- review of PR #238 ----------------------------------------------------------------------------------------------------------------------
test('review: a folded place still reads as abroad ("España", "Österreich"), and accents are not needed', () => {
  for (const l of ['Madrid, España', 'Wien, Österreich', 'Espana', 'Osterreich', 'Türkiye']) assert.ok(foreignLocation(l), l);
  assert.equal(foreignLocation('Pune, India'), false);
});

test('review: "US" in US pay and benefits words is read in capitals only ("Why Join Us Benefits" is not a US package)', () => {
  assert.equal(usRemoteByText(CRM + 'Why Join Us Benefits: health cover and learning budget.'), false);
  assert.equal(usRemoteByText(CRM + 'Join us! Benefits for all.'), false);
  assert.ok(usRemoteByText(CRM + 'Benefits: a comprehensive US benefits package.'));
  assert.ok(usRemoteByText(CRM + 'The U.S. base salary range is $100K-$150K.'));
});

test('review: an employer named after a city or a word is not abroad; a recruiter or job board named for a country is', () => {
  for (const co of ['Phoenix Contact', 'Jordan Valves', 'Perth Engineering', 'Charlotte Systems', 'Austin Engineering', 'Georgia-Pacific'])
    assert.equal(sanaAbroadUnread('', PLANT, co, 'manatal'), false, co);
  for (const co of ['WorkNigeria', 'Jobs Kenya', 'Ghana Careers', 'Work in UK']) assert.ok(sanaAbroadUnread('', PLANT, co, 'manatal'), co);
  assert.ok(evS('Maintenance Manager', 'Chakan', PLANT, { company: 'Phoenix Contact' }).score > VISA_UNLIKELY_CAP, 'Phoenix Contact in India is not capped');
});

test('review: a remote or home-office place is not an office ("Remote: Home Office"); hybrid or on-site words still are', () => {
  assert.notEqual(evF('Implementation Manager', 'Remote: Home Office, India', CRM + INDIA).eligibility, 'INELIGIBLE');
  assert.notEqual(evF('Implementation Manager', 'India (work from home office)', CRM + INDIA).eligibility, 'INELIGIBLE');
  assert.equal(evF('Implementation Manager', 'Remote / Hybrid - Pune office, India', CRM + INDIA).eligibility, 'INELIGIBLE');
  assert.equal(evF('Implementation Manager', 'Pune Office', CRM + INDIA).eligibility, 'INELIGIBLE');
});

test('review: an internal-applicant instruction inside an open posting is not internal-only', () => {
  assert.equal(internalOnly('Internal applicants only need to notify their manager before applying.'), false);
  assert.equal(internalOnly('Internal candidates only have to submit a short form.'), false);
  assert.ok(internalOnly('Internal applicants only.'));
  assert.ok(internalOnly('This posting is for internal applicants only, as part of our talent programme.'));
});

test('review: an empty application-form label offers no visa route (MSD: "Relocation: VISA Sponsorship: Travel Requirements:"); a filled one still does', () => {
  const form = PLANT + 'Employee Status: Regular Relocation: VISA Sponsorship: Travel Requirements: Flexible Work Arrangements: Not Applicable';
  const r = evS('Plant Utilities Engineer', 'USA - New Jersey - Rahway', form);
  assert.notEqual(r.eligibility, 'ELIGIBLE');
  assert.ok(r.score <= VISA_UNLIKELY_CAP, `${r.score}`);
  assert.equal(evS('Plant Utilities Engineer', 'USA - New Jersey - Rahway', PLANT + 'Visa sponsorship available for this role.').eligibility, 'ELIGIBLE');
});

test('review: a US operating or stationary engineer is a licensed shift operator\'s trade, below her level; a plant or shift engineer is not', () => {
  for (const t of ['Power Plant - Operating Engineer I', 'Stationary Engineer, Plant Maintenance'])
    assert.ok(evS(t, 'Pune, India', PLANT).score <= UNDER_LEVEL_CAP, t);
  for (const t of ['Shift Engineer', 'Plant Operations Engineer', 'Operations & Maintenance Engineer'])
    assert.ok(evS(t, 'Pune, India', PLANT).score > UNDER_LEVEL_CAP, t);
});

test('review: power-system studies for a consultancy are design work, not plant O&M; a commissioning or maintenance title is not', () => {
  const studies = 'Perform steady-state and dynamic power system studies: load flow, short-circuit and voltage stability studies in PSS/E and DIgSILENT PowerFactory.';
  assert.equal(sanaOtherProfession('Senior Power Systems Engineer (APAC)', studies), 'design, product or consultancy');
  assert.ok(evS('Senior Power Systems Engineer', 'Noida, India', PLANT + studies).score <= AVOID_TITLE_CAP);
  assert.equal(sanaOtherProfession('Commissioning Engineer - Substations', studies), null);
  assert.equal(sanaOtherProfession('Electrical Maintenance Engineer', 'Carry out load flow checks with the grid operator.'), null);
});
