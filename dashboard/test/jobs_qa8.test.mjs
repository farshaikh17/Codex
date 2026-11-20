// Jobs QA 8 (20 Nov, recall audit): good jobs the screen threw away or scored too low. 667 rejected postings were judged; the rules below lift the
// RIGHT ones without letting their near misses in. Each rule has positive cases in paraphrased wording and the near misses that keep their score.
// Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, foreignLocation, indianPlace, placeBand, SANA_ROLE, sanaCommissioningSkills, sanaPowerFieldService, sanaElectricalMaintenance,
  PLATFORM_GAP_CAP, VISA_UNLIKELY_CAP, RULES_MARKER } from '../worker/discovery.ts';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, total_years_experience: 9,
  primary_skills: JSON.stringify(['HubSpot', 'Workflow Automation', 'CRM Configuration', 'Zapier', 'Process Design', 'API Integrations']),
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Automation Specialist', 'Revenue Operations Specialist']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, total_years_experience: 9,
  primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis', 'Boilers', 'Turbines']),
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)']) };
const evS = (title, location, description, o = {}) => evaluate(sana, { id: 'x', title, company: o.company || 'Acme Industries', url: 'https://e.com/x', location, description, remote: false, source: o.source || 'successfactors' });
const evF = (title, location, description, o = {}) => evaluate(farhan, { id: 'x', title, company: o.company || 'Acme', url: 'https://e.com/x', location, description, remote: true, source: 'greenhouse' });
const FLOOR_S = sana.qualification_threshold - 10;
const pad = (s) => (s + ' ').repeat(2) + 'We offer a competitive package, medical cover and annual leave in line with local law. Applicants should send a CV in English.';

test('marker: the rules changed, so every stored row is re-scored once (profile_v23)', () => {
  assert.equal(RULES_MARKER, 'profile_v23');
});

test('place: "Town, <Indian state code>, IN" is India; a US state code without IN, and Indiana, are not', () => {
  for (const l of ['Cuddalore, TN, IN', 'Sriperumbudur, TN, IN, 602105', 'Gummidipundi, TN, IN', 'Nathana, PB, IN', 'Kurli, MH, in', 'Tarapur, MH, IN, 401 506'])
    { assert.equal(foreignLocation(l), false, l); assert.equal(indianPlace(l), true, l); assert.equal(placeBand('sana_ansari', l, null, false, ''), 'india_onsite', l); }
  for (const l of ['Nashville, TN', 'Memphis, TN, US', 'Austin, TX, US'])
    { assert.equal(foreignLocation(l), true, l); assert.equal(indianPlace(l), false, l); }
  assert.equal(indianPlace('Lafayette, IN'), false, 'Indiana stays unread here (indianaPlace decides it)');
  assert.equal(indianPlace('Coimbatore, TN'), true);
  const PLANT = pad('Plan preventive maintenance of the boilers and turbines in our continuous-process plant, lead root cause analysis of breakdowns and run the utilities.');
  const e = evS('Senior Engineer - Plant Maintenance', 'Cuddalore, TN, IN', PLANT);
  assert.doesNotMatch(e.qualification_reason, /abroad/, 'no visa cap on an Indian plant town');
  assert.ok(e.score > VISA_UNLIKELY_CAP, `${e.score}`);
});

test('place: "Little India" is a district of Singapore, not India; India itself still is', () => {
  assert.equal(indianPlace('Little India, Singapore'), false);
  assert.equal(foreignLocation('Little India, Singapore'), true);
  assert.notEqual(placeBand('sana_ansari', 'Little India, Singapore', null, false, ''), 'india_onsite');
  assert.equal(indianPlace('Singapore / India'), true);
  assert.equal(indianPlace('Pune, India'), true);
});

const MV = pad('Carry out site testing and commissioning of medium voltage switchgear, transformers and protection relays at substations; clear punch lists, run energisation and hand over to operations.');
const PRECOMM = pad('Lead pre-commissioning and commissioning of instruments, analysers and DCS loops on a refinery expansion: loop checks, start-up support and handover to the plant team.');
const OM = pad('Head the operations and maintenance of our solar and wind plants: availability, O&M contracts, spares and plant performance, and the handover of new assets from construction.');

test('Sana: plant commissioning, testing and O&M count as her work and rise to Worth a try', () => {
  for (const [title, place, d] of [['Senior Testing & Commissioning Engineer, Medium Voltage', 'Riyadh, Saudi Arabia', MV],
    ['Instrument Engineer (Pre Commissioning Field)', 'Abu Dhabi, United Arab Emirates', PRECOMM], ['Lead of Commissioning - Electrical', 'Doha, Qatar', MV],
    ['Senior Manager O&M', 'Pune, IN, 411014', OM], ['Project Manager - Pre-Commissioning & Maintenance', 'Abu Dhabi, AE', PRECOMM]]) {
    const skills = sanaCommissioningSkills(title, d);
    assert.ok(skills.length >= 1, `${title}: ${skills}`);
    const e = evS(title, place, d);
    assert.ok(e.skills.some((s) => skills.includes(s)), title);
    assert.ok(e.score >= FLOOR_S, `${title}: ${e.score}`);
  }
  // at most two such skills
  assert.ok(sanaCommissioningSkills('Commissioning and O&M Engineer', MV + OM).length <= 2);
});

test('Sana: pipeline, telecom, building-services, data-centre, software and services commissioning do not earn those skills', () => {
  for (const [title, d] of [
    ['Pipeline Commissioning Engineer', pad('Hydrotest, pigging and commissioning of cross-country gas pipelines and compressor stations.')],
    ['Telecom Commissioning Engineer', pad('Commissioning of BTS sites, fibre optic links and 5G radios across the network.')],
    ['BMS Commissioning Engineer', pad('Commissioning of BMS and HVAC plant in commercial buildings: chillers, AHUs and pumps.')],
    ['Commissioning Engineer', pad('Commissioning of HVAC and BMS systems for a hyperscale data centre; chillers, pumps and generators in a mission critical facility.')],
    ['Commissioning Engineer', pad('MEP commissioning for hospitals and hotels: HVAC, fire alarm and plumbing plant.')],
    ['Software Commissioning Engineer', pad('Commissioning of control software and SCADA screens for water plants.')],
    ['Service Director - People Commissioning', pad('Lead the commissioning of health and care services for the region.')],
    ['Commissioning Engineer', pad('Join our friendly team and grow your career with us.')],
  ]) assert.deepEqual(sanaCommissioningSkills(title, d), [], title);
  // a maintenance title is not a commissioning title (its score is unchanged by this rule)
  assert.deepEqual(sanaCommissioningSkills('Maintenance Engineer', MV), []);
  // and a telecom O&M post stays capped as another field
  const t = evS('O&M Engineer - Telecom', 'Dubai, UAE', pad('O&M of BSS and RAN sites; network uptime for Nokia and Ericsson equipment.'));
  assert.ok(t.score < FLOOR_S, `${t.score}`);
});

test('Sana: plant-discipline manager and engineer titles pass her role test', () => {
  for (const t of ['Deputy Manager - Mechanical', 'Assistant Manager – Mechanical', 'Sr. Manager (C&I)', 'Associate Manager- C&I Maintenance', 'Manager - Instrumentation',
    'Senior Manager - Electrical', 'Engineer - Mechanical', 'Mechanical Executive', 'Engineer - Maintenance', 'Executive (Maintenance)', 'Shift Engineer',
    'Maintenance Planning Engineer', 'Maintenance Scheduler', 'Rotating Equipment Engineer', 'Static Equipment Engineer', 'Senior Engineer (Reliability)'])
    assert.ok(SANA_ROLE.test(t), t);
  for (const t of ['Deputy Manager - Finance', 'Manager - Human Resources', 'Assistant Manager - Accounts', 'Executive Assistant', 'Senior Manager - Procurement Strategy',
    'Field Service Engineer'])
    assert.equal(SANA_ROLE.test(t), false, t);
  const PLANT = pad('Maintenance engineer for the mechanical side of our thermal power plant: boilers, turbines, coal handling; preventive maintenance, shutdown planning and root cause analysis.');
  const e = evS('Deputy Manager - Mechanical', 'Tamnar, Chhattisgarh, India', PLANT, { company: 'Acme Power' });
  assert.equal(e.status, 'NEEDS_REVIEW');
  assert.ok(e.score >= sana.qualification_threshold, `${e.score}`);
});

test('Sana: a field service engineer is hers for a power-equipment maker or power-plant work, not a lab, medical or IT one', () => {
  const POWER = pad('Install, test and service power transformers and circuit breakers at customer substations; troubleshoot faults and lead site repairs.');
  assert.equal(sanaPowerFieldService('Field Service Engineer', 'Hitachi', 'Company Name: HITACHI ENERGY INDIA LIMITED. ' + POWER), true);
  assert.equal(sanaPowerFieldService('Field Service Engineer', 'Siemens Energy', POWER), true);
  assert.equal(sanaPowerFieldService('Field Service Engineer', 'BHEL', POWER), true);
  assert.equal(sanaPowerFieldService('Field Service Engineer', 'Acme Services', pad('Service gas turbines, generators and boilers at power plants and substations across the region.')), true);
  for (const [co, d] of [['Waters', pad('Install and service mass spectrometers and chromatography systems in customer laboratories.')],
    ['Bruker', pad('Service NMR and microscopy instruments for life science customers.')],
    ['Hitachi', pad('Hitachi Vantara: install and service storage arrays and servers in customer data centres.')],
    ['Medtronic', pad('Service medical imaging and diagnostic equipment in hospitals.')],
    ['Acme Services', pad('Service packaging machines for our customers; travel 60%.')]])
    assert.equal(sanaPowerFieldService('Field Service Engineer', co, d), false, co);
  const e = evS('Field Service Engineer', 'Hyderabad, Telangana, India', 'Company Name: HITACHI ENERGY INDIA LIMITED. ' + POWER, { company: 'Hitachi' });
  assert.equal(e.status, 'NEEDS_REVIEW');
  assert.ok(e.score >= FLOOR_S, `${e.score}`);
  const lab = evS('Field Service Engineer', 'Bengaluru, India', pad('Install and service mass spectrometers in customer laboratories.'), { company: 'Waters' });
  assert.equal(lab.status, 'HOLD');
});

test('Sana (owner decision 20 Nov): electrical maintenance of a plant, port or utility scores normally; electrical design, protection and sales stay reduced', () => {
  const PORT = pad('Execute routine, preventive and breakdown maintenance of port equipment at the container terminal; fault diagnosis and correction; record jobs in the shift log; work permits.');
  const MILL = pad('Supervise technicians on breakdown work and weekly preventive maintenance with production; keep spare parts ready for our packaging factory.');
  for (const [title, d] of [['Executive - Electrical Engineering - Ports & Terminals', PORT], ['Electrical Engineer - Manufacturing Department', MILL],
    ['Electrical Engineer', pad('Electrical maintenance engineer at a combined-cycle power plant: preventive and breakdown maintenance of switchgear, motors and transformers; shutdowns and spares.')]]) {
    assert.equal(sanaElectricalMaintenance(title, d), true, title);
    assert.doesNotMatch(evS(title, 'Kochi, Kerala, India', d).qualification_reason, /Electrical-only title/, title);
  }
  const DESIGN = pad('Prepare electrical design drawings, cable schedules and ETAP studies for substations and plants; detailed design packages and design reviews for EPC tenders.');
  for (const [title, d] of [['Electrical Engineer', DESIGN], ['Electrical Design Engineer', PORT], ['Electrical Protection Engineer', PORT], ['Electrical Engineer - Switchgear Sales', PORT],
    ['Electrical Supervisor', PORT], ['Electrical Controls Engineer', PORT], ['Electrical Engineer', pad('Join our electrical team; plant and port projects across the region.')]])
    assert.equal(sanaElectricalMaintenance(title, d), false, title);
  assert.match(evS('Electrical Engineer', 'Kochi, Kerala, India', DESIGN).qualification_reason, /Electrical-only title/);
});

test('both: a visa refusal with an example list in brackets is read as no visa route', () => {
  const d = pad('Electrical maintenance engineer for our site utilities: preventive maintenance of substations, transformers and generators; root cause analysis of failures.')
    + ' Relocation assistance may be available. U.S. work visa sponsorship (such as TN, O-1, H-1B, etc.) is not available for this role now or in the future.';
  const e = evS('Electrical Engineer', 'United States - Massachusetts - Andover', d);
  assert.notEqual(e.eligibility, 'ELIGIBLE');
  assert.ok(e.score <= VISA_UNLIKELY_CAP, `${e.score}`);
  const ok = evS('Electrical Engineer', 'Andover, Massachusetts', d.replace('is not available', 'is available'));
  assert.equal(ok.eligibility, 'ELIGIBLE');
});

test('Farhan: the Zoho / HubSpot / Salesforce platform-gap cap is unchanged (owner decision 20 Nov)', () => {
  const d = pad('Build Zoho CRM and Zoho Creator automations, integrations and low-code AI agents for our clients. This is a fully remote role open to candidates based in India.');
  assert.ok(evF('Senior AI & Zoho Automation Engineer', 'Remote - India', d).score <= PLATFORM_GAP_CAP);
});
