// Read-only post-deploy checks. The key comes from the environment and is never printed or sent anywhere but the
// target's Authorization header.  SMOKE_BASE=https://... SMOKE_KEY=... [SMOKE_EXPECT_APPLICATIONS=12] node scripts/post_deploy_smoke.mjs
const BASE = (process.env.SMOKE_BASE || '').replace(/\/$/, '');
const KEY = process.env.SMOKE_KEY;
if (!BASE || !KEY) { console.error('SMOKE_BASE and SMOKE_KEY are required'); process.exit(2); }
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
const get = (p, key) => fetch(BASE + p, { headers: key ? { Authorization: `Bearer ${key}` } : {} });

check('health is public', (await get('/api/health')).status === 200);
check('version is public', (await get('/api/version')).status === 200);
for (const p of ['/api/profile', '/api/applications', '/api/dashboard/overview', '/api/jobs?candidate_id=farhan_shaikh', '/api/analytics/discovery?candidate_id=sana_ansari', '/api/india-remote/jobs']) {
  const r = await get(p);
  check(`anonymous ${p.split('?')[0]} is refused`, r.status === 401, `status ${r.status}`);
}
check('a wrong key is refused (one attempt only)', (await get('/api/profile', 'definitely-not-the-key')).status === 403);
const ok = await get('/api/dashboard/overview', KEY);
check('the real key is accepted', ok.status === 200, `status ${ok.status} (429 means this address is locked out for up to 15 minutes)`);
if (ok.status === 200) {
  const o = await ok.json();
  console.log(`INFO  overview: farhan READY ${o.farhan?.ready_count} / sana READY ${o.sana?.ready_count}; active ${o.active_jobs_count} of ${o.total_jobs_tracked}`);
  const apps = await (await get('/api/applications?candidate_id=farhan_shaikh', KEY)).json();
  const byStatus = {}; for (const a of apps.applications || []) byStatus[a.app_status || a.status] = (byStatus[a.app_status || a.status] || 0) + 1;
  console.log(`INFO  Farhan application records: ${apps.count} ${JSON.stringify(byStatus)}`);
  if (process.env.SMOKE_EXPECT_APPLICATIONS) check(`application records preserved (${process.env.SMOKE_EXPECT_APPLICATIONS})`, String(apps.count) === process.env.SMOKE_EXPECT_APPLICATIONS, `found ${apps.count}`);
  for (const c of ['farhan_shaikh', 'sana_ansari']) {
    const f = await (await get(`/api/analytics/discovery?candidate_id=${c}`, KEY)).json();
    check(`funnel for ${c} is candidate-scoped and computed`, f.candidate_id === c && f.scope === 'current_active_inventory', JSON.stringify(f).slice(0, 120));
  }
  const src = await (await get('/api/analytics/sources-effectiveness?candidate_id=farhan_shaikh', KEY)).json();
  check('source scorecard has no placeholder feeds', !JSON.stringify(src).includes('example.com'));
}
console.log(failed ? `\n${failed} check(s) failed: roll back (see docs/RELEASE.md)` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
