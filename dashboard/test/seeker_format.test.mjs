// The job seeker's Today status line (QA 3: "Updated HH:MM" without a date made a stale page look fresh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { updatedText, sourceText } from '../frontend/src/seeker/format.ts';

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
