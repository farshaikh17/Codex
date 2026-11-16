// Live list 16 Nov: one employer's remote job, posted once per country, filled Farhan's Ready ten times, each copy remote-from-India confirmed by
// the text's "work from anywhere in the world". Invented rows shaped like those copies; nothing here is the live posting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../worker/discovery.ts';
import { selectShortlist, MARK, twinKey } from '../scripts/shortlist_select.mjs';
import { audit } from '../scripts/shortlist_audit.mjs';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();
const F = 'farhan_shaikh';
const farhan = { id: F, primary_skills: JSON.stringify(['Product Implementation', 'Technical Troubleshooting']), total_years_experience: 9 };
const TEXT = 'We are a 100% remote company. Lead the technical implementation of our products for customers and do technical troubleshooting '
  + 'of their integrations. Product implementation for high-value accounts. Work from anywhere in the world with an autonomous schedule.';
const COUNTRIES = ['Brazil', 'Cambodia', 'Chile; Argentina; Peru', 'Mexico', 'Colombia', 'Multiple Countries', 'São Paulo, São Paulo, Brazil', 'Venezuela', 'Remote', 'Uruguay'];
const ev = (location) => evaluate(farhan, { id: 'x', title: 'Lead Solutions Engineer (Remote)', company: 'AdCo', url: 'https://e.com/x', location, description: TEXT, remote: true });

let n = 0;
const row = (o = {}) => ({ kind: 'pool', candidate_id: F, job_id: o.job_id || `j${String(++n).padStart(3, '0')}`, title: 'Implementation Manager ' + n, company: 'Co ' + n,
  location: 'Remote', workplace: 'UNKNOWN', source: 'jazzhr', discovered_at: iso(1), last_verified_at: iso(0), active: 1, marked: 1, target_exact: 0,
  score: 77, skill_score: 40, eligibility: 'ELIGIBLE', status: 'NEEDS_REVIEW', reason: 'Cloud discovery match.', threshold: 70, description: TEXT, ...o });
const copies = (o = {}) => COUNTRIES.map((loc, i) => row({ job_id: 'mm' + i, company: 'AdCo', title: 'Lead Solutions Engineer (Remote)', location: loc,
  workplace: loc === 'Remote' ? 'REMOTE_RESTRICTED' : 'UNKNOWN', ...o }));
const tiers = (res) => Object.fromEntries(res.changes.map((c) => [c.job_id, c.to]));
const onList = (res) => Object.entries(tiers(res)).filter(([, t]) => t !== 'NEEDS_REVIEW').map(([id]) => id);

test('a remote posting whose only place is another named country is not remote-from-India confirmed for Farhan, despite "work from anywhere"', () => {
  for (const loc of ['Brazil', 'Mexico', 'Cambodia', 'Chile; Argentina; Peru', 'São Paulo, São Paulo, Brazil', 'Venezuela', 'Uruguay']) {
    const r = ev(loc);
    assert.notEqual(r.eligibility, 'ELIGIBLE', loc);
    assert.match(r.reason, /another country/, loc);
    assert.equal(r.eligibility, 'UNKNOWN', loc);
  }
  // not confirmed, so not shortlisted for Farhan (an unconfirmed row needs a place naming India)
  assert.deepEqual(onList(selectShortlist([row({ job_id: 'br', location: 'Brazil', eligibility: 'UNKNOWN', score: 80 })], { now: NOW })), []);
  // 'Remote', 'Multiple Countries' and worldwide places are read as before
  for (const loc of ['Remote', 'Multiple Countries', 'Remote (Worldwide)', 'Anywhere']) assert.equal(ev(loc).eligibility, 'ELIGIBLE', loc);
  // a foreign place that also says India, APAC or anywhere, or text hiring from India, still counts
  assert.equal(ev('Brazil; India').eligibility, 'ELIGIBLE');
  assert.equal(ev('Brazil or anywhere').eligibility, 'ELIGIBLE');
  assert.notEqual(evaluate(farhan, { id: 'x', title: 'Lead Solutions Engineer', company: 'AdCo', url: 'https://e.com/x', location: 'Brazil', remote: true,
    description: TEXT + ' We are hiring candidates based in India too.' }).eligibility, 'INELIGIBLE');
});

test('ten country copies of one employer and title are one row on the shortlist', () => {
  const res = selectShortlist([...copies(), row({ job_id: 'other', score: 75 })], { now: NOW });
  const kept = onList(res).filter((id) => id.startsWith('mm'));
  assert.equal(kept.length, 1, JSON.stringify(tiers(res)));
  assert.ok(onList(res).includes('other'), 'another employer is not affected');
  // the copies were automatic rows already (the live state): all but one go back to To review
  const incumbents = copies({ kind: 'auto', status: 'READY', reason: MARK + 'Cloud discovery match.' });
  const res2 = selectShortlist(incumbents, { now: NOW });
  assert.equal(res2.changes.filter((c) => c.to === 'NEEDS_REVIEW').length, 9);
  assert.equal(new Set(incumbents.map(twinKey)).size, 1, 'one twin key for every copy');
});

test('the kept copy is the best scored, then the India-located one, then the newest', () => {
  const base = { company: 'AdCo', title: 'Lead Solutions Engineer (Remote)' };
  const t1 = tiers(selectShortlist([row({ ...base, job_id: 'a', location: 'Remote' }), row({ ...base, job_id: 'b', location: 'Remote - India' }),
    row({ ...base, job_id: 'c', location: 'Multiple Countries', discovered_at: iso(0) })], { now: NOW }));
  assert.deepEqual(Object.keys(t1).filter((k) => t1[k] !== 'NEEDS_REVIEW'), ['b'], 'India-located preferred at the same score');
  const t2 = tiers(selectShortlist([row({ ...base, job_id: 'a', location: 'Remote', score: 85 }), row({ ...base, job_id: 'b', location: 'Remote - India' })], { now: NOW }));
  assert.deepEqual(Object.keys(t2), ['a'], 'a better score wins');
  const t3 = tiers(selectShortlist([row({ ...base, job_id: 'a', location: 'Remote', discovered_at: iso(3) }), row({ ...base, job_id: 'b', location: 'Multiple Countries', discovered_at: iso(0) })], { now: NOW }));
  assert.deepEqual(Object.keys(t3), ['b'], 'then the newest');
});

test('a held copy (an application or a decision) keeps its place and blocks the others; on-site plants stay separate jobs', () => {
  const held = { kind: 'held', candidate_id: F, job_id: 'mine', company: 'AdCo', title: 'Lead Solutions Engineer', location: 'Brazil', workplace: 'UNKNOWN', status: 'READY' };
  const res = selectShortlist([held, ...copies()], { now: NOW });
  assert.deepEqual(onList(res), [], 'no automatic twin of a held row');
  assert.ok(!res.changes.some((c) => c.job_id === 'mine'), 'the held row is never changed');
  const plant = (id, loc) => row({ job_id: id, candidate_id: 'sana_ansari', company: 'Adani Power', title: 'Electrical Maintenance Engineer', location: loc, workplace: 'ONSITE', score: 83 });
  assert.deepEqual(onList(selectShortlist([plant('p1', 'Udupi, India'), plant('p2', 'Kawai, Rajasthan, India')], { now: NOW })).sort(), ['p1', 'p2']);
});

test('the audit fails twins on a person\'s shortlist (the selector\'s key), only on a day the selector ran', () => {
  const stored = COUNTRIES.slice(0, 3).map((loc, i) => ({ kind: 'row', candidate_id: F, job_id: 'mm' + i, status: i ? 'STRETCH_READY' : 'READY', company: 'AdCo',
    title: 'Lead Solutions Engineer (Remote)', location: loc, workplace: 'UNKNOWN', source: 'jazzhr', url: 'https://e.com/' + i, last_verified_at: iso(0), active: 1, decided: 0 }));
  const res = audit(stored, { report: {}, now: NOW });
  assert.equal(res.problems.filter((p) => /one employer and title/.test(p)).length, 1, res.problems.join('\n'));
  assert.ok(audit(stored, { report: null, now: NOW }).ok, 'not checked when the selector did not run');
  assert.ok(audit(stored.slice(0, 1), { report: {}, now: NOW }).ok);
  // a copy a person since applied to is theirs, not a twin the screen made
  assert.ok(audit([stored[0], { ...stored[1], decided: 1 }], { report: {}, now: NOW }).ok);
});
