// Jobs QA 3 (16 Nov, 100+ jobs per person re-scored with the current rules and hand-judged): the patterns behind the wrong rows it found, one test
// per rule, each with the near misses that must keep their place. Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, foreignLocation, gulfPlace, indianPlace, sanaIndiaCity, indianaPlace, trailingCountryCode, codedForeignPlace, textLocation, titlePlaces,
  foreignPlaceInPosting, bareForeignCode, FAR_ABOVE_GAP, INDIA_UNCONFIRMED_PENALTY, VISA_UNLIKELY_CAP, RULES_MARKER } from '../worker/discovery.ts';
import { posting } from '../scripts/prescore.mjs';
import { TASTE_LIMIT } from '../scripts/taste_rules.mjs';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'Process Design']), total_years_experience: 9,
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Revenue Operations Specialist', 'Solutions Implementation']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis']), total_years_experience: 9,
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)', 'Power Plant Operations Engineer', 'Energy Efficiency Engineer']) };
const CRM = 'Configure the CRM, design processes and build workflow automation for customers. ';
const PLANT = 'Preventive maintenance, reliability and root cause analysis of boilers, turbines and pumps at a thermal power plant. '.repeat(3);
const ev = (cand, title, location, description = '', remote = /remote/i.test(location), extra = {}) =>
  evaluate(cand, { id: 'x', title, company: 'Acme', url: 'https://e.com/x', location, description, remote, ...extra });

test('marker: the rules changed, so every stored row is re-scored once (profile_v18)', () => {
  assert.equal(RULES_MARKER, 'profile_v18');
});

test('Farhan: director, principal and VP titles stay below his Worth-a-try floor; manager, lead, head of and chief of staff are not touched', () => {
  const floor = farhan.qualification_threshold - FAR_ABOVE_GAP;
  for (const t of ['Director, Professional Services', 'Principal Technical Program Manager', 'Senior Director, Revenue Operations', 'VP, Implementation',
    'Associate Director - Business Systems', 'Director of Business Operations and Systems'])
  {
    const r = ev(farhan, t, 'Remote - India', CRM.repeat(3), true);
    assert.ok(r.score <= floor, `${t}: ${r.score}`);
    assert.ok(r.score + TASTE_LIMIT < farhan.qualification_threshold - 10, `${t} stays below the Worth-a-try floor even with the largest taste raise`);
    assert.match(r.qualification_reason, /far above the candidate's level/, t);
  }
  for (const t of ['Implementation Manager', 'Technical Operations Lead', 'Senior Revenue Operations Manager', 'Chief of Staff'])
    assert.ok(ev(farhan, t, 'Remote - India', CRM.repeat(3), true).score >= 70, t);
  // a target role naming the title is not capped, and Sana is not affected
  const directorTarget = { ...farhan, target_roles: JSON.stringify(['Director of Implementation']) };
  assert.ok(ev(directorTarget, 'Director of Implementation', 'Remote - India', CRM.repeat(3), true).score > floor);
  assert.ok(ev(sana, 'Principal Reliability Engineer', 'Pune, India', PLANT).score >= 60);
});

test('Farhan: a bare "Remote" place whose Location line or title names another country is remote in that country, not from India', () => {
  for (const [title, d] of [
    ['WMS Implementation Engineer', 'Location: Remote – United States Department: Professional Services. ' + CRM],
    ['Senior Implementation Consultant', 'Senior Implementation Consultant Location: United Kingdom Salary: £100,000. ' + CRM],
    ['AI Solutions Engineer', '- Location: Espoo, Finland - Department: Business Applications. ' + CRM],
    ['Operations Manager', 'Location: Remote, California (Must be able to complete in-person duties). ' + CRM],
    ['Implementation Manager', 'This position can be based remotely within the US. ' + CRM],
    ['Implementation Manager', 'This role is fully remote, offering flexibility to work from anywhere within the UK. ' + CRM],
    ['Grants Operations Implementation Manager (US or Canada)', CRM],
    ['Enterprise Implementation Consultant - US Remote', CRM],
    ['Solutions Engineer - Dublin / US Remote', CRM],
    ['Marketing Operations Manager (Canada)', CRM],
    ['FBS (Mexico) - Sr. Integration Engineer', CRM]]) {
    const r = ev(farhan, title, 'Remote', d, true);
    assert.equal(r.eligibility, 'INELIGIBLE', `${title}: ${d.slice(0, 50)}`);
  }
  // near misses: India, worldwide or APAC in the title or the line; a line that is not a place; plain remote
  for (const [title, d] of [
    ['Marketing Automation Manager - Canada, Spain, India', CRM],
    ['Sr. Automation Engineer (Remote India - Night Shift)', CRM],
    ['Lead Solutions Engineer (Remote)', CRM],
    ['Manager, Automation (Global Remote)', CRM],
    ['Implementation Manager', 'Location: Remote Who are we? At Acme we build software used in London and Paris. ' + CRM],
    ['Implementation Manager', 'Location: Remote (worldwide). ' + CRM],
    ['Implementation Manager (n8n, Make, Python/JavaScript)', CRM],
    ['Implementation Manager', 'We are a US-based company. ' + CRM]]) {
    assert.notEqual(ev(farhan, title, 'Remote', d, true).eligibility, 'INELIGIBLE', `${title}: ${d.slice(0, 50)}`);
  }
  assert.equal(textLocation('Job title: X Location: India (remote) Overview This role is responsible for CRM.'), 'India (remote)');
  assert.deepEqual(titlePlaces('Solutions Engineer - Dublin / US Remote'), ['US Remote']);
  assert.ok(foreignPlaceInPosting('Implementation Manager (UK Preferred)', ''));
  assert.ok(!foreignPlaceInPosting('Implementation Manager (Job ID: IHUMEL1EA)', ''));
});

test('Farhan: "Location: India (remote)" in the text confirms remote from India although the place says only "Remote"', () => {
  const r = ev(farhan, 'Marketing Automation & CRM Operations Manager', 'Remote', 'Job title: Marketing Automation & CRM Operations Manager Location: India (remote) Overview ' + CRM, true);
  assert.equal(r.eligibility, 'ELIGIBLE');
  // an office line is not remote
  assert.notEqual(ev(farhan, 'Implementation Engineer', 'Remote', 'Location: Bangalore Type: Full-Time. ' + CRM, true).reason, 'Posting explicitly supports fully remote work from India.');
});

test('Farhan: a remote job that names no India, APAC, Asia, worldwide or anywhere wording ranks below one that does, and is not removed', () => {
  const plain = ev(farhan, 'Implementation Manager', 'Remote', CRM.repeat(3), true);
  const india = ev(farhan, 'Implementation Manager', 'Remote', CRM.repeat(3) + 'We hire across India.', true);
  const world = ev(farhan, 'Implementation Manager', 'Remote', CRM.repeat(3) + 'Work from anywhere.', true);
  assert.equal(plain.status, 'NEEDS_REVIEW'); assert.equal(plain.eligibility, 'UNKNOWN');
  assert.equal(india.score - plain.score, INDIA_UNCONFIRMED_PENALTY);
  assert.ok(world.score > plain.score);
  assert.match(plain.qualification_reason, /nothing in the posting says it hires from India/);
  // confirmed rows and Sana are not touched
  assert.doesNotMatch(ev(farhan, 'Implementation Manager', 'Remote - India', CRM.repeat(3), true).qualification_reason, /hires from India/);
  assert.doesNotMatch(ev(sana, 'Reliability Engineer', 'Remote', PLANT, true).qualification_reason, /hires from India/);
});

test('places written with a country code are read: trailing ISO codes (2 or 3 letters), leading codes, Canadian provinces, "City ST"', () => {
  for (const l of ['Kabirwala, PK, 58150', 'Docklands, VIC, au', 'Rojana Industrial Park, TH', 'Bandar Lampung, NULL, id', '05, SG, 639088', 'Hallam, VIC, AU, 3803',
    'Wolverhampton, England, gb', 'Taber, AB, CAN (Plant)', 'Limerick, IRL', 'CN - Qingdao', 'CAN-Ontario-Guelph', 'US.NC.Raleigh.940 Main Campus Drive', 'Milton, ON',
    'Waukesha WI; +1 more', 'AF Oshkosh Converter Films WI', 'Delhi, NY', 'SE (SE110)', 'Remote - Colorado', 'Remote (Texas)'])
    assert.ok(foreignLocation(l), l);
  // Indian places and codes shared with Indian states stay Indian or unread
  for (const l of ['Chennai, in', 'Pune, MH, IN, 410501', 'Bommasandra, KA, in', 'Izmir, TR, 35620', 'CH - Basel', 'Chennai, TN', 'Baramati, MH, IN', 'IN', 'Aurangabad MH; +2 more',
    'Gurugram, Haryana, IN', 'Delhi', 'New Delhi, India', 'Hyderabad, Telangana - IND', 'Remote, India'])
    assert.ok(!foreignLocation(l), l);
  assert.equal(trailingCountryCode('Kabirwala, PK, 58150'), 'PK');
  assert.equal(trailingCountryCode('Mumbai, MH, in'), null);
  assert.ok(codedForeignPlace('CN - Qingdao')); assert.ok(!codedForeignPlace('IND - Pune'));
  assert.ok(bareForeignCode('SE (SE110)')); assert.ok(!bareForeignCode('MH (Pune)'));
  assert.ok(!indianPlace('Delhi, NY')); assert.ok(indianPlace('Delhi, India')); assert.ok(sanaIndiaCity('Chennai, TN'));
  // Gulf: an Arabic place with its code is Gulf; Latin-script codes stay upper case only
  assert.ok(gulfPlace('مسقط, محافظة مسقط, om')); assert.ok(!gulfPlace('Springfield, qa')); assert.ok(gulfPlace('Doha, QA'));
});

test('Sana: a job abroad written with a country code gets the visa-route cap like the same job written in full; the Gulf and India do not', () => {
  for (const l of ['Kabirwala, PK, 58150', 'Jemeppe-sur-Sambre, BE, 5190', 'Docklands, VIC, au', 'Krubong, MY', 'Milton, ON', 'Delhi, NY'])
    assert.ok(ev(sana, 'Utilities Engineer', l, PLANT).score <= VISA_UNLIKELY_CAP, l);
  assert.ok(ev(sana, 'Utilities Engineer', 'Kabirwala, PK, 58150', PLANT + ' Visa sponsorship available.').score > VISA_UNLIKELY_CAP, 'a stated visa route keeps it');
  for (const l of ['Baramati, MH, IN', 'Bommasandra, KA, in', 'مسقط, محافظة مسقط, om', 'Riyadh, Riyadh - SAU'])
    assert.ok(ev(sana, 'Utilities Engineer', l, PLANT).score > 60, l);
});

test('Sana: "City, IN" from Workday or with an American text is Indiana, not India; SuccessFactors "Pithampur, IN" stays India', () => {
  assert.ok(indianaPlace('Lafayette, IN', 'Utilities plant engineer.', 'workday'));
  assert.ok(indianaPlace('Hammond, IN', 'Maintenance supervisor. Pay $30 an hour.', ''));
  assert.ok(indianaPlace('Woodburn, IN', 'Maintenance', '', 'https://acme.wd5.myworkdayjobs.com/x'));
  assert.ok(!indianaPlace('Pithampur, IN', 'Electrical maintenance at the plant.', 'successfactors'));
  assert.ok(!indianaPlace('Lafayette, IN', 'Our plant in Pune, India.', 'workday'), 'the text names India');
  assert.ok(!indianaPlace('Pune, IN', '', 'workday'), 'a known Indian city');
  const us = ev(sana, 'Utilities Plant Engineer', 'Lafayette, IN', PLANT, false, { source: 'workday' });
  assert.notEqual(us.eligibility, 'ELIGIBLE'); assert.ok(us.score <= VISA_UNLIKELY_CAP);
  const ind = ev(sana, 'Electrical Maintenance Engineer', 'Pithampur, IN', PLANT, false, { source: 'successfactors' });
  assert.equal(ind.eligibility, 'ELIGIBLE'); assert.ok(ind.score > 60);
  // the import's posting carries the source to evaluate()
  assert.equal(posting({ id: 'j', title: 'T', ats_type: 'workday', location: 'Lafayette, IN', description: 'x', url: 'https://e.com' }).source, 'workday');
});

test('Sana: "will not accept applicants who require visa sponsorship" is no visa route; "Relocation Assistance Provided: No" is no relocation', () => {
  const us = ev(sana, 'Reliability Engineer', 'Longview, TX, US, 75602', PLANT + ' Note Eastman will not accept applicants for this offered position who require visa sponsorship, including those on F-1 OPT.');
  assert.notEqual(us.eligibility, 'ELIGIBLE'); assert.ok(us.score <= VISA_UNLIKELY_CAP);
  assert.equal(ev(sana, 'Reliability Engineer', 'Longview, TX, US', PLANT + ' Visa sponsorship available for this role.').eligibility, 'ELIGIBLE', 'a stated route still counts');
  assert.notEqual(ev(sana, 'Gas Turbine Service Engineer', 'Dubai', PLANT + ' Additional Information Relocation Assistance Provided: No').eligibility, 'ELIGIBLE');
  assert.equal(ev(sana, 'Gas Turbine Service Engineer', 'Dubai', PLANT + ' Relocation assistance provided.').eligibility, 'ELIGIBLE');
});
