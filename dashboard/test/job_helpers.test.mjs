import test from 'node:test';
import assert from 'node:assert/strict';
import { postingUrl, peopleSearchLinks, skillGaps, followUpState, localDay, SKILL_VOCABULARY, isAutoShortlisted, withoutAutoMark, updatedNote } from '../frontend/src/jobHelpers.ts';

test('people search links are built from the employer name, encoded, and empty for no name', () => {
  const links = peopleSearchLinks('  Black & Veatch ');
  assert.equal(links.length, 3);
  assert.ok(links.every((l) => l.url.startsWith('https://www.linkedin.com/search/results/')));
  assert.ok(links[0].url.includes('Black%20%26%20Veatch%20recruiter'));
  assert.ok(links[2].url.includes('/companies/'));
  assert.deepEqual(peopleSearchLinks(''), []);
  assert.deepEqual(peopleSearchLinks(undefined), []);
});

test('skill gaps: what the posting asks for, what the profile lists, what it does not', () => {
  const text = 'We need CMMS experience (SAP PM or Maximo), vibration analysis, root cause analysis and a gas turbine background. HVAC is a plus.';
  const g = skillGaps(text, ['Reliability', 'Root Cause Analysis', 'SAP PM Planning']);
  assert.deepEqual([...g.asked].sort(), ['cmms', 'gas turbine', 'hvac', 'maximo', 'root cause analysis', 'sap pm', 'turbine', 'vibration analysis']);
  assert.ok(g.have.includes('root cause analysis') && g.have.includes('sap pm'));
  assert.ok(g.missing.includes('cmms') && g.missing.includes('maximo') && g.missing.includes('vibration analysis') && g.missing.includes('gas turbine'));
  assert.ok(!g.missing.includes('root cause analysis'));
});

test('skill gaps match whole words only and handle empty input', () => {
  assert.deepEqual(skillGaps('', ['sql']), { asked: [], have: [], missing: [] });
  assert.deepEqual(skillGaps('We use mysqlite and plcxyz', []).asked, [], 'sql inside mysqlite and plc inside plcxyz are not skills named');
  const g = skillGaps('Zapier, SQL and HubSpot workflows', null);
  assert.deepEqual(g.missing.sort(), ['hubspot', 'sql', 'zapier']);
  assert.ok(SKILL_VOCABULARY.length > 100);
});

test('follow-up state: overdue, today, soon, later, and nothing for no or bad dates', () => {
  const today = '2026-11-10';
  assert.deepEqual(followUpState('2026-11-07', today), { key: 'overdue', label: 'Overdue by 3 days', days: -3 });
  assert.equal(followUpState('2026-11-09', today).label, 'Overdue by 1 day');
  assert.equal(followUpState('2026-11-10', today).key, 'today');
  assert.deepEqual([followUpState('2026-11-11', today).label, followUpState('2026-11-13', today).key], ['In 1 day', 'soon']);
  assert.equal(followUpState('2026-11-14', today).key, 'later');
  assert.equal(followUpState('2026-12-01', '2026-11-30').days, 1, 'across a month end');
  for (const bad of [null, undefined, '', 'tomorrow', '2026-13-40x']) assert.equal(followUpState(bad, today).key, 'none');
  assert.equal(followUpState('2026-11-10', 'bad').key, 'none');
});

test('localDay is the viewer\'s own calendar date, zero-padded', () => {
  assert.equal(localDay(new Date(2026, 0, 5, 3, 0)), '2026-01-05');
  assert.equal(localDay(new Date(2026, 10, 11, 0, 30)), '2026-11-11');
  assert.equal(localDay(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('the automatic shortlist mark is recognised only at the start of the reason and removed for display', () => {
  assert.equal(isAutoShortlisted('Shortlisted automatically. Cloud discovery match.'), true);
  assert.equal(isAutoShortlisted('Manual override by operator: Shortlisted automatically. x'), false);
  assert.equal(isAutoShortlisted(null), false);
  assert.equal(withoutAutoMark('Shortlisted automatically. Meets the stated 5+ years.'), 'Meets the stated 5+ years.');
  assert.equal(withoutAutoMark('Strongest Fit verified match (61%)'), 'Strongest Fit verified match (61%)');
  assert.equal(withoutAutoMark(undefined), '');
});

test('updated note: "Updated <date, time>" when the last daily run is recent, amber "Not updated today" over 26 hours or when none is recorded, hidden for an older server', () => {
  const now = new Date('2026-11-13T20:00:00Z');
  const fresh = updatedNote('2026-11-12T21:47:00Z', now);
  assert.equal(fresh.stale, false); assert.match(fresh.label, /^Updated 1[23] Nov, \d{2}:\d{2}$/);
  const old = updatedNote('2026-11-12T17:00:00Z', now);
  assert.equal(old.stale, true); assert.equal(old.label, 'Not updated today'); assert.match(old.title, /^Last daily update: 12 Nov, \d{2}:\d{2}$/);
  assert.equal(updatedNote(null, now).label, 'Not updated today'); assert.equal(updatedNote(null, now).stale, true);
  assert.equal(updatedNote(undefined, now), null, 'a Worker that does not report it yet shows nothing');
});

test('seeker posting links prefer a valid HTTPS original, then a usable source', () => {
  const source = 'https://example.org/jobs/123';
  const link = (original_posting_url, source_url = source) => postingUrl({ original_posting_url, source_url });
  assert.equal(link('https://example.org/jobs/123/apply'), 'https://example.org/jobs/123/apply');
  for (const invalid of ['https://', 'https://bad host/', 'nan', 'http://example.org/old', null]) {
    assert.equal(link(invalid), source);
  }
  assert.equal(link(null, 'http://example.org/legacy'), 'http://example.org/legacy');
  assert.equal(link('https://', 'https://'), null);
});
