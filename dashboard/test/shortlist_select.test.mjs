// The shortlist selector (plan phase 3: scripts/shortlist_select.mjs). Pure functions on invented pool rows, plus the generated SQL run on a
// database with the real migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { selectInto, exportPool } from './shortlist_helpers.mjs';
import { selectShortlist, selectionSql, MARK, titleKey, isReposter } from '../scripts/shortlist_select.mjs';
import { RULES_MARKER, familyOf, placeBand } from '../worker/discovery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-11-13T12:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();
const C = 'farhan_shaikh';
let n = 0;
/** An invented pool row: eligible, two skills, threshold 60, verified today, found today. */
const row = (o = {}) => ({ kind: 'pool', candidate_id: C, job_id: o.job_id || `j${String(++n).padStart(3, '0')}`, _n: o.job_id ? ++n : n, title: 'Implementation Manager ' + n, company: 'Co ' + n,
  location: 'Remote - India', workplace: 'REMOTE', source: 'greenhouse', discovered_at: iso(1), last_verified_at: iso(0), active: 1, marked: 1, target_exact: 0,
  score: 70, skill_score: 40, eligibility: 'ELIGIBLE', status: 'NEEDS_REVIEW', reason: 'Cloud discovery match.', threshold: 60, description: 'x', ...o });
const auto = (tier, o = {}) => row({ kind: 'auto', status: tier, reason: MARK + 'Cloud discovery match.', ...o });
const tiers = (res) => Object.fromEntries(res.changes.map((c) => [c.job_id, c.to]));
const sel = (pool, o = {}) => selectShortlist(pool, { now: NOW, ...o });

test('tier rule: Ready needs the threshold and confirmed eligibility; Stretch takes unconfirmed at the threshold or confirmed up to 10 below', () => {
  const pool = [row({ job_id: 'r', score: 60 }), row({ job_id: 'su', score: 75, eligibility: 'UNKNOWN' }), row({ job_id: 'sb', score: 50 }),
    row({ job_id: 'low', score: 49 }), row({ job_id: 'ul', score: 59, eligibility: 'UNKNOWN' }), row({ job_id: 'one', score: 90, skill_score: 20 }),
    row({ job_id: 'exact', score: 90, skill_score: 20, target_exact: 1, description: 'Plant maintenance and reliability work. '.repeat(10) }), row({ job_id: 'old', score: 90, marked: 0 }), row({ job_id: 'shut', score: 90, active: 0 }),
    row({ job_id: 'bare', score: 90, skill_score: 20, target_exact: 1, description: '' }), row({ job_id: 'short', score: 90, skill_score: 20, target_exact: 1, description: 'Reliability Engineer. '.repeat(13) })];
  // jobs QA 13 Nov: the exact title stands in for the two skills only with 300+ characters of description ('Reliability Engineer II' at a trading firm had none)
  assert.deepEqual(tiers(sel(pool)), { r: 'READY', su: 'STRETCH_READY', sb: 'STRETCH_READY', exact: 'READY' });
});

test('verification: only rows verified in 4 days, or found open by today\'s check; a row found closed is out; relaxed keeps incumbents only', () => {
  const pool = [row({ job_id: 'fresh' }), row({ job_id: 'stale', last_verified_at: iso(5) }), row({ job_id: 'checked', last_verified_at: iso(9) }),
    row({ job_id: 'dead' }), auto('READY', { job_id: 'inc', last_verified_at: iso(9) })];
  assert.deepEqual(tiers(sel(pool, { alive: ['checked'], dead: ['dead'] })), { fresh: 'READY', checked: 'READY', inc: 'NEEDS_REVIEW' });
  assert.deepEqual(tiers(sel(pool, { relaxed: true })), { fresh: 'READY', dead: 'READY' }, 'relaxed: the incumbent stays (no change), a stale new row still waits');
  assert.equal(sel(pool, { relaxed: true }).changes.some((c) => c.job_id === 'stale'), false);
});

test('at most 25 per tier, best first; Ready-quality overflow fills Stretch first (S10); an incumbent outranked leaves with the right reason', () => {
  const pool = [];
  for (let i = 0; i < 30; i++) pool.push(row({ job_id: 'r' + String(i).padStart(2, '0'), score: 90 - i }));
  for (let i = 0; i < 30; i++) pool.push(row({ job_id: 's' + String(i).padStart(2, '0'), score: 55 }));
  pool.push(auto('STRETCH_READY', { job_id: 'inc', score: 51 }), auto('READY', { job_id: 'fell', score: 20 }));
  const res = sel(pool);
  const t = tiers(res);
  assert.equal(Object.values(t).filter((x) => x === 'READY').length, 25);
  assert.deepEqual(['r25', 'r26', 'r27', 'r28', 'r29'].map((k) => t[k]), Array(5).fill('STRETCH_READY'));
  assert.equal(Object.keys(t).filter((k) => k.startsWith('s') && t[k] === 'STRETCH_READY').length, 20);
  const why = Object.fromEntries(res.changes.map((c) => [c.job_id, c.why]));
  assert.match(why.inc, /^Outranked/); assert.match(why.fell, /^No longer meets/);
  assert.equal(res.report[C].READY.count, 25); assert.equal(res.report[C].STRETCH_READY.count, 25);
});

test('one posting per employer and title, also against rows a person holds', () => {
  const pool = [row({ job_id: 'a', company: 'Acme Inc', title: 'Implementation Lead', score: 80 }), row({ job_id: 'b', company: 'acme', title: 'implementation lead', score: 79 }),
    row({ job_id: 'c', company: 'Beta', title: 'Implementation Lead', score: 70 }), { kind: 'held', candidate_id: C, job_id: 'h', company: 'Beta', title: 'Implementation Lead', status: 'READY' }];
  assert.deepEqual(tiers(sel(pool)), { a: 'READY' });
});

test('incumbents keep their places only through the +2', () => {
  const mk = (newScore) => {
    const pool = [];
    for (let i = 0; i < 24; i++) pool.push(row({ score: 90 }));
    pool.push(auto('READY', { job_id: 'inc', score: 70 }), row({ job_id: 'chal', score: newScore }));
    return tiers(sel(pool, { tierSize: 25 }));
  };
  assert.equal(mk(71).chal, 'STRETCH_READY', 'a new row 1 point better does not displace the incumbent (70 + 2)');
  assert.equal(mk(71).inc, undefined, 'the incumbent stays where it is');
  assert.equal(mk(73).chal, 'READY', 'a new row 3 points better does');
  assert.equal(mk(73).inc, 'STRETCH_READY');
});

test('swaps: the lowest-ranked row breaking a soft rule is replaced by the best row that fixes it, within the score floor; otherwise the rule is relaxed', () => {
  // an invented soft rule for the engine alone: at most 2 rows whose title says "Blue" per tier
  const blue = (r) => /Blue/.test(r.title);
  const rule = { name: 'blue', tiers: ['READY', 'STRETCH_READY'], count: (l) => ['READY', 'STRETCH_READY'].reduce((a, t) => a + Math.max(0, l[t].filter(blue).length - 2), 0),
    breakers: (l, t) => (l[t].filter(blue).length > 2 ? l[t].filter(blue) : []) };
  const pool = [row({ job_id: 'b1', title: 'Blue 1', score: 90 }), row({ job_id: 'b2', title: 'Blue 2', score: 89 }), row({ job_id: 'b3', title: 'Blue 3', score: 88 }),
    row({ job_id: 'b4', title: 'Blue 4', score: 87 }), row({ job_id: 'g1', title: 'Green 1', score: 80 }), row({ job_id: 'g2', title: 'Green 2', score: 70 }),
    row({ job_id: 'g3', title: 'Green 3', score: 64 }), row({ job_id: 'x', title: 'Other', score: 60, eligibility: 'UNKNOWN' })];
  const res = sel(pool, { tierSize: 3, rules: [rule] });
  const t = tiers(res);
  assert.deepEqual(['b1', 'b2', 'g1'].map((k) => t[k]), ['READY', 'READY', 'READY'], 'b3 swapped for g1 (80, within 10 of 88)');
  assert.equal(res.report[C].READY.swaps, 1);
  // Stretch takes b3, b4 (Ready overflow) and g2: two Blue rows, nothing to fix
  assert.deepEqual(['b3', 'b4', 'g2'].map((k) => t[k]), ['STRETCH_READY', 'STRETCH_READY', 'STRETCH_READY']);
  assert.deepEqual(res.report[C].STRETCH_READY.relaxed, []);
  // with a fifth Blue row Stretch is b3, b4, b5: the only fixes are g2 (70, more than 10 below b5's 86) and g3 (64, under threshold + 5): relaxed
  const r2 = sel([...pool, row({ job_id: 'b5', title: 'Blue 5', score: 86 })], { tierSize: 3, rules: [rule] });
  assert.equal(tiers(r2).b5, 'STRETCH_READY');
  assert.deepEqual(r2.report[C].STRETCH_READY.relaxed, ['blue']);
});

test('a pool no larger than the tier: only hard rules apply (no swap)', () => {
  const blue = (r) => /Blue/.test(r.title);
  const rule = { name: 'blue', tiers: ['READY'], count: (l) => Math.max(0, l.READY.filter(blue).length - 1), breakers: (l) => l.READY.filter(blue) };
  const pool = [row({ title: 'Blue 1', score: 90 }), row({ title: 'Blue 2', score: 90 }), row({ title: 'Green', score: 90 })];
  const res = sel(pool, { tierSize: 3, rules: [rule] });
  assert.equal(Object.values(tiers(res)).filter((x) => x === 'READY').length, 3);
  assert.equal(res.report[C].READY.pool_smaller_than_tier, true);
  assert.equal(res.report[C].READY.swaps, 0);
});

test('A4: one employer holding the 20 best scores keeps 2 per tier; the rest go to the best other employers within the score floor', () => {
  const pool = [];
  for (let i = 0; i < 20; i++) pool.push(row({ job_id: 'big' + String(i).padStart(2, '0'), company: 'BigCo', score: 90 - (i % 4) }));
  for (let i = 0; i < 60; i++) pool.push(row({ job_id: 'o' + String(i).padStart(2, '0'), score: 88 - (i % 6) }));
  const res = sel(pool);
  const t = tiers(res);
  const big = (tier) => Object.entries(t).filter(([k, v]) => k.startsWith('big') && v === tier).length;
  assert.equal(big('READY'), 2); assert.equal(big('STRETCH_READY'), 2);
  assert.equal(res.report[C].READY.count, 25); assert.equal(res.report[C].READY.max_employer_share, 0.08);
  assert.ok(res.report[C].READY.swaps >= 1 && !res.report[C].READY.relaxed.includes('employer_per_tier'), JSON.stringify(res.report[C].READY));
  // the employer named in the person's skills may hold 5 per tier
  const gh = [];
  for (let i = 0; i < 8; i++) gh.push(row({ job_id: 'gh' + i, company: 'GoHighLevel', score: 95 }));
  for (let i = 0; i < 40; i++) gh.push(row({ score: 85 }));
  const cands = [{ id: C, primary_skills: JSON.stringify(['CRM Configuration', 'GoHighLevel']) }];
  const t2 = tiers(sel(gh, { candidates: cands }));
  assert.equal(Object.entries(t2).filter(([k, v]) => k.startsWith('gh') && v === 'READY').length, 5);
  assert.equal(Object.entries(t2).filter(([k, v]) => k.startsWith('gh') && v === 'STRETCH_READY').length, 3, 'the rest of its rows, under its own both-tier cap');
});

test('A4: four per employer on both tiers, relaxed when nothing fits', () => {
  const pool = [];
  for (let i = 0; i < 6; i++) pool.push(row({ job_id: 'e' + i, company: 'Evergreen', score: 90 }));
  for (let i = 0; i < 46; i++) pool.push(row({ score: 85 }));
  const t = tiers(sel(pool));
  assert.equal(Object.entries(t).filter(([k, v]) => k.startsWith('e') && v !== 'NEEDS_REVIEW').length, 4);
  // nothing else qualifies within the floor: the cap is relaxed and reported, the tier still fills
  const tight = [];
  for (let i = 0; i < 6; i++) tight.push(row({ job_id: 'f' + i, company: 'Fixed', score: 90 }));
  for (let i = 0; i < 3; i++) tight.push(row({ score: 62 }));
  const r = sel(tight, { tierSize: 3 });
  assert.ok(r.report[C].READY.relaxed.includes('employer_per_tier'));
  assert.equal(r.report[C].READY.count, 3);
});

test('A4: reposting sites: at most 3 per tier; a repost of a direct posting in the pool is dropped, a different posting is not', () => {
  const D = 'Configure the CRM and own workflow automation for our customers. Remote within India. '.repeat(3);
  const pool = [row({ job_id: 'direct', company: 'Acme', title: 'Implementation Lead', location: 'Remote - India', description: D, score: 80 }),
    row({ job_id: 'dup', company: 'Jobgether', title: 'Implementation Lead', location: 'Remote - India', description: D + ' Apply via Jobgether.', score: 90 }),
    row({ job_id: 'notdup', company: 'Jobgether', title: 'Implementation Lead', location: 'Remote - India', description: 'Another company entirely: onboard our SaaS customers and run their implementations from kickoff to go-live. '.repeat(2), score: 90 }),
    // tenth-man review: the reposter puts its own sentence first and the title says "(Remote)": still the same job
    row({ job_id: 'dup2', company: 'Jobgether', title: 'Implementation Lead (Remote)', location: 'India', description: 'This position is posted by Jobgether on behalf of a partner company. ' + D, score: 90 })];
  for (let i = 0; i < 5; i++) pool.push(row({ job_id: 'rp' + i, company: ['Turing', 'Crossover', 'Braintrust', 'Pavago', '20four7VA'][i], score: 95 }));
  const t = tiers(sel(pool));
  assert.equal(t.dup, undefined, 'the duplicate is dropped');
  assert.equal(t.dup2, undefined, 'and the one with its own opening sentence and a (Remote) title');
  assert.ok(t.notdup, 'a different posting from the same reposter stays');
  assert.equal(Object.entries(t).filter(([k, v]) => (k.startsWith('rp') || k === 'notdup') && v === 'READY').length, 3, 'three reposter rows in Ready');
  assert.equal(Object.entries(t).filter(([k, v]) => (k.startsWith('rp') || k === 'notdup') && v === 'STRETCH_READY').length, 3, 'the rest overflow to Stretch, three there too');
});

test('A4: a tenant-id employer is not shortlisted (B1 gives it a name first); known ids and short real names from other sites are', () => {
  const pool = [row({ job_id: 't1', company: 'Fa Eqid Saasfaprod1', source: 'oracle' }), row({ job_id: 't2', company: 'eluq', source: 'workday' }),
    row({ job_id: 't3', company: 'Eluq', source: 'oracle', url: 'https://eluq.fa.em3.oraclecloud.com/hcmUI/job/1' }),
    row({ job_id: 'k5', company: 'Hdga', source: 'oracle', url: 'https://hdga.fa.em3.oraclecloud.com/hcmUI/job/1' }),   // the names table knows it (Lucy Electric)
    row({ job_id: 'k1', company: 'Abb', source: 'workday' }), row({ job_id: 'k2', company: 'skip', source: 'ashby' }), row({ job_id: 'k3', company: 'Jll', source: 'workday' }),
    row({ job_id: 'k4', company: 'DAMAC', source: 'oracle', url: 'https://ejwe.fa.em2.oraclecloud.com/x' })];
  assert.deepEqual(tiers(sel(pool)), { k1: 'READY', k2: 'READY', k3: 'READY', k4: 'READY', k5: 'READY' });
});

test('A5: role families, five sample titles each, first match wins, including the misfiles found', () => {
  const F = 'farhan_shaikh', S = 'sana_ansari';
  const cases = {
    [F]: {
      revops_crm: ['RevOps Manager', 'Revenue Operations Lead', 'CRM Specialist', 'Sales Operations Manager', 'Marketing Automation Manager'],
      implementation: ['Implementation Manager', 'Customer Onboarding Lead', 'Deployment Strategist', 'Professional Services Consultant', 'Technical Project Manager, Implementations'],
      automation_ai: ['Automation Engineer', 'AI Specialist', 'Workflow Architect', 'No-code Builder', 'Integration Engineer'],
      technical_delivery: ['Technical Delivery Lead', 'Delivery Manager (Remote - India)', 'Technical Program Manager', 'Senior Project Manager', 'Delivery Lead, APAC'],
      business_systems: ['Business Systems Manager', 'Systems Analyst', 'Systems Architect', 'Salesforce Systems Administrator', 'Internal Tools Lead'],
      solutions: ['Solutions Engineer', 'Solution Consultant', 'Technical Account Manager', 'Customer Engineer', 'Senior Solutions Architect'],
      operations_general: ['Operations Manager', 'Chief of Staff', 'Business Operations Lead', 'Tech Operations Manager', 'Head of Operations'],
    },
    [S]: {
      maintenance: ['Maintenance Engineer', 'Electrical Maintenance Engineer', 'O&M Engineer – Solar', 'Shutdown Planner', 'Lead Engineer – Rotating Equipment'],
      reliability_asset: ['Reliability Engineer', 'Asset Performance Engineer', 'Asset Integrity Specialist', 'Condition Monitoring Engineer', 'Vibration Analyst'],
      energy_decarb: ['Energy Efficiency Engineer', 'Energy Manager', 'Decarbonisation Consultant', 'Net Zero Lead', 'Emissions Specialist'],
      plant_operations: ['Power Plant Operations Engineer', 'Plant Engineer', 'Shift In-charge', 'Boiler Engineer', 'Control Room Operator'],
      utilities: ['Utilities Engineer', 'HVAC Engineer', 'Water Treatment Engineer', 'Compressed Air Specialist', 'Facilities Engineer'],
      commissioning_projects: ['Commissioning Engineer', 'Project Engineer – Power', 'Projects Manager', 'Construction Manager', 'Site Engineer'],
      electrical: ['Electrical Engineer', 'Substation Engineer', 'Switchgear Engineer', 'Transmission Lines Engineer', 'Protection Engineer'],
      field_consulting: ['Field Service Engineer', 'Technical Consultant', 'Advisor, Power Systems', 'Product Specialist', 'Senior Consultant'],
    },
  };
  for (const [cid, fams] of Object.entries(cases)) for (const [fam, titles] of Object.entries(fams)) for (const t of titles) assert.equal(familyOf(cid, t), fam, `${cid}: ${t}`);
  assert.equal(familyOf(F, 'Brand Designer'), 'unclassified');
  assert.equal(familyOf('someone_else', 'Implementation Manager'), 'unclassified');
});

test('A5: no family above 40% of a tier (allowance at least 4), relaxed when nothing else qualifies; unclassified is not capped', () => {
  const pool = [];
  for (let i = 0; i < 30; i++) pool.push(row({ job_id: 'im' + String(i).padStart(2, '0'), title: 'Implementation Manager ' + i, score: 90 }));
  const others = ['RevOps Manager', 'Automation Engineer', 'Technical Program Manager', 'Systems Analyst', 'Solutions Engineer', 'Operations Manager'];
  for (let i = 0; i < 40; i++) pool.push(row({ job_id: 'ot' + String(i).padStart(2, '0'), title: others[i % 6] + ' ' + i, score: 85 }));
  const res = sel(pool);
  assert.equal(res.report[C].READY.families.implementation, 10, 'at most 40% of 25');
  assert.ok(Object.keys(res.report[C].READY.families).length >= 4, JSON.stringify(res.report[C].READY.families));
  // the same pool with nothing else within the floor: the cap is relaxed, the tier still fills
  const only = pool.slice(0, 30);
  const r2 = sel(only);
  assert.ok(r2.report[C].READY.relaxed.includes('family_share'));
  assert.equal(r2.report[C].READY.count, 25);
  const un = []; for (let i = 0; i < 30; i++) un.push(row({ title: 'Brand Designer ' + i, score: 90 })); for (let i = 0; i < 30; i++) un.push(row({ title: 'Operations Manager ' + i, score: 80 }));
  assert.equal(sel(un).report[C].READY.families.unclassified, 25, 'unclassified is not a family: not capped');
});

test('A5: "something different" takes up to 2 places at the end of Stretch for a family on neither tier, never unclassified, within the floor', () => {
  const pool = [];
  for (let i = 0; i < 60; i++) pool.push(row({ title: ['Implementation Manager', 'RevOps Manager', 'Automation Engineer', 'Operations Manager'][i % 4] + ' ' + i, score: 90 - (i % 5) }));
  pool.push(row({ job_id: 'brand', title: 'Brand Designer', score: 84 }));                 // unclassified: never
  pool.push(row({ job_id: 'sol', title: 'Solutions Engineer', score: 80 }));               // a new family, within 10 of the last Stretch row
  pool.push(row({ job_id: 'sys', title: 'Systems Analyst', score: 79 }));                  // a second new family
  pool.push(row({ job_id: 'tpm', title: 'Technical Program Manager', score: 64 }));       // a third, under threshold + 5
  const res = sel(pool);
  const t = tiers(res);
  assert.deepEqual([t.sol, t.sys, t.brand, t.tpm], ['STRETCH_READY', 'STRETCH_READY', undefined, undefined]);
  assert.equal(res.report[C].STRETCH_READY.different, 2);
  assert.equal(res.report[C].STRETCH_READY.count, 25);
  assert.equal(sel(pool, { different: false }).changes.some((c) => c.job_id === 'sol'), false);
});

test('A6: place bands', () => {
  const F = 'farhan_shaikh', S = 'sana_ansari';
  const b = (cid, loc, wp = 'UNKNOWN', d = '') => placeBand(cid, loc, wp, null, d);
  assert.equal(b(S, 'Ruwais, AE'), 'gulf'); assert.equal(b(S, 'Doha, Qatar', 'ONSITE'), 'gulf');
  assert.equal(b(S, 'Jamnagar, Gujarat', 'ONSITE'), 'india_onsite'); assert.equal(b(S, 'Pune, India'), 'india_onsite');
  assert.equal(b(S, 'Remote - India', 'REMOTE_RESTRICTED'), 'remote'); assert.equal(b(S, 'Remote (Global)', 'REMOTE_RESTRICTED'), 'remote');
  assert.equal(b(F, 'Remote (Global)', 'REMOTE_RESTRICTED'), 'remote_global'); assert.equal(b(F, 'Anywhere', 'REMOTE_RESTRICTED'), 'remote_global');
  assert.equal(b(F, 'Remote - APAC', 'REMOTE_RESTRICTED'), 'remote_global'); assert.equal(b(S, 'Remote - APAC', 'REMOTE_RESTRICTED'), 'remote');
  assert.equal(b(F, 'Remote - India', 'REMOTE_RESTRICTED'), 'remote'); assert.equal(b(F, 'Remote', 'REMOTE_RESTRICTED', 'We hire anywhere in the world.'), 'remote_global');
  assert.equal(b(F, 'Remote - US', 'REMOTE_RESTRICTED'), 'other'); assert.equal(b(F, 'Remote', 'REMOTE_RESTRICTED', 'US residents only.'), 'other');
  assert.equal(b(S, 'Houston, TX', 'ONSITE', 'Visa sponsorship available for the right candidate.'), 'abroad_with_route');
  assert.equal(b(S, 'Houston, TX', 'ONSITE', 'We are unable to offer visa sponsorship.'), 'other');
  assert.equal(b(S, 'Houston, TX', 'ONSITE'), 'other');
});

test('A6: band minimums are met by swaps within the score floor, or reported as a shortfall', () => {
  const S = 'sana_ansari';
  const srow = (o) => row({ candidate_id: S, title: 'Maintenance Engineer ' + n, ...o });
  const fam = ['Maintenance Engineer', 'Reliability Engineer', 'Energy Manager', 'Plant Engineer', 'Utilities Engineer', 'Electrical Engineer'];
  const pool = [];
  for (let i = 0; i < 60; i++) pool.push(srow({ title: fam[i % 6] + ' ' + i, location: 'Pune, India', workplace: 'ONSITE', score: 90 - (i % 5) }));
  for (let i = 0; i < 6; i++) pool.push(srow({ job_id: 'gulf' + i, title: fam[i % 6] + ' G' + i, location: 'Ruwais, AE', workplace: 'ONSITE', score: 80, eligibility: 'UNKNOWN' }));
  for (let i = 0; i < 4; i++) pool.push(srow({ job_id: 'rem' + i, title: fam[i % 6] + ' R' + i, location: 'Remote - India', workplace: 'REMOTE_RESTRICTED', score: 82 }));
  const res = sel(pool);
  const rep = res.report[S];
  assert.ok(rep.READY.bands.remote >= 2, JSON.stringify(rep.READY.bands));
  assert.ok(rep.STRETCH_READY.bands.gulf >= 5, JSON.stringify(rep.STRETCH_READY.bands));
  assert.ok(rep.STRETCH_READY.bands.remote >= 2, JSON.stringify(rep.STRETCH_READY.bands));
  assert.deepEqual(rep.READY.band_shortfall, {}); assert.deepEqual(rep.STRETCH_READY.band_shortfall, {});
  // Gulf rows under the floor (threshold + 5) cannot be swapped in: reported, not forced
  const low = pool.map((r) => (r.job_id.startsWith('gulf') ? { ...r, score: 62 } : r));
  const r2 = sel(low).report[S].STRETCH_READY;
  assert.equal(r2.bands.gulf || 0, 0);
  assert.deepEqual(r2.band_shortfall, { gulf: 5 });
  assert.ok(r2.relaxed.includes('band_gulf_min_5'));
});

test('A7: the report counts rows found more than 30 days ago (they rank 5 lower)', () => {
  const res = sel([row({ discovered_at: iso(40), score: 90 }), row({ discovered_at: iso(2), score: 86 })], { tierSize: 1 });
  assert.equal(res.report[C].READY.older_than_30_days, 0, 'the 40-day-old 90 ranks as 85, below the new 86');
  assert.equal(sel([row({ discovered_at: iso(40), score: 92 })]).report[C].READY.older_than_30_days, 1);
});

test('tenth-man fixes: titles compare without place and work-mode parts; the same title at another plant is another job; reposters by their whole name', () => {
  assert.equal(titleKey('Solutions Engineer (Remote)'), titleKey('Solutions Engineer'));
  assert.equal(titleKey('Senior Engineer - Mechanical Maintenance, Jamnagar'), titleKey('Senior Engineer - Mechanical Maintenance'));
  assert.equal(titleKey('Delivery Manager – Remote, India'), 'delivery manager');
  assert.notEqual(titleKey('Engineer - Maintenance'), titleKey('Engineer - Reliability'));
  const pool = [row({ job_id: 'z1', company: 'Zapier', title: 'Solutions Engineer', score: 90 }), row({ job_id: 'z2', company: 'Zapier, Inc.', title: 'Solutions Engineer (Remote)', score: 89 }),
    row({ job_id: 'a1', company: 'Adani Power', title: 'Electrical Maintenance Engineer', location: 'Udupi, Karnataka, India', workplace: 'ONSITE', score: 83 }),
    row({ job_id: 'a2', company: 'Adani Power', title: 'Electrical Maintenance Engineer', location: 'Kawai, Rajasthan, India', workplace: 'ONSITE', score: 82 }),
    row({ job_id: 'a3', company: 'Adani Power', title: 'Electrical Maintenance Engineer', location: 'Udupi, India', workplace: 'ONSITE', score: 81 }),
    row({ job_id: 'tl', company: 'Turing Labs', title: 'Implementation Engineer', score: 80 })];
  const t = tiers(sel(pool));
  assert.equal(t.z1, 'READY'); assert.equal(t.z2, undefined, 'the same Zapier job once');
  assert.deepEqual([t.a1, t.a2, t.a3], ['READY', 'READY', undefined], 'two plants are two jobs; the same plant twice is one');
  assert.equal(isReposter({ company: 'Turing Labs' }), false); assert.equal(isReposter({ company: 'Turing' }), true); assert.equal(isReposter({ company: 'Jobgether' }), true);
});

test('deterministic: the same pool in any order gives the same changes', () => {
  const pool = [];
  for (let i = 0; i < 60; i++) pool.push(row({ score: 55 + (i * 7) % 40, eligibility: i % 3 ? 'ELIGIBLE' : 'UNKNOWN', discovered_at: iso(i % 40) }));
  const a = sel(pool), b = sel([...pool].reverse());
  assert.deepEqual(a.changes, b.changes);
});

test('generated SQL: guards, marks, history, idempotence; a person\'s Ready row and decided rows stay byte-identical', () => {
  const { sqlite: db } = createDb();
  db.prepare(`INSERT INTO candidates(id,full_name,qualification_threshold) VALUES (?,?,60)`).run(C, 'F');
  const V = JSON.stringify({ preliminary: true, [RULES_MARKER]: true }), now = new Date().toISOString();
  const add = (id, score, o = {}) => {
    db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,discovered_at,last_verified_at) VALUES (?,?,?,?,?,?,?,?)`).run(id, 'T ' + id, 'Co ' + id, 'lever', 'https://x.example/' + id, o.active ?? 1, now, now);
    db.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?,?)`).run(C, id, o.status || 'NEEDS_REVIEW', o.elig || 'ELIGIBLE', o.reason ?? 'Cloud discovery match.', o.override || null);
    db.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,score_breakdown) VALUES (?,?,?,40,?)`).run(C, id, score, V);
    if (o.app) db.prepare(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,'APPLIED')`).run('ap' + id, C, id);
  };
  add('new', 80); add('up', 85, { status: 'STRETCH_READY', reason: MARK + 'x' }); add('down', 20, { status: 'READY', reason: MARK + 'y' });
  add('person', 10, { status: 'READY', reason: 'Strongest Fit verified match (61%)' }); add('ovr', 90, { override: 'NEEDS_REVIEW' });
  add('applied', 20, { status: 'READY', reason: MARK + 'z', app: true }); add('ovr_auto', 20, { status: 'READY', reason: MARK + 'w', override: 'READY' });
  const keep = () => JSON.stringify(db.prepare(`SELECT * FROM candidate_qualifications WHERE job_id IN ('person','ovr','applied','ovr_auto') ORDER BY job_id`).all());
  const before = keep();
  const r = selectInto(db);
  const st = Object.fromEntries(db.prepare(`SELECT job_id j, qualification_status s, qualification_reason r FROM candidate_qualifications`).all().map((x) => [x.j, [x.s, x.r]]));
  assert.deepEqual(st.new, ['READY', MARK + 'Cloud discovery match.']);
  assert.deepEqual(st.up, ['READY', MARK + 'x'], 'moved up: marked once');
  assert.deepEqual(st.down, ['NEEDS_REVIEW', 'y'], 'demoted: the mark is removed');
  assert.equal(keep(), before, 'decided, applied and person-set rows are byte-identical');
  const hist = db.prepare(`SELECT job_id j, previous_status p, new_status n, actor a FROM qualification_history ORDER BY job_id`).all().map((h) => `${h.j}:${h.p}>${h.n}:${h.a}`);
  assert.deepEqual(hist, ['down:READY>NEEDS_REVIEW:discovery', 'new:NEEDS_REVIEW>READY:discovery', 'up:STRETCH_READY>READY:discovery']);
  db.exec(r.sql);   // the same file twice
  assert.equal(db.prepare('SELECT COUNT(*) c FROM qualification_history').get().c, 3, 'running the file again changes nothing');
  assert.equal(selectInto(db).sql, '', 'a fresh selection on the result has nothing to change');
  // between the export and the write a person decides and a job closes: the guards win
  db.prepare(`UPDATE candidate_qualifications SET qualification_status = 'NEEDS_REVIEW', qualification_reason = 'Cloud discovery match.' WHERE job_id = 'new'`).run();
  add('closing', 95);
  const sql = selectionSql(selectShortlist(exportPool(db).rows, {}).changes);
  assert.match(sql, /'new'[\s\S]*'closing'|'closing'[\s\S]*'new'/, 'both would be shortlisted');
  db.prepare(`UPDATE candidate_qualifications SET manual_override_status = 'HOLD' WHERE job_id = 'new'`).run();
  db.prepare(`UPDATE jobs SET is_active = 0 WHERE id = 'closing'`).run();
  db.exec(sql);
  assert.equal(db.prepare(`SELECT qualification_status s FROM candidate_qualifications WHERE job_id = 'new'`).get().s, 'NEEDS_REVIEW', 'a decision made in between is not overwritten');
  assert.equal(db.prepare(`SELECT qualification_status s FROM candidate_qualifications WHERE job_id = 'closing'`).get().s, 'NEEDS_REVIEW', 'a job closed in between is not shortlisted');
});

test('CLI: one SQL file; with no pool it writes an empty file and the lists stay as they are', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-'));
  const out = path.join(dir, 'select.sql');
  const cli = (...a) => execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/shortlist_select.mjs', '--out', out, ...a], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(out, 'stale');
  assert.match(cli('--pool', path.join(dir, 'missing.json')), /No shortlist pool/);
  assert.equal(fs.readFileSync(out, 'utf8'), '');
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'pool.json'), JSON.stringify({ rows: [row({ job_id: 'p1', last_verified_at: now, discovered_at: now })] }));
  fs.writeFileSync(path.join(dir, 'live.json'), JSON.stringify({ alive: [], dead: ['p1'] }));
  cli('--pool', path.join(dir, 'pool.json'), '--report', path.join(dir, 'report.json'));
  assert.match(fs.readFileSync(out, 'utf8'), /'READY'[\s\S]*generation = generation \+ 1/);
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))[C].READY;   // plan A7
  for (const k of ['count', 'employers', 'max_employer_share', 'families', 'bands', 'older_than_30_days', 'swaps', 'relaxed', 'pool_smaller_than_tier']) assert.ok(k in rep, k);
  cli('--pool', path.join(dir, 'pool.json'), '--liveness', path.join(dir, 'live.json'));
  assert.equal(fs.readFileSync(out, 'utf8'), '', 'found closed by today\'s check: not shortlisted');
});

test('plan D1: the report counts pool and tier rows per source', () => {
  const pool = [row({ job_id: 'a', source: 'workday', company: 'A' }), row({ job_id: 'b', source: 'workday', company: 'B' }),
    row({ job_id: 'c', source: 'ats_dataset', company: 'C', score: 50 }), row({ job_id: 'd', source: undefined, company: 'D', score: 40 })];
  const { report } = sel(pool);
  assert.deepEqual(report[C].pool_sources, { workday: 2, ats_dataset: 1, unknown: 1 });
  assert.deepEqual(report[C].READY.sources, { workday: 2 });
  assert.deepEqual(report[C].STRETCH_READY.sources, { ats_dataset: 1 });
});

test('gap fix: a Gulf posting from a job board that refuses the check, found in 2 days, counts for Stretch only; the audit agrees', () => {
  const S = 'sana_ansari';
  const g = (o) => row({ candidate_id: S, title: 'Maintenance Engineer ' + o.job_id, company: 'Gulf Co ' + o.job_id, location: 'Dubai, United Arab Emirates', workplace: 'ONSITE',
    source: 'linkedin', url: 'https://ae.linkedin.com/jobs/view/' + o.job_id, last_verified_at: null, discovered_at: iso(1), ...o });
  const pool = [g({ job_id: 'ready_q', score: 85 }), g({ job_id: 'stretch_q', score: 70, eligibility: 'UNKNOWN' }),
    g({ job_id: 'bayt', url: 'https://www.bayt.com/en/uae/jobs/x', score: 75 }), g({ job_id: 'old', discovered_at: iso(3), score: 90 }),
    g({ job_id: 'india', location: 'Pune, India', url: 'https://in.linkedin.com/jobs/view/9', score: 90 }),
    g({ job_id: 'ats', url: 'https://boards.greenhouse.io/x/1', score: 90 }), g({ job_id: 'dead', score: 90 }),
    auto('READY', { candidate_id: S, job_id: 'inc', company: 'Inc Co', location: 'Doha, Qatar', url: 'https://qa.indeed.com/viewjob?jk=1', last_verified_at: null, discovered_at: iso(0), score: 88 })];
  const res = sel(pool, { dead: ['dead'] });
  assert.deepEqual(tiers(res), { ready_q: 'STRETCH_READY', stretch_q: 'STRETCH_READY', bayt: 'STRETCH_READY', inc: 'STRETCH_READY' },
    'Ready-quality rows go to Stretch, never Ready; older than 2 days, India, another site and a closed posting stay out');
  assert.equal(res.changes.find((c) => c.job_id === 'inc').why, 'Not confirmed still open: moved to Stretch');
  assert.equal(res.report[S].STRETCH_READY.listed_not_confirmed, 4);
  assert.equal(res.report[S].READY.count, 0);
  // the same rows verified by the check go to Ready as before
  assert.equal(tiers(sel(pool.map((r) => ({ ...r, last_verified_at: iso(0) })), { dead: ['dead'] })).ready_q, 'READY');
});

test('one SuccessFactors posting across tracking links and employer aliases', () => {
  const common = { source: 'successfactors', location: 'Bap, India', title: 'Solar Asset Manager', workplace: 'ONSITE' };
  const a = row({ ...common, job_id: 'a', company: 'Energy Services', url: 'https://example.org/job/Solar-Lead/12345/', score: 91 });
  const b = row({ ...common, job_id: 'b', company: 'Energy Group', url: a.url + '?feedId=null&utm_source=rss', score: 90 });
  const other = row({ ...common, job_id: 'c', company: 'Another Employer', url: 'https://other.example/job/Solar-Lead/12345/' });
  assert.deepEqual(tiers(sel([b, other, a])), { a: 'READY', c: 'READY' });
  assert.deepEqual(tiers(sel([{ ...a, kind: 'held' }, b, other])), { c: 'READY' });
});
