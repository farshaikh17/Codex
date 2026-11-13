// Resold clients: onboarding, private-by-default visibility, read-only share links, backfill and CSV export.
// Every check names the clients and jobs it expects, not just a status code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, ADMIN_KEY } from './harness.mjs';

const F = 'farhan_shaikh', S = 'sana_ansari';
const worker = await loadWorker();

function world(extra = {}) {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,qualification_threshold,primary_skills) VALUES (?,?,?,?,?),(?,?,?,?,?)`,
    F, 'Farhan', 'Mumbai, India', 70, '["CRM Configuration"]', S, 'Sana', 'Kota, India', 60, '["Maintenance"]');
  const job = (id, title, location, description, o = {}) => run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, title, o.company || 'Acme', 'lever', 'https://jobs.lever.co/acme/' + id, o.active ?? 1, location, description, o.workplace || 'REMOTE', o.at || '2026-11-01T00:00:00Z', o.provenance || 'LIVE_PUBLIC');
  job('k1', 'Data Analyst', 'Remote - India', 'Fully remote role. SQL and dashboards.', { at: '2026-11-03T00:00:00Z' });
  job('k2', 'Office Manager', 'Remote - India', 'Fully remote role.', { at: '2026-11-02T00:00:00Z' });
  job('k3', 'Senior Data Analyst', 'Berlin, Germany', 'On-site in Berlin. SQL.', { workplace: 'ONSITE', at: '2026-11-01T00:00:00Z' });
  job('k4', 'Data Analyst (board)', 'Remote', 'Reported by a board.', { provenance: 'PUBLIC_FEED_UNVERIFIED', at: '2026-10-30T00:00:00Z' });
  job('k5', 'Data Analyst', 'Remote - India', 'Closed posting.', { active: 0 });
  job('k6', '=HYPERLINK("http://x.invalid","Data Analyst")', 'Remote - India', 'Fully remote role. SQL.', { company: 'Formula, "Co"', at: '2026-10-29T00:00:00Z' });
  // built-in candidates' existing rows must never change
  run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,qualification_reason) VALUES (?,?,?,?,?,?)`, F, 'k1', 'READY', 'STRONGEST_FIT', 'ELIGIBLE', 'human');
  run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,manual_override_status,manual_override_reason,eligibility_status) VALUES (?,?,?,?,?,?)`, F, 'k2', 'HOLD', 'HOLD', 'PRIVATE-OVERRIDE-REASON', 'ELIGIBLE');
  run(`INSERT INTO applications(id,candidate_id,job_id,status,notes) VALUES ('a1',?,?,?,?)`, F, 'k1', 'APPLIED', 'PRIVATE-NOTE-c1');
  return { sqlite, d1, run, env: makeEnv(d1, extra) };
}
async function req(env, method, path, { body, key = ADMIN_KEY, view } = {}) {
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (view) headers['X-View-Token'] = view;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://test.invalid' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const analyst = { full_name: 'Priya Analyst', current_location: 'Pune, India', primary_skills: ['SQL', 'Dashboards'], qualification_threshold: 65,
  display_title: 'Data & BI Analyst', summary_line: 'SQL • Dashboards • remote from India',
  search_profile: { role_keywords: ['data analyst', 'bi analyst'], avoid_keywords: ['senior'], location_mode: 'REMOTE_FROM_HOME', home_country: 'India' } };
const snapBuiltins = (w) => JSON.stringify(['candidate_qualifications', 'candidate_job_scores', 'applications'].map((t) =>
  w.sqlite.prepare(`SELECT * FROM ${t} WHERE candidate_id IN ('${F}','${S}') ORDER BY 1,2`).all()));
const ids = (r) => (r.json?.jobs || []).map((j) => j.id).sort();

test('a new client is private: visitors cannot list, open or even learn its id; the operator sees it', async () => {
  const w = world();
  const made = await req(w.env, 'POST', '/api/clients', { body: analyst });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.json.client.id, 'priya_analyst');
  assert.equal(made.json.client.visibility, 'private');
  const anonList = await req(w.env, 'GET', '/api/candidates', { key: null });
  assert.deepEqual(anonList.json.map((c) => c.id).sort(), [F, S]);
  const opList = await req(w.env, 'GET', '/api/candidates');
  assert.deepEqual(opList.json.map((c) => c.id).sort(), [F, 'priya_analyst', S]);
  for (const p of ['/api/jobs?candidate_id=priya_analyst', '/api/analytics?candidate_id=priya_analyst', '/api/candidates/priya_analyst/jobs', '/api/export?candidate_id=priya_analyst']) {
    const r = await req(w.env, 'GET', p, { key: null });
    assert.equal(r.status, 400, p);
    assert.ok(!r.text.includes('priya_analyst\"]') && !(r.json?.allowed_candidate_ids || []).includes('priya_analyst'), `${p} must not list the private id`);
  }
  // an unknown id answers exactly like a private one
  const unknown = await req(w.env, 'GET', '/api/jobs?candidate_id=nobody_here', { key: null });
  assert.deepEqual(unknown.json.allowed_candidate_ids.sort(), [F, S]);
  const ov = await req(w.env, 'GET', '/api/dashboard/overview', { key: null });
  assert.deepEqual(ov.json.candidates.map((c) => c.candidate_id), [F, S]);
  const ovOp = await req(w.env, 'GET', '/api/dashboard/overview');
  assert.deepEqual(ovOp.json.candidates.map((c) => c.candidate_id), [F, S, 'priya_analyst']);
  assert.equal(ovOp.json.candidates[2].display_title, 'Data & BI Analyst');
});

test('backfill screens exactly the active jobs the client has no row for, with its own profile, and touches nothing else', async () => {
  const w = world();
  await req(w.env, 'POST', '/api/clients', { body: analyst });
  const before = snapBuiltins(w);
  const b1 = await req(w.env, 'POST', '/api/clients/priya_analyst/backfill?limit=200');
  assert.equal(b1.status, 200, b1.text);
  assert.equal(b1.json.inserted, 5);                       // k1 k2 k3 k4 k6 (k5 is closed)
  const rows = Object.fromEntries(w.sqlite.prepare(`SELECT q.job_id, q.qualification_status st, q.eligibility_status es, s.overall_score sc FROM candidate_qualifications q JOIN candidate_job_scores s USING(candidate_id, job_id) WHERE q.candidate_id='priya_analyst'`).all().map((r) => [r.job_id, r]));
  assert.deepEqual(Object.keys(rows).sort(), ['k1', 'k2', 'k3', 'k4', 'k6']);
  assert.deepEqual([rows.k1.st, rows.k1.es], ['NEEDS_REVIEW', 'ELIGIBLE']);   // keyword in title, remote from India
  assert.equal(rows.k2.st, 'HOLD');                                           // no role keyword in the title
  assert.ok(rows.k3.sc < rows.k1.sc, 'senior is on the avoid list and Berlin is a foreign location: ranked lower');
  assert.equal(rows.k3.es, 'UNKNOWN');
  assert.deepEqual([rows.k4.st, rows.k4.es], ['NEEDS_REVIEW', 'UNKNOWN']);    // job-board posting: never eligible from the board alone
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM candidate_qualifications WHERE candidate_id='priya_analyst' AND qualification_status IN ('READY','READY_HIGH','STRETCH_READY')`).get().n, 0);
  assert.equal(snapBuiltins(w), before, 'the built-in candidates are untouched');
  const b2 = await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  assert.equal(b2.json.inserted, 0);
  // and the operator listing shows the work
  const list = await req(w.env, 'GET', '/api/clients');
  const p = list.json.clients.find((c) => c.id === 'priya_analyst');
  assert.equal(p.jobs_screened, 5);
  assert.deepEqual(p.search_profile.role_keywords, ['data analyst', 'bi analyst']);
});

test('a share link opens exactly one client, read-only, uncached, until it is revoked', async () => {
  const w = world({ RESPONSE_CACHE: 'on', GIT_COMMIT: 'test' });
  await req(w.env, 'POST', '/api/clients', { body: analyst });
  await req(w.env, 'POST', '/api/clients', { body: { ...analyst, full_name: 'Omar Other' } });
  await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  await req(w.env, 'POST', '/api/clients/omar_other/backfill');
  const link = await req(w.env, 'POST', '/api/clients/priya_analyst/share-links', { body: { label: 'for Priya' } });
  assert.equal(link.status, 201);
  assert.match(link.json.token, /^v1_[0-9a-f]{48}$/);
  assert.equal(link.json.path, `/app#view=${link.json.token}&candidate=priya_analyst`);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) n FROM client_view_tokens WHERE token_hash = ?').get(link.json.token).n, 0, 'only the hash is stored');
  const t = link.json.token;

  const mine = await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst&limit=50', { key: null, view: t });
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(ids(mine), ['k1', 'k2', 'k3', 'k4', 'k6']);
  assert.equal(mine.headers.get('X-Cache'), null, 'share-link answers are never cached');
  const cands = await req(w.env, 'GET', '/api/candidates', { key: null, view: t });
  assert.deepEqual(cands.json.map((c) => c.id).sort(), [F, 'priya_analyst', S]);
  assert.equal(cands.json.find((c) => c.id === 'priya_analyst').visibility, undefined, 'viewers get the public field set');

  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=omar_other', { key: null, view: t })).status, 400, 'another client stays closed');
  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst', { key: null })).status, 400, 'no link, no access');
  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst', { key: null, view: 'v1_' + '0'.repeat(48) })).status, 400);
  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst', { key: null, view: 'garbage' })).status, 400);
  // the public cache never holds the private client: a visitor right after the viewer is still refused
  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst&limit=50', { key: null })).status, 400);
  // a share link cannot write
  assert.equal((await req(w.env, 'POST', '/api/clients/priya_analyst/backfill', { key: null, view: t })).status, 401);

  const listed = await req(w.env, 'GET', '/api/clients/priya_analyst/share-links');
  assert.equal(listed.json.share_links.length, 1);
  assert.ok(!listed.text.includes(t), 'the token is never shown again');
  const del = await req(w.env, 'DELETE', `/api/clients/priya_analyst/share-links/${listed.json.share_links[0].link_id}`);
  assert.equal(del.status, 200);
  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst', { key: null, view: t })).status, 400, 'revoked at once');
});

test('visibility changes apply at once, including to cached answers; the built-in two cannot be made private', async () => {
  const w = world({ RESPONSE_CACHE: 'on', GIT_COMMIT: 'test' });
  await req(w.env, 'POST', '/api/clients', { body: analyst });
  await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  assert.equal((await req(w.env, 'PUT', '/api/clients/priya_analyst', { body: { visibility: 'public' } })).status, 200);
  const pub = await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst&limit=50', { key: null });
  assert.equal(pub.status, 200);
  assert.deepEqual(ids(pub), ['k1', 'k2', 'k3', 'k4', 'k6']);
  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst&limit=50', { key: null })).headers.get('X-Cache'), 'HIT');
  assert.equal((await req(w.env, 'PUT', '/api/clients/priya_analyst', { body: { visibility: 'private' } })).status, 200);
  assert.equal((await req(w.env, 'GET', '/api/jobs?candidate_id=priya_analyst&limit=50', { key: null })).status, 400, 'the cached public answer is not served');
  const ov = await req(w.env, 'GET', '/api/dashboard/overview', { key: null });
  assert.deepEqual(ov.json.candidates.map((c) => c.candidate_id), [F, S]);
  const b = await req(w.env, 'PUT', `/api/clients/${F}`, { body: { visibility: 'private' } });
  assert.equal(b.status, 400);
  assert.equal((await req(w.env, 'GET', `/api/jobs?candidate_id=${F}`, { key: null })).status, 200);
});

test('client input is validated; onboarding needs the operator key', async () => {
  const w = world();
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: analyst, key: null })).status, 401);
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: { ...analyst, search_profile: { role_keywords: [] } } })).status, 400);
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: { ...analyst, id: 'Bad Id!' } })).status, 400);
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: { ...analyst, qualification_threshold: 200 } })).status, 400);
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: { ...analyst, primary_timezone: 'Mars/Base' } })).status, 400);
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: { ...analyst, id: F } })).status, 409);
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: analyst })).status, 201);
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: analyst })).status, 409);
  // keywords are plain words: regex characters match literally and cannot break or slow the screen
  const r = await req(w.env, 'POST', '/api/clients', { body: { ...analyst, full_name: 'Regex Person', search_profile: { role_keywords: ['(a+)+$', 'c++'] } } });
  assert.equal(r.status, 201);
  assert.equal((await req(w.env, 'POST', '/api/clients/regex_person/backfill')).status, 200);
});

test('CSV export: the public field set, spreadsheet-safe, visibility-checked', async () => {
  const w = world();
  const pub = await req(w.env, 'GET', `/api/export?candidate_id=${F}`, { key: null });
  assert.equal(pub.status, 200);
  assert.match(pub.headers.get('Content-Type'), /text\/csv/);
  const lines = pub.text.trim().split('\r\n');
  assert.equal(lines[0], 'job_id,title,company,location,workplace,posting_url,qualification_status,eligibility,lane,preliminary_score,pay_published,pay_text,application_status,discovered_at');
  assert.deepEqual(lines.slice(1).map((l) => l.split(',')[0]).sort(), ['k1', 'k2']);
  assert.ok(lines.some((l) => l.startsWith('k1,') && l.includes(',APPLIED,')));
  for (const secret of ['PRIVATE-NOTE-c1', 'PRIVATE-OVERRIDE-REASON', 'Mumbai']) assert.ok(!pub.text.includes(secret), secret);
  await req(w.env, 'POST', '/api/clients', { body: analyst });
  await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  assert.equal((await req(w.env, 'GET', '/api/export?candidate_id=priya_analyst', { key: null })).status, 400);
  const op = await req(w.env, 'GET', '/api/export?candidate_id=priya_analyst');
  const k6 = op.text.split('\r\n').find((l) => l.startsWith('k6,'));
  assert.ok(k6.startsWith(`k6,"'=HYPERLINK(""http://x.invalid"",""Data Analyst"")","Formula, ""Co""",`), k6);
  const ready = await req(w.env, 'GET', '/api/export?candidate_id=priya_analyst&qualification_status=HOLD');
  assert.deepEqual(ready.text.trim().split('\r\n').slice(1).map((l) => l.split(',')[0]).sort(), ['k2']);
  assert.equal((await req(w.env, 'GET', '/api/export?candidate_id=priya_analyst&qualification_status=DROP', {})).status, 400);
});

test('a full 100-row page works on both listings (D1 allows at most 100 bound parameters per statement)', async () => {
  const w = world();
  for (let i = 0; i < 130; i++) {
    w.run(`INSERT INTO jobs(id,title,company,source_adapter,is_active,location_restrictions,description,workplace_type,discovered_at) VALUES (?,?,?,?,1,?,?,?,?)`, `bulk${i}`, 'Implementation Manager', 'Bulk', 'lever', 'Remote - India', 'Fully remote from India.', 'REMOTE', '2026-11-04T00:00:00Z');
    w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status) VALUES (?,?,?,?,?)`, F, `bulk${i}`, 'NEEDS_REVIEW', 'STRONGEST_FIT', 'ELIGIBLE');
  }
  const jobs = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&limit=100`, { key: null });
  assert.equal(jobs.status, 200, jobs.text.slice(0, 200));
  assert.equal(jobs.json.jobs.length, 100);
  const ir = await req(w.env, 'GET', `/api/india-remote/jobs?candidate_id=${F}&limit=100`, { key: null });
  assert.equal(ir.status, 200, ir.text.slice(0, 200));
  assert.equal(ir.json.jobs.length, 100);
  const op = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&limit=130`);
  assert.equal(op.json.jobs.length, 130, 'the operator may ask for more than 100 rows: still one statement parameter');
});

test('a client profile shows only what was entered for it, never the built-in candidates’ facts', async () => {
  const w = world();
  await req(w.env, 'POST', '/api/clients', { body: analyst });
  const op = await req(w.env, 'GET', '/api/profile?candidate_id=priya_analyst');
  assert.equal(op.status, 200);
  assert.equal(op.json.display_title, 'Data & BI Analyst');
  assert.equal(op.json.summary_line, 'SQL • Dashboards • remote from India');
  assert.deepEqual(op.json.target_roles, ['data analyst', 'bi analyst']);
  assert.deepEqual(op.json.location_preferences, ['Fully remote from India']);
  for (const k of ['min_acceptable_salary_usd', 'min_fixed_monthly_inr', 'preferred_inr_range', 'notice_period_days']) assert.equal(op.json[k], null, k);
  assert.ok(!JSON.stringify(op.json).includes('Farhan') && !JSON.stringify(op.json).includes('120000'));
  await req(w.env, 'PUT', '/api/clients/priya_analyst', { body: { visibility: 'public' } });
  const pub = await req(w.env, 'GET', '/api/profile?candidate_id=priya_analyst', { key: null });
  assert.equal(pub.json.summary_line, 'SQL • Dashboards • remote from India');
  assert.equal(pub.json.current_location, 'India');
  assert.ok(!pub.text.includes('Pune'), 'the stored city stays operator-only');
});

test('a private id is indistinguishable from an unknown one: same status and same bytes on every route, also when the budget is used up', async () => {
  const w = world({ RESPONSE_CACHE: 'on', GIT_COMMIT: 'test' });
  await req(w.env, 'POST', '/api/clients', { body: { ...analyst, full_name: 'Secret Person' } });
  for (const path of ['/api/jobs?candidate_id=X', '/api/candidates/X/jobs', '/api/export?candidate_id=X', '/api/profile?candidate_id=X', '/api/jobs/k1?candidate_id=X', '/api/analytics?candidate_id=X']) {
    const priv = await req(w.env, 'GET', path.replace('X', 'secret_person'), { key: null });
    const unk = await req(w.env, 'GET', path.replace('X', 'secret_persoX'), { key: null });
    assert.equal(priv.status, unk.status, path);
    assert.equal(priv.text.replace('secret_person', 'ID'), unk.text.replace('secret_persoX', 'ID'), path);
    assert.ok(!priv.text.includes('secret_person'), path);
  }
  w.run(`INSERT INTO read_meter(day, rows_read) VALUES (?, 99999999) ON CONFLICT(day) DO UPDATE SET rows_read = 99999999`, new Date().toISOString().slice(0, 10));
  const a = await req(w.env, 'GET', '/api/jobs?candidate_id=secret_person', { key: null });
  const b = await req(w.env, 'GET', '/api/jobs?candidate_id=secret_persoX', { key: null });
  assert.equal(a.status, b.status, 'over budget');
  assert.equal(a.text, b.text);
});

test('an answer computed under an older registry generation is never cached; an invalid share token does not bypass the cache', async () => {
  const w = world({ RESPONSE_CACHE: 'on', GIT_COMMIT: 'test' });
  // a visitor request whose visibility was decided, then an operator change lands before its cache write
  const realPrepare = w.d1.prepare.bind(w.d1);
  let bumped = false;
  w.d1.prepare = (sql) => {
    if (!bumped && /SELECT s\.generation AS current/.test(sql)) { bumped = true; w.run('UPDATE cache_state SET generation = generation + 1 WHERE id = 1'); }
    return realPrepare(sql);
  };
  const first = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}`, { key: null });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Cache'), null, 'not stored: visibility was decided under the previous generation');
  w.d1.prepare = realPrepare;
  assert.equal((await req(w.env, 'GET', `/api/jobs?candidate_id=${F}`, { key: null })).headers.get('X-Cache'), 'MISS');
  assert.equal((await req(w.env, 'GET', `/api/jobs?candidate_id=${F}`, { key: null, view: 'garbage' })).headers.get('X-Cache'), 'HIT');
});

test('backfill skips a job the client already applied to (no orphan score), counts only what it wrote, and finishes', async () => {
  const w = world();
  await req(w.env, 'POST', '/api/clients', { body: analyst });
  w.run(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('pa','priya_analyst','k2','APPLIED')`);
  const b1 = await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  assert.equal(b1.json.inserted, 4);
  assert.equal(b1.json.more, false);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM candidate_job_scores WHERE candidate_id='priya_analyst' AND job_id='k2'`).get().n, 0);
  const b2 = await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  assert.deepEqual([b2.json.inserted, b2.json.more], [0, false]);
  // batches are bounded to 40 per call whatever is asked
  for (let i = 0; i < 45; i++) w.run(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at) VALUES (?,?,?,?,1,?)`, `m${i}`, 'Data Analyst', 'M', 'lever', '2026-11-05T00:00:00Z');
  const b3 = await req(w.env, 'POST', '/api/clients/priya_analyst/backfill?limit=500');
  assert.deepEqual([b3.json.inserted, b3.json.more], [40, true]);
  const b4 = await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  assert.deepEqual([b4.json.inserted, b4.json.more], [5, false]);
});

test('analytics average score keeps its scope: every score row of an active job, with or without a qualification row', async () => {
  const w = world();
  w.run(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score) VALUES (?,?,?),(?,?,?),(?,?,?)`, F, 'k1', 60, F, 'k2', 60, F, 'k3', 90);
  const a = await req(w.env, 'GET', `/api/analytics?candidate_id=${F}`);
  assert.equal(a.json.average_match_score, 70, 'k3 has a score but no qualification row; it still counts');
  assert.equal(a.json.total_jobs, 2);
});

test('overview and the client list stay within the 50-queries-per-request limit with many clients', async () => {
  const w = world();
  for (let i = 0; i < 12; i++) await req(w.env, 'POST', '/api/clients', { body: { ...analyst, full_name: `Client Number ${String.fromCharCode(97 + i)}`, visibility: i % 2 ? 'public' : 'private' } });
  const realPrepare = w.d1.prepare.bind(w.d1);
  let n = 0; w.d1.prepare = (sql) => { n++; return realPrepare(sql); };
  const op = await req(w.env, 'GET', '/api/dashboard/overview');
  assert.equal(op.json.candidates.length, 14);
  assert.ok(n < 30, `overview used ${n} queries`);
  n = 0;
  const pub = await req(w.env, 'GET', '/api/dashboard/overview', { key: null });
  assert.equal(pub.json.candidates.length, 2 + 6, 'only the public clients for a visitor');
  assert.ok(n < 30, `public overview used ${n} queries`);
  n = 0;
  const list = await req(w.env, 'GET', '/api/clients');
  assert.equal(list.json.clients.length, 14);
  assert.ok(n < 20, `client list used ${n} queries`);
  w.d1.prepare = realPrepare;
});

test('un-save removes a SAVED-only record, leaves the job in "not applied" lists, keeps history, and never removes a real application', async () => {
  const w = world();
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status) VALUES (?,?,?,?,?)`, F, 'k3', 'NEEDS_REVIEW', 'STRONGEST_FIT', 'UNKNOWN');
  const before = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&exclude_applied=true&limit=50`);
  assert.ok(before.json.jobs.some((j) => j.id === 'k3'));
  await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k3', status: 'SAVED' } });
  assert.equal(w.sqlite.prepare(`SELECT status FROM applications WHERE candidate_id=? AND job_id='k3'`).get(F).status, 'SAVED');
  const r = await req(w.env, 'DELETE', `/api/applications/k3?candidate_id=${F}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(w.sqlite.prepare(`SELECT COUNT(*) n FROM applications WHERE candidate_id=? AND job_id='k3'`).get(F).n, 0);
  assert.equal(w.sqlite.prepare(`SELECT new_status FROM application_history WHERE candidate_id=? AND job_id='k3' ORDER BY id DESC LIMIT 1`).get(F).new_status, 'UNSAVED');
  const list = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&exclude_applied=true&limit=50`);
  assert.ok(list.json.jobs.some((j) => j.id === 'k3'), 'an un-saved job is listed again as not applied');
  // a real application (k1 is APPLIED with a note) can never be removed this way
  assert.equal((await req(w.env, 'DELETE', `/api/applications/k1?candidate_id=${F}`)).status, 409);
  assert.equal(w.sqlite.prepare(`SELECT status FROM applications WHERE candidate_id=? AND job_id='k1'`).get(F).status, 'APPLIED');
  assert.equal((await req(w.env, 'DELETE', `/api/applications/k9?candidate_id=${F}`)).status, 404);
  assert.equal((await req(w.env, 'DELETE', `/api/applications/k3?candidate_id=${F}`, { key: null })).status, 401, 'visitors cannot un-save');
});

test('a visitor cannot reach a private client by naming a visible candidate in the query and the private one in the path', async () => {
  const w = world();
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: analyst })).status, 201);
  await req(w.env, 'POST', '/api/clients/priya_analyst/backfill');
  const statuses = 'status=NEEDS_REVIEW,HOLD,INELIGIBLE,READY,STRETCH_READY';
  for (const p of [
    `/api/candidates/priya_analyst/jobs?${statuses}&candidate_id=${F}`,
    `/api/candidates/priya_analyst/dashboard?candidate_id=${F}`,
    `/api/candidates/priya_analyst/applications?candidate_id=${F}`,
    `/api/candidates/priya_analyst/strategy?candidate_id=${F}`,
    `/api/candidates/priya_analyst/jobs?candidate_id=${S}`,
    `/api/candidates/priya%5Fanalyst/jobs?candidate_id=${F}`,
  ]) {
    const r = await req(w.env, 'GET', p, { key: null });
    assert.equal(r.status, 400, `${p} must answer like an unknown id`);
    assert.ok(!r.text.includes('Priya'), `${p} must not carry the private client's name`);
  }
  // the reverse (private id in the query, visible id in the path) was already refused; keep it so
  assert.equal((await req(w.env, 'GET', `/api/candidates/${F}/jobs?candidate_id=priya_analyst`, { key: null })).status, 400);
  // the operator still sees it, and a visible candidate's own paths still work for visitors
  assert.equal((await req(w.env, 'GET', `/api/candidates/priya_analyst/jobs?${statuses}`)).status, 200);
  assert.equal((await req(w.env, 'GET', `/api/candidates/${F}/jobs?candidate_id=${F}`, { key: null })).status, 200);
});

test('open tracker (owner decision 2026-11-12): tracker actions work without a key for the built-in candidates only; everything else still needs it', async () => {
  const w = world({ OPEN_TRACKER: 'on' });
  assert.equal((await req(w.env, 'POST', '/api/clients', { body: analyst })).status, 201);   // a private client exists
  const open = (method, path, body) => req(w.env, method, path, { body, key: null });
  // version tells the page
  assert.equal((await open('GET', '/api/version')).json.open_tracker, true);
  // save, status, notes, follow-up, feedback, history, override: all without a key for Farhan
  const saved = await open('POST', '/api/applications', { candidate_id: F, job_id: 'k3', status: 'SAVED' });
  assert.ok(saved.status === 200 || saved.status === 201, saved.text);
  assert.equal((await open('POST', '/api/applications', { candidate_id: F, job_id: 'k3', status: 'APPLIED', notes: 'Sent CV on portal' })).status < 300, true);
  assert.equal(w.sqlite.prepare(`SELECT status, notes FROM applications WHERE candidate_id = ? AND job_id = 'k3'`).get(F).notes, 'Sent CV on portal');
  assert.equal((await open('PUT', '/api/applications/k3/follow-up', { candidate_id: F, follow_up_on: '2030-01-01' })).status, 200);
  assert.equal((await open('POST', '/api/jobs/k3/feedback', { candidate_id: F, rating: 'UP' })).status, 200);
  assert.equal((await open('GET', `/api/jobs/k3/feedback?candidate_id=${F}`)).json.feedback.rating, 'UP');
  assert.equal((await open('GET', `/api/applications/k3/history?candidate_id=${F}`)).status, 200);
  assert.equal((await open('POST', '/api/jobs/k2/qualification-override', { candidate_id: F, status: 'NEEDS_REVIEW', reason: 'Worth a look after all' })).status, 200);
  // the visitor's own job list now carries the tracker notes (that is the point), but never contact or pay details
  const list = await open('GET', `/api/applications?candidate_id=${F}`);
  assert.ok(list.text.includes('Sent CV on portal'), 'notes are visible in open-tracker mode');
  const prof = await open('GET', `/api/candidates`);
  assert.ok(!/cash_floor|"email"|"phone"/.test(prof.text), 'private profile fields stay private');
  // not for a private client, not for a request naming two candidates, not for routes outside the tracker
  { const r = await open('POST', '/api/applications', { candidate_id: 'priya_analyst', job_id: 'k1', status: 'SAVED' }); assert.equal(r.status, 401, 'private client: ' + r.text.slice(0, 160)); }
  { const r = await open('POST', `/api/jobs/k1/feedback?candidate_id=${S}`, { candidate_id: F, rating: 'UP' }); assert.equal(r.status, 401, 'two candidates: ' + r.text.slice(0, 160)); }
  for (const [m, p, b] of [['GET', '/api/clients'], ['PUT', '/api/profile?candidate_id=' + F, { full_name: 'x' }], ['GET', '/api/client-requests'], ['PUT', '/api/site-settings', {}], ['POST', '/api/clients', analyst]])
    { const r = await open(m, p, b); assert.equal(r.status, 401, `${m} ${p} still needs the key: ${r.status} ${r.text.slice(0, 120)}`); }
  // switched off: the key is needed again
  const off = world();
  assert.equal((await req(off.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k3', status: 'SAVED' }, key: null })).status, 401);
  assert.equal((await req(off.env, 'GET', '/api/version', { key: null })).json.open_tracker, false);
  assert.ok(!(await req(off.env, 'GET', `/api/applications?candidate_id=${F}`, { key: null })).text.includes('PRIVATE-NOTE-c1'), 'notes stay stripped when off');
});

test('new today: only jobs found or put on the list in the last day; the total and status counts follow the filter', async () => {
  const w = world();
  const now = new Date().toISOString();
  w.run(`UPDATE candidate_qualifications SET qualified_at = '2026-11-03T00:00:00Z' WHERE job_id = 'k1'`);
  w.run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES ('n1','Fresh Role','Acme','lever','https://jobs.lever.co/acme/n1',1,'Remote - India','x','REMOTE',?, 'LIVE_PUBLIC')`, now);
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status) VALUES (?,?,?,?)`, F, 'n1', 'READY', 'ELIGIBLE');
  // an old posting shortlisted just now (sqlite datetime format) also counts as new on the list
  w.run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,qualified_at) VALUES (?,?,?,?,datetime('now'))`, F, 'k6', 'STRETCH_READY', 'UNKNOWN');
  const r = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&qualification_status=APPLY_WORTHY&new_within=1`, { key: null });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(ids(r), ['k6', 'n1'], 'k1 (READY since 3 Nov) is not new');
  assert.equal(r.json.total, 2);
  const all = await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&qualification_status=APPLY_WORTHY`, { key: null });
  assert.ok(ids(all).includes('k1') && all.json.total === 3);
  assert.equal((await req(w.env, 'GET', `/api/jobs?candidate_id=${F}&new_within=3`, { key: null })).status, 200, 'an unsupported value is ignored, not an error');
});

test('a tracker action clears only that person\'s stored answers: the other person\'s stay cached, the changed person sees the change at once', async () => {
  const w = world({ OPEN_TRACKER: 'on', RESPONSE_CACHE: 'on' });
  const keys = () => w.sqlite.prepare('SELECT key FROM response_cache ORDER BY key').all().map((r) => r.key);
  const gen = () => w.sqlite.prepare('SELECT generation g FROM cache_state WHERE id = 1').get()?.g;
  await req(w.env, 'GET', `/api/applications?candidate_id=${F}`, { key: null });
  await req(w.env, 'GET', `/api/applications?candidate_id=${S}`, { key: null });
  await req(w.env, 'GET', `/api/jobs?candidate_id=${S}`, { key: null });
  const before = keys(), g0 = gen();
  assert.ok(before.some((k) => k.includes(`candidate_id=${F}`)) && before.some((k) => k.includes(`candidate_id=${S}`)), JSON.stringify(before));
  const saved = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k3', status: 'APPLIED', notes: 'Sent' }, key: null });
  assert.ok(saved.status < 300, saved.text);
  const after = keys();
  assert.equal(gen(), g0, 'the global generation is not raised by a tracker action');
  assert.ok(!after.some((k) => k.includes(`candidate_id=${F}`)), 'Farhan\'s stored answers are cleared');
  assert.deepEqual(after.filter((k) => k.includes(`candidate_id=${S}`)), before.filter((k) => k.includes(`candidate_id=${S}`)), 'Sana\'s stay');
  const fresh = await req(w.env, 'GET', `/api/applications?candidate_id=${F}`, { key: null });
  assert.ok(fresh.text.includes('Sent'), 'Farhan sees his change straight away');
  // a change that is not a tracker action still clears everything
  await req(w.env, 'PUT', '/api/clients/' + S, { body: { display_title: 'x' } });
  assert.ok(gen() > g0 || keys().length === 0, 'non-tracker changes keep the global clear');
});

test('open tracker limits: a script hitting the tracker is stopped after the hourly allowance; huge notes are refused; another network is unaffected', async () => {
  const w = world({ OPEN_TRACKER: 'on' });
  const send = (ip, body) => worker.fetch(new Request('https://test.invalid/api/jobs/k3/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body) }), w.env, { waitUntil() {} });
  const statuses = [];
  for (let i = 0; i < 65; i++) statuses.push((await send('198.51.100.7', { candidate_id: F, rating: i % 2 ? 'UP' : 'DOWN' })).status);
  assert.equal(statuses.filter((s) => s === 200).length, 60, 'the first 60 writes in an hour go through');
  assert.ok(statuses.slice(60).every((s) => s === 429), 'then 429: ' + statuses.slice(60).join());
  assert.equal((await send('198.51.100.8', { candidate_id: F, rating: 'UP' })).status, 200, 'another network is not affected');
  const big = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k3', status: 'SAVED', notes: 'x'.repeat(2001) }, key: null });
  assert.equal(big.status, 400); assert.match(big.text, /longer than 2000/);
});
