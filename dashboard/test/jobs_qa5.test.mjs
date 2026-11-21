// Jobs QA 5 (19 Nov): a posting that admits only people based in, or already allowed to work in, countries other than India ('We can only consider
// candidates based in Austria, Belgium, Germany ... and the UK', 'must hold the right to work in the UK') is the wrong place for both built-in
// profiles, whatever its place line says. Positive cases and the near misses that must keep their place. Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, rightToWorkAbroad, VISA_UNLIKELY_CAP, RULES_MARKER } from '../worker/discovery.ts';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'Process Design']), total_years_experience: 9,
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Revenue Operations Specialist', 'Solutions Implementation']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis']), total_years_experience: 9,
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)', 'Power Plant Operations Engineer', 'Energy Efficiency Engineer']) };
const CRM = 'Configure the CRM, design processes and build workflow automation for customers. '.repeat(3);
const PLANT = 'Preventive maintenance, reliability and root cause analysis of boilers, turbines and pumps at a thermal power plant. '.repeat(3);
const ANYWHERE = PLANT + 'You can work from anywhere. ';   // as in the enspired posting: without the restriction it would reach Worth a try
const ev = (cand, title, location, description = '', remote = /remote/i.test(location)) =>
  evaluate(cand, { id: 'x', title, company: 'Acme', url: 'https://e.com/x', location, description, remote });

const RESTRICTED = [
  'Note: We can only consider candidates based in Austria, Belgium, Germany, the Netherlands, Slovakia, Spain, and the UK (or open to relocation to one of these countries, provided the candidate holds the right to work).',
  'Candidates must be based in the United Kingdom.',
  'You must have the right to work in the UK.',
  '**Applicants must hold a valid Guernsey** [**employment permit.**](https://example.com/permits)',
  'Applicants must hold a valid work permit for Switzerland.',
  'You must be eligible to work in Canada without sponsorship.',
  'EU work authorisation required.',
  'Right to work in Australia is essential.',
  'Open to candidates based in Germany only.',
];
const NEAR_MISS = [
  'You must be eligible to work in India.',
  'Candidates must be based in Bangalore or London.',
  'You do not need to be based in the UK.',
  'We are an equal opportunity employer and respect every person\'s right to work free of discrimination.',
  'We must ensure all employees have the right to work in the UK.',
  'Applicants must have the right to work.',
  'Candidates must be based in one of our offices.',
];

test('marker: the rules changed, so every stored row is re-scored once (profile_v20, bumped again by later rule changes)', () => {
  assert.match(RULES_MARKER, /^profile_v(?:2\d|[3-9]\d)$/);
});

test('the restriction is read from the text; India, a denied or bare requirement and the employer\'s own duties are not', () => {
  for (const t of RESTRICTED) assert.ok(rightToWorkAbroad(t, { gulfOk: true }), t);
  for (const t of NEAR_MISS) assert.equal(rightToWorkAbroad(t, { gulfOk: true }), false, t);
  // a Gulf requirement is Sana's own route, but not remote from India for Farhan
  for (const t of ['Must be based in Dubai, UAE.', 'You must have the right to work in Saudi Arabia.']) {
    assert.equal(rightToWorkAbroad(t, { gulfOk: true }), false, t);
    assert.equal(rightToWorkAbroad(t), true, t);
  }
});

test('Sana: a job open only to people based in or allowed to work in other countries is capped like a job abroad with no visa route', () => {
  for (const loc of ['Remote job', 'Multiple locations']) {
    const base = ev(sana, 'Power Plant Operations Engineer', loc, ANYWHERE, false);
    assert.ok(base.score >= sana.qualification_threshold, `baseline ${loc}: ${base.score}`);
    for (const t of RESTRICTED) {
      const r = ev(sana, 'Power Plant Operations Engineer', loc, ANYWHERE + t, false);
      assert.ok(r.score <= VISA_UNLIKELY_CAP, `${loc} | ${t}: ${r.score}`);
      assert.match(r.qualification_reason, /allowed to work in another country/, t);
    }
  }
  // near misses keep their place: the phrases above, a stated visa route, a Gulf requirement, an Indian place
  for (const t of NEAR_MISS) assert.ok(ev(sana, 'Power Plant Operations Engineer', 'Remote job', ANYWHERE + t, false).score >= sana.qualification_threshold, t);
  for (const [loc, t] of [
    ['Remote job', 'You must have the right to work in the UK. Visa sponsorship is available for the right candidate.'],
    ['Remote job', 'Candidates must be based in Qatar.'],
    ['Pune, India', 'Candidates must be based in Germany for the first year of training.'],
    ['Doha, Qatar', 'You must have the right to work in the UK or be willing to relocate to Qatar.']]) {
    const r = ev(sana, 'Power Plant Operations Engineer', loc, ANYWHERE + t, false);
    assert.ok(r.score >= sana.qualification_threshold, `${loc} | ${t}: ${r.score}`);
    assert.doesNotMatch(r.qualification_reason, /allowed to work in another country/, t);
  }
});

test('Farhan: a remote job open only to people based in or allowed to work in another country is not remote from India', () => {
  const base = ev(farhan, 'Implementation Manager', 'Remote', CRM);
  assert.notEqual(base.eligibility, 'INELIGIBLE');
  for (const t of [...RESTRICTED, 'Must be based in Dubai, UAE.']) {
    const r = ev(farhan, 'Implementation Manager', 'Remote', CRM + t);
    assert.equal(r.eligibility, 'INELIGIBLE', t);
  }
  // (the employer's 'right to work in the UK' duty already ties a remote job to the UK for Farhan: remoteCountryByText, live list review 13 Nov)
  for (const t of NEAR_MISS.filter((x) => !/must ensure/.test(x))) assert.notEqual(ev(farhan, 'Implementation Manager', 'Remote', CRM + t).eligibility, 'INELIGIBLE', t);
  // remote from India stated in the posting wins
  const india = ev(farhan, 'Implementation Manager', 'Remote - India', CRM + ' You must have the right to work in India or the UK.');
  assert.equal(india.eligibility, 'ELIGIBLE');
});
