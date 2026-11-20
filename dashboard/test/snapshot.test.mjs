// Cheap views (migration 0027, worker/snapshot.ts): the job seeker's Today page, lists, counts, facets and Hidden jobs answered from the person's
// stored list copy must be exactly what the full queries answer, before and after tracker actions, and the copy must never outlive the
// response cache's own rules (generation, code version, time limit). Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, call } from './harness.mjs';
import { seekerSnapshot, BUILD_SQL, cmpBin } from '../worker/snapshot.ts';

const F = 'farhan_shaikh', S = 'sana_ansari';
const worker = await loadWorker();

// A deterministic random fixture with every case the predicates distinguish: statuses inside and outside the list (and one the code never
// writes), overrides, closed jobs, applications of every kind, unassessed collector rows, Not for me rows, ties in score and date, both date
// formats, recent and old screening times, twins (same employer and title in several places), non-ASCII ids and titles, rows without a score.
function fixture(n = 700, seed = 7) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const { sqlite, d1 } = createDb();
  sqlite.exec(`INSERT INTO candidates(id, full_name, qualification_threshold) VALUES ('${F}', 'Test F', 70), ('${S}', 'Test S', 60)`);
  const now = Date.now();
  const iso = (days) => new Date(now - days * 86400000).toISOString();
  const sqlTime = (days) => iso(days).slice(0, 19).replace('T', ' ');
  const titles = ['Implementation Manager', 'Solutions Engineer', 'Reliability Engineer - Pune', 'Reliability Engineer (Remote)', 'Plant Engineer, Jamnagar', 'Data Analyst', 'Ingénieur Fiabilité', 'Operations Lead'];
  const companies = ['Acme', 'Acme Inc.', 'Beta', 'Gamma Ltd', 'Delta', 'Énergie SA', 'Zeta'];
  const places = ['Remote - India', 'Pune, India', 'Bengaluru, India', 'London, UK', 'Dubai, UAE', null];
  const work = ['REMOTE', 'REMOTE_GLOBAL', 'REMOTE_RESTRICTED', 'HYBRID', 'ONSITE', 'UNKNOWN'];
  const statuses = ['NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'READY', 'READY_HIGH', 'STRETCH_READY', 'HOLD', 'HOLD', 'INELIGIBLE', 'CLOSED', 'APPLIED', 'DISMISSED'];
  const reasons = ['Cloud discovery match.', '[GITHUB_COLLECTOR] Unassessed import', 'You marked this Not for me. Earlier reason', 'Held automatically (low match).', null];
  const ins = {
    job: sqlite.prepare(`INSERT INTO jobs(id, title, company, source_adapter, workplace_type, location_restrictions, description, discovered_at, is_active) VALUES (?, ?, ?, 'lever', ?, ?, ?, ?, ?)`),
    q: sqlite.prepare(`INSERT INTO candidate_qualifications(candidate_id, job_id, qualification_status, eligibility_status, qualification_reason, manual_override_status, manual_override_reason, qualified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    s: sqlite.prepare(`INSERT INTO candidate_job_scores(candidate_id, job_id, overall_score) VALUES (?, ?, ?)`),
    a: sqlite.prepare(`INSERT INTO applications(id, candidate_id, job_id, status, notes) VALUES (?, ?, ?, ?, ?)`),
  };
  for (let i = 0; i < n; i++) {
    const id = (i % 50 === 7 ? 'ä-' : 'ds:lever:') + String(i).padStart(5, '0');
    const days = Math.floor(rnd() * 20) + (rnd() < 0.3 ? 0.5 : 0);
    const found = i % 9 === 0 ? sqlTime(days) : iso(days);
    ins.job.run(id, pick(titles), pick(companies), pick(work), pick(places), rnd() < 0.2 ? 'We use an engineer toolkit, 50% remote' : 'Plain text', found, rnd() < 0.85 ? 1 : 0);
    for (const c of [F, S]) {
      if (rnd() < 0.15) continue;
      const st = pick(statuses);
      const ov = rnd() < 0.08 ? pick(['READY', 'INELIGIBLE', 'HOLD', 'CLOSED', 'NEEDS_REVIEW']) : null;
      ins.q.run(c, id, st, pick(['ELIGIBLE', 'UNKNOWN', 'UNKNOWN', 'INELIGIBLE']), st === 'HOLD' ? pick(reasons.slice(1, 4)) : pick(reasons), ov, ov ? 'decision' : null,
        rnd() < 0.5 ? iso(rnd() * 12) : sqlTime(rnd() * 12));
      if (rnd() < 0.9) ins.s.run(c, id, pick([0, 40, 55, 60, 60, 65, 72, 80, 95]));
      if (rnd() < 0.08) ins.a.run(`app-${c}-${i}`, c, id, pick(['SAVED', 'SAVED', 'APPLIED', 'REJECTED', 'INTERVIEWING']), rnd() < 0.3 ? 'a note' : null);
    }
  }
  return { sqlite, d1 };
}

const off = (d1) => makeEnv(d1, { SEEKER_SNAPSHOT: 'off' });
const on = (d1) => makeEnv(d1, { SEEKER_SNAPSHOT: 'on' });
async function same(d1, path, key) {
  const a = await call(worker, off(d1), 'GET', path, { key });
  const b = await call(worker, on(d1), 'GET', path, { key });
  assert.equal(b.status, a.status, path);
  assert.deepEqual(b.json, a.json, path);
  return a.json;
}

const SEEKER_LISTS = (c) => [
  `/api/today?candidate_id=${c}`,
  ...['NEEDS_REVIEW', 'READY', 'STRETCH_READY'].flatMap((st) => ['score_desc', 'date_desc'].flatMap((sort) => [0, 25].map((off) =>
    `/api/jobs?candidate_id=${c}&exclude_applied=true&exclude_dismissed=true&qualification_status=${st}&sort_by=${sort}${st === 'NEEDS_REVIEW' ? '&collapse_twins=true' : ''}&limit=25&offset=${off}`))),
  `/api/jobs?candidate_id=${c}&exclude_applied=true&exclude_dismissed=true&qualification_status=NEEDS_REVIEW&eligibility=ELIGIBLE&sort_by=score_desc&collapse_twins=true&limit=25&offset=0`,
  `/api/jobs?candidate_id=${c}&exclude_applied=true&exclude_dismissed=true&qualification_status=NEEDS_REVIEW&workplace_type=REMOTE_ANY&sort_by=score_desc&collapse_twins=true&limit=25&offset=0`,
  `/api/jobs?candidate_id=${c}&exclude_applied=true&exclude_dismissed=true&qualification_status=NEEDS_REVIEW&min_score=60&sort_by=score_desc&collapse_twins=true&limit=25&offset=0`,
  `/api/jobs?candidate_id=${c}&exclude_applied=true&exclude_dismissed=true&qualification_status=NEEDS_REVIEW&search=engineer&sort_by=score_desc&collapse_twins=true&limit=25&offset=0`,
  `/api/jobs?candidate_id=${c}&hidden=true&limit=100`,
];

test('cheap views: every seeker list, count and facet from the stored copy equals the full queries (both people, public and operator)', async () => {
  const { d1 } = fixture();
  for (const c of [F, S]) for (const key of [null, undefined]) for (const p of SEEKER_LISTS(c)) await same(d1, p, key);
});

test('cheap views: random combinations of filters, sorts, pages and grouping equal the full queries', async () => {
  const { d1 } = fixture(500, Number(process.env.SNAPSHOT_FUZZ_SEED || 11));
  let x = Number(process.env.SNAPSHOT_FUZZ_SEED || 5); const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < Number(process.env.SNAPSHOT_FUZZ || 160); i++) {
    const q = [`candidate_id=${pick([F, S])}`];
    const add = (k, vals) => { const v = pick(vals); if (v != null) q.push(`${k}=${encodeURIComponent(v)}`); };
    add('exclude_applied', ['true', 'true', 'true', 'false', null]); add('exclude_dismissed', ['true', 'true', 'true', 'false', null]);
    add('hidden', [null, null, null, null, 'true']);
    add('qualification_status', [null, 'ALL', 'NEEDS_REVIEW', 'READY', 'STRETCH_READY', 'APPLY_WORTHY', 'READY_HIGH', 'APPLIED', 'HOLD']);
    add('sort_by', [null, 'score_desc', 'date_desc', 'other', 'title_asc']);
    add('collapse_twins', [null, 'true', 'true']); add('eligibility', [null, null, 'ELIGIBLE', 'UNKNOWN', 'ALL']);
    add('workplace_type', [null, null, 'REMOTE_ANY', 'UNKNOWN', 'ONSITE', 'ALL']); add('min_score', [null, null, '60', '70']);
    add('search', [null, null, null, 'engineer', '50%', 'énergie', 'Acme']); add('found_on', [null, null, null, null, 'EMPLOYER']);
    add('limit', ['25', '5', '100', null]); add('offset', ['0', '0', '25', '10', '400']);
    await same(d1, `/api/jobs?${q.join('&')}`, pick([null, undefined]));
  }
});

test('cheap views: after each tracker action the corrected copy equals the full queries, and an action does not rebuild the copy', async () => {
  const { sqlite, d1 } = fixture(400, 3);
  const env = on(d1);
  for (const c of [F, S]) await call(worker, env, 'GET', `/api/today?candidate_id=${c}`);   // builds both copies
  const built = sqlite.prepare("SELECT candidate_id, built_at FROM seeker_snapshot WHERE part = 0").all().map((r) => ({ ...r }));
  const visible = (c) => sqlite.prepare(`SELECT q.job_id AS id FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id WHERE q.candidate_id = ? AND j.is_active = 1
    AND q.qualification_status = 'NEEDS_REVIEW' AND q.manual_override_status IS NULL AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id) ORDER BY q.job_id`).all(c).map((r) => r.id);
  for (const c of [F, S]) {
    const [j1, j2, j3, j4, j5] = visible(c);
    const actions = [
      ['POST', '/api/applications', { candidate_id: c, job_id: j1, status: 'SAVED' }],
      ['POST', '/api/applications', { candidate_id: c, job_id: j2, status: 'APPLIED' }],
      ['POST', `/api/jobs/${encodeURIComponent(j3)}/feedback`, { candidate_id: c, rating: 'DOWN' }],
      ['POST', `/api/jobs/${encodeURIComponent(j4)}/qualification-override`, { candidate_id: c, status: 'READY', reason: 'Looks right' }],
      ['DELETE', `/api/applications/${encodeURIComponent(j1)}?candidate_id=${c}`, undefined],
      ['POST', `/api/jobs/${encodeURIComponent(j3)}/feedback`, { candidate_id: c, rating: 'CLEAR' }],
      ['POST', `/api/jobs/${encodeURIComponent(j5)}/qualification-override`, { candidate_id: c, status: 'HOLD', reason: 'Not now' }],
    ];
    for (const [m, path, body] of actions) {
      const r = await call(worker, env, m, path, { body });
      assert.ok(r.status < 300, `${m} ${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.json)}`);
      for (const p of SEEKER_LISTS(c)) await same(d1, p, null);
    }
  }
  const after = sqlite.prepare("SELECT candidate_id, built_at FROM seeker_snapshot WHERE part = 0").all().map((r) => ({ ...r }));
  assert.deepEqual(after, built, 'tracker actions corrected the copies in place (no rebuild)');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM seeker_dirty').get().n, 0, 'every dirty mark was consumed');
});

test('cheap views: the copy is rebuilt under a new cache generation, a new code version or past the time limit, never reused across them', async () => {
  const { sqlite, d1 } = fixture(200, 5);
  const v = { version: 'test-v', maxAge: 1800 };
  assert.equal((await seekerSnapshot(d1, F, v)).state, 'built');
  assert.equal((await seekerSnapshot(d1, F, v)).state, 'kept');
  // a row changed outside the Worker's tracker routes, with a generation bump (as every import and operator change does): seen at once
  const job = sqlite.prepare(`SELECT job_id FROM candidate_qualifications WHERE candidate_id = ? AND qualification_status = 'NEEDS_REVIEW' LIMIT 1`).get(F).job_id;
  sqlite.prepare(`UPDATE candidate_qualifications SET qualification_status = 'INELIGIBLE' WHERE candidate_id = ? AND job_id = ?`).run(F, job);
  sqlite.exec('UPDATE cache_state SET generation = generation + 1 WHERE id = 1');
  const s1 = await seekerSnapshot(d1, F, v);
  assert.equal(s1.state, 'built');
  assert.ok(!s1.rows.some((r) => r.id === job));
  assert.equal((await seekerSnapshot(d1, F, { ...v, version: 'test-v2' })).state, 'built');
  assert.equal((await seekerSnapshot(d1, F, { ...v, version: 'test-v2' })).state, 'kept');
  sqlite.exec('UPDATE seeker_snapshot SET built_at = built_at - 1801');
  assert.equal((await seekerSnapshot(d1, F, { ...v, version: 'test-v2' })).state, 'built');
  assert.equal((await seekerSnapshot(d1, F, { ...v, version: 'test-v2', maxAge: 600 })).state, 'kept');
  sqlite.exec('UPDATE seeker_snapshot SET built_at = built_at - 601');
  assert.equal((await seekerSnapshot(d1, F, { ...v, version: 'test-v2', maxAge: 600 })).state, 'built', 'the operator limit (10 minutes) applies to operator reads');
});

test('cheap views: a write based on an older read is not stored, and a dirty mark made after the read survives', async () => {
  const { sqlite, d1 } = fixture(200, 9);
  const v = { version: 'test-v', maxAge: 1800 };
  await seekerSnapshot(d1, F, v);
  const job = sqlite.prepare(`SELECT job_id FROM candidate_qualifications WHERE candidate_id = ? AND qualification_status = 'NEEDS_REVIEW' LIMIT 1`).get(F).job_id;
  // another request replaced the copy (new token) while this one was patching: this one's write must not land
  sqlite.prepare(`INSERT INTO seeker_dirty(candidate_id, job_id, at) VALUES (?, ?, 1)`).run(F, job);
  const realBatch = d1.batch.bind(d1);
  let raced = false;
  d1.batch = async (stmts) => { if (!raced) { raced = true; sqlite.exec(`UPDATE seeker_snapshot SET token = 'someone-else' WHERE part = 0`); sqlite.prepare(`UPDATE seeker_dirty SET at = 2`).run(); } return realBatch(stmts); };
  const before = sqlite.prepare('SELECT part, body FROM seeker_snapshot ORDER BY part').all().map((r) => ({ ...r }));
  assert.equal((await seekerSnapshot(d1, F, v)).state, 'patched');
  d1.batch = realBatch;
  assert.deepEqual(sqlite.prepare('SELECT part, body FROM seeker_snapshot ORDER BY part').all().map((r) => ({ ...r })), before, 'the losing write changed nothing');
  assert.equal(sqlite.prepare('SELECT at FROM seeker_dirty WHERE job_id = ?').get(job)?.at, 2, 'the newer mark is kept for the next read');
  assert.equal((await seekerSnapshot(d1, F, v)).state, 'patched');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM seeker_dirty').get().n, 0);
});

test('cheap views: without the 0027 tables (an older database) the full queries answer, unchanged', async () => {
  const { sqlite, d1 } = fixture(150, 13);
  const want = await call(worker, off(d1), 'GET', `/api/today?candidate_id=${F}`, { key: null });
  sqlite.exec('DROP TABLE seeker_snapshot; DROP TABLE seeker_dirty');
  const got = await call(worker, on(d1), 'GET', `/api/today?candidate_id=${F}`, { key: null });
  assert.deepEqual(got.json, want.json);
  const w = await call(worker, on(d1), 'POST', '/api/applications', { body: { candidate_id: F, job_id: sqlite.prepare('SELECT id FROM jobs LIMIT 1').get().id, status: 'SAVED' } });
  assert.ok(w.status < 300, 'a tracker action still works');
});

test('cheap views: a warm Today and list read only the copy and the page rows (no statement over every screening row)', async () => {
  const { d1 } = fixture(300, 17);
  const seen = [];
  const spy = { ...d1, prepare: (sql) => { seen.push(sql); return d1.prepare(sql); }, batch: (s) => d1.batch(s) };
  const env = makeEnv(spy, { SEEKER_SNAPSHOT: 'on' });
  await call(worker, env, 'GET', `/api/today?candidate_id=${F}`, { key: null });
  assert.ok(seen.some((s) => s === BUILD_SQL), 'the first read builds the copy');
  seen.length = 0;
  await call(worker, env, 'GET', `/api/today?candidate_id=${F}`, { key: null });
  await call(worker, env, 'GET', `/api/jobs?candidate_id=${F}&exclude_applied=true&exclude_dismissed=true&qualification_status=NEEDS_REVIEW&sort_by=score_desc&collapse_twins=true&limit=25&offset=0`, { key: null });
  const wide = seen.filter((s) => /FROM candidate_qualifications q\s+(JOIN|LEFT JOIN|INDEXED)/.test(s) && !/json_each/.test(s) && !/a\.candidate_id = \?|FROM applications a/.test(s));
  assert.deepEqual(wide, [], 'no full list query on a warm read');
});

test('cheap views: SQLite BINARY order for ids and dates', () => {
  const xs = ['b', 'a', 'ä', 'aa', '\u{1F600}', '�', 'A', ''];
  const sqliteOrder = createDb().sqlite.prepare(`SELECT value FROM json_each(?) ORDER BY value`).all(JSON.stringify(xs)).map((r) => r.value);
  assert.deepEqual([...xs].sort(cmpBin), sqliteOrder);
});

test('cheap views (review 1): a correction landing between this request\'s two reads never leaves it with the old copy and no mark', async () => {
  const { sqlite, d1 } = fixture(200, 19);
  const v = { version: 'test-v', maxAge: 1800 };
  await seekerSnapshot(d1, F, v);
  const job = sqlite.prepare(`SELECT id FROM (SELECT q.job_id AS id FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id WHERE q.candidate_id = ? AND j.is_active = 1
    AND q.qualification_status = 'NEEDS_REVIEW' AND COALESCE(q.manual_override_status, '') = '' AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)) LIMIT 1`).get(F).id;
  // a tracker action: the job leaves the list (Not for me), with its dirty mark
  sqlite.prepare(`UPDATE candidate_qualifications SET qualification_status = 'HOLD', qualification_reason = 'You marked this Not for me.' WHERE candidate_id = ? AND job_id = ?`).run(F, job);
  sqlite.prepare(`INSERT INTO seeker_dirty(candidate_id, job_id, at) VALUES (?, ?, 1)`).run(F, job);
  // another request corrects the copy (and removes the mark) right after this request's first read
  let fired = false;
  const spy = { ...d1, batch: (st) => d1.batch(st), prepare: (sql) => {
    const st = d1.prepare(sql);
    if (fired || !/FROM seeker_dirty WHERE candidate_id|LEFT JOIN seeker_snapshot/.test(sql)) return st;
    return { bind: (...a) => { st.bind(...a); return { all: async () => { const r = await st.all(); fired = true; await seekerSnapshot(d1, F, v); return r; } }; } };
  } };
  const s = await seekerSnapshot(spy, F, v);
  assert.ok(fired);
  assert.ok(!s.rows.some((r) => r.id === job), 'the job marked Not for me is not back on the list');
  assert.ok(s.hidden.some((r) => r.id === job));
});

test('cheap views (review 2): an answer from the copy is cached with the copy\'s build time, so copy and entry together stay within one limit', async () => {
  const { sqlite, d1 } = fixture(150, 23);
  const env = makeEnv(d1, { RESPONSE_CACHE: 'on', SEEKER_SNAPSHOT: 'on' });
  const path = `/api/today?candidate_id=${F}`;
  await call(worker, env, 'GET', path, { key: null });   // builds the copy
  sqlite.exec('DELETE FROM response_cache; UPDATE seeker_snapshot SET built_at = built_at - 1500');
  const r = await call(worker, env, 'GET', path, { key: null });
  assert.equal(r.status, 200);
  const row = sqlite.prepare(`SELECT created_at FROM response_cache WHERE key LIKE '%/api/today%'`).get();
  const built = sqlite.prepare(`SELECT built_at FROM seeker_snapshot WHERE candidate_id = ? AND part = 0`).get(F).built_at;
  assert.equal(row.created_at, built, 'stored with the copy\'s time, not now');
  assert.ok(Math.floor(Date.now() / 1000) - row.created_at >= 1500);
});

test('cheap views (review 3): if the dirty mark cannot be written after a tracker write, the person\'s copy is dropped, never left stale', async () => {
  const { sqlite, d1 } = fixture(200, 29);
  const env0 = on(d1);
  await call(worker, env0, 'GET', `/api/today?candidate_id=${F}`);
  const job = sqlite.prepare(`SELECT q.job_id AS id FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id WHERE q.candidate_id = ? AND j.is_active = 1
    AND q.qualification_status = 'NEEDS_REVIEW' AND q.manual_override_status IS NULL AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id) LIMIT 1`).get(F).id;
  // after the handler's write, every dirty-mark write and every generation bump fails
  let armed = false;
  const broken = { run: async () => { throw new Error('D1_ERROR: simulated write failure'); } };
  const spy = { ...d1, batch: (st) => d1.batch(st), exec: (x) => d1.exec(x), prepare: (sql) => {
    if (/INSERT OR REPLACE INTO applications/.test(sql)) armed = true;
    if (armed && /INTO seeker_dirty|SET generation = generation \+ 1/.test(sql)) return { bind: () => broken, ...broken };
    return d1.prepare(sql);
  } };
  const w = await call(worker, makeEnv(spy, { SEEKER_SNAPSHOT: 'on' }), 'POST', '/api/applications', { body: { candidate_id: F, job_id: job, status: 'APPLIED' } });
  assert.ok(w.status < 300, JSON.stringify(w.json));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM seeker_snapshot WHERE candidate_id = ?').get(F).n, 0, 'the copy was dropped');
  for (const p of SEEKER_LISTS(F)) await same(d1, p, null);
});
