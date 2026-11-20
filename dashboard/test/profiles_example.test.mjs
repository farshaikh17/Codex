// Multi-candidate base (docs/MULTI_CANDIDATE.md section 7, demo): a SYNTHETIC person (test/profiles/example_data_analyst_remote_eu.json: not a
// real person, never seeded into production) goes end to end with no scoring code of their own: config -> discovery queries -> scoring ->
// shortlist -> audit, plus the taste rules and the judged-set harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseProfileConfig } from '../worker/profiles/schema.ts';
import { scoreCandidate, registerCandidates, profileOf, bandFor, shortlistSettings } from '../worker/profiles/dispatch.ts';
import { familyOf } from '../worker/discovery.ts';
import { selectShortlist, fitsStretchRule } from '../scripts/shortlist_select.mjs';
import { audit } from '../scripts/shortlist_audit.mjs';
import { buildMarks, tasteAdjust } from '../scripts/taste_rules.mjs';
import { onboardingAudit, auditMarkdown } from '../scripts/quality/onboarding_audit.mjs';
import { runJudged, checkJudged, regressions } from '../scripts/quality/judged_harness.mjs';
import { configSql, storedConfig } from '../scripts/profile_config.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname), root = path.join(dir, '..', '..');
const CONFIG_FILE = path.join(dir, 'profiles', 'example_data_analyst_remote_eu.json');
const CONFIG_INPUT = fs.readFileSync(CONFIG_FILE, 'utf8');
// what scripts/profile_config.mjs stores (merged, validated, resolved): the only kind of config the scorer and discovery use
const stored = (id, cfg) => { const r = storedConfig(id, cfg); if (!r.ok) throw new Error(r.errors.join('; ')); return JSON.stringify(r.config); };
const CONFIG = stored('example_data_analyst_remote_eu', CONFIG_INPUT);
const ID = 'example_data_analyst_remote_eu';
const CAND = { id: ID, total_years_experience: 5, qualification_threshold: 65, primary_skills: JSON.stringify(['Looker']), target_roles: JSON.stringify([]), profile_config: CONFIG };
const DESC = 'You will own SQL models and Tableau dashboards for product and marketing KPIs, run A/B test reporting with Python and dbt, and present insights to stakeholders. '
  + 'Data quality and reporting are yours. 4+ years of experience as an analyst. We are a fully remote team.';
const OFFICE = DESC.replace('We are a fully remote team.', 'The team works together at our office.');
const post = (id, title, location, description = DESC, remote = true, extra = {}) => ({ id, title, company: extra.company || 'Example Co', url: `https://boards.greenhouse.io/exampleco/jobs/${id}`, source: 'greenhouse', location, description, remote, ...extra });

test('the synthetic config is valid, and bad configs are refused with a reason', () => {
  assert.equal(parseProfileConfig(CONFIG).ok, true);
  for (const bad of ['{', { schema: 2 }, { schema: 1, field: { packs: ['astrology'] } }, { schema: 1, place: [{ policy: 'moon' }] }, { schema: 1, level: { min: 'director', max: 'junior' } },
    { schema: 1, place: [{ policy: 'onsite_in', countries: ['ZZ'] }] }, { schema: 1, field: { title: { must: ['x'.repeat(80)] } } }, 'x'.repeat(17000)]) {
    const r = parseProfileConfig(bad); assert.equal(r.ok, false, JSON.stringify(bad).slice(0, 60)); assert.ok(r.errors.length);
  }
  const sql = configSql(ID, CONFIG_INPUT);
  assert.equal(sql.ok, true); assert.equal(sql.summary.engine, 'profile'); assert.match(sql.sql, /ON CONFLICT\(candidate_id\)/);
  assert.equal(configSql('farhan_shaikh', JSON.stringify({ schema: 1, extends: 'legacy:farhan_shaikh' })).summary.engine, 'legacy', 'a built-in id stays on the old path unless it says profile');
});

test('config -> discovery queries (engine/profile_plan.py), bounded per person', () => {
  const out = execFileSync('python3', [path.join(root, 'engine', 'profile_plan.py'), '--config', CONFIG_FILE], { cwd: root, encoding: 'utf8' });
  const plan = JSON.parse(out);
  assert.ok(plan.profile_engine);
  assert.match('senior data analyst', new RegExp(plan.role, 'i')); assert.doesNotMatch('warehouse driver', new RegExp(plan.role, 'i'));
  assert.match('data engineer', new RegExp(plan.exclude, 'i'));
  assert.deepEqual(plan.countries, ['NL', 'DE']);
  assert.equal(plan.mode, 'HOME_OR_RELOCATE');
  assert.ok(plan.jobspy.length >= 1 && plan.jobspy.length <= 5); assert.deepEqual(plan.jobspy[0], ['data analyst', 'Netherlands', 'Netherlands', ['indeed', 'linkedin']]);
  assert.ok(plan.workable.length <= 8 && plan.workable_places.length <= 6 && plan.eures.length <= 4 && plan.adzuna.length <= 3);
  assert.deepEqual(plan.boards, [{ kind: 'greenhouse', slug: 'exampleco' }]);
  assert.equal(plan.max_rows, 5000); assert.equal(plan.max_selected, 200);
});

test('config -> scoring: the packs score the new person (no scoring code of their own)', () => {
  registerCandidates([CAND]);
  assert.ok(profileOf(CAND), 'on the profile engine');
  const good = scoreCandidate(CAND, post('a1', 'Senior Data Analyst', 'Remote - Netherlands'));
  assert.equal(good.eligibility, 'ELIGIBLE'); assert.equal(good.status, 'NEEDS_REVIEW');
  assert.ok(good.score >= 65, `a fitting remote job reaches the threshold (${good.score}: ${good.qualification_reason})`);
  assert.ok(good.skills.includes('SQL') && good.skills.includes('Looker') === false);
  // on site in a listed country is eligible (onsite_in NL, DE); on site elsewhere is not confirmed
  assert.equal(scoreCandidate(CAND, post('a2', 'Product Analyst', 'Berlin, Germany', OFFICE, false)).eligibility, 'ELIGIBLE');
  assert.equal(scoreCandidate(CAND, post('a3', 'Product Analyst', 'Austin, Texas', OFFICE, false)).eligibility, 'UNKNOWN');
  // field: another family is not a role match; an excluded family is capped
  assert.equal(scoreCandidate(CAND, post('a4', 'Account Executive', 'Remote - Netherlands')).status, 'HOLD');
  assert.ok(scoreCandidate(CAND, post('a5', 'Data Engineer', 'Remote - Netherlands')).score <= 40 || scoreCandidate(CAND, post('a5', 'Data Engineer', 'Remote - Netherlands')).status === 'HOLD');
  // level band: min mid caps junior titles; max lead keeps manager / head titles below the threshold
  assert.ok(scoreCandidate(CAND, post('a6', 'Junior Data Analyst', 'Remote - Netherlands')).score <= 40);
  assert.ok(scoreCandidate(CAND, post('a7', 'Head of Data Analytics', 'Remote - Netherlands')).score < 65);
  // required skill: no SQL named -> below the Worth-a-try floor
  const noSql = scoreCandidate(CAND, post('a8', 'Data Analyst', 'Remote - Netherlands', 'Build Tableau dashboards and KPI reporting for stakeholders with Python. 4+ years of experience. Fully remote team across Europe.'));
  assert.ok(noSql.score <= 54, noSql.qualification_reason); assert.match(noSql.qualification_reason, /required skills/);
  // language: Dutch is spoken, German is not
  assert.ok(scoreCandidate(CAND, post('a9', 'Data Analyst', 'Amsterdam, Netherlands', DESC + ' Fluent Dutch is required.', false)).score >= 65);
  assert.ok(scoreCandidate(CAND, post('a10', 'Data Analyst', 'Remote - Netherlands', DESC + ' Fluent German is required.')).score < 65);
  // type: a part-time gig is capped; pay below the EUR floor loses points
  assert.ok(scoreCandidate(CAND, post('a11', 'Part-time Data Analyst', 'Remote - Netherlands')).score <= 40);
  const low = scoreCandidate(CAND, post('a12', 'Data Analyst', 'Remote - Netherlands', DESC, true, { salary: { min: 20000, max: 30000, currency: 'EUR', period: 'year' } }));
  assert.match(low.qualification_reason, /below the 50,000 EUR a year floor/);
  // remote limited to another country is not confirmed for someone in the Netherlands; hygiene applies to everyone
  assert.notEqual(scoreCandidate(CAND, post('a13', 'Data Analyst', 'Remote - US', DESC.replace('fully remote team', 'team. Must be located in the US'))).eligibility, 'ELIGIBLE');
  assert.equal(scoreCandidate(CAND, post('a14', 'Data Analyst', 'Remote', DESC + ' Active secret clearance required.')).status, 'INELIGIBLE');
  assert.equal(bandFor(ID, 'Remote - Netherlands', 'REMOTE', true, DESC), 'remote');
  assert.equal(bandFor(ID, 'Berlin, Germany', 'ONSITE', false, DESC), 'home_onsite');
  assert.equal(familyOf(ID, 'Senior BI Analyst'), 'data_analytics', 'the config families are known to familyOf()');
});

test('scoring -> shortlist -> audit for the new person, with their own tier size and band minimum', () => {
  registerCandidates([CAND]);
  const now = Date.parse('2026-11-20T12:00:00Z');
  const pool = [];
  for (let i = 0; i < 14; i++) {
    const remote = i % 2 === 0, title = ['Data Analyst', 'Senior Data Analyst', 'Product Analyst', 'BI Analyst', 'Marketing Analyst', 'Analytics Engineer', 'Reporting Analyst'][i % 7];
    const p = post('s' + i, title + (i > 6 ? ' II' : ''), remote ? 'Remote - Netherlands' : 'Amsterdam, Netherlands', DESC, remote, { company: 'Employer ' + i });
    const e = scoreCandidate(CAND, p);
    pool.push({ kind: 'pool', marked: 1, active: 1, candidate_id: ID, job_id: p.id, title: p.title, company: p.company, stored_company: p.company, location: p.location, workplace: remote ? 'REMOTE' : 'ONSITE',
      source: 'greenhouse', provenance: 'LIVE_PUBLIC', discovered_at: '2026-11-18T00:00:00Z', last_verified_at: '2026-11-19T00:00:00Z', url: p.url, description: DESC, score: e.score,
      skill_score: Math.min(100, e.skills.length * 20), eligibility: e.eligibility, status: 'NEEDS_REVIEW', reason: '', threshold: 65, target_exact: e.target_exact ? 1 : 0 });
  }
  assert.equal(shortlistSettings(ID).tierSize, 10);
  const { changes, report } = selectShortlist(pool, { now, candidates: [CAND] });
  const ready = changes.filter((c) => c.to === 'READY');
  assert.equal(ready.length, 10, 'tier size from the config');
  assert.ok(report[ID].READY.bands.remote >= 2, 'band minimum from the config');
  // the stored lists pass the daily audit
  const rows = changes.map((c) => ({ ...pool.find((r) => r.job_id === c.job_id), kind: 'row', status: c.to, decided: 0 }));
  const res = audit(rows, { candidates: [CAND], report, now });
  assert.equal(res.ok, true, res.problems.join('; '));
  // the onboarding audit reads the same rows and flags rule-level risks only
  const rep = onboardingAudit([...rows, { ...rows[0], job_id: 'thin', status: 'STRETCH_READY', description: 'Short.', company: 'Jobgether' }], [CAND], ID, 40);
  assert.equal(rep.engine, 'profile');
  assert.ok(rep.rows.find((r) => r.job_id === 'thin').flags.includes('thin_text'));
  assert.ok(rep.rows.find((r) => r.job_id === 'thin').flags.includes('reposter'));
  assert.match(auditMarkdown(rep), /Onboarding audit: example_data_analyst_remote_eu/);
  // an unconfirmed Worth-a-try row of a remote-only profile needs a home or worldwide place (the built-in rule, from the config)
  const remoteOnly = { ...CAND, id: 'example_remote_only', profile_config: stored('example_remote_only', { schema: 1, field: { role_families: ['data_analytics'] }, place: [{ policy: 'remote_from_country', country: 'NL' }] }) };
  registerCandidates([remoteOnly]);
  const r0 = { candidate_id: 'example_remote_only', active: 1, marked: 1, skill_score: 40, score: 70, threshold: 65, eligibility: 'UNKNOWN', description: DESC };
  assert.equal(fitsStretchRule({ ...r0, place_ok: shortlistSettings('example_remote_only').homePlaceOk('Remote - Austin, Texas') }), false);
  assert.equal(fitsStretchRule({ ...r0, place_ok: shortlistSettings('example_remote_only').homePlaceOk('Remote - Netherlands') }), true);
});

test('taste ("Not for me") works for the new person through their role families', () => {
  registerCandidates([CAND]);
  const marks = buildMarks([{ candidate_id: ID, title: 'Data Analyst', company: 'Dull Corp', label: 'NOT_FOR_ME' }, { candidate_id: ID, title: 'BI Analyst', company: 'Dull Corp', label: 'NOT_FOR_ME' }]);
  assert.equal(tasteAdjust(marks, ID, 'Senior Data Analyst', 'Dull Corp').adj, -5);
  assert.equal(tasteAdjust(marks, ID, 'Senior Data Analyst', 'Nice Corp').adj, 0);
});

test('a hand-judged sample becomes a permanent test (judged-set harness)', () => {
  const judged = JSON.parse(fs.readFileSync(path.join(dir, 'profiles', 'judged_example_data_analyst_remote_eu.json'), 'utf8'));
  assert.deepEqual(checkJudged(judged), []);
  const res = runJudged(judged, [CAND]);
  assert.equal(res.summary.rows, judged.rows.length);
  const bad = res.rows.filter((r) => !r.ok);
  assert.deepEqual(bad.map((r) => `${r.id} ${r.title}: ${r.tier} ${r.score}`), [], 'every judged row meets its expectation');
  assert.deepEqual(regressions(res, res), []);
  assert.deepEqual(checkJudged({ schema: 1, candidate_id: ID, rows: [{ id: 'x', title: 't', verdict: 'MAYBE' }] }).length, 1);
});

test('the Worker screens a new person with their packs: the onboarding backfill reads the stored config (migration 0028)', async () => {
  const { createDb } = await import('./harness.mjs');
  const { backfillClient } = await import('../worker/discovery.ts');
  const { sqlite, d1 } = createDb();
  sqlite.prepare(`INSERT INTO candidates(id,full_name,current_location,qualification_threshold,primary_skills,target_roles,total_years_experience) VALUES (?,?,?,?,?,?,?)`)
    .run(ID, 'Example Analyst', 'Synthetic', 65, CAND.primary_skills, CAND.target_roles, 5);
  sqlite.prepare(`INSERT INTO candidate_profile_configs(candidate_id, config) VALUES (?, ?)`).run(ID, CONFIG);
  sqlite.prepare(`INSERT INTO jobs(id,title,company,source_adapter,location_restrictions,description,workplace_type,is_active,discovered_at) VALUES (?,?,?,?,?,?,?,1,'2026-11-19T00:00:00Z')`)
    .run('wj1', 'Senior Data Analyst', 'Example Co', 'greenhouse', 'Remote - Netherlands', DESC, 'REMOTE');
  const r = await backfillClient(d1, ID, 40);
  assert.equal(r.inserted, 1);
  const q = sqlite.prepare(`SELECT eligibility_status AS e, eligibility_reason AS why FROM candidate_qualifications WHERE candidate_id = ? AND job_id = 'wj1'`).get(ID);
  assert.equal(q.e, 'ELIGIBLE');
  assert.match(q.why, /Netherlands/, 'the profile place policy decided, not the old default');
});

// ---- code review of #242: one test per finding --------------------------------------------------------------------------------------
const P = (id, title, location, description, remote = true, extra = {}) => ({ id, title, company: 'Synthetic Co', url: '', source: 'greenhouse', location, description, remote, ...extra });
const person = (id, cfg, row = {}) => ({ id, total_years_experience: 6, qualification_threshold: 60, primary_skills: JSON.stringify(['SQL', 'Tableau']), target_roles: '[]', profile_config: stored(id, cfg), ...row });

test('review 1: an "X only" or "must be based in X" restriction does not block a person whose home is X', () => {
  const us = person('example_us_home', { schema: 1, field: { role_families: ['data_analytics'] }, place: [{ policy: 'remote_from_country', country: 'US' }] });
  const r = scoreCandidate(us, P('u1', 'Data Analyst', 'Remote - US', DESC + ' US residents only. Must be based in the US.'));
  assert.notEqual(r.eligibility, 'INELIGIBLE', r.reason);
  assert.equal(r.eligibility, 'ELIGIBLE', r.reason);
  const uk = person('example_uk_home', { schema: 1, field: { role_families: ['data_analytics'] }, place: [{ policy: 'remote_from_country', country: 'GB' }] });
  assert.equal(scoreCandidate(uk, P('u2', 'Data Analyst', 'Remote - United Kingdom', DESC + ' UK residents only.')).eligibility, 'ELIGIBLE');
  assert.equal(scoreCandidate(uk, P('u3', 'Data Analyst', 'Remote', DESC + ' US residents only.')).eligibility, 'INELIGIBLE', 'another country still blocks');
  // the EU covers an EU home
  const nl = person('example_nl_home', { schema: 1, field: { role_families: ['data_analytics'] }, place: [{ policy: 'remote_from_country', country: 'NL' }] });
  assert.notEqual(scoreCandidate(nl, P('u4', 'Data Analyst', 'Remote - Netherlands', DESC + ' EU residents only.')).eligibility, 'INELIGIBLE');
});

test('review 2: the config threshold is the shortlist cut-off too (pool rows carry the stored one), and the SQL stores it', () => {
  const c = person('example_thr', { schema: 1, field: { role_families: ['data_analytics'] }, place: [{ policy: 'onsite_in', countries: ['NL'] }], thresholds: { qualify: 62 } }, { qualification_threshold: 80 });
  registerCandidates([c]);
  assert.equal(shortlistSettings('example_thr').threshold, 62);
  const row = { kind: 'pool', marked: 1, active: 1, candidate_id: 'example_thr', job_id: 't1', title: 'Data Analyst', company: 'A', stored_company: 'A', location: 'Amsterdam, Netherlands', workplace: 'ONSITE',
    source: 'greenhouse', discovered_at: '2026-11-18T00:00:00Z', last_verified_at: '2026-11-19T00:00:00Z', url: '', description: DESC, score: 70, skill_score: 40, eligibility: 'ELIGIBLE', status: 'NEEDS_REVIEW', reason: '', threshold: 80, target_exact: 0 };
  const { changes } = selectShortlist([row], { now: Date.parse('2026-11-20T12:00:00Z'), candidates: [c] });
  assert.equal(changes[0]?.to, 'READY', 'score 70 is at the config threshold 62, though the stored row says 80');
  assert.match(configSql('example_thr', { schema: 1, field: { role_families: ['data_analytics'] }, thresholds: { qualify: 62 } }).sql, /UPDATE candidates SET qualification_threshold = 62 WHERE id = 'example_thr'/);
});

test('review 3/4/8: configs without a role rule, unknown families, or not resolved are refused (the run never meets them)', () => {
  for (const bad of [{ schema: 1 }, { schema: 1, field: { packs: ['keyword'] } }, { schema: 1, field: { role_families: ['astronomy'] } }]) assert.equal(storedConfig('example_bad', bad).ok, false, JSON.stringify(bad));
  assert.equal(storedConfig('example_ok', { schema: 1, field: { target_roles: ['Data Analyst'] } }).ok, true, 'target roles are a role rule');
  // a valid config that was not written by profile_config.mjs is not used by the scorer
  const unresolved = { id: 'example_unresolved', primary_skills: '[]', profile_config: JSON.stringify({ schema: 1, field: { role_families: ['data_analytics'] } }) };
  assert.equal(profileOf(unresolved), null);
});

test('review 6: a changed or removed config does not leave the old families or settings behind', () => {
  const c = person('example_change', { schema: 1, field: { role_families: ['nursing'] }, place: [{ policy: 'onsite_in', countries: ['GB'] }], thresholds: { qualify: 61, tier_size: 7 } });
  registerCandidates([c]);
  assert.equal(familyOf('example_change', 'Staff Nurse'), 'nursing');
  const changed = { ...c, profile_config: stored('example_change', { schema: 1, field: { role_families: ['teaching'] }, place: [{ policy: 'onsite_in', countries: ['GB'] }] }) };
  registerCandidates([changed]);
  assert.equal(familyOf('example_change', 'Staff Nurse'), 'unclassified');
  assert.equal(familyOf('example_change', 'Maths Teacher'), 'teaching');
  // the same row object with its config edited in place is re-read too
  changed.profile_config = null;
  registerCandidates([changed]);
  assert.equal(familyOf('example_change', 'Maths Teacher'), 'unclassified');
  assert.deepEqual(shortlistSettings('example_change'), {});
});

test('review 7: parsing keeps the built-in keys, and extends merges thresholds / shortlist / salary key by key', () => {
  const st = storedConfig('sana_ansari', { schema: 1, engine: 'profile', thresholds: { tier_size: 20 }, shortlist: { stretch_needs_home_place: true } });
  assert.equal(st.ok, true, st.errors?.join('; '));
  assert.equal(st.config.thresholds.default, 60, 'the base default stays');
  assert.equal(st.config.thresholds.tier_size, 20);
  assert.deepEqual(st.config.shortlist.band_minimums, { READY: { remote: 2 }, STRETCH_READY: { gulf: 5, remote: 2 } }, 'the base band minimums stay');
  assert.equal(st.config.shortlist.stretch_needs_home_place, true);
  const f = storedConfig('farhan_shaikh', { schema: 1, engine: 'profile', salary: { floor: { amount: 150000, currency: 'INR', period: 'month' } } });
  assert.equal(f.config.salary.preferred_inr_monthly, 2500000 / 12, 'the base preferred pay stays');
  assert.equal(f.config.place[0].legacy_skip, true, 'the built-in employer skip is kept through parsing');
  assert.equal(parseProfileConfig({ schema: 1, field: { target_roles: ['x y'] }, shortlist: { stretch_needs_home_place: false } }).config.shortlist.stretch_needs_home_place, false);
});

test('review 9: a floor in another currency reads the posting pay in that currency', () => {
  const low = scoreCandidate(CAND, post('m1', 'Data Analyst', 'Remote - Netherlands', DESC, true, { salary: { min: 20000, max: 30000, currency: 'EUR', period: 'year' } }));
  assert.match(low.qualification_reason, /Published pay \(up to 30,000 EUR a year\) is below the 50,000 EUR a year floor/);
  assert.doesNotMatch(low.qualification_reason, /₹/);
});
