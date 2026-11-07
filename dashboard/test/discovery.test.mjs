import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { seed } from './fixtures.mjs';
import { evaluate, avoidedTitle, foreignLocation, remoteFromStored, AVOID_TITLE_CAP, FOREIGN_LOCATION_PENALTY, SANA_OLD_ACCESS_REASON, SANA_UNKNOWN_ACCESS_REASON } from '../worker/discovery.ts';
import { plan, SELECT_ROWS } from '../scripts/rescore_ranking_v2.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const farhan = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation']) };
const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability', 'Plant Engineering']) };
const post = (title, location = 'Remote', description = 'CRM Configuration and Workflow Automation role.') => ({ id: 'x', title, url: 'https://example.com/x', location, description, remote: /remote/i.test(location) });

test('ranking: avoid-list titles are capped at 40, other titles are not, and the status and eligibility rules are unchanged', () => {
  const good = evaluate(farhan, post('Implementation Manager', 'Remote - India'));
  const avoided = evaluate(farhan, post('Senior Software Engineer, Operations Platform', 'Remote - India'));
  assert.ok(good.score > AVOID_TITLE_CAP, `a fitting title keeps its score (${good.score})`);
  assert.ok(avoided.score <= AVOID_TITLE_CAP, `avoid-list title capped (${avoided.score})`);
  assert.equal(avoided.eligibility, good.eligibility, 'eligibility is computed the same way');
  assert.equal(avoided.status, good.status, 'status rules unchanged (still review, never READY)');
  assert.match(avoided.qualification_reason, /avoid list/);
  for (const t of ['Software Engineer', 'DevOps Engineer', 'Site Reliability Engineer', 'Machine Learning Engineer', 'Security Engineer', 'Finance Manager', 'Customer Support Specialist', 'Engineering Manager', 'SDET'])
    assert.ok(avoidedTitle('farhan_shaikh', t), t);
  for (const t of ['Implementation Manager', 'Technical Operations Lead', 'Solutions Implementation Specialist', 'CRM Administrator', 'Business Systems Analyst'])
    assert.ok(!avoidedTitle('farhan_shaikh', t), t);
  assert.ok(!avoidedTitle('sana_ansari', 'Software Engineer'), "the avoid list is Farhan's only");
});

test('ranking: a posting whose only stated location is outside India loses points for Farhan unless it supports remote work from India', () => {
  const india = evaluate(farhan, post('Implementation Manager', 'Remote - India'));
  const us = evaluate(farhan, post('Implementation Manager', 'Austin, TX', 'CRM Configuration and Workflow Automation.'));
  const usSame = evaluate({ ...farhan }, post('Implementation Manager', 'Remote', 'CRM Configuration and Workflow Automation.'));
  assert.equal(foreignLocation('Austin, TX'), true); assert.equal(foreignLocation('London, United Kingdom'), true);
  assert.equal(foreignLocation('Remote'), false); assert.equal(foreignLocation('Bengaluru, India'), false); assert.equal(foreignLocation(''), false);
  assert.equal(us.score, Math.max(0, usSame.score - FOREIGN_LOCATION_PENALTY), `${us.score} vs ${usSame.score}`);
  assert.equal(india.eligibility, 'ELIGIBLE'); assert.ok(india.score >= us.score);
  assert.equal(us.eligibility, 'UNKNOWN', 'eligibility rules are not changed by the penalty');
  // Sana is open to relocation: no penalty and no avoid list
  const sa = evaluate(sana, post('Reliability Engineer', 'London, United Kingdom', 'Reliability and Plant Engineering role.'));
  const sb = evaluate(sana, post('Reliability Engineer', 'Remote', 'Reliability and Plant Engineering role.'));
  assert.equal(sa.score, sb.score);
});


// ---- title and location rules (shared by the Worker and the correction script) -------------------------------------
test('avoid list: software/ML/security/test families always; finance/support/management families unless the title names his own target areas', () => {
  for (const t of ['Software Engineer', 'Senior Backend Engineer', 'Backend|Engineer', 'Software Engineer–Platform', 'Implementation Engineer - Backend/API', 'DevOps Engineer', 'Site Reliability Engineer', 'SRE', 'Machine Learning Engineer', 'Data Scientist', 'Security Engineer', 'SDET', 'QA Engineer', 'Test Automation Lead', 'Finance Manager', 'Financial Controller', 'Payroll Specialist', 'Customer Support Specialist', 'Support Engineer', 'Engineering Manager', 'Director of Engineering', 'Accountant'])
    assert.ok(avoidedTitle('farhan_shaikh', t), `${t} should be capped`);
  for (const t of ['Implementation Manager', 'Technical Operations Lead', 'Solutions Implementation Specialist', 'CRM Administrator', 'Business Systems Analyst', 'Finance Systems Analyst', 'Business Systems Analyst - Finance',
    'Solutions Engineering Manager', 'Implementation Support Specialist', 'Payroll Implementation Specialist', 'Customer Support Operations Manager', 'Air Traffic Controller', 'Implementation Manager, Software Onboarding', 'Presre Lead'])
    assert.ok(!avoidedTitle('farhan_shaikh', t), `${t} should not be capped`);
  assert.ok(!avoidedTitle('sana_ansari', 'Software Engineer'));
});
test('foreign location: US/EU/other named places, U.S., bare US, state codes; never a place that also names India', () => {
  for (const l of ['Austin, TX', 'Plano, TX', 'Palo Alto, CA', 'London, United Kingdom', 'Remote - U.S.', 'U.S.', 'U.S. Remote', 'Remote - US', 'US Remote', 'Remote (US)', 'Remote, North America', 'Remote, Americas', 'Dubai, UAE', 'Singapore', 'Berlin, Germany'])
    assert.equal(foreignLocation(l), true, l);
  for (const l of ['Remote', 'Remote - India', 'Bengaluru, India', 'Bangalore / London', 'Noida', 'Gurugram, Haryana', 'Bhubaneswar, OR', 'Hybrid', '', 'Work with us'])
    assert.equal(foreignLocation(l), false, l);
  assert.equal(remoteFromStored('REMOTE_RESTRICTED', ''), true); assert.equal(remoteFromStored(null, 'Remote - India'), true); assert.equal(remoteFromStored('ONSITE', 'Mumbai, India'), false);
});

// ---- the correction script, run against a real database with the real migrations --------------------------------------
const old = JSON.stringify({ rule_version: 'cloud-conservative-review-1', preliminary: true });
function world() {
  const { sqlite } = createDb(); seed(sqlite);
  const job = (id, title, loc, wt = 'ONSITE', desc = null) => sqlite.prepare("INSERT INTO jobs(id,title,company,source_adapter,is_active,location_restrictions,workplace_type,description,discovered_at) VALUES (?,?,?,?,1,?,?,?,'2026-11-01T00:00:00Z')").run(id, title, 'Co', 'lever', loc, wt, desc);
  const row = (c, id, score, o = {}) => {
    sqlite.prepare('INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,eligibility_reason,manual_override_status) VALUES (?,?,?,?,?,?,?)')
      .run(c, id, o.status || 'NEEDS_REVIEW', o.lane || 'STRONGEST_FIT', o.elig || 'UNKNOWN', o.reason || 'x', o.override || null);
    sqlite.prepare('INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,strategy_lane,score_breakdown) VALUES (?,?,?,?,?)').run(c, id, score, o.lane || 'STRONGEST_FIT', o.bd || old); };
  const run = () => { const rows = sqlite.prepare(SELECT_ROWS).all(); const p = plan(rows); for (const st of p.statements) sqlite.exec(st); return p; };
  const score = (c, id) => sqlite.prepare('SELECT overall_score s FROM candidate_job_scores WHERE candidate_id=? AND job_id=?').get(c, id).s;
  const elig = (c, id) => sqlite.prepare('SELECT eligibility_status e FROM candidate_qualifications WHERE candidate_id=? AND job_id=?').get(c, id).e;
  return { sqlite, job, row, run, score, elig };
}
const F = 'farhan_shaikh', S = 'sana_ansari';

test('correction (Farhan): cap, location penalty and both together match what evaluate() would store; re-running changes nothing', () => {
  const w = world();
  w.job('a1', 'Senior Software Engineer', 'Remote'); w.row(F, 'a1', 66);                    // cap -> 40
  w.job('a2', 'Implementation Manager', 'Austin, TX'); w.row(F, 'a2', 66);                  // foreign -> 51
  w.job('a3', 'Implementation Manager', 'Remote - India'); w.row(F, 'a3', 66);              // untouched
  w.job('a4', 'Software Engineer', 'London, UK'); w.row(F, 'a4', 66);                       // cap then penalty -> 25 (as evaluate())
  w.job('a5', 'Software Engineer', 'Remote'); w.row(F, 'a5', 30);                           // already below the cap
  w.job('a6', 'Implementation Manager', 'Remote - U.S.'); w.row(F, 'a6', 66);               // SQL used to miss this
  w.job('a7', 'Implementation Manager', 'Plano, TX'); w.row(F, 'a7', 66);                   // ... and this
  w.job('a8', 'Backend|Engineer', 'Remote'); w.row(F, 'a8', 66);                            // punctuation
  w.job('a9', 'Implementation Manager', 'London, UK'); w.row(F, 'a9', 66, { elig: 'ELIGIBLE' });   // affirmatively eligible: no penalty
  const p1 = w.run();
  assert.deepEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'].map((id) => w.score(F, id)), [40, 51, 66, 25, 30, 51, 51, 40, 66]);
  assert.ok(p1.counts.estimated_rows_written > 0);
  const p2 = w.run();
  assert.equal(p2.statements.length, 0, 're-running plans nothing');
  assert.deepEqual(['a1', 'a2', 'a4', 'a6'].map((id) => w.score(F, id)), [40, 51, 25, 51]);
});

test('correction: rows already scored under the new rules (tagged) are never penalised again; engine-scored, overridden and non-review rows are untouched', () => {
  const w = world();
  const tagged = JSON.stringify({ rule_version: 'cloud-conservative-review-1', preliminary: true, ranking_v2: true });
  w.job('b1', 'Implementation Manager', 'London, UK'); w.row(F, 'b1', 35, { bd: tagged });   // the new Worker already took the 15 off
  w.job('b2', 'DevOps Engineer', 'Remote'); w.row(F, 'b2', 66, { override: 'READY' });         // human decision
  w.job('b3', 'DevOps Engineer', 'Remote'); w.row(F, 'b3', 66, { bd: JSON.stringify({ rule_version: 'engine-v2' }) });   // collector engine
  w.job('b4', 'DevOps Engineer', 'Remote'); w.row(F, 'b4', 66, { status: 'READY' });           // not a review row
  w.job('b5', 'DevOps Engineer', 'Remote'); w.row(F, 'b5', 66, { bd: 'not json' });
  w.run();
  assert.deepEqual(['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => w.score(F, id)), [35, 66, 66, 66, 66]);
});

test('correction: a tracker record never excludes a job; applications, history and overrides stay byte-identical', () => {
  const w = world();
  w.job('c1', 'DevOps Engineer', 'Remote'); w.row(F, 'c1', 66);
  w.sqlite.prepare("INSERT INTO applications(id,candidate_id,job_id,status,notes) VALUES ('c-app','farhan_shaikh','c1','SAVED','placeholder listing')").run();
  w.sqlite.prepare("INSERT INTO application_history(candidate_id,job_id,application_id,new_status,actor,source) VALUES ('farhan_shaikh','c1','c-app','SAVED','test','test')").run();
  w.job('c2', 'DevOps Engineer', 'Remote'); w.row(F, 'c2', 66, { override: 'READY' });
  const snap = () => JSON.stringify([w.sqlite.prepare('SELECT * FROM applications ORDER BY id').all(), w.sqlite.prepare('SELECT * FROM application_history ORDER BY id').all(),
    w.sqlite.prepare('SELECT candidate_id,job_id,qualification_status,manual_override_status,manual_override_reason FROM candidate_qualifications WHERE manual_override_status IS NOT NULL ORDER BY 1,2').all()]);
  const before = snap();
  w.run();
  assert.equal(w.score(F, 'c1'), 40, 'the job that has a placeholder tracker record is still corrected');
  assert.equal(w.score(F, 'c2'), 66, 'the overridden one is not');
  assert.equal(snap(), before);
  assert.ok(before.includes('placeholder listing'), 'the snapshot really contains the application');
});

test('correction (Sana): city-list eligibility becomes unknown, remote-in-India stays eligible even under the old reason, score loses the 10 points only where they were added', () => {
  const w = world();
  w.job('s1', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 's1', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON });                                   // -> UNKNOWN, 50
  w.job('s2', 'Reliability Engineer', 'Remote - India', 'REMOTE_RESTRICTED'); w.row(S, 's2', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON });          // remote, old reason: untouched
  w.job('s3', 'Reliability Engineer', 'Pune, India'); w.row(S, 's3', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, override: 'READY' });               // override: untouched
  w.job('s4', 'Reliability Engineer', 'Pune, India'); w.row(S, 's4', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, status: 'READY' });                  // READY: untouched
  w.job('s5', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 's5', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, lane: 'UNASSIGNED' });            // no role bonus to remove
  w.job('s6', 'Reliability Engineer', 'Remote'); w.row(S, 's6', 60, { elig: 'ELIGIBLE', reason: 'Remote role in India.' });                                      // new-style: untouched
  w.run();
  assert.deepEqual(['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => [w.elig(S, id), w.score(S, id)]),
    [['UNKNOWN', 50], ['ELIGIBLE', 60], ['ELIGIBLE', 60], ['ELIGIBLE', 60], ['UNKNOWN', 60], ['ELIGIBLE', 60]]);
  assert.equal(w.sqlite.prepare("SELECT eligibility_reason r FROM candidate_qualifications WHERE candidate_id='sana_ansari' AND job_id='s1'").get().r, SANA_UNKNOWN_ACCESS_REASON);
  assert.equal(w.run().statements.length, 0, 'idempotent');
});

test('correction: the write estimate counts the score index, and the preliminary scores of other rules are never selected', () => {
  const w = world();
  w.job('d1', 'DevOps Engineer', 'Remote'); w.row(F, 'd1', 66);
  const p = plan(w.sqlite.prepare(SELECT_ROWS).all());
  assert.equal(p.counts.score_rows, 1); assert.equal(p.counts.estimated_rows_written, 2);
  assert.ok(!SELECT_ROWS.includes('applications') && !SELECT_ROWS.includes('application_history'), 'the script never reads the tracker');
});

test('Sana: a role in an Indian city is UNKNOWN until accessibility is verified; only a role that is remote in India is eligible', () => {
  const city = evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability and Plant Engineering role at our plant.'));
  const remoteIndia = evaluate(sana, { ...post('Reliability Engineer', 'Remote - India', 'Reliability and Plant Engineering role.'), remote: true });
  const pune = evaluate(sana, post('Plant Engineer', 'Pune, Maharashtra, India', 'Plant Engineering role.'));
  assert.equal(city.eligibility, 'UNKNOWN'); assert.match(city.reason, /accessibility is unknown/);
  assert.equal(pune.eligibility, 'UNKNOWN');
  assert.equal(remoteIndia.eligibility, 'ELIGIBLE'); assert.equal(remoteIndia.reason, 'Remote role in India.');
  assert.ok(remoteIndia.score > city.score, 'the eligibility bonus no longer applies to an unverified city');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'London, United Kingdom', 'Reliability role. Visa sponsorship available.')).eligibility, 'ELIGIBLE', 'other rules are unchanged');
});

// ---- re-review fixes ------------------------------------------------------------------------------------------------
test('Sana correction recomputes the score exactly like evaluate() (clamp at 90) and also covers job-board rows', () => {
  const w = world();
  const bd = (n) => JSON.stringify({ rule_version: 'cloud-conservative-review-1', preliminary: true, matched_skills: Array.from({ length: n }, (_, i) => 's' + i) });
  w.job('k1', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 'k1', 90, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, bd: bd(6) });   // stored min(90,98); new Worker: min(90,88) = 88
  w.job('k2', 'Reliability Engineer', 'Pune, India'); w.row(S, 'k2', 90, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, bd: bd(8) });    // clamp: new Worker also 90
  w.job('k3', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 'k3', 66, { elig: 'UNKNOWN', reason: 'Reported by a job board', bd: bd(2) });  // board row: bonus was added before eligibility was forced to UNKNOWN -> 56
  w.job('k4', 'Reliability Engineer', 'Remote - India', 'REMOTE_RESTRICTED'); w.row(S, 'k4', 66, { elig: 'UNKNOWN', reason: 'Reported by a job board', bd: bd(2) });     // remote: untouched
  w.run();
  assert.deepEqual(['k1', 'k2', 'k3', 'k4'].map((id) => w.score(S, id)), [88, 90, 56, 66]);
  const fresh = evaluate({ id: 'sana_ansari', primary_skills: JSON.stringify(['s0', 's1', 's2', 's3', 's4', 's5']) }, { id: 'x', title: 'Reliability Engineer', url: 'https://example.com/x', location: 'Mumbai, India', description: 's0 s1 s2 s3 s4 s5 reliability', remote: false });
  assert.equal(fresh.score, 88, 'a fresh evaluation agrees with the corrected stored row');
  assert.equal(w.elig(S, 'k3'), 'UNKNOWN');
});

test('Sana: only unverified airport accessibility becomes unknown. Relocation routes stay eligible, statuses and lanes do not change, the profile keeps its relocation preferences', () => {
  // routes to ELIGIBLE other than a city name are unchanged
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Remote - India', 'Reliability and Plant Engineering.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Dubai, UAE', 'Reliability and Plant Engineering. Relocation assistance provided.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Berlin, Germany', 'Reliability and Plant Engineering. Visa sponsorship available.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Remote - Worldwide', 'Reliability. Worldwide remote work.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Dubai, UAE', 'Reliability and Plant Engineering.')).eligibility, 'UNKNOWN', 'unchanged: no affirmative evidence');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability.')).eligibility, 'UNKNOWN');
  assert.notEqual(evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability.')).status, 'INELIGIBLE', 'an unverified city is reviewed, never excluded');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability and Plant Engineering.')).lane, 'STRONGEST_FIT', 'the lane is unchanged');
});

test('Sana correction changes eligibility_status/eligibility_reason and score only: never the qualification status, lane or any decision', () => {
  const w = world();
  w.job('m1', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 'm1', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON });
  const cols = () => JSON.stringify(w.sqlite.prepare("SELECT qualification_status, strategy_lane, manual_override_status, manual_override_reason, qualified_at FROM candidate_qualifications WHERE candidate_id='sana_ansari' AND job_id='m1'").get());
  const before = cols(); w.run();
  assert.equal(cols(), before);
  assert.equal(w.elig(S, 'm1'), 'UNKNOWN');
});

test('foreign location: exclusion phrases are not US locations; more places and states are covered; plural target words are recognised', () => {
  for (const l of ['Remote, excluding the US', 'Worldwide (excluding US)', 'Remote, anywhere except U.S.', 'Remote - outside of the United States']) assert.equal(foreignLocation(l), false, l);
  for (const l of ['Remote - EU', 'Tokyo, Japan', 'Stockholm, Sweden', 'Manila, Philippines', 'Nashville, TN', 'Las Vegas, NV']) assert.equal(foreignLocation(l), true, l);
  assert.equal(avoidedTitle('farhan_shaikh', 'Technical Support Engineer – Integrations'), false);
});

test('Sana remote-in-India rows keep ELIGIBLE and their score; only the stored reason text is aligned, once', () => {
  const w = world();
  w.job('r1', 'Reliability Engineer', 'Remote - India', 'REMOTE_RESTRICTED');
  w.row(S, 'r1', 74, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON });
  const p = w.run();
  assert.equal(w.score(S, 'r1'), 74); assert.equal(w.elig(S, 'r1'), 'ELIGIBLE');
  assert.equal(w.sqlite.prepare("SELECT eligibility_reason r FROM candidate_qualifications WHERE job_id='r1'").get().r, 'Remote role in India.');
  assert.equal(p.counts.sana_accessibility, 0); assert.equal(w.run().statements.length, 0);
});

test('review round 3: exclusion lists, non-US forms, Indian TN, board rows and the narrow Sana city test', async () => {
  for (const l of ['Remote, excluding US and Canada', 'Remote, excluding US, UK', 'Remote, outside the UK or Europe', 'Remote, non-US', 'Remote (excl. US)', 'Remote, ex-US', 'Remote - not US', 'Remote - anywhere but the US', 'Remote - APAC (no US)', 'Coimbatore, TN', 'Madurai, TN'])
    assert.equal(foreignLocation(l), false, l);
  for (const l of ['Remote - US', 'Austin, TX', 'London, UK', 'New York, NY']) assert.equal(foreignLocation(l), true, l);
  const { sanaIndiaCity } = await import('../worker/discovery.ts');
  assert.equal(sanaIndiaCity('Kolkata, West Bengal'), false); assert.equal(sanaIndiaCity('Mumbai, India'), true);
  const w = world();
  // a board row for Sana in a city the Worker does not treat as Indian, scored from sponsorship: untouched
  w.job('k1', 'Reliability Engineer', 'Kolkata, West Bengal');
  w.row(S, 'k1', 58, { elig: 'UNKNOWN', reason: 'Reported by Some Board; employer availability and eligibility are unverified.', bd: JSON.stringify({ rule_version: 'cloud-conservative-review-1', matched_skills: ['a'] }) });
  // a Farhan board row: eligibility was forced to UNKNOWN after scoring, so no foreign-location penalty
  w.job('k2', 'Implementation Manager', 'Remote (US)', 'REMOTE_RESTRICTED', 'CRM Configuration. Remote in India welcome.');
  w.row(F, 'k2', 58, { elig: 'UNKNOWN', reason: 'Reported by Some Board; employer availability and eligibility are unverified.' });
  // the Worker scored these with the eligibility evaluate() gave BEFORE the board override, so the script re-runs evaluate() on the stored posting:
  const BR = 'Reported by Some Board; employer availability and eligibility are unverified.';
  w.job('k5', 'Implementation Manager', 'London, UK', 'UNKNOWN', 'CRM Configuration and workflow automation.'); w.row(F, 'k5', 64, { elig: 'UNKNOWN', reason: BR });   // not eligible, foreign -> 49
  w.job('k6', 'Implementation Manager', 'London, UK', 'UNKNOWN', null); w.row(F, 'k6', 64, { elig: 'UNKNOWN', reason: BR });                                         // posting not stored -> left alone
  w.job('k7', 'Software Engineer', 'London, UK', 'UNKNOWN', 'Build services.'); w.row(F, 'k7', 64, { elig: 'UNKNOWN', reason: BR });                                  // cap 40, then -15 -> 25
  const p = w.run();
  assert.equal(w.score(F, 'k5'), 49); assert.equal(w.score(F, 'k6'), 64); assert.equal(w.score(F, 'k7'), 25);
  assert.equal(w.score(S, 'k1'), 58); assert.equal(w.score(F, 'k2'), 58); assert.equal(p.counts.sana_accessibility, 0);
});

test('exclusion lists with ", and" and "not in the US" are not foreign; real places after an exclusion stay foreign', () => {
  for (const l of ['Remote, excluding US, Canada, and Europe', 'Remote, not in the US', 'Remote, excluding the US and UK']) assert.equal(foreignLocation(l), false, l);
  for (const l of ['Remote, excluding Canada, London', 'Remote - not UK, Berlin', 'Mexico City', 'Nottingham, UK']) assert.equal(foreignLocation(l), true, l);
});

test('Sana: relocation interest and worldwide remote are never proof by themselves; the gates need posting evidence and never reach READY', () => {
  const base = { id: 'sana_ansari', primary_skills: JSON.stringify(['reliability']) };
  const post = (location, description, remote = false) => ({ id: 'x', title: 'Reliability Engineer', url: 'https://example.com/x', location, description, remote });
  // the candidate's stated interest in relocating is not an input to the screen
  for (const d of ['Reliability and Plant Engineering.']) for (const loc of ['Dubai, UAE', 'Berlin, Germany', 'Remote']) {
    const a = evaluate({ ...base, relocation_interest: true }, post(loc, d)), b = evaluate({ ...base, relocation_interest: false }, post(loc, d)), c = evaluate(base, post(loc, d));
    assert.deepEqual(a, b); assert.deepEqual(a, c); assert.equal(a.eligibility, 'UNKNOWN', loc + ': no posting evidence');
  }
  // 'Remote' alone (no worldwide statement) and a bare relocation mention in a negated form are not evidence
  assert.equal(evaluate(base, post('Remote', 'Reliability role.', true)).eligibility, 'UNKNOWN');
  assert.equal(evaluate(base, post('Berlin, Germany', 'Reliability role. We do not offer visa sponsorship.')).eligibility, 'UNKNOWN');
  assert.equal(evaluate(base, post('Remote - US', 'Reliability role. Worldwide remote work. US residents only.')).eligibility, 'UNKNOWN');
  assert.equal(evaluate(base, post('Remote', 'Reliability role. Active secret clearance required. Worldwide remote work.')).eligibility, 'INELIGIBLE');
  // where the posting itself states it, the result is ELIGIBLE for LOCATION only: the reason says review is still required, and the status is never READY
  const sp = evaluate(base, post('Berlin, Germany', 'Reliability role. Visa sponsorship available.')), wr = evaluate(base, post('Remote - Worldwide', 'Reliability. Worldwide remote work.'));
  assert.equal(sp.eligibility, 'ELIGIBLE'); assert.match(sp.reason, /requires review/); assert.equal(wr.eligibility, 'ELIGIBLE');
  for (const r of [sp, wr]) { assert.ok(['NEEDS_REVIEW', 'HOLD'].includes(r.status)); assert.match(r.qualification_reason, /review before READY|retained for review/); }
});

test('review round 4: a denial anywhere beats a welcoming sponsorship phrase; words ending in not/no/ex are not exclusions', () => {
  const sa = { id: 'sana_ansari', primary_skills: '[]' };
  const mk = (d) => evaluate(sa, { id: 'x', title: 'Reliability Engineer', url: 'https://e.com/x', location: 'Berlin, Germany', description: d, remote: false });
  assert.equal(mk('International applicants welcome. We do not offer visa sponsorship.').eligibility, 'UNKNOWN');
  assert.equal(mk('No relocation assistance, but visa sponsorship available.').eligibility, 'UNKNOWN');
  assert.equal(mk('Visa sponsorship available.').eligibility, 'ELIGIBLE');
  assert.equal(foreignLocation('Mexico'), true); assert.equal(foreignLocation('Remote, excluding the US'), false);
  assert.equal(foreignLocation('Remote, non-US'), false); assert.equal(foreignLocation('Remote, ex-US'), false);
});

test('Greenhouse postings whose absolute_url is the employer careers page are kept with the canonical Greenhouse link; invalid ones still fail loudly', async () => {
  const { normalize, greenhouseBoardURL } = await import('../worker/discovery.ts');
  const src = { id: 'greenhouse:elastic', kind: 'greenhouse', slug: 'elastic', name: 'Elastic', cursor: 0, failures: 0 };
  const posting = (o) => ({ id: 8346463, title: 'Senior Solutions Architect', absolute_url: 'https://jobs.elastic.co/jobs?gh_jid=8346463', location: { name: 'Mexico City' }, content: 'Solutions work', ...o });
  const kept = normalize(src, posting({}));
  assert.equal(kept.url, 'https://boards.greenhouse.io/elastic/jobs/8346463'); assert.equal(kept.url, greenhouseBoardURL('elastic', 8346463));
  assert.equal(kept.title, 'Senior Solutions Architect');
  // an official Greenhouse link is used as given; an arbitrary or non-https host is never copied into the application link
  assert.equal(normalize(src, posting({ absolute_url: 'https://job-boards.greenhouse.io/elastic/jobs/8346463' })).url, 'https://job-boards.greenhouse.io/elastic/jobs/8346463');
  assert.equal(normalize(src, posting({ absolute_url: 'http://evil.example/x' })).url, 'https://boards.greenhouse.io/elastic/jobs/8346463');
  assert.equal(normalize(src, posting({ absolute_url: undefined })).url, 'https://boards.greenhouse.io/elastic/jobs/8346463');
  // real defects are still errors, with a message that says which
  assert.throws(() => normalize(src, posting({ title: '' })), /missing title/);
  assert.throws(() => normalize(src, posting({ id: undefined })), /stable ID/);
  const lever = { id: 'lever:acme', kind: 'lever', slug: 'acme', name: 'Acme', cursor: 0, failures: 0 };
  assert.throws(() => normalize(lever, { id: 'abc', text: 'Implementation Manager', hostedUrl: 'https://evil.example/abc', categories: {}, descriptionPlain: 'x' }), /not an official HTTPS URL/);
  assert.equal(normalize(lever, { id: 'abc', text: 'Implementation Manager', hostedUrl: 'https://jobs.lever.co/acme/abc', categories: {}, descriptionPlain: 'x' }).url, 'https://jobs.lever.co/acme/abc');
});

test('end to end: a queued Greenhouse posting on an employer-hosted careers page is stored (canonical link), not failed; a posting without a title still fails and is recorded', async () => {
  const { runDiscovery } = await import('../worker/discovery.ts');
  const { sqlite, d1 } = createDb(); seed(sqlite);
  sqlite.exec("UPDATE cloud_automation SET enabled=1, lease_until=0 WHERE id=1");
  sqlite.exec("INSERT OR IGNORE INTO cloud_sources(id,kind,slug,name,enabled,next_due) VALUES ('greenhouse:elastic','greenhouse','elastic','Elastic',1,9999999999)");
  const queue = (id, payload) => sqlite.prepare("INSERT INTO cloud_discovery_queue(id,source_id,posting_id,payload,state,next_due,updated_at) VALUES (?,?,?,?, 'PENDING', 0, 'x')").run('greenhouse:elastic:' + id, 'greenhouse:elastic', id, JSON.stringify(payload));
  queue('8346463', { id: 8346463, title: 'Senior Solutions Architect' });
  const transport = async (url) => new Response(JSON.stringify(String(url).includes('8346463')
    ? { id: 8346463, title: 'Senior Solutions Architect', absolute_url: 'https://jobs.elastic.co/jobs?gh_jid=8346463', location: { name: 'Mumbai, India' }, content: '<p>CRM configuration and workflow automation.</p>' }
    : { id: 1, title: '', absolute_url: 'https://jobs.elastic.co/jobs?gh_jid=1', content: '<p>x</p>' }), { status: 200 });
  const ok = await runDiscovery({ DB: d1 }, 'MANUAL', transport, 'greenhouse:elastic');
  assert.equal(ok.status, 'SUCCESS');
  const job = sqlite.prepare("SELECT original_posting_url u, title FROM jobs WHERE id = 'greenhouse:elastic:8346463'").get();
  assert.equal(job.u, 'https://boards.greenhouse.io/elastic/jobs/8346463');
  assert.equal(sqlite.prepare("SELECT state FROM cloud_discovery_queue WHERE id='greenhouse:elastic:8346463'").get().state, 'DONE');
  queue('1', { id: 1, title: '' });
  const bad = await runDiscovery({ DB: d1 }, 'MANUAL', transport, 'greenhouse:elastic');
  assert.equal(bad.status, 'ERROR'); assert.match(bad.error, /missing title/);
  const row = sqlite.prepare("SELECT attempts, last_error FROM cloud_discovery_queue WHERE id='greenhouse:elastic:1'").get();
  assert.equal(row.attempts, 1); assert.match(row.last_error, /missing title/);
});

test('a posting the employer ATS answers 404 for is recorded as removed and its job closed; an applied-to or decided job stays; other errors still fail', async () => {
  const { runDiscovery } = await import('../worker/discovery.ts');
  const { sqlite, d1 } = createDb(); seed(sqlite);
  sqlite.exec("UPDATE cloud_automation SET enabled=1, lease_until=0 WHERE id=1");
  sqlite.exec("INSERT OR IGNORE INTO cloud_sources(id,kind,slug,name,enabled,next_due) VALUES ('greenhouse:elastic','greenhouse','elastic','Elastic',1,9999999999)");
  const queue = (id) => sqlite.prepare("INSERT INTO cloud_discovery_queue(id,source_id,posting_id,payload,state,next_due,updated_at) VALUES (?,?,?,?, 'PENDING', 0, 'x')").run('greenhouse:elastic:' + id, 'greenhouse:elastic', id, '{}');
  const stored = (id) => {
    sqlite.prepare("INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at) VALUES (?,?,?,?,1,'2026-11-01')").run('gh:' + id, 'Role ' + id, 'Elastic', 'greenhouse');
    sqlite.prepare("INSERT INTO cloud_job_evidence(job_id,source_id,posting_id,content_sha256,fetched_at,rule_version) VALUES (?,?,?,?,?,?)").run('gh:' + id, 'greenhouse:elastic', id, 'x', 'x', 'x');
  };
  stored('g1'); stored('g2'); stored('g3');
  sqlite.prepare("INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('ap','farhan_shaikh','gh:g2','APPLIED')").run();
  const transport = async (url) => String(url).includes('/g9') ? new Response('{}', { status: 500 }) : new Response('not found', { status: 404 });
  for (const id of ['g1', 'g2', 'g4']) {
    queue(id);
    const r = await runDiscovery({ DB: d1 }, 'MANUAL', transport, 'greenhouse:elastic');
    assert.equal(r.status, 'SUCCESS', id); assert.equal(r.posting_closed, true, id);
    assert.equal(sqlite.prepare('SELECT state, last_error FROM cloud_discovery_queue WHERE posting_id = ?').get(id).state, 'GONE', id);
  }
  const active = (id) => sqlite.prepare('SELECT is_active a, expired_at e FROM jobs WHERE id = ?').get('gh:' + id);
  assert.equal(active('g1').a, 0); assert.ok(active('g1').e, 'closing time recorded');
  assert.equal(active('g2').a, 1, 'a job someone applied to is left as it is');
  assert.equal(active('g3').a, 1, 'a job whose posting was not checked is untouched');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM applications WHERE id='ap'").get().n, 1);
  queue('g9');
  const err = await runDiscovery({ DB: d1 }, 'MANUAL', transport, 'greenhouse:elastic');
  assert.equal(err.status, 'ERROR', 'a server error is not mistaken for a removed posting');
  assert.equal(sqlite.prepare("SELECT state FROM cloud_discovery_queue WHERE posting_id='g9'").get().state, 'PENDING');
});
