// Contract tests for the job listings behind the India Remote view and the READY dashboard. They assert WHICH jobs come back (exact ids,
// order, classes), not that a control is selected or a counter is non-zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { roleFamilyOf, fitOf, assessmentConflict, ROLE_FAMILIES } from '../worker/listing.ts';

const worker = await loadWorker();
const F = 'farhan_shaikh', S = 'sana_ansari';

function world(extraEnv = {}) {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,citizenship,primary_timezone,total_years_experience,qualification_threshold) VALUES
       ('farhan_shaikh','Test Farhan','India','India','Asia/Kolkata',4,70), ('sana_ansari','Test Sana','India','India','Asia/Kolkata',9,60)`);
  const add = (cand, id, title, { status = 'NEEDS_REVIEW', elig = 'ELIGIBLE', score = 50, pub = 0, active = 1, app = null, lane = 'STRONGEST_FIT', override = null, company = 'Co', at = '2026-11-01T00:00:00Z' } = {}) => {
    if (!sqlite.prepare('SELECT 1 FROM jobs WHERE id=?').get(id))
      run(`INSERT INTO jobs(id,title,company,source_adapter,is_active,salary_published,discovered_at,location_restrictions) VALUES (?,?,?,?,?,?,?,'Remote - India')`, id, title, company, 'lever', active, pub, at);
    run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,strategy_lane,manual_override_status,manual_override_reason) VALUES (?,?,?,?,?,?,?)`,
      cand, id, status, elig, lane, override, override ? 'PRIVATE-OVERRIDE-REASON-9c1' : null);
    run(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score) VALUES (?,?,?)`, cand, id, score);
    if (app) run(`INSERT INTO applications(id,candidate_id,job_id,status,notes) VALUES (?,?,?,?,?)`, `app-${cand}-${id}`, cand, id, app, 'PRIVATE-NOTE-9c1');
  };
  return { sqlite, env: makeEnv(d1, extraEnv), add, run };
}
const ids = (r) => r.json.jobs.map((j) => j.id);
const get = (w, path, key) => call(worker, w.env, 'GET', path, key === undefined ? {} : { key });
const JOBS = (q, c = F) => `/api/jobs?candidate_id=${c}&${q}`;
const IR = (q, c = F) => `/api/india-remote/jobs?candidate_id=${c}&${q}`;

// Farhan's India Remote set. Scores are distinct so the order is fully determined.
function farhanSet(w) {
  const a = w.add;
  a(F, 'ir1', 'Implementation Manager', { status: 'READY', score: 90, pub: 1 });
  a(F, 'ir2', 'Solutions Engineer', { status: 'READY', score: 85, pub: 0 });
  a(F, 'ir3', 'CRM Systems Analyst', { status: 'STRETCH_READY', score: 80, pub: 1 });
  a(F, 'ir4', 'Workflow Automation Lead', { status: 'STRETCH_READY', score: 75, pub: 0, app: 'APPLIED' });
  a(F, 'ir5', 'Technical Operations Manager', { status: 'NEEDS_REVIEW', score: 70, pub: 1 });
  a(F, 'ir6', 'Revenue Operations Analyst', { status: 'NEEDS_REVIEW', score: 65, pub: 0, app: 'SAVED' });
  a(F, 'ir7', 'Staff Software Engineer', { status: 'INELIGIBLE', score: 40, pub: 0 });
  a(F, 'ir8', 'Technical Account Manager', { status: 'HOLD', score: 35, pub: 1 });
  a(F, 'ir9', 'Gardener', { status: 'READY_HIGH', score: 30, pub: 0 });
  a(F, 'ir10', 'AI Operations Engineer', { status: 'READY', score: 20, pub: 1 });
  a(F, 'ir13', 'Implementation Specialist', { status: 'READY', score: 15, pub: 1, app: 'REJECTED' });
  // never part of the India Remote set
  a(F, 'ir11', 'Implementation Lead (closed)', { status: 'READY', score: 99, active: 0 });
  a(F, 'ir12', 'Implementation Director (location unknown)', { status: 'READY', score: 98, elig: 'UNKNOWN' });
}
const ALL_F = ['ir1', 'ir2', 'ir3', 'ir4', 'ir5', 'ir6', 'ir7', 'ir8', 'ir9', 'ir10', 'ir13'];   // score order

test('role families come from the title only, in rule order; an unmatched title has no family (never an invented default)', () => {
  const expect = {
    'Implementation Manager': 'IMPLEMENTATION', 'Solutions Engineer': 'SOLUTIONS', 'CRM Systems Analyst': 'CRM_GTM', 'Workflow Automation Lead': 'AUTOMATION',
    'Technical Operations Manager': 'TECHNICAL_OPERATIONS', 'Revenue Operations Analyst': 'REVENUE_SYSTEMS', 'Technical Account Manager': 'TECHNICAL_ACCOUNT',
    'AI Operations Engineer': 'AI_OPERATIONS', 'Reliability Engineer': 'RELIABILITY_MAINTENANCE', 'Power Systems Engineer': 'POWER_ENERGY',
  };
  for (const [t, k] of Object.entries(expect)) assert.equal(roleFamilyOf(t)?.key, k, t);
  for (const t of ['Gardener', 'Staff Software Engineer', '', null, undefined]) assert.equal(roleFamilyOf(t), null, String(t));
  // reviewer-found misclassifications of realistic titles
  for (const t of ['Senior Power BI Developer', 'Power BI Analyst', 'Power Apps Developer', 'Account Executive', 'Account Manager', 'Software Engineer, Billing', 'HR Operations Specialist', 'Finance Operations Analyst'])
    assert.equal(roleFamilyOf(t), null, t);
  assert.equal(roleFamilyOf('Billing Systems Analyst')?.key, 'REVENUE_SYSTEMS'); assert.equal(roleFamilyOf('Operations Manager')?.key, 'TECHNICAL_OPERATIONS'); assert.equal(roleFamilyOf('Power Systems Engineer')?.key, 'POWER_ENERGY');
  const t0 = Date.now(); roleFamilyOf('ai '.repeat(30000)); assert.ok(Date.now() - t0 < 200, 'a very long title cannot make the rules expensive');
  assert.ok(!ROLE_FAMILIES.some((f) => /stretch/i.test(f.label)), '"Adjacent Stretch" is a fit, not a role family');
  assert.equal(fitOf('READY_HIGH'), 'READY'); assert.equal(fitOf('HOLD'), 'NOT_FIT'); assert.equal(fitOf('CLOSED'), 'NOT_FIT'); assert.equal(fitOf(undefined), 'NOT_FIT');
});

test('software site reliability titles do not enter the plant reliability filter or its counts', async () => {
  const w = world();
  for (const [id, title] of [
    ['software', 'Site Reliability Engineer - India'], ['gitops', 'Senior Site Reliability / GitOps Engineer'],
    ['network', 'Network Reliability Engineer'], ['sre', 'SRE - Software Reliability Engineer'],
    ['plant', 'Plant Reliability Engineer'], ['equipment', 'Rotating Equipment Reliability Engineer'],
    ['refinery', 'Site Reliability Engineer - Refinery'],
  ]) w.add(S, id, title);
  const plant = await get(w, IR('role_family=RELIABILITY_MAINTENANCE', S), null);
  assert.deepEqual(ids(plant).sort(), ['equipment', 'plant', 'refinery']);
  const other = await get(w, IR('role_family=UNCLASSIFIED', S), null);
  assert.deepEqual(ids(other).sort(), ['gitops', 'network', 'software', 'sre']);
  assert.equal(other.json.facets.role_family.find(f => f.key === 'RELIABILITY_MAINTENANCE').count, 3);
});

test('India Remote: the unfiltered list is exactly the ELIGIBLE active jobs of the candidate, best score first', async () => {
  const w = world(); farhanSet(w);
  const r = await get(w, IR(''));
  assert.equal(r.status, 200); assert.deepEqual(ids(r), ALL_F); assert.equal(r.json.total, ALL_F.length); assert.equal(r.json.count, ALL_F.length);
  for (const j of r.json.jobs) { assert.equal(j.remote_from_india, 'CONFIRMED'); assert.equal(j.eligibility.classification, 'ELIGIBLE'); assert.equal(j.candidate_id, F); }
});

test('India Remote: fit filter returns exactly the jobs of that class (READY includes READY_HIGH); counts equal the list', async () => {
  const w = world(); farhanSet(w);
  const want = { READY: ['ir1', 'ir2', 'ir9', 'ir10', 'ir13'], STRETCH: ['ir3', 'ir4'], REVIEW: ['ir5', 'ir6'], NOT_FIT: ['ir7', 'ir8'] };
  for (const [fit, expected] of Object.entries(want)) {
    const r = await get(w, IR(`farhan_fit=${fit}`));
    assert.deepEqual(ids(r), expected, fit); assert.equal(r.json.total, expected.length, fit);
    assert.ok(r.json.jobs.every((j) => j.farhan_fit === fit), `every job of ${fit} is classified ${fit}`);
    assert.equal(r.json.facets.fit[fit], expected.length, `the facet beside ${fit} equals what choosing it shows`);
  }
  const all = await get(w, IR(''));
  assert.deepEqual(all.json.facets.fit, { ALL: 11, READY: 5, STRETCH: 2, REVIEW: 2, NOT_FIT: 2 });
  assert.equal(all.json.jobs.find((j) => j.id === 'ir9').farhan_fit, 'READY');
});

test('India Remote: role family filter returns exactly the jobs of that family; Unclassified is only what no rule matches; facets list real families only', async () => {
  const w = world(); farhanSet(w);
  const want = { IMPLEMENTATION: ['ir1', 'ir13'], SOLUTIONS: ['ir2'], CRM_GTM: ['ir3'], AUTOMATION: ['ir4'], TECHNICAL_OPERATIONS: ['ir5'], REVENUE_SYSTEMS: ['ir6'], TECHNICAL_ACCOUNT: ['ir8'], AI_OPERATIONS: ['ir10'], UNCLASSIFIED: ['ir7', 'ir9'] };
  for (const [fam, expected] of Object.entries(want)) {
    const r = await get(w, IR(`role_family=${fam}`));
    assert.deepEqual(ids(r), expected, fam);
    for (const j of r.json.jobs) assert.equal(j.role_family_key, fam);
  }
  const unclassified = (await get(w, IR('role_family=UNCLASSIFIED'))).json.jobs;
  assert.ok(unclassified.every((j) => j.role_family === null), 'no invented family label on an unclassified job');
  const fam = (await get(w, IR(''))).json.facets.role_family;
  assert.deepEqual(fam.map((f) => [f.key, f.count]), [['TECHNICAL_ACCOUNT', 1], ['REVENUE_SYSTEMS', 1], ['CRM_GTM', 1], ['AI_OPERATIONS', 1], ['AUTOMATION', 1], ['SOLUTIONS', 1], ['IMPLEMENTATION', 2], ['TECHNICAL_OPERATIONS', 1], ['UNCLASSIFIED', 2]]);
});

test('India Remote: pay filter is the stored salary_published flag (legacy UNKNOWN is the same as UNPUBLISHED)', async () => {
  const w = world(); farhanSet(w);
  const pub = await get(w, IR('pay_filter=PUBLISHED')), unpub = await get(w, IR('pay_filter=UNPUBLISHED')), legacy = await get(w, IR('pay_filter=UNKNOWN'));
  assert.deepEqual(ids(pub), ['ir1', 'ir3', 'ir5', 'ir8', 'ir10', 'ir13']); assert.ok(pub.json.jobs.every((j) => j.salary_published === true));
  assert.deepEqual(ids(unpub), ['ir2', 'ir4', 'ir6', 'ir7', 'ir9']); assert.ok(unpub.json.jobs.every((j) => j.salary_published === false));
  assert.deepEqual(ids(legacy), ids(unpub));
  assert.deepEqual(pub.json.facets.pay, { ALL: 11, PUBLISHED: 6, UNPUBLISHED: 5 });   // a facet ignores its OWN filter: it says what choosing each option would show
  const all = await get(w, IR('')); assert.deepEqual(all.json.facets.pay, { ALL: 11, PUBLISHED: 6, UNPUBLISHED: 5 });
});

test('India Remote: applied jobs are excluded on request; SAVED is not "applied"; the default keeps every eligible job', async () => {
  const w = world(); farhanSet(w);
  const ex = await get(w, IR('exclude_applied=true'));
  assert.deepEqual(ids(ex), ['ir1', 'ir2', 'ir3', 'ir5', 'ir6', 'ir7', 'ir8', 'ir9', 'ir10']);   // ir4 (APPLIED) and ir13 (REJECTED) are gone, ir6 (SAVED) stays
  assert.equal(ex.json.facets.fit.ALL, 9); assert.deepEqual(ex.json.facets.fit, { ALL: 9, READY: 4, STRETCH: 1, REVIEW: 2, NOT_FIT: 2 });
  assert.deepEqual(ids(await get(w, IR('exclude_applied=false'))), ALL_F);
  assert.equal((await get(w, IR('exclude_applied=true'))).json.jobs.find((j) => j.id === 'ir6').application.status, 'SAVED');
});

test('India Remote: combined filters, search and empty results', async () => {
  const w = world(); farhanSet(w);
  assert.deepEqual(ids(await get(w, IR('farhan_fit=READY&role_family=SOLUTIONS&pay_filter=UNPUBLISHED&exclude_applied=true'))), ['ir2']);
  assert.deepEqual(ids(await get(w, IR('farhan_fit=READY&pay_filter=PUBLISHED&exclude_applied=true'))), ['ir1', 'ir10']);           // ir13 (REJECTED) excluded
  assert.deepEqual(ids(await get(w, IR('farhan_fit=READY&pay_filter=PUBLISHED&exclude_applied=false'))), ['ir1', 'ir10', 'ir13']);
  assert.deepEqual(ids(await get(w, IR('search=automation'))), ['ir4']);
  assert.deepEqual(ids(await get(w, IR('search=analyst&farhan_fit=STRETCH'))), ['ir3']);
  const none = await get(w, IR('farhan_fit=STRETCH&pay_filter=PUBLISHED&role_family=TECHNICAL_ACCOUNT'));
  assert.equal(none.status, 200); assert.deepEqual(none.json.jobs, []); assert.equal(none.json.total, 0); assert.equal(none.json.count, 0);
  assert.deepEqual(none.json.facets.fit, { ALL: 1, READY: 0, STRETCH: 0, REVIEW: 0, NOT_FIT: 1 });   // fit counts ignore the fit filter: with this family and pay only the NOT_FIT job (ir8) would show
  assert.deepEqual((await get(w, IR('farhan_fit=STRETCH&role_family=TECHNICAL_ACCOUNT&pay_filter=PUBLISHED&exclude_applied=true&search=zzz'))).json.facets.fit, { ALL: 0, READY: 0, STRETCH: 0, REVIEW: 0, NOT_FIT: 0 });
  assert.deepEqual((await get(w, IR('search=zzzz-nothing'))).json.jobs, []);
});

test('India Remote: pagination is stable, complete and does not change the counts', async () => {
  const w = world(); farhanSet(w);
  const seen = []; let total = null;
  for (let off = 0; off < 14; off += 4) {
    const r = await get(w, IR(`limit=4&offset=${off}`));
    assert.equal(r.json.limit, 4); assert.equal(r.json.offset, off);
    if (total === null) total = r.json.total; assert.equal(r.json.total, total); assert.equal(r.json.facets.fit.ALL, total);
    seen.push(...ids(r));
  }
  assert.deepEqual(seen, ALL_F, 'the pages, concatenated, are the whole list once, in order');
  const past = await get(w, IR('limit=4&offset=40'));
  assert.deepEqual(past.json.jobs, []); assert.equal(past.json.total, ALL_F.length);
  const filtered = [];
  for (let off = 0; off < 6; off += 2) filtered.push(...ids(await get(w, IR(`farhan_fit=READY&limit=2&offset=${off}`))));
  assert.deepEqual(filtered, ['ir1', 'ir2', 'ir9', 'ir10', 'ir13']);
});

test('India Remote: sort orders are honoured with explicit expected orders', async () => {
  const w = world();
  w.add(F, 'o1', 'Beta Analyst', { status: 'READY', score: 10, company: 'Zeta', at: '2026-11-03T00:00:00Z' });
  w.add(F, 'o2', 'Alpha Analyst', { status: 'READY', score: 30, company: 'Mid', at: '2026-11-01T00:00:00Z' });
  w.add(F, 'o3', 'Gamma Analyst', { status: 'READY', score: 20, company: 'Alpha', at: '2026-11-02T00:00:00Z' });
  assert.deepEqual(ids(await get(w, IR('sort_by=score_desc'))), ['o2', 'o3', 'o1']);
  assert.deepEqual(ids(await get(w, IR('sort_by=date_desc'))), ['o1', 'o3', 'o2']);
  assert.deepEqual(ids(await get(w, IR('sort_by=title_asc'))), ['o2', 'o1', 'o3']);
  assert.deepEqual(ids(await get(w, IR('sort_by=company_asc'))), ['o3', 'o2', 'o1']);
});

test('India Remote: both candidates are isolated and classified from their own rows', async () => {
  const w = world(); farhanSet(w);
  w.add(S, 's1', 'Reliability Engineer', { status: 'READY', score: 88, pub: 1 });
  w.add(S, 's2', 'Power Systems Engineer', { status: 'STRETCH_READY', score: 77 });
  w.add(S, 's3', 'Plant Maintenance Lead', { status: 'NEEDS_REVIEW', score: 66, app: 'APPLIED' });
  w.add(S, 's4', 'Solar Developer', { status: 'NEEDS_REVIEW', score: 55, elig: 'UNKNOWN' });
  w.add(S, 'ir1', 'Implementation Manager', { status: 'HOLD', score: 5 });    // the same job is a different class for her
  const sana = await get(w, IR('', S));
  assert.deepEqual(ids(sana), ['s1', 's2', 's3', 'ir1']); assert.ok(sana.json.jobs.every((j) => j.candidate_id === S));
  assert.deepEqual(ids(await get(w, IR('farhan_fit=READY', S))), ['s1']);
  assert.deepEqual(ids(await get(w, IR('role_family=RELIABILITY_MAINTENANCE&exclude_applied=true', S))), ['s1']);          // s3 is applied, so only s1 remains
  assert.deepEqual(ids(await get(w, IR('role_family=RELIABILITY_MAINTENANCE', S))), ['s1', 's3']);
  assert.deepEqual(ids(await get(w, IR('role_family=POWER_ENERGY', S))), ['s2']);
  assert.deepEqual(ids(await get(w, IR('farhan_fit=NOT_FIT', S))), ['ir1']);
  assert.ok(!ids(await get(w, IR('farhan_fit=NOT_FIT', F))).includes('ir1'));
  assert.equal((await get(w, IR('farhan_fit=READY', F))).json.jobs.find((j) => j.id === 'ir1').farhan_fit, 'READY');           // Farhan's own class for the same job
});

test('India Remote: unsupported values are refused, not ignored', async () => {
  const w = world(); farhanSet(w);
  for (const q of ['farhan_fit=MAYBE', 'pay_filter=MEETS_60K', 'role_family=Adjacent%20Stretch', 'sort_by=random', 'exclude_applied=yes']) {
    const r = await get(w, IR(q)); assert.equal(r.status, 400, q); assert.ok(r.json.error && r.json.allowed, q);
    const pub = await get(w, IR(q), null);                                                                    // a visitor without a key gets the reason too
    assert.equal(pub.status, 400, q); assert.match(pub.json.detail, /^Unsupported /, q); assert.ok(Array.isArray(pub.json.allowed), q);
  }
  const j = await get(w, JOBS('farhan_fit=MAYBE'), null); assert.equal(j.status, 400); assert.match(j.json.detail, /farhan_fit/);
  const p = await get(w, JOBS('pay_filter=MEETS_60K'), null); assert.equal(p.status, 400); assert.match(p.json.detail, /pay_filter/);
  assert.equal((await get(w, '/api/india-remote/jobs?candidate_id=nobody')).status, 400);
});

test('India Remote: parameters of the old delegated route that are not filters here are refused, and search wildcards are literal', async () => {
  const w = world(); farhanSet(w);
  for (const q of ['min_score=85', 'qualification_status=STRETCH_READY', 'strategy_lane=DREAM', 'workplace_type=ONSITE', 'source_adapter=zzz', 'eligibility=INELIGIBLE', 'exclude_dismissed=true']) {
    const r = await get(w, IR(q), null); assert.equal(r.status, 400, q); assert.match(r.json.detail, /not .*filters|parameter/i, q);
  }
  assert.deepEqual(ids(await get(w, IR('search=%25'))), [], '"%" is a literal character, not a wildcard that matches every job');
  assert.deepEqual(ids(await get(w, IR('search=_'))), []);
  assert.equal((await get(w, IR(''))).json.truncated, false);
});

test('cache: answers that differ only in a filter are never shared; a repeat is a hit', async () => {
  const w = world({ RESPONSE_CACHE: 'on', GIT_COMMIT: 'commit-a' }); farhanSet(w);
  const ready = await get(w, IR('farhan_fit=READY'), null), stretch = await get(w, IR('farhan_fit=STRETCH'), null);
  assert.deepEqual(ids(ready), ['ir1', 'ir2', 'ir9', 'ir10', 'ir13']); assert.deepEqual(ids(stretch), ['ir3', 'ir4']);
  for (const q of ['role_family=SOLUTIONS', 'pay_filter=PUBLISHED', 'exclude_applied=true', 'limit=2&offset=2']) {
    const a = await get(w, IR(q), null), b = await get(w, IR(''), null);
    assert.notDeepEqual(ids(a), ids(b), q);
  }
  const again = await worker.fetch(new Request('https://test.invalid' + IR('farhan_fit=READY')), w.env, { waitUntil() {} });
  assert.equal(again.headers.get('X-Cache'), 'HIT', 'the repeat of an identical request is answered from the cache');
  assert.deepEqual((await again.json()).jobs.map((j) => j.id), ['ir1', 'ir2', 'ir9', 'ir10', 'ir13']);
  for (const [a, b] of [['sort_by=title_asc', 'sort_by=date_desc'], ['search=analyst', 'search=implementation']]) assert.notDeepEqual(ids(await get(w, IR(a), null)), ids(await get(w, IR(b), null)), `${a} vs ${b}`);
  assert.deepEqual(ids(await get(w, IR('', S), null)), [], 'another candidate never receives Farhan\'s cached answer');
  // /api/jobs: the same rule for the filters it honours
  const j1 = await get(w, `/api/jobs?candidate_id=${F}&farhan_fit=READY`, null), j2 = await get(w, `/api/jobs?candidate_id=${F}&pay_filter=PUBLISHED`, null);
  assert.ok(j1.json.jobs.every((j) => j.farhan_fit === 'READY')); assert.ok(j2.json.jobs.every((j) => j.salary_published));
  assert.notDeepEqual(ids(j1), ids(j2));
});

// ---- READY dashboard: the selected status is queried on the server -------------------------------------------------------
function readyWorld() {
  const w = world();
  // 130 higher-scoring jobs that are NOT ready fill the first pages when sorted by score ...
  for (let i = 0; i < 130; i++) w.add(F, `hi${String(i).padStart(3, '0')}`, `Operations Analyst ${i}`, { status: 'NEEDS_REVIEW', elig: i % 2 ? 'ELIGIBLE' : 'UNKNOWN', score: 95 - Math.floor(i / 10), at: `2026-11-02T00:${String(i % 60).padStart(2, '0')}:00Z` });
  // ... and the READY / STRETCH jobs score below all of them.
  w.add(F, 'rd1', 'Implementation Manager', { status: 'READY', score: 41 });
  w.add(F, 'rd2', 'Solutions Engineer', { status: 'READY', score: 33 });
  w.add(F, 'rd3', 'Automation Specialist', { status: 'READY', score: 12 });
  w.add(F, 'rd4', 'CRM Lead', { status: 'READY', score: 9, app: 'APPLIED' });
  w.add(F, 'rd5', 'Onboarding Lead', { status: 'READY', score: 8, app: 'SAVED' });
  w.add(F, 'st1', 'Technical Operations Lead', { status: 'STRETCH_READY', score: 44 });
  w.add(F, 'st2', 'Delivery Manager', { status: 'STRETCH_READY', score: 7 });
  w.add(F, 'dis1', 'Dismissed Role', { status: 'INELIGIBLE', score: 99 });
  w.add(S, 'sr1', 'Reliability Engineer', { status: 'READY', score: 20 });
  return w;
}

test('READY dashboard: READY jobs below the first 100 scores are returned when the status is queried on the server', async () => {
  const w = readyWorld();
  const firstHundred = await get(w, JOBS('sort_by=score_desc&exclude_applied=true&limit=100'), null);
  assert.equal(firstHundred.json.count, 100);
  assert.ok(!ids(firstHundred).some((id) => /^(rd|st)/.test(id)), 'the old request (first 100 by score, filtered in the browser) contains no READY job at all');
  const ready = await get(w, JOBS('qualification_status=READY&sort_by=score_desc&exclude_applied=true&limit=100'), null);
  assert.deepEqual(ids(ready), ['rd1', 'rd2', 'rd3', 'rd5']);               // rd4 is applied; rd5 is only SAVED
  assert.equal(ready.json.total, 4); assert.ok(ready.json.jobs.every((j) => j.qualification_status === 'READY' && j.candidate_id === F));
  const stretch = await get(w, JOBS('qualification_status=STRETCH_READY&exclude_applied=true&limit=100'), null);
  assert.deepEqual(ids(stretch), ['st1', 'st2']);
  const worthy = await get(w, JOBS('qualification_status=APPLY_WORTHY&exclude_applied=true&limit=100'), null);
  assert.deepEqual(ids(worthy), ['st1', 'rd1', 'rd2', 'rd3', 'rd5', 'st2']);
});

test('READY dashboard: counts in the same answer equal what each tab shows; pagination walks the whole READY set', async () => {
  const w = readyWorld();
  const r = await get(w, JOBS('qualification_status=READY&exclude_applied=true&exclude_dismissed=true&limit=100'), null);
  assert.equal(r.json.status_counts.READY, 4); assert.equal(r.json.status_counts.STRETCH_READY, 2); assert.equal(r.json.status_counts.NEEDS_REVIEW, 130);
  assert.equal(r.json.total, r.json.status_counts.READY, 'the list total and the READY count are the same number');
  const pages = [];
  for (let off = 0; off < 4; off += 3) { const p = await get(w, JOBS(`qualification_status=READY&exclude_applied=true&limit=3&offset=${off}`), null); assert.equal(p.json.total, 4); pages.push(...ids(p)); }
  assert.deepEqual(pages, ['rd1', 'rd2', 'rd3', 'rd5']);
  const review = await get(w, JOBS('qualification_status=NEEDS_REVIEW&exclude_applied=true&exclude_dismissed=true&limit=100&offset=100'), null);
  assert.equal(review.json.count, 30); assert.equal(review.json.total, 130);       // beyond the old 100-row ceiling, reachable by paging
  const dismissed = await get(w, JOBS('exclude_dismissed=true&limit=100&offset=0&qualification_status=ALL'), null);
  assert.ok(!ids(dismissed).includes('dis1'));
});

test('READY dashboard: the review sub-filters are real server filters (location unverified, pay not published)', async () => {
  const w = readyWorld();
  const unk = await get(w, JOBS('qualification_status=NEEDS_REVIEW&eligibility=UNKNOWN&limit=100'), null);
  assert.equal(unk.json.total, 65); assert.ok(unk.json.jobs.every((j) => j.eligibility.classification === 'UNKNOWN'));
  const unpub = await get(w, JOBS('qualification_status=NEEDS_REVIEW&pay_filter=UNPUBLISHED&limit=5'), null);
  assert.equal(unpub.json.total, 130); assert.ok(unpub.json.jobs.every((j) => j.salary_published === false));
  assert.equal((await get(w, JOBS('qualification_status=NEEDS_REVIEW&pay_filter=PUBLISHED&limit=5'), null)).json.total, 0);
  const bad = await get(w, JOBS('pay_filter=MEETS_60K'), null); assert.equal(bad.status, 400);
});

test('READY/score conflicts are explained, not repaired; human decisions are not exposed or changed', async () => {
  const w = world();
  w.add(F, 'c1', 'Implementation Manager', { status: 'READY', score: 0 });                                              // READY, no score
  w.add(F, 'c2', 'Solutions Engineer', { status: 'READY', score: 55 });                                                // below the 70 threshold
  w.add(F, 'c3', 'CRM Lead', { status: 'READY', score: 88, override: 'READY' });                                       // fine
  w.add(F, 'c4', 'Automation Lead', { status: 'READY', score: 52, override: 'READY', lane: 'NOT_FIT' });               // human READY, low score, NOT_FIT lane
  w.add(F, 'c5', 'Delivery Manager', { status: 'STRETCH_READY', score: 40 });                                         // stretch is not held to the threshold
  const before = JSON.stringify([w.sqlite.prepare('SELECT * FROM candidate_qualifications ORDER BY job_id').all(), w.sqlite.prepare('SELECT * FROM candidate_job_scores ORDER BY job_id').all()]);
  const pub = await get(w, JOBS('qualification_status=READY&limit=100'), null);
  const by = Object.fromEntries(pub.json.jobs.map((j) => [j.id, j]));
  assert.equal(by.c1.assessment_conflict, true); assert.match(by.c1.assessment_conflict_reason, /no preliminary score is stored/); assert.match(by.c1.assessment_conflict_reason, /comes from the qualification review/);
  assert.equal(by.c2.assessment_conflict, true); assert.match(by.c2.assessment_conflict_reason, /score is 55, below the qualification threshold of 70/);
  assert.equal(by.c3.assessment_conflict, false); assert.equal(by.c3.assessment_conflict_reason, null);
  assert.equal(by.c4.assessment_conflict, true); assert.match(by.c4.assessment_conflict_reason, /was set by a human decision/); assert.match(by.c4.assessment_conflict_reason, /NOT_FIT/);
  assert.ok(!JSON.stringify(pub.json).includes('PRIVATE-OVERRIDE-REASON-9c1'), 'the human override reason is never part of a public answer');
  assert.equal(by.c2.qualification_status, 'READY'); assert.equal(by.c2.score.overall_score, 55);                        // shown as recorded
  const st = (await get(w, JOBS('qualification_status=STRETCH_READY'), null)).json.jobs[0]; assert.equal(st.assessment_conflict, false);
  const after = JSON.stringify([w.sqlite.prepare('SELECT * FROM candidate_qualifications ORDER BY job_id').all(), w.sqlite.prepare('SELECT * FROM candidate_job_scores ORDER BY job_id').all()]);
  assert.equal(after, before, 'reading listings changes no status, override or score');
  assert.deepEqual(assessmentConflict({ qualification_status: 'NEEDS_REVIEW', overall_score: 0 }, 70), { conflict: false, reason: null });
});

test('listings never write: applications, history, qualifications and scores are byte-identical after every request', async () => {
  const w = world(); farhanSet(w); w.add(S, 's1', 'Reliability Engineer', { status: 'READY', score: 88 });
  const snap = () => JSON.stringify(['applications', 'application_history', 'candidate_qualifications', 'candidate_job_scores'].map((t) => w.sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
  const before = snap();
  for (const q of ['', 'farhan_fit=READY', 'role_family=SOLUTIONS&pay_filter=PUBLISHED', 'exclude_applied=true&limit=2&offset=2', 'search=analyst']) { await get(w, IR(q)); await get(w, IR(q, S)); await get(w, IR(q), null); }
  await get(w, JOBS('qualification_status=READY&limit=100')); await get(w, JOBS('farhan_fit=READY&pay_filter=PUBLISHED'), null);
  assert.equal(snap(), before);
});

test('India Remote requires remote evidence while the general list retains eligible office and relocation jobs', async () => {
  const w = world();
  for (const [id, workplace, location, reason] of [
    ['india', 'REMOTE', 'Remote - India', ''],
    ['world', 'UNKNOWN', 'Worldwide', 'Posting explicitly advertises worldwide remote work.'],
    ['legacy', 'UNKNOWN', 'India', 'Accessible Indian market opportunity (Remote in India).'],
    ['office', 'ONSITE', 'Wada, India', 'On-site or hybrid in India: workable for the candidate (owner decision 2026-11-12).'],
    ['hybrid', 'HYBRID', 'Remote - India', 'Posting explicitly supports fully remote work from India.'],
    ['visa', 'REMOTE_RESTRICTED', 'Berlin', 'Posting affirmatively mentions sponsorship/relocation; eligibility still requires review.'],
    ['unknown', 'UNKNOWN', 'India', ''],
  ]) {
    w.add(S, id, 'Engineer');
    w.run('UPDATE jobs SET workplace_type=?, location_restrictions=? WHERE id=?', workplace, location, id);
    w.run('UPDATE candidate_qualifications SET eligibility_reason=? WHERE job_id=?', reason, id);
  }
  const jobs = (await get(w, JOBS('', S), null)).json.jobs;
  assert.equal(jobs.length, 7);
  assert.deepEqual(jobs.filter(j => j.remote_from_india === 'CONFIRMED').map(j => j.id).sort(), ['india', 'legacy', 'world']);
  assert.deepEqual(ids(await get(w, IR('', S), null)).sort(), ['india', 'legacy', 'world']);
  assert.equal((await get(w, '/api/india-remote/summary?candidate_id=' + S, null)).json.total_confirmed, 3);
});
