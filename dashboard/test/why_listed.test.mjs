// Gap fix (13 Nov): the card's why line says plainly when a Gulf job-board row on "Worth a try" could not be confirmed still open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { whyLine, notConfirmedOpen } from '../worker/why.ts';
import { listedOnlyHost } from '../worker/discovery.ts';

const base = { title: 'Maintenance Engineer', workplace_type: 'ONSITE', location_restrictions: 'Dubai, United Arab Emirates', qualification_status: 'STRETCH_READY',
  eligibility_status: 'ELIGIBLE', overall_score: 70, qualification_reason: 'Shortlisted automatically. Cloud discovery match.',
  original_posting_url: 'https://ae.linkedin.com/jobs/view/1', source_url: 'https://ae.linkedin.com/jobs/view/1', last_verified_at: null };

test('hosts: bayt, indeed and linkedin (any country subdomain), nothing else', () => {
  for (const u of ['https://www.bayt.com/en/uae/jobs/x', 'https://ae.indeed.com/viewjob?jk=1', 'https://in.linkedin.com/jobs/view/1', 'https://linkedin.com/jobs/view/2']) assert.ok(listedOnlyHost(u), u);
  for (const u of ['https://notlinkedin.com/x', 'https://linkedin.com.evil.example/x', 'https://boards.greenhouse.io/x', '', 'not a url']) assert.ok(!listedOnlyHost(u), u);
});

test('why line: "could not be confirmed still open" only for an automatic, unverified Gulf job-board row on Worth a try', () => {
  assert.match(whyLine('sana_ansari', base, ['a', 'b'], 60), /could not be confirmed still open/);
  assert.ok(notConfirmedOpen(base));
  assert.ok(notConfirmedOpen({ ...base, original_posting_url: null }), 'no direct link: the board URL is the one checked');
  const no = [{ last_verified_at: new Date().toISOString() }, { qualification_status: 'READY' }, { qualification_reason: 'Saved by the operator.' },
    { location_restrictions: 'Pune, India' }, { original_posting_url: 'https://boards.greenhouse.io/x/1', source_url: 'https://boards.greenhouse.io/x/1' },
    { original_posting_url: 'https://careers.employer.example/1' }];
  for (const o of no) assert.doesNotMatch(whyLine('sana_ansari', { ...base, ...o }, ['a'], 60), /confirmed/, JSON.stringify(o));
  assert.ok(notConfirmedOpen({ ...base, last_verified_at: new Date(Date.now() - 5 * 86400000).toISOString() }), 'verified 5 days ago is not recent');
});
