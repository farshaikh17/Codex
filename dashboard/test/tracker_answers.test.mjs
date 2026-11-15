// Code QA 13 Nov.
// F4: a keyless open-tracker request runs at operator level, but its answer must be stripped like a public answer except for the tracker's
//     own fields (TRACKER_KEYS): no audit actor, document path or other private field. The operator (with the key) still sees everything.
// F6: a tracker write clears only that person's cached answers (no generation bump). A read that was computed before the write and stored
//     after it must not be served afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, ADMIN_KEY } from './harness.mjs';

const F = 'farhan_shaikh';
const worker = await loadWorker();

function world(extra = {}) {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name,current_location,qualification_threshold,primary_skills) VALUES (?,?,?,?,?)`, F, 'Farhan', 'Mumbai, India', 70, '["CRM Configuration"]');
  for (const id of ['k1', 'k2', 'k3']) {
    run(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,location_restrictions,description,workplace_type,discovered_at,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, 'Implementation Manager ' + id, 'Acme', 'lever', 'https://jobs.lever.co/acme/' + id, 1, 'Remote - India', 'Fully remote role.', 'REMOTE', '2026-11-01T00:00:00Z', 'LIVE_PUBLIC');
    run(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status) VALUES (?,?,?,?)`, F, id, 'READY', 'ELIGIBLE');
  }
  run(`INSERT INTO applications(id,candidate_id,job_id,status,notes,cover_letter_path) VALUES ('app1',?,?,'SUBMITTED','my own note','PRIVATE-COVER-PATH')`, F, 'k2');
  run(`INSERT INTO application_history(candidate_id,job_id,application_id,new_status,notes,actor,source) VALUES (?,?,'app1','SUBMITTED','my own note','PRIVATE-ACTOR-NAME','cloud_worker')`, F, 'k2');
  run(`INSERT INTO qualification_history(candidate_id,job_id,previous_status,new_status,reason,actor) VALUES (?,?,'NEEDS_REVIEW','READY','reviewed','PRIVATE-ACTOR-NAME')`, F, 'k2');
  return { sqlite, run, d1, env: makeEnv(d1, { OPEN_TRACKER: 'on', ...extra }) };
}
async function req(env, method, path, { body, key = null } = {}) {
  const headers = { 'CF-Connecting-IP': '9.9.9.9' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://test.invalid' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, cache: res.headers.get('x-cache') };
}
const keysDeep = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
};

test('F4: keyless tracker reads (history, qualification audit) carry no audit actor (actor, reviewer); the tracker notes stay; the operator still sees the actor', async () => {
  const w = world();
  for (const path of [`/api/applications/k2/history?candidate_id=${F}`, `/api/jobs/k2/qualification-audit?candidate_id=${F}`]) {
    const open = await req(w.env, 'GET', path);
    assert.equal(open.status, 200, path + ' ' + open.text);
    assert.ok(!open.text.includes('PRIVATE-ACTOR-NAME'), `${path} leaks the actor: ${open.text}`);
    assert.ok(!keysDeep(open.json).has('actor') && !keysDeep(open.json).has('reviewer'), path);
    const op = await req(w.env, 'GET', path, { key: ADMIN_KEY });
    assert.ok(op.text.includes('PRIVATE-ACTOR-NAME'), `the operator keeps the actor on ${path}`);
  }
  const hist = await req(w.env, 'GET', `/api/applications/k2/history?candidate_id=${F}`);
  assert.ok(hist.text.includes('my own note'), 'the tracker\'s own note is kept');
});

test('F4: keyless tracker writes answer without private fields, but keep the tracker fields and a refusal\'s explanation', async () => {
  const w = world();
  const saved = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k2', status: 'INTERVIEWING', notes: 'second round' } });
  assert.equal(saved.status, 200, saved.text);
  assert.ok(!saved.text.includes('PRIVATE-COVER-PATH'), saved.text);
  assert.ok(!keysDeep(saved.json).has('cover_letter_path') && !keysDeep(saved.json).has('actor'));
  assert.ok(saved.text.includes('second round'), 'the note just written is in the answer');
  const override = await req(w.env, 'POST', '/api/jobs/k1/qualification-override', { body: { candidate_id: F, status: 'HOLD', reason: 'not now', reviewer: 'PRIVATE-ACTOR-NAME' } });
  assert.equal(override.status, 200, override.text);
  assert.ok(!override.text.includes('PRIVATE-ACTOR-NAME'), override.text);
  assert.equal(override.json.audit_record.reason, 'not now');
  const opOverride = await req(w.env, 'POST', '/api/jobs/k1/qualification-override', { key: ADMIN_KEY, body: { candidate_id: F, status: 'HOLD', reason: 'not now', reviewer: 'PRIVATE-ACTOR-NAME' } });
  assert.ok(opOverride.text.includes('PRIVATE-ACTOR-NAME'), 'the operator answer is unchanged');
  // a refusal keeps its message (the app shows it)
  const stale = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k2', status: 'OFFER', expected_updated_at: '2000-01-01T00:00:00Z' } });
  assert.equal(stale.status, 409, stale.text);
  assert.match(stale.json.error, /changed elsewhere/);
  const empty = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k2', status: 'OFFER', notes: '' } });
  assert.equal(empty.status, 409, empty.text);
  assert.match(empty.json.error, /note is empty/);
  const bad = await req(w.env, 'POST', '/api/jobs/k1/qualification-override', { body: { candidate_id: F, status: 'NOPE', reason: 'x' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error, 'a 400 keeps its explanation');
});

test('F6: a read computed before a tracker write and stored after it is not served afterwards', async () => {
  const w = world({ RESPONSE_CACHE: 'on' });
  const list = `/api/applications?candidate_id=${F}`;
  // The read pauses right after it has read the applications table; the keyless tracker write runs in that gap (on the same database).
  let armed = true;
  const wrapStmt = (st, sql) => {
    const me = {
      bind: (...a) => { st.bind(...a); return me; },
      first: (...a) => st.first(...a),
      run: (...a) => st.run(...a),
      all: async (...a) => {
        const r = await st.all(...a);
        if (armed && /FROM\s+applications\b/i.test(sql) && /^\s*SELECT/i.test(sql)) {
          armed = false;
          const write = await req(w.env, 'POST', '/api/applications', { body: { candidate_id: F, job_id: 'k1', status: 'APPLIED', notes: 'sent today' } });
          assert.equal(write.status, 200, write.text);
        }
        return r;
      },
    };
    return me;
  };
  const slowDb = { ...w.d1, prepare: (sql) => wrapStmt(w.d1.prepare(sql), sql), batch: (x) => w.d1.batch(x) };
  const first = await req({ ...w.env, DB: slowDb }, 'GET', list);
  assert.equal(first.status, 200);
  assert.equal(armed, false, 'the write ran during the read');
  assert.ok(!first.text.includes('sent today'), 'the in-flight read was computed before the write');
  const next = await req(w.env, 'GET', list);
  assert.equal(next.status, 200);
  assert.ok(next.text.includes('sent today'), `the next read must show the write, got X-Cache ${next.cache}: ${next.text.slice(0, 300)}`);
  // and caching works again once the action is a few seconds old
  w.run(`UPDATE response_cache SET created_at = created_at - 60 WHERE key = '~tracker-change'`);
  const again = await req(w.env, 'GET', list);
  const third = await req(w.env, 'GET', list);
  assert.equal(third.cache, 'HIT', `cache still used: ${again.cache} then ${third.cache}`);
});
