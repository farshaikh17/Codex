import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { seed } from './fixtures.mjs';
import { VISA_UNLIKELY_CAP, evaluate, avoidedTitle, foreignLocation, remoteFromStored, AVOID_TITLE_CAP, FOREIGN_LOCATION_PENALTY, SANA_OLD_ACCESS_REASON, SANA_UNKNOWN_ACCESS_REASON } from '../worker/discovery.ts';
import { plan, SELECT_ROWS } from '../scripts/rescore_ranking_v2.mjs';
import * as DISCOVERY from '../worker/discovery.ts';
const SANA_INDIA_ONSITE_REASON_P2 = DISCOVERY.SANA_INDIA_ONSITE_REASON;

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
  for (const t of ['Software Engineer', 'DevOps Engineer', 'Site Reliability Engineer', 'Machine Learning Engineer', 'Security Engineer', 'Finance Manager', 'Customer Support Specialist', 'Engineering Manager', 'SDET', 'Business Systems Analyst', 'Senior Business Systems Analyst', 'Sales Engineer', 'Pre-Sales Consultant', 'Treasury Consultant', 'Senior Consultant – Ripple Treasury (GTreasury)', 'Strategic Solutions Engineer', 'Commercial Operations Specialist', 'Cyber Operations Lead, Critical Harm Operations', 'Compensation Operations Analyst', 'Pricing Operations Lead', 'Senior Specialist, T2 / Target2 Payment Operations'])
    assert.ok(avoidedTitle('farhan_shaikh', t), t);
  for (const t of ['Implementation Manager', 'Technical Operations Lead', 'Solutions Implementation Specialist', 'CRM Administrator', 'Support Operations Lead', 'Revenue Operations Analyst', 'Marketing Operations Manager',
    'Commercial Operations Specialist (RevOps)', 'Revenue Operations - Commercial Operations Specialist'])   // jobs QA 13 Nov: RevOps in the title lets it through
    assert.ok(!avoidedTitle('farhan_shaikh', t), t);
  assert.ok(avoidedTitle('sana_ansari', 'Software Engineer') && !avoidedTitle('sana_ansari', 'Reliability Engineer'), "Sana's own list: software and IT-reliability titles only (owner review 2026-11-12)");
  assert.ok(!avoidedTitle('sana_ansari', 'Implementation Manager'), 'Farhan\'s list is not applied to Sana');
});

test('ranking: a posting whose only stated location is outside India loses points for Farhan unless it supports remote work from India', () => {
  const india = evaluate(farhan, post('Implementation Manager', 'Remote - India'));
  // a remote role limited to another country is ruled out (jobs QA 13 Nov); one whose text also names Asia or India keeps the penalty instead
  const us = evaluate(farhan, post('Implementation Manager', 'Remote, London, United Kingdom', 'CRM Configuration and Workflow Automation. Clients across Asia.'));
  const usSame = evaluate({ ...farhan }, post('Implementation Manager', 'Remote', 'CRM Configuration and Workflow Automation. Clients across Asia.'));
  assert.equal(evaluate(farhan, post('Implementation Manager', 'Remote, London, United Kingdom', 'CRM Configuration and Workflow Automation.')).eligibility, 'INELIGIBLE');
  assert.equal(foreignLocation('Austin, TX'), true); assert.equal(foreignLocation('London, United Kingdom'), true);
  assert.equal(foreignLocation('Remote'), false); assert.equal(foreignLocation('Bengaluru, India'), false); assert.equal(foreignLocation(''), false);
  assert.equal(us.score, Math.max(0, usSame.score - FOREIGN_LOCATION_PENALTY), `${us.score} vs ${usSame.score}`);
  assert.equal(india.eligibility, 'ELIGIBLE'); assert.ok(india.score >= us.score);
  assert.equal(us.eligibility, 'UNKNOWN', 'eligibility rules are not changed by the penalty');
  // Sana relocates anywhere: no foreign-location penalty, but an on-site role abroad needs a realistic route from India
  // (the Gulf, or a visa sponsorship offer); otherwise its score is capped at VISA_UNLIKELY_CAP (owner rule 2026-11-07, cap since 2026-11-12)
  const sb = evaluate(sana, post('Reliability Engineer', 'Remote', 'Reliability and Plant Engineering role.'));
  const london = evaluate(sana, post('Reliability Engineer', 'London, United Kingdom', 'Reliability and Plant Engineering role.'));
  const sponsored = evaluate(sana, post('Reliability Engineer', 'London, United Kingdom', 'Reliability and Plant Engineering role. Visa sponsorship available.'));
  const dubai = evaluate(sana, post('Reliability Engineer', 'Dubai, United Arab Emirates', 'Reliability and Plant Engineering role.'));
  assert.equal(london.score, Math.min(sb.score, VISA_UNLIKELY_CAP)); assert.match(london.qualification_reason, /no visa route from India/);
  assert.ok(sponsored.score >= sb.score, 'a sponsorship offer removes the penalty');
  assert.equal(dubai.score, sb.score, 'the Gulf is a normal route from India');
});


// ---- title and location rules (shared by the Worker and the correction script) -------------------------------------
test('avoid list: software/ML/security/test families always; finance/support/management families unless the title names his own target areas', () => {
  for (const t of ['Software Engineer', 'Senior Backend Engineer', 'Backend|Engineer', 'Software Engineer–Platform', 'Implementation Engineer - Backend/API', 'DevOps Engineer', 'Site Reliability Engineer', 'SRE', 'Machine Learning Engineer', 'Data Scientist', 'Security Engineer', 'SDET', 'QA Engineer', 'Test Automation Lead', 'Finance Manager', 'Financial Controller', 'Payroll Specialist', 'Customer Support Specialist', 'Support Engineer', 'Engineering Manager', 'Director of Engineering', 'Accountant',
    // jobs QA 13 Nov: other fields that came in through 'operations', 'solutions' or 'architect'
    'Solutions Engineering Manager', 'Engineering Manager - Solutions Engineering', 'Senior Solutions Architect', 'Systems Architect / Engineering Architecture Lead', 'Staff Engineer - CRM & Automation',
    'Principal Engineer, Solutions Architecture', 'Infrastructure Operations Engineer', 'L2 Cloud Operations Engineer', 'Platform Operations Manager', 'Sr. Product Manager - Custom Objects & CRM Data Platform',
    'Central Monitoring Operations Manager - Clinical', 'Territory Operations Manager - India & Subcontinent', 'Senior ATQC - Automation Frameworks', 'Test Automation Framework Lead'])
    assert.ok(avoidedTitle('farhan_shaikh', t), `${t} should be capped`);
  for (const t of ['Implementation Manager', 'Technical Operations Lead', 'Solutions Implementation Specialist', 'CRM Administrator', 'Finance Systems Analyst',
    'Solutions Consultant', 'Revenue Operations Manager', 'Implementation Support Specialist', 'Automation Specialist', 'Business Systems Lead', 'CRM Operations Specialist', 'Technical Delivery Manager', 'Payroll Implementation Specialist', 'Customer Support Operations Manager', 'Air Traffic Controller', 'Implementation Manager, Software Onboarding', 'Presre Lead'])
    assert.ok(!avoidedTitle('farhan_shaikh', t), `${t} should not be capped`);
  assert.ok(!avoidedTitle('sana_ansari', 'Customer Support Manager'), 'Farhan\'s families are not applied to Sana');
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

test('correction (Sana): city-list rows stay eligible with their score (owner decision 2026-11-12), only the reason text changes; decided rows untouched', () => {
  const w = world();
  w.job('s1', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 's1', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON });                                   // -> UNKNOWN, 50
  w.job('s2', 'Reliability Engineer', 'Remote - India', 'REMOTE_RESTRICTED'); w.row(S, 's2', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON });          // remote, old reason: untouched
  w.job('s3', 'Reliability Engineer', 'Pune, India'); w.row(S, 's3', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, override: 'READY' });               // override: untouched
  w.job('s4', 'Reliability Engineer', 'Pune, India'); w.row(S, 's4', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, status: 'READY' });                  // READY: untouched
  w.job('s5', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 's5', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, lane: 'UNASSIGNED' });            // no role bonus to remove
  w.job('s6', 'Reliability Engineer', 'Remote'); w.row(S, 's6', 60, { elig: 'ELIGIBLE', reason: 'Remote role in India.' });                                      // new-style: untouched
  w.run();
  assert.deepEqual(['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => [w.elig(S, id), w.score(S, id)]),
    [['ELIGIBLE', 60], ['ELIGIBLE', 60], ['ELIGIBLE', 60], ['ELIGIBLE', 60], ['ELIGIBLE', 60], ['ELIGIBLE', 60]]);
  assert.match(w.sqlite.prepare("SELECT eligibility_reason r FROM candidate_qualifications WHERE candidate_id='sana_ansari' AND job_id='s1'").get().r, /owner decision 2026-11-12/);
  assert.equal(w.sqlite.prepare("SELECT eligibility_reason r FROM candidate_qualifications WHERE candidate_id='sana_ansari' AND job_id='s3'").get().r, SANA_OLD_ACCESS_REASON, 'an overridden row is not touched');
  assert.equal(w.run().statements.length, 0, 'idempotent');
});

test('correction: the write estimate counts the score index, and the preliminary scores of other rules are never selected', () => {
  const w = world();
  w.job('d1', 'DevOps Engineer', 'Remote'); w.row(F, 'd1', 66);
  const p = plan(w.sqlite.prepare(SELECT_ROWS).all());
  assert.equal(p.counts.score_rows, 1); assert.equal(p.counts.estimated_rows_written, 2);
  assert.ok(!SELECT_ROWS.includes('applications') && !SELECT_ROWS.includes('application_history'), 'the script never reads the tracker');
});

test('Sana: on-site and remote roles in India are both eligible (owner decision 2026-11-12; was UNKNOWN until airport access was verified)', () => {
  const city = evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability and Plant Engineering role at our plant.'));
  const remoteIndia = evaluate(sana, { ...post('Reliability Engineer', 'Remote - India', 'Reliability and Plant Engineering role.'), remote: true });
  const pune = evaluate(sana, post('Plant Engineer', 'Pune, Maharashtra, India', 'Plant Engineering role.'));
  assert.equal(city.eligibility, 'ELIGIBLE'); assert.match(city.reason, /owner decision 2026-11-12/);
  assert.equal(pune.eligibility, 'ELIGIBLE');
  assert.equal(remoteIndia.eligibility, 'ELIGIBLE'); assert.equal(remoteIndia.reason, 'Remote role in India.');
  assert.ok(city.score >= 50, `the eligibility bonus applies to an Indian city again (${city.score})`);
  assert.equal(evaluate(sana, post('Reliability Engineer', 'London, United Kingdom', 'Reliability role. Visa sponsorship available.')).eligibility, 'ELIGIBLE', 'other rules are unchanged');
});

// ---- re-review fixes ------------------------------------------------------------------------------------------------
test('Sana correction: an old city-list row keeps ELIGIBLE and its score (reason text updated); job-board rows still lose the bonus', () => {
  const w = world();
  const bd = (n) => JSON.stringify({ rule_version: 'cloud-conservative-review-1', preliminary: true, matched_skills: Array.from({ length: n }, (_, i) => 's' + i) });
  w.job('k1', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 'k1', 90, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, bd: bd(6) });   // stored min(90,98); new Worker: min(90,88) = 88
  w.job('k2', 'Reliability Engineer', 'Pune, India'); w.row(S, 'k2', 90, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON, bd: bd(8) });    // clamp: new Worker also 90
  w.job('k3', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 'k3', 66, { elig: 'UNKNOWN', reason: 'Reported by a job board', bd: bd(2) });  // board row: bonus was added before eligibility was forced to UNKNOWN -> 56
  w.job('k4', 'Reliability Engineer', 'Remote - India', 'REMOTE_RESTRICTED'); w.row(S, 'k4', 66, { elig: 'UNKNOWN', reason: 'Reported by a job board', bd: bd(2) });     // remote: untouched
  w.run();
  assert.deepEqual(['k1', 'k2', 'k3', 'k4'].map((id) => w.score(S, id)), [90, 90, 56, 66]);
  assert.equal(w.elig(S, 'k1'), 'ELIGIBLE');
  const fresh = evaluate({ id: 'sana_ansari', primary_skills: JSON.stringify(['s0', 's1', 's2', 's3', 's4', 's5']) }, { id: 'x', title: 'Reliability Engineer', url: 'https://example.com/x', location: 'Mumbai, India', description: 's0 s1 s2 s3 s4 s5 reliability', remote: false });
  assert.equal(fresh.score, 90, 'a fresh evaluation agrees with the stored row');
  assert.equal(w.elig(S, 'k3'), 'UNKNOWN');
});

test('Sana: Indian cities are eligible; relocation routes stay eligible, statuses and lanes do not change, the profile keeps its relocation preferences', () => {
  // routes to ELIGIBLE other than a city name are unchanged
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Remote - India', 'Reliability and Plant Engineering.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Dubai, UAE', 'Reliability and Plant Engineering. Relocation assistance provided.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Berlin, Germany', 'Reliability and Plant Engineering. Visa sponsorship available.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Remote - Worldwide', 'Reliability. Worldwide remote work.')).eligibility, 'ELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Dubai, UAE', 'Reliability and Plant Engineering.')).eligibility, 'UNKNOWN', 'unchanged: no affirmative evidence');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability.')).eligibility, 'ELIGIBLE');
  assert.notEqual(evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability.')).status, 'INELIGIBLE');
  assert.equal(evaluate(sana, post('Reliability Engineer', 'Mumbai, India', 'Reliability and Plant Engineering.')).lane, 'STRONGEST_FIT', 'the lane is unchanged');
});

test('Sana correction changes eligibility_status/eligibility_reason and score only: never the qualification status, lane or any decision', () => {
  const w = world();
  w.job('m1', 'Reliability Engineer', 'Mumbai, India'); w.row(S, 'm1', 60, { elig: 'ELIGIBLE', reason: SANA_OLD_ACCESS_REASON });
  const cols = () => JSON.stringify(w.sqlite.prepare("SELECT qualification_status, strategy_lane, manual_override_status, manual_override_reason, qualified_at FROM candidate_qualifications WHERE candidate_id='sana_ansari' AND job_id='m1'").get());
  const before = cols(); w.run();
  assert.equal(cols(), before);
  assert.equal(w.elig(S, 'm1'), 'ELIGIBLE');
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
  assert.equal(sanaIndiaCity('Kathmandu, Nepal'), false); assert.equal(sanaIndiaCity('Mumbai, India'), true);   // Kolkata counts as India since phase 2 (S1)
  const w = world();
  // a board row for Sana in a city the Worker does not treat as Indian, scored from sponsorship: untouched
  w.job('k1', 'Reliability Engineer', 'Kathmandu, Nepal');
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

test('skills count when their key words appear, not only the exact phrase; a lone generic word is not enough', async () => {
  const { skillFound, evaluate } = await import('../worker/discovery.ts');
  const t = 'you will configure the crm and build automation of workflows using apis for a technical team';
  assert.equal(skillFound('CRM Configuration', t), true);
  assert.equal(skillFound('Workflow Automation', t), true);
  assert.equal(skillFound('AI-assisted workflows', t), false, 'only "workflows" remains: not enough on its own');
  assert.equal(skillFound('GoHighLevel', t), false);
  assert.equal(skillFound('Reliability', 'plant reliability programs'), true);
  assert.equal(skillFound('Electrical Maintenance', 'maintenance of electrical systems'), true);
  assert.equal(skillFound('Electrical Maintenance', 'electrical design only'), false);
  // the review's false matches stay false: a word must be a word of its own, single-word skills match exactly, words must be close
  for (const [skill, text] of [['Sales', 'salary negotiable'], ['Ads', 'address and advanced'], ['Gas', 'gain experience'], ['Commissioning', 'commission-based'],
    ['Open Source', 'sourcing open roles'], ['Writing', 'write code'], ['Operations', 'operator role'], ['Technical Team Leadership', 'technical skills. ' + 'x'.repeat(200) + ' leadership']])
    assert.equal(skillFound(skill, text), false, `${skill} / ${text.slice(0, 30)}`);
  // never fewer matches than the exact-phrase rule
  const exact = (s, x) => x.includes(s.toLowerCase());
  for (const s of ['CRM Configuration', 'Workflow Automation', 'GoHighLevel']) if (exact(s, 'crm configuration and workflow automation in gohighlevel')) assert.equal(skillFound(s, 'crm configuration and workflow automation in gohighlevel'), true);
  const p = { id: 'x', title: 'Implementation Manager', url: '', location: 'Remote - India', description: 'Fully remote. You will configure our CRM and own automation of sales workflows.', remote: true };
  assert.equal(evaluate({ id: 'farhan_shaikh', primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'GoHighLevel']) }, p).score, 50 + 16, 'two skills found by key words');
});

// ---- Spot check of 12 Nov 2026: roles far below the candidate, platform-specific roles, QA roles ----------------------------------
import { underLevel, yearsCeiling, platformGap, UNDER_LEVEL_CAP, PLATFORM_GAP_CAP } from '../worker/discovery.ts';

test('a role pitched well below the candidate is capped: by title, or by an experience range that tops out at half their experience', () => {
  const sana9 = { ...sana, total_years_experience: 9.2 };
  const REL = 'Reliability and Plant Engineering for the site.';
  const normal = evaluate(sana9, post('Maintenance Engineer', 'Pune, India', REL + ' 5 to 10 years of experience.'));
  const trainee = evaluate(sana9, post('DET Electrical – Trainee, Pune', 'Pune, India', REL));
  const range = evaluate(sana9, post('Electrical Maintenance Engineer', 'Pune, India', REL + ' Degree with 2 to 4 years of industrial experience.'));
  assert.ok(normal.score > UNDER_LEVEL_CAP, `a role at her level is not capped (${normal.score})`);
  assert.ok(trainee.score <= UNDER_LEVEL_CAP, `trainee title capped (${trainee.score})`);
  assert.ok(range.score <= UNDER_LEVEL_CAP, `a 2-4 year role capped for 9 years (${range.score})`);
  assert.match(trainee.qualification_reason, /below the candidate's experience/);
  assert.equal(trainee.status, normal.status, 'the bucket rule is unchanged; only the score is capped');
  assert.equal(yearsCeiling('1-3 years of experience in software testing'), 3);
  assert.equal(yearsCeiling('Experience 3-8 years of experience in facilities'), 8);
  assert.equal(yearsCeiling("Minimum 2 years' experience"), 0, 'a floor alone is not a range');
  for (const t of ['Jr. QA Automation (API)', 'Junior Engineer', 'Graduate Engineer Trainee', 'Maintenance Intern', 'Apprentice Electrician'])
    assert.ok(underLevel(t, '', 9), t);
  for (const t of ['Maintenance Engineer', 'Internal Systems Lead', 'Senior Reliability Engineer', 'Assistant Manager - Utilities'])
    assert.ok(!underLevel(t, '', 9), t);
  assert.ok(!underLevel('Junior Engineer', '', 3), 'not applied to someone early in their career');
  assert.ok(!underLevel('Shift Technician', '3-8 years of experience', 9.2), 'an 8-year ceiling is not below 9 years');
});

test('a role built around a platform the profile does not list is marked down; one it lists is not', () => {
  const f9 = { ...farhan, total_years_experience: 9.4, primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'GoHighLevel']) };
  const DESC = 'Fully remote role, open to candidates in India. CRM Configuration and Workflow Automation.';
  const plain = evaluate(f9, post('Implementation Lead', 'Remote - India', DESC));
  const workday = evaluate(f9, post('Sr. Systems Analyst – Workday Time & Absence Implementation Lead', 'Remote - India', DESC));
  const ghl = evaluate(f9, post('GoHighLevel Implementation Lead', 'Remote - India', DESC));
  assert.equal(workday.score, Math.min(plain.score, PLATFORM_GAP_CAP), `${plain.score} vs ${workday.score}`);   // a cap since phase 2 (S7)
  assert.ok(ghl.score >= plain.score, `a platform on the profile costs nothing (${ghl.score} vs ${plain.score})`);
  assert.match(workday.qualification_reason, /Built around workday/);
  assert.equal(platformGap('SAP PM Maintenance Planner', ['Maintenance Planning']), 'sap');
  assert.equal(platformGap('Maintenance Planner', ['Maintenance Planning']), null);
  assert.equal(platformGap('Sapphire Operations Lead', []), null, 'whole words only');
});

test('QA and test roles are on Farhan\'s avoid list', () => {
  for (const t of ['Jr. QA Automation (API) - Bangalore, India', 'QA Analyst', 'Senior Test Engineer', 'Quality Assurance Lead'])
    assert.ok(avoidedTitle('farhan_shaikh', t), t);
  assert.ok(!avoidedTitle('farhan_shaikh', 'Implementation Manager'));
});

test('top-100 review (12 Nov): US relocation is not a visa route, Gulf nationals-only roles are excluded, software reliability and technician posts rank low', () => {
  const sa = { id: 'sana_ansari', primary_skills: JSON.stringify(['Breakdown Maintenance', 'Preventive Maintenance', 'Reliability', 'Root Cause Analysis']), total_years_experience: 9.2 };
  const fa = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['Workflow Automation', 'Process Design', 'Technical Delivery']), total_years_experience: 9 };
  const D = 'Lead breakdown maintenance and preventive maintenance; reliability and root cause analysis for the plant. 5+ years.';
  const mk = (who, title, location, description = D, remote = false) => evaluate(who, { id: 'x', title, company: 'Acme', url: 'https://e.com/x', location, description, remote });
  // a US on-site job that offers only relocation: not eligible-by-evidence, capped below the shortlist
  const us = mk(sa, 'Maintenance Supervisor', 'Montgomery, AL, United States', D + ' Relocation assistance available.');
  assert.equal(us.eligibility, 'UNKNOWN'); assert.ok(us.score <= VISA_UNLIKELY_CAP, String(us.score));
  // the same with a real visa route stays a candidate
  const visa = mk(sa, 'Maintenance Supervisor', 'Montgomery, AL, United States', D + ' Visa sponsorship available.');
  assert.equal(visa.eligibility, 'ELIGIBLE'); assert.ok(visa.score > VISA_UNLIKELY_CAP);
  // the Gulf keeps relocation as a route
  assert.equal(mk(sa, 'Maintenance Engineer', 'Jubail, Saudi Arabia', D + ' Relocation provided.').eligibility, 'ELIGIBLE');
  assert.ok(mk(sa, 'Maintenance Engineer', 'Al-Jubail, Saudi Arabia').score > VISA_UNLIKELY_CAP, 'the Gulf is not capped');
  // reserved for nationals
  assert.equal(mk(sa, 'Electrical Technician I(Saudi Nationals)', 'Jubail, Saudi Arabia').eligibility, 'INELIGIBLE');
  assert.equal(mk(sa, 'Maintenance Engineer', 'Doha, Qatar', D + ' This role is open to Qatari nationals only.').eligibility, 'INELIGIBLE');
  assert.notEqual(mk(sa, 'Maintenance Engineer', 'Doha, Qatar', D + ' We welcome Qatari nationals and expatriates.').eligibility, 'INELIGIBLE');
  // plant reliability vs software / hardware-test reliability
  const plant = mk(sa, 'Reliability Engineer', 'Pune, India');
  for (const t of ['Senior Site Reliability Engineer (Night Shift)', 'Senior Hardware Test and Reliability Engineer', 'SRE Lead', 'DevOps Reliability Engineer'])
    assert.ok(mk(sa, t, 'Pune, India').score < plant.score && mk(sa, t, 'Pune, India').score <= 40, t);
  // remote only inside another region, form-style "Sponsorship Available: No", and IT security consultants
  assert.ok(mk(sa, 'Reliability Engineer', 'Lakeville, MA', D, true).score <= VISA_UNLIKELY_CAP, 'remote within the US is not remote from India');
  assert.ok(mk(sa, 'Technical Consultant - Water Treatment', 'Remote (Albania, Austria, Belgium, Germany)', D, true).score <= VISA_UNLIKELY_CAP);
  assert.ok(mk(sa, 'Reliability Engineer', 'Remote - Worldwide', D + ' Worldwide remote work.', true).score > VISA_UNLIKELY_CAP, 'worldwide remote is fine');
  const bv = mk(sa, 'Mechanical Commissioning Engineer', 'Lathrop, MO, US', D + ' Relocation eligible : No Full time/Part time : Full-Time Visa Sponsorship Available: No Why Black & Veatch?');
  assert.equal(bv.eligibility, 'UNKNOWN'); assert.ok(bv.score <= VISA_UNLIKELY_CAP);
  assert.ok(mk(sa, 'Power Systems Engineer (Energy) - Bicester', 'Oxford, GB, OX27 7LT').score <= VISA_UNLIKELY_CAP, 'GB is abroad');
  assert.ok(mk(sa, 'Senior Technical Consultant - AI Security', 'Remote (India)', D, true).score <= 40, 'not her field');
  assert.ok(mk(sa, 'Reliability Engineer', 'Bangalore, India', 'Own reliability of our hardware products from design through manufacturing.').score <= 40, 'product reliability, no plant work');
  assert.ok(mk(sa, 'Hardware Reliability Engineer', 'Bangalore, India').score <= 40);
  assert.ok(mk(sa, 'Reliability Engineer', 'Bangalore, India', 'Plant equipment reliability and maintenance; product quality support.').score > 40, 'plant reliability stays');
  // technician posts are below a 9-year engineer
  assert.ok(mk(sa, 'Electrical Shift Technician – Facilities Operations', 'Sanand, India').score <= 40);
  assert.ok(mk(sa, 'Maintenance Manager', 'Hosur, Tamil Nadu, India').score > 40);
  // support tiers and plain associate titles are below a 9-year operator; associate director/manager are not
  const R = 'Fully remote, India. Workflow automation, process design and technical delivery.';
  assert.ok(mk(fa, 'L2 Cloud Operations Engineer (Azure & AWS)', 'Remote - India', R, true).score <= 40);
  assert.ok(mk(fa, 'Business Operations Associate', 'Remote - India', R, true).score <= 40);
  assert.ok(mk(fa, 'Associate Director, Business Operations', 'Remote - India', R, true).score > 40);
  assert.ok(mk(fa, 'Implementation Manager', 'Remote - India', R, true).score > 40);
});

test('ranking v3: a title naming a target role and a title at the candidate\'s level rank above an otherwise equal job; caps still win', async () => {
  const { TARGET_EXACT_BONUS, TARGET_WORD_BONUS, SENIORITY_BONUS, targetFit } = await import('../worker/discovery.ts');
  const fa = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['Workflow Automation', 'Process Design']), total_years_experience: 9,
    target_roles: JSON.stringify(['Implementation Manager', 'Automation Specialist', 'Revenue Operations Specialist']) };
  const D = 'Fully remote, India. Workflow automation and process design.';
  const mk = (title, who = fa) => evaluate(who, { id: 'x', title, company: 'Acme', url: 'https://e.com/x', location: 'Remote - India', description: D, remote: true });
  assert.equal(targetFit('Implementation Manager, EMEA', fa.target_roles), 'exact');
  assert.equal(targetFit('Implementation Consultant', fa.target_roles), 'word');
  assert.equal(targetFit('Solutions Engineer', fa.target_roles), null, 'generic words do not count');
  const base = mk('Solutions Engineer').score;
  assert.equal(mk('Automation Specialist').score, Math.min(95, base + TARGET_EXACT_BONUS));
  assert.equal(mk('Implementation Consultant').score, Math.min(95, base + TARGET_WORD_BONUS));
  assert.equal(mk('Senior Solutions Engineer').score, Math.min(95, base + SENIORITY_BONUS));
  assert.match(mk('Automation Specialist').qualification_reason, /target roles/);
  assert.ok(mk('Junior Automation Specialist').score <= 40, 'the under-level cap still wins over the bonus');
  const noTargets = { ...fa, target_roles: null };
  assert.equal(mk('Automation Specialist', noTargets).score, mk('Solutions Engineer', noTargets).score, 'no stored targets: no bonus');
});

test('live shortlist review (12 Nov 22:00): HR-pay and travel operations are not Farhan\'s; trading-systems reliability is not Sana\'s', () => {
  const fa = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['Workflow Automation', 'Process Design']), total_years_experience: 9 };
  const sa = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability', 'Root Cause Analysis']), total_years_experience: 9.2 };
  const mk = (who, title, loc, d) => evaluate(who, { id: 'x', title, company: 'Acme', url: 'https://e.com/x', location: loc, description: d, remote: /remote/i.test(loc) });
  const R = 'Fully remote, India. Workflow automation and process design.';
  for (const t of ['Senior Manager, Total Rewards Operations', 'Travel Operations Manager | Remote', 'Benefits Operations Specialist', 'Payroll Operations Analyst'])
    assert.ok(mk(fa, t, 'Remote - India', R).score <= 40, t);
  assert.ok(mk(fa, 'Revenue Operations Manager', 'Remote - India', R).score > 40, 'RevOps stays');
  assert.ok(mk(sa, 'Reliability Engineer II', 'Gurgaon, Haryana, India', 'Keep our low-latency trading infrastructure and Linux production systems reliable; root cause analysis.').score <= 40);
  assert.ok(mk(sa, 'Reliability Engineer', 'Pune, India', 'Plant equipment reliability, rotating equipment and maintenance; root cause analysis.').score > 40, 'plant reliability stays');
});

// ---- Phase 2 (plan section 6): sorting must agree with the profiles. Invented postings, each landing where the plan says it should. ----
const P2_SANA = { id: 'sana_ansari', total_years_experience: 9.2, qualification_threshold: 60,
  primary_skills: JSON.stringify(['Power Plant Operations', 'DCS Monitoring', 'Preventive Maintenance', 'Breakdown Maintenance', 'Rotating Equipment Maintenance', 'Root Cause Analysis', 'Reliability', 'Shutdown Planning', 'Maintenance Planning', 'Procurement', 'Contractor Supervision']),
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)', 'Power Plant Operations Engineer', 'Plant Engineer', 'Asset Performance Specialist', 'Energy Efficiency Engineer', 'Decarbonization Engineer']) };
const P2_FARHAN = { id: 'farhan_shaikh', total_years_experience: 9, qualification_threshold: 70,
  primary_skills: JSON.stringify(['GoHighLevel', 'CRM Configuration', 'Workflow Automation', 'API & Webhook Integration', 'Requirements Gathering', 'Product Implementation', 'Technical Delivery', 'Process Design', 'SOP Development', 'Stakeholder Management']),
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Automation Specialist', 'Technical Delivery Manager', 'Business Systems Lead', 'CRM / Revenue Operations Specialist']) };
const P2_PLANT = 'Responsible for preventive maintenance and breakdown maintenance of rotating equipment (pumps, compressors, turbines, boilers) at a 660 MW thermal power plant. Root cause analysis, shutdown planning, maintenance planning, reliability improvement, DCS monitoring, contractor supervision and procurement of spares. 8+ years of experience required.';
const P2_IMPL = 'Implement and configure our CRM for customers, build workflow automation, integrate APIs and webhooks, gather requirements from stakeholders, write SOPs and lead technical delivery of onboarding projects. 5+ years of experience.';
const p2eval = (who, title, location, description, remote = /remote/i.test(location), company = 'Acme') => evaluate(who, { id: 'x', title, company, url: 'https://e.com/x', location, description, remote });
/** Where a row lands under the shortlist rule (scripts/dataset_apply.mjs), ignoring the 25-row limits. */
function p2tier(who, r) {
  const thr = who.qualification_threshold;
  if (r.status === 'INELIGIBLE') return 'INELIGIBLE';
  if (r.status === 'HOLD') return 'HOLD';
  if (r.score <= 45) return 'HOLD';
  if (r.score >= thr && r.eligibility === 'ELIGIBLE') return 'READY';
  if ((r.score >= thr && r.eligibility === 'UNKNOWN') || (r.eligibility === 'ELIGIBLE' && r.score >= thr - 10)) return 'STRETCH';
  return 'REVIEW';
}

test('S1: Indian plant towns, states and union territories count as India; a namesake abroad does not', () => {
  const { sanaIndiaCity, indianPlace } = DISCOVERY;
  for (const l of ['Jamnagar', 'Vadodara', 'Mundra', 'Raigarh, Chhattisgarh', 'Visakhapatnam, Andhra Pradesh', 'Jharsuguda, Odisha', 'Nagpur, Maharashtra', 'IN-Singrauli',
    'Kolkata, West Bengal', 'Angul', 'Hosur, Tamil Nadu', 'Dahej, Gujarat', 'Thoothukudi', 'Sri City', 'Chandigarh', 'Puducherry', 'Jamnagar, GJ, IN'])
    assert.ok(sanaIndiaCity(l) && !foreignLocation(l), l);
  for (const l of ['Lahore, Punjab, Pakistan', 'Kochi, Japan', 'Hyderabad, Sindh, Pakistan', 'Ruwais, AE', 'Remote', '16 Locations', 'London, UK'])
    assert.ok(!sanaIndiaCity(l), l);
  assert.ok(indianPlace('Punjab, India') && !indianPlace('Punjab, Pakistan'));
  assert.equal(p2tier(P2_SANA, p2eval(P2_SANA, 'Senior Engineer - Mechanical Maintenance', 'Jamnagar', P2_PLANT)), 'READY');
  assert.equal(p2tier(P2_SANA, p2eval(P2_SANA, 'Maintenance Engineer', 'Vadodara', P2_PLANT)), 'READY');
  assert.equal(p2eval(P2_SANA, 'Maintenance Engineer', 'Vadodara', P2_PLANT).reason, SANA_INDIA_ONSITE_REASON_P2);
  // Farhan: a remote role stated in an Indian state is remote from India
  assert.equal(p2eval(P2_FARHAN, 'Implementation Manager', 'Remote - Gujarat', P2_IMPL).eligibility, 'ELIGIBLE');
});

test('S2: every title the daily searches fetch is recognised as the person\'s field', async () => {
  const { spawnSync } = await import('node:child_process');
  const py = spawnSync('python3', ['-c', `
import json, engine.dataset_discovery as d, engine.more_sources as m
def split(r):
    out, depth, cur = [], 0, ''
    for ch in r:
        depth += ch == '('
        depth -= ch == ')'
        if ch == '|' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    return out + [cur]
print(json.dumps({'builtin': {c: split(p['role']) for c, p in d.BUILTIN.items()},
  'terms': {'farhan_shaikh': m.QUERIES['farhan_shaikh'] + m.EURES_TERMS['farhan_shaikh'] + [t for _, t in m.ADZUNA['farhan_shaikh']],
            'sana_ansari': m.QUERIES['sana_ansari'] + m.SF_TERMS + m.EURES_TERMS['sana_ansari'] + [t for _, t in m.ADZUNA['sana_ansari']]}}))`], { cwd: path.resolve(root, '..'), encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const { builtin, terms } = JSON.parse(py.stdout);
  // One sample title per alternative of the dataset search's role rule (engine/dataset_discovery.py BUILTIN). A new alternative needs a sample here.
  const SAMPLES = {
    farhan_shaikh: ['Implementation Manager', 'Integration Specialist', 'Automation Specialist', 'Business Systems Lead', 'CRM Manager', 'RevOps Lead', 'Sales Ops Manager', 'Marketing Ops Lead',
      'Systems Architect', 'Customer Onboarding Lead', 'Onboarding Manager', 'Business Operations Lead', 'Revenue Operations Manager', 'Sales Operations Manager', 'Marketing Operations Manager',
      'GTM Operations Lead', 'Go-to-Market Operations Manager', 'GTM Engineer', 'Go-to-Market Engineer', 'Solutions Consultant', 'Technical Delivery Manager', 'Tech Ops Lead', 'Platform Operations Manager',
      'Operations Manager', 'Chief of Staff', "Founder's Office Associate", 'Founding Operations Lead', 'AI Operations Lead'],
    sana_ansari: ['Electrical Engineer', 'Power Plant Engineer', 'Power Generation Engineer', 'Turbine Engineer', 'Boiler Engineer', 'Field Service Engineer - Gas Turbines', 'Plant Operator', 'Control Room Engineer',
      'Ingenieur Instandhaltung', 'Wartungsingenieur', 'Kraftwerksingenieur', 'Elektroingenieur', 'Betriebsingenieur', 'Ingenieur Zuverlässigkeit', 'Anlageningenieur', 'Ingénieur maintenance',
      'Ingénieur centrale thermique', 'Onderhoudsingenieur', 'Elektrotechnisch Ingenieur', 'Adviseur energiebesparing', 'Ingenieur Energieeffizienz', 'Power Station Engineer', 'Substation Engineer',
      'Switchgear Engineer', 'Transmission Line Engineer', 'O&M Engineer – Solar', 'Operations and Maintenance Engineer', 'Maintenance Engineer', 'Plant Engineer', 'Reliability Engineer',
      'Commissioning Engineer', 'Asset Performance Specialist', 'Energy Engineer', 'Utilities Engineer', 'Renewables Engineer', 'Solar Site Engineer', 'Wind Turbine Technician Lead', 'Thermal Power Plant Engineer',
      'Hydro Power Engineer', 'Decarbonisation Consultant', 'Sustainability Engineer', 'Cleantech Engineer', 'Net Zero Engineer', 'Emissions Engineer', 'Efficiency Engineer', 'Technical Consultant'],
  };
  const who = { farhan_shaikh: P2_FARHAN, sana_ansari: P2_SANA };
  const role = (cid, title) => p2eval(who[cid], title, 'Pune, India', 'x').lane === 'STRONGEST_FIT';
  for (const cid of Object.keys(SAMPLES)) {
    for (const alt of builtin[cid]) {
      const sample = SAMPLES[cid].find((t) => new RegExp(alt, 'i').test(t));
      assert.ok(sample, `${cid}: no sample title for the search alternative /${alt}/`);
      assert.ok(role(cid, sample), `${cid}: "${sample}" (search /${alt}/) is not a role match`);
    }
    for (const term of terms[cid]) {
      const title = `${term} ${cid === 'farhan_shaikh' ? 'Specialist' : 'Engineer'}`.replace(/\b(\w+) \1\b/i, '$1');
      assert.ok(role(cid, title), `${cid}: search term "${term}" gives "${title}", not a role match`);
    }
  }
  // the plan's postings
  for (const t of ['O&M Engineer – Solar', 'Shift In-charge', 'Lead Engineer – Rotating Equipment', 'Mechanical Engineer - Static Equipment', 'Shift Engineer - Operations (Thermal)'])
    assert.equal(p2tier(P2_SANA, p2eval(P2_SANA, t, 'Hyderabad, India', P2_PLANT)), 'READY', t);
  for (const t of ['Delivery Manager', 'Technical Program Manager', 'Technical Account Manager', 'Professional Services Consultant', 'Customer Engineer'])
    assert.notEqual(p2tier(P2_FARHAN, p2eval(P2_FARHAN, t, 'Remote - India', P2_IMPL)), 'HOLD', t);
  assert.equal(p2eval(P2_FARHAN, 'Delivery Manager', 'Remote - India', P2_IMPL).lane, 'STRONGEST_FIT');
  // IT operations is not plant operations
  assert.ok(p2eval(P2_SANA, 'IT Operations Engineer', 'Pune, India', P2_PLANT).score <= 40);
});

test('S4: one matching word is not enough: Power BI, sales, aviation, plant-based and EV-battery reliability titles are capped for Sana', () => {
  for (const [t, d] of [['Power BI Developer', 'Build dashboards. Root cause analysis of data issues. Procurement analytics.'], ['Energy Sales Manager', 'Sell rooftop solar. Procurement.'],
    ['Aircraft Maintenance Engineer', 'DGCA licence B1. Preventive maintenance of A320 aircraft. Reliability.'], ['Reliability Engineer', 'Vehicle reliability testing, DFMEA, Weibull analysis for EV battery packs. Root cause analysis.'],
    ['Power Platform Consultant', 'Power Apps, Power Automate. Procurement process.'], ['Power Electronics Engineer', 'Design inverters, PCB, magnetics. Reliability testing.'],
    ['Plant-Based Product Manager', 'FMCG plant-based foods. Procurement.'], ['Sustainability Reporting Analyst', 'ESG reporting. Procurement data.'], ['Aviation Maintenance Planner', 'Maintenance planning for an airline fleet.']]) {
    const r = p2eval(P2_SANA, t, t === 'Aircraft Maintenance Engineer' ? 'Delhi, India' : 'Pune, India', d);
    assert.ok(r.score <= 40 && p2tier(P2_SANA, r) === 'HOLD', `${t}: ${r.score}`);
  }
  assert.ok(p2eval(P2_SANA, 'Reliability Engineer', 'Pune, India', P2_PLANT).score > 60, 'plant reliability is untouched');
  assert.equal(p2eval(P2_SANA, 'Reliability Engineer', 'Pune, India', P2_PLANT).target_fit, 'exact');
  assert.equal(p2eval(P2_SANA, 'Maintenance Planner', 'Pune, India', P2_PLANT).target_fit, 'word');
});

test('S5: plain worldwide-remote wording counts; Farhan also takes Remote - APAC / Asia; a named place or region still restricts', () => {
  const V = 'Join our team. You will configure CRM workflows, build workflow automation, integrate API and webhooks, and manage stakeholders. 5+ years experience.';
  for (const [loc, remote] of [['Remote (Global)', true], ['Anywhere', false], ['Remote, Worldwide', true], ['Global', true], ['Fully remote', true], ['Remote - APAC', true], ['Remote - Asia', true]]) {
    const r = p2eval(P2_FARHAN, 'Implementation Manager', loc, V, remote);
    assert.equal(r.eligibility, 'ELIGIBLE', loc); assert.equal(p2tier(P2_FARHAN, r), 'READY', loc);
  }
  for (const loc of ['Anywhere in the US', 'Global - EMEA', 'Remote - Southeast Asia', 'Remote - Philippines', 'Remote, Europe', 'Remote'])
    assert.notEqual(p2eval(P2_FARHAN, 'Implementation Manager', loc, V, true).eligibility, 'ELIGIBLE', loc);
  // the APAC reading is Farhan's only; plain worldwide wording counts for Sana too
  assert.notEqual(p2eval(P2_SANA, 'Energy Efficiency Engineer', 'Remote - APAC', P2_PLANT, true).reason, 'Posting explicitly advertises worldwide remote work.');
  assert.equal(p2eval(P2_SANA, 'Energy Efficiency Engineer', 'Remote (Global)', P2_PLANT, true).eligibility, 'ELIGIBLE');
});

test('S6: too senior is capped just below the threshold (never Ready); Chief of Staff and a target role naming the title are not', () => {
  const lvl = (who, t, loc, d) => p2eval(who, t, loc, d);
  for (const [who, t, loc, d] of [[P2_FARHAN, 'VP, Implementation', 'Remote - India', P2_IMPL.replace('5+ years', '15+ years')], [P2_SANA, 'Plant Head', 'Pune, India', P2_PLANT.replace('8+ years', '20+ years')],
    [P2_FARHAN, 'Senior Implementation Manager', 'Remote - India', P2_IMPL.replace('5+ years', '12+ years') + ' Lead a team of 25.'], [P2_FARHAN, 'Head of Implementation', 'Remote - India', P2_IMPL],
    [P2_SANA, 'General Manager - Maintenance', 'Pune, India', P2_PLANT]]) {
    const r = lvl(who, t, loc, d);
    assert.equal(r.score, who.qualification_threshold - 1, t); assert.notEqual(p2tier(who, r), 'READY', t);
    assert.match(r.qualification_reason, /above the candidate's level/);
  }
  assert.ok(lvl(P2_FARHAN, 'Chief of Staff', 'Remote - India', P2_IMPL).score >= 70, 'Chief of Staff is a builder role, not an executive one');
  assert.ok(lvl(P2_FARHAN, 'Implementation Manager', 'Remote - India', P2_IMPL.replace('5+ years', '11+ years')).score >= 70, 'years + 2 is still fine');
  const headTarget = { ...P2_FARHAN, target_roles: JSON.stringify(['Head of Implementation']) };
  assert.ok(lvl(headTarget, 'Head of Implementation', 'Remote - India', P2_IMPL).score >= 70, 'a target role naming the title is not capped');
});

test('S7: a role built around a platform the profile does not list is capped at 60, never Ready', () => {
  const { PLATFORM_GAP_CAP } = DISCOVERY;
  for (const t of ['Workday Implementation Lead', 'Salesforce Implementation Consultant']) {
    const r = p2eval(P2_FARHAN, t, 'Remote - India', P2_IMPL + ' Fully remote, India.');
    assert.equal(r.score, PLATFORM_GAP_CAP, t); assert.notEqual(p2tier(P2_FARHAN, r), 'READY', t);
  }
  assert.ok(p2eval(P2_FARHAN, 'GoHighLevel Implementation Lead', 'Remote - India', P2_IMPL).score > PLATFORM_GAP_CAP, 'a platform the profile lists is not capped');
});

test('S8: office jobs do not pass Farhan\'s remote-only rule; "work from home" alone is not remote; a denied hybrid is fine', () => {
  const V = 'Join our team. You will configure CRM workflows, build workflow automation, integrate API and webhooks, and manage stakeholders. 5+ years experience.';
  const wfh = p2eval(P2_FARHAN, 'Implementation Manager', 'Bengaluru, India', V + ' We offer a flexible work from home policy and free lunches.', false);
  assert.notEqual(wfh.eligibility, 'ELIGIBLE'); assert.notEqual(p2tier(P2_FARHAN, wfh), 'READY');
  for (const [loc, d, remote] of [['Bengaluru, India', V + ' This is a hybrid role, 3 days in office.', false], ['India', V + ' This is a hybrid role, 3 days in our Pune office.', true],
    ['Remote - India', V + ' You will work 2 days a week in the office.', true], ['Remote - India', V + ' The role is hybrid.', true]]) {
    const r = p2eval(P2_FARHAN, 'Implementation Manager', loc, d, remote);
    assert.equal(r.eligibility, 'INELIGIBLE', d); assert.match(r.reason, remote ? /Hybrid or set office days/ : /Not a remote role/);
  }
  for (const d of [V + ' This is not a hybrid role; fully remote.', V + ' Experience with hybrid cloud integration.', V + ' Remote in India.'])
    assert.equal(p2eval(P2_FARHAN, 'Implementation Manager', 'Remote - India', d, true).eligibility, 'ELIGIBLE', d);
  // Sana is not remote-only: hybrid does not rule her out
  assert.equal(p2eval(P2_SANA, 'Maintenance Engineer', 'Pune, India', P2_PLANT + ' This is a hybrid role, 3 days in office.').eligibility, 'ELIGIBLE');
});

test('S9: Gulf details: nationals preference caps at 45, Gulf plant towns and country codes count, "for our clients" alone is not an agency', () => {
  const { gulfPlace, agencyPosting, NATIONALS_PREFERENCE_CAP } = DISCOVERY;
  const G = P2_PLANT + ' Tax-free salary, family status, accommodation.';
  for (const extra of [' Saudization: preference to Saudi nationals.', ' Preference will be given to Omani nationals.', ' Priority under Emiratisation rules.']) {
    const r = p2eval(P2_SANA, 'Maintenance Engineer', 'Riyadh, KSA', G + extra);
    assert.ok(r.score <= NATIONALS_PREFERENCE_CAP, extra); assert.equal(p2tier(P2_SANA, r), 'HOLD', extra); assert.match(r.qualification_reason, /preference to the country's nationals/);
  }
  assert.ok(p2eval(P2_SANA, 'Maintenance Engineer', 'Riyadh, KSA', G).score > 60, 'no preference stated: not capped');
  for (const l of ['Ruwais, AE', 'Mesaieed, QA', 'Duqm', 'Salalah, Oman', 'Yanbu', 'Jubail, SA', 'Kuwait City, KW', 'Sitra, BH']) assert.ok(gulfPlace(l), l);
  for (const l of ['Pune, India', 'Sacramento, CA', 'Paris', 'Saar, Germany']) assert.ok(!gulfPlace(l), l);
  assert.equal(agencyPosting('Worley', 'We deliver engineering projects for our clients across energy.'), false);
  assert.equal(agencyPosting('Fichtner Consultants', 'Engineering and consulting for power plants.'), false);
  assert.equal(agencyPosting('Acme', 'We are hiring for one of our clients, a large refinery.'), true);
  assert.equal(agencyPosting('Acme', 'Our client is a leading utility.'), true);
  assert.equal(agencyPosting('Gulf Manpower Recruitment', 'Maintenance supervisor.'), true);
});

test('S11: Sana\'s other target roles can score: their distinctive words count as skills, at most twice', () => {
  const { targetSkills, TARGET_SKILL_MAX } = DISCOVERY;
  const ee = p2eval(P2_SANA, 'Energy Efficiency Engineer', 'Remote (worldwide)', 'Conduct energy audits and decarbonization roadmaps for industrial clients. Work from anywhere in the world.', true);
  assert.deepEqual(ee.skills, ['Energy Efficiency', 'Decarbonization']); assert.equal(p2tier(P2_SANA, ee), 'READY', `was 58 with no skill matched; now ${ee.score}`);
  const dc = p2eval(P2_SANA, 'Decarbonisation Consultant', 'Remote - India', 'Net zero roadmaps, energy audits and decarbonisation plans for cement plants.', true);
  assert.deepEqual(dc.skills, ['Decarbonization']); assert.ok(dc.score >= 60, `British spelling counts, and the title fits the target role (${dc.score})`);
  // at most twice, never a generic word (maintenance, plant), never a skill already matched
  const many = targetSkills(JSON.stringify(['Energy Efficiency Engineer', 'Decarbonization Engineer', 'Asset Performance Specialist', 'Plant Engineer', 'Maintenance Engineer (Power Plant)']), [], 'energy efficiency, decarbonization and asset performance at the plant; maintenance');
  assert.deepEqual(many, ['Energy Efficiency', 'Decarbonization', 'Asset Performance']);
  assert.equal(p2eval({ ...P2_SANA, target_roles: JSON.stringify(['Energy Efficiency Engineer', 'Decarbonization Engineer', 'Asset Performance Specialist']) }, 'Energy Engineer', 'Pune, India', 'energy efficiency, decarbonization and asset performance').skills.length, TARGET_SKILL_MAX);
  assert.deepEqual(targetSkills(JSON.stringify(['Reliability Engineer']), ['Reliability'], 'reliability of pumps'), [], 'already a skill');
  assert.deepEqual(targetSkills(JSON.stringify(['Plant Engineer', 'Industrial Maintenance Engineer']), [], 'plant maintenance'), [], 'generic words do not count');
  // Farhan is unchanged
  assert.deepEqual(p2eval(P2_FARHAN, 'Implementation Manager', 'Remote - India', 'Implementation of technical operations.').skills, []);
});

test('phase 2 tenth-man fixes: hybrid boilerplate, NCR, ", SA", analyst, Saudization boilerplate, "(Power Plant)", anchored words, AGM/DGM', () => {
  const { gulfPlace, sanaIndiaCity } = DISCOVERY;
  // 1. hybrid wording about the company or its customers is not this job
  for (const extra of [' Offices in London and Pune with a hybrid working model for office-based staff; this role is fully remote.', ' We offer flexible hybrid working and a home office budget.',
    ' Hybrid work policy for those near a hub.', ' You will onsite 2 days per quarter for customer workshops.', ' Help customers roll out a hybrid working model.'])
    assert.equal(p2eval(P2_FARHAN, 'Implementation Manager', 'Remote - India', P2_IMPL + extra, true).eligibility, 'ELIGIBLE', extra);
  // 2. NCR is Metro Manila too
  assert.equal(sanaIndiaCity('Remote - Makati, NCR, Philippines'), false); assert.equal(sanaIndiaCity('Gurugram, NCR'), true);
  assert.notEqual(p2eval(P2_FARHAN, 'Implementation Manager', 'Remote - Makati, NCR, Philippines', P2_IMPL, true).eligibility, 'ELIGIBLE');
  // 3. ", SA" is South Australia / South Africa, and codes are upper case
  for (const l of ['Adelaide, SA', 'Port Augusta, SA', 'Johannesburg, SA', 'Springfield, qa']) assert.ok(!gulfPlace(l), l);
  assert.ok(p2eval(P2_SANA, 'Maintenance Engineer', 'Adelaide, SA', P2_PLANT + ' Relocation assistance available.').score <= 45);
  // 5. plant analysts are hers
  for (const t of ['Reliability Analyst', 'Condition Monitoring Analyst - Power Plant']) assert.ok(p2eval(P2_SANA, t, 'Vadodara', P2_PLANT).score > 45, t);
  assert.ok(p2eval(P2_SANA, 'Business Analyst - Energy', 'Pune, India', P2_PLANT).score <= 40);
  // 6. a bare Saudization mention is boilerplate
  assert.ok(p2eval(P2_SANA, 'Senior Mechanical Maintenance Engineer', 'Jubail, Saudi Arabia', P2_PLANT + ' We are committed to Saudization. Visa sponsorship provided.').score > 60);
  // 7. the one-skill exception needs the target's qualifier
  const S7 = { ...P2_SANA, target_roles: JSON.stringify(['Maintenance Engineer (Power Plant)', 'Reliability Engineer']) };
  assert.equal(p2eval(S7, 'Building Maintenance Engineer', 'Mumbai, India', 'Hotel lifts and HVAC.').target_exact, false);
  assert.equal(p2eval(S7, 'Maintenance Engineer - Power Plant', 'Korba', P2_PLANT).target_exact, true);
  assert.equal(p2eval(S7, 'Senior Reliability Engineer', 'Korba', P2_PLANT).target_exact, true);
  // 8. anchored words
  for (const t of ['Registered Nurse - Rotating Shifts', 'Thermal Engineer']) assert.equal(p2eval(P2_SANA, t, 'Pune, India', 'Patient care.').lane, 'UNASSIGNED', t);
  for (const t of ['Clinical Program Manager', 'Project Manager - Construction']) assert.ok(p2eval(P2_FARHAN, t, 'Remote - India', P2_IMPL, true).score <= 40, t);
  // 9. AGM and DGM are mid-senior grades
  assert.doesNotMatch(p2eval(P2_SANA, 'Assistant General Manager - Maintenance', 'Korba', P2_PLANT).qualification_reason, /above the candidate's level/);
  assert.match(p2eval(P2_SANA, 'General Manager - Maintenance', 'Korba', P2_PLANT).qualification_reason, /above the candidate's level/);
});

test('full state and province names (gap fix, 13 Nov): "Houston, Texas" is abroad for Sana\'s visa cap; near misses are not', () => {
  for (const l of ['Houston, Texas', 'Houston, Texas, United States', 'Baton Rouge, Louisiana 70801', 'Seattle, Washington', 'Atlanta, Georgia', 'Indianapolis, Indiana',
    'Calgary, Alberta, Canada', 'Fort McMurray, Alberta', 'Sarnia, Ontario', 'Gladstone, Queensland', 'Perth, Western Australia', 'Melbourne, Victoria 3000',
    'Kansas City, Missouri (Hybrid)', 'Mobile, Alabama; Pascagoula, Mississippi', 'Charleston, West Virginia - Onsite'])
    assert.equal(foreignLocation(l), true, l);
  for (const l of ['Indore, Madhya Pradesh', 'Indore', 'Panaji, Goa', 'Building 3, Washington Square', 'Washington Street, Pune', 'Office 4, Washington Plaza, Hyderabad', 'Plot 7, Victoria Road, Mumbai',
    'Jamnagar, Gujarat', 'Ruwais, Abu Dhabi', 'Jubail, Saudi Arabia', 'Remote - India', 'Kolkata, West Bengal', 'Indiana Jones Road', 'Texas Instruments campus',
    'Bengaluru, Karnataka; Houston, Texas'])
    assert.equal(foreignLocation(l), l === 'Ruwais, Abu Dhabi' || l === 'Jubail, Saudi Arabia', l);   // Gulf places were foreign before too; the visa cap exempts them
  const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Breakdown Maintenance', 'Preventive Maintenance', 'Reliability', 'Root Cause Analysis']), total_years_experience: 9.2 };
  const D = 'Lead breakdown maintenance and preventive maintenance; reliability and root cause analysis for the plant. 5+ years.';
  const mk = (location, description = D) => evaluate(sana, { id: 'x', title: 'Maintenance Engineer', company: 'Acme', url: 'https://e.com/x', location, description, remote: false });
  const tx = mk('Houston, Texas'), txCode = mk('Houston, TX'), india = mk('Jamnagar, Gujarat'), gulf = mk('Jubail, Saudi Arabia');
  assert.ok(tx.score <= VISA_UNLIKELY_CAP, String(tx.score)); assert.equal(tx.score, txCode.score, 'the full name is capped like the code');
  assert.match(tx.qualification_reason, /no visa route from India/);
  assert.ok(mk('Houston, Texas', D + ' Visa sponsorship available.').score > VISA_UNLIKELY_CAP, 'a stated visa route still lifts the cap');
  assert.ok(india.score > VISA_UNLIKELY_CAP && gulf.score > VISA_UNLIKELY_CAP, 'India and the Gulf are not capped');
  assert.ok(mk('Panaji, Goa').score > VISA_UNLIKELY_CAP && mk('Indore, Madhya Pradesh').score > VISA_UNLIKELY_CAP);
});
