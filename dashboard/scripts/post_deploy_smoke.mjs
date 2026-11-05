// Read-only post-deploy checks of the PUBLIC dashboard. No credentials are needed or used.
//   SMOKE_BASE=https://... [SMOKE_EXPECT_COMMIT=<sha>] [SMOKE_EXPECT_APPLICATIONS=12] node scripts/post_deploy_smoke.mjs
// Anonymous write attempts use a nonexistent job id and an invalid body so that, even if protection failed, nothing
// real could be changed; they must all be refused with 401 before reaching any handler.
const BASE = (process.env.SMOKE_BASE || '').replace(/\/$/, '');
if (!BASE) { console.error('SMOKE_BASE is required'); process.exit(2); }
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
const get = (p) => fetch(BASE + p);
const PRIVATE_KEYS = /"(error_message|rejection_stage|rejection_reason_category|notes|application_notes|rejection_notes|resume_version|cover_letter_path|application_channel|actor|cash_floor_inr_monthly|cash_floor_inr_annual|min_acceptable_salary_usd|pay_line|employment_history|location_preferences|manual_override_reason)"/;
const PRIVATE_TEXT = /RRVUNL|Mianro|Chhabra|1,?20,?000|[\w.+-]+@[\w-]+\.[a-z]{2,}/i;

const v = await (await get('/api/version')).json().catch(() => ({}));
check('health is public', (await get('/api/health')).status === 200);
check('version is public', !!v.version, JSON.stringify(v));
if (process.env.SMOKE_EXPECT_COMMIT) check(`the live Worker reports the commit being released (${process.env.SMOKE_EXPECT_COMMIT.slice(0, 10)})`, v.commit === process.env.SMOKE_EXPECT_COMMIT, `live commit ${v.commit}`);
console.log(`INFO  live version ${v.version} commit ${v.commit} deployed_at ${v.deployed_at}`);

// public viewing works for both candidates and exposes nothing private
const counts = {};
for (const c of ['farhan_shaikh', 'sana_ansari']) {
  for (const p of [`/api/jobs?candidate_id=${c}&limit=25`, `/api/profile?candidate_id=${c}`, `/api/applications?candidate_id=${c}`, `/api/analytics?candidate_id=${c}`,
    `/api/analytics/discovery?candidate_id=${c}`, `/api/analytics/sources-effectiveness?candidate_id=${c}`, `/api/qualification/metrics?candidate_id=${c}`, `/api/cohorts/metrics?candidate_id=${c}`, `/api/india-remote/summary?candidate_id=${c}`]) {
    const r = await get(p); const t = await r.text();
    check(`public ${p.split('?')[0]} (${c.split('_')[0]}) answers 200 without a key`, r.status === 200, `status ${r.status}`);
    // Job postings legitimately contain salaries and contact emails, so text patterns are applied only to candidate-side surfaces.
    const candidateSide = /^\/api\/(profile|candidates|dashboard)/.test(p);
    check(`...and holds no private field${candidateSide ? ', employer, pay or email' : ''}`, !PRIVATE_KEYS.test(t) && (!candidateSide || !PRIVATE_TEXT.test(t)), (t.match(PRIVATE_KEYS) || t.match(PRIVATE_TEXT) || [])[0]);
    if (p.startsWith('/api/applications')) { try { counts[c] = JSON.parse(t).count; } catch {} }
  }
}
for (const p of ['/api/candidates', '/api/dashboard/overview', '/api/sources', '/api/automation/status']) {
  const r = await get(p); const t = await r.text();
  const cs = /^\/api\/(candidates|dashboard)/.test(p);
  check(`public ${p} answers 200 and holds nothing private`, r.status === 200 && !PRIVATE_KEYS.test(t) && (!cs || !PRIVATE_TEXT.test(t)), `status ${r.status}`);
}
console.log(`INFO  application records visible: ${JSON.stringify(counts)}`);
if (process.env.SMOKE_EXPECT_APPLICATIONS) check(`Farhan's application records preserved (${process.env.SMOKE_EXPECT_APPLICATIONS})`, String(counts.farhan_shaikh) === process.env.SMOKE_EXPECT_APPLICATIONS, `found ${counts.farhan_shaikh}`);
const sc = await (await get('/api/analytics/sources-effectiveness?candidate_id=farhan_shaikh')).text();
check('source scorecard has no placeholder feeds', !sc.includes('example.com'));

// protected surface
for (const p of ['/api/applications/none/history?candidate_id=farhan_shaikh', '/api/jobs/none/qualification-audit?candidate_id=farhan_shaikh', '/api/automation/runs', '/api/meta', '/api/backups', '/api/sync/activity-logs']) {
  const r = await get(p); check(`anonymous GET ${p.split('?')[0]} is refused`, r.status === 401, `status ${r.status}`);
}
for (const [m, p, b] of [['POST', '/api/applications', { candidate_id: 'farhan_shaikh', job_id: 'smoke-nonexistent', status: 'SAVED' }], ['PUT', '/api/profile?candidate_id=farhan_shaikh', { public_view: true }],
  ['POST', '/api/automation/trigger', {}], ['POST', '/api/automation/pause', {}], ['POST', '/api/jobs/smoke-nonexistent/qualification-override', { candidate_id: 'farhan_shaikh', status: 'READY', reason: 'smoke' }],
  ['POST', '/api/jobs/smoke-nonexistent/feedback?candidate_id=farhan_shaikh', { rating: 'CLEAR' }], ['POST', '/api/profile/import-resume', { text: 'x' }]]) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  check(`anonymous ${m} ${p.split('?')[0]} is refused (401)`, r.status === 401, `status ${r.status}`);
}
console.log(failed ? `\n${failed} check(s) failed: roll back (see dashboard/docs/RELEASE.md)` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
