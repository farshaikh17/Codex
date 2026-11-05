// Read-only post-deploy checks. The key comes from the environment and is never printed or sent anywhere but the
// target's Authorization header.  SMOKE_BASE=https://... SMOKE_KEY=... [SMOKE_EXPECT_APPLICATIONS=12] node scripts/post_deploy_smoke.mjs
const BASE = (process.env.SMOKE_BASE || '').replace(/\/$/, '');
const KEY = process.env.SMOKE_KEY; // optional: without it only the anonymous checks run
if (!BASE) { console.error('SMOKE_BASE is required'); process.exit(2); }
const REQUIRE_AUTH = process.env.REQUIRE_AUTH_SMOKE === '1';
if (REQUIRE_AUTH && !KEY) { console.error('REQUIRE_AUTH_SMOKE=1 but SMOKE_KEY is empty: authenticated checks cannot be skipped'); process.exit(2); }
let authChecks = 0;
let failed = 0;
const check = (name, ok, detail = '', authed = false) => { if (authed) authChecks++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
const get = (p, key) => fetch(BASE + p, { headers: key ? { Authorization: `Bearer ${key}` } : {} });

check('health is public', (await get('/api/health')).status === 200);
check('version is public', (await get('/api/version')).status === 200);
for (const p of ['/api/profile', '/api/applications', '/api/dashboard/overview', '/api/jobs?candidate_id=farhan_shaikh', '/api/analytics/discovery?candidate_id=sana_ansari', '/api/india-remote/jobs']) {
  const r = await get(p);
  check(`anonymous ${p.split('?')[0]} is refused`, r.status === 401, `status ${r.status}`);
}
{ const w = (await get('/api/profile?candidate_id=farhan_shaikh', 'definitely-not-the-key')).status; check('a wrong key is refused (one attempt only)', w === 403 || w === 429, `status ${w}`); }
const ok = KEY ? await get('/api/dashboard/overview', KEY) : null;
if (!KEY) console.log('INFO  SMOKE_KEY not set: authenticated checks skipped (anonymous protection verified only)');
else check('the real key is accepted', ok.status === 200, `status ${ok.status} (429 means this address is locked out for up to 15 minutes)`, true);
if (ok && ok.status === 200) {
  const o = await ok.json();
  console.log(`INFO  overview: farhan READY ${o.farhan?.ready_count} / sana READY ${o.sana?.ready_count}; active ${o.active_jobs_count} of ${o.total_jobs_tracked}`);
  const apps = await (await get('/api/applications?candidate_id=farhan_shaikh', KEY)).json();
  const byStatus = {}; for (const a of apps.applications || []) byStatus[a.app_status || a.status] = (byStatus[a.app_status || a.status] || 0) + 1;
  console.log(`INFO  Farhan application records: ${apps.count} ${JSON.stringify(byStatus)}`);
  if (process.env.SMOKE_EXPECT_APPLICATIONS) check(`application records preserved (${process.env.SMOKE_EXPECT_APPLICATIONS})`, String(apps.count) === process.env.SMOKE_EXPECT_APPLICATIONS, `found ${apps.count}`, true);
  for (const c of ['farhan_shaikh', 'sana_ansari']) {
    const f = await (await get(`/api/analytics/discovery?candidate_id=${c}`, KEY)).json();
    check(`funnel for ${c} is candidate-scoped and computed`, f.candidate_id === c && f.scope === 'current_active_inventory', JSON.stringify(f).slice(0, 120), true);
  }
  const src = await (await get('/api/analytics/sources-effectiveness?candidate_id=farhan_shaikh', KEY)).json();
  check('source scorecard has no placeholder feeds', !JSON.stringify(src).includes('example.com'), '', true);
}
if (REQUIRE_AUTH && authChecks === 0) { console.log('FAIL  no authenticated check ran'); failed++; }
console.log(`\nauthenticated checks run: ${authChecks}`);
console.log(failed ? `\n${failed} check(s) failed: roll back (see docs/RELEASE.md)` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
