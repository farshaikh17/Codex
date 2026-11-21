// The job seeker's Today status line (QA 3: "Updated HH:MM" without a date made a stale page look fresh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { updatedText, sourceText, placeText, employerName } from '../frontend/src/seeker/format.ts';

test('the update time has no date only when it was today in India time', () => {
  const now = new Date('2026-11-16T12:00:00Z');                                   // 17:30 IST, 16 Nov
  assert.equal(updatedText('2026-11-16T03:30:00Z', now), 'Updated 09:00');
  assert.equal(updatedText('2026-11-15T20:16:00Z', now), 'Updated 01:46', '20:16 UTC on 15 Nov is 01:46 IST on 16 Nov: today');
  assert.equal(updatedText('2026-11-15T14:46:00Z', now), 'Updated 15 Nov, 20:16');
  assert.equal(updatedText('2026-11-01T05:00:00Z', now), 'Updated 1 Nov, 10:30');
  assert.equal(updatedText('2026-11-15T18:29:00Z', now), 'Updated 15 Nov, 23:59', 'the last minute of yesterday in India');
  assert.equal(updatedText('2026-11-15T18:30:00Z', now), 'Updated 00:00', 'the first minute of today in India');
  assert.equal(updatedText(null, now), 'Updated');
  assert.equal(updatedText('not a date', now), 'Updated');
});

test('a reposting site is never called the employer\'s own site (QA 16 Nov: Jobgether via a Lever tenant)', () => {
  assert.equal(sourceText('lever', 'LIVE_PUBLIC', 'Jobgether'), 'From a reposting site, not the employer');
  assert.equal(sourceText('workable', 'LIVE_PUBLIC', 'Turing.com'), 'From a reposting site, not the employer');
  assert.equal(sourceText('lever', 'LIVE_PUBLIC', 'Turing Labs'), "From the employer's own site");
  assert.equal(sourceText('greenhouse', 'LIVE_PUBLIC', 'Acme'), "From the employer's own site");
  assert.equal(sourceText('indeed', 'LIVE_PUBLIC', 'Acme'), 'From a job board');
});

test('site QA 21 Nov: a remote job says Remote on the card even when its first place is a city', () => {
  assert.equal(placeText({ location_restrictions: 'Delhi', workplace_type: 'REMOTE' }), 'Remote · Delhi');
  assert.equal(placeText({ location_restrictions: 'Warszawa (Poland); Kraków', workplace_type: 'REMOTE_RESTRICTED' }), 'Remote · Warszawa (Poland)');
  assert.equal(placeText({ location_restrictions: 'Remote - India', workplace_type: 'REMOTE' }), 'Remote - India', 'not said twice');
  assert.equal(placeText({ location_restrictions: 'Anywhere', workplace_type: 'REMOTE_GLOBAL' }), 'Anywhere');
  assert.equal(placeText({ location_restrictions: '', workplace_type: 'REMOTE' }), 'Remote');
  assert.equal(placeText({ location_restrictions: 'Pune, India', workplace_type: 'ONSITE' }), 'Pune, India');
  assert.equal(placeText({ location_restrictions: null, workplace_type: null }), 'Place not stated');
});

test('site QA 21 Nov: hiring-system account names are shown as the employer, display only', () => {
  assert.equal(employerName('MahindraCareerSiteHRprd'), 'Mahindra', 'both suffixes');
  assert.equal(employerName('nestleHRprdRMK'), 'Nestlé');
  assert.equal(employerName('MahindraCareerSite'), 'Mahindra');
  assert.equal(employerName('Adani Career Site'), 'Adani');
  assert.equal(employerName('HatchD1'), 'Hatch');
  assert.equal(employerName('regentcollegelondon'), 'Regent College London');
  assert.equal(employerName('US Kraft Heinz'), 'Kraft Heinz');
  for (const name of ['Siemens Energy', 'WSP', 'Schneider Electric', 'SUSONITY', 'GE Vernova', 'Area D1', 'ib vogt', 'deliveroo', 'adidas', 'storyblok', 'AcmeD2'])
    assert.equal(employerName(name), name, name + ' is kept as stored (lower case on purpose, or a D-digit name not in the list)');
  assert.equal(employerName(null), '');
});
