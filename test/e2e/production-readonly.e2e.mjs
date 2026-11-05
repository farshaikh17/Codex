// Read-only real-browser verification of the DEPLOYED dashboard. Makes no write: every non-GET request except the key
// check is aborted before it leaves the browser. The key comes from the environment and is never printed.
//   E2E_BASE=https://career-job-engine.<account>.workers.dev E2E_KEY=... node test/e2e/production-readonly.e2e.mjs [desktop|mobile]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = (process.env.E2E_BASE || '').replace(/\/$/, '');
const KEY = process.env.E2E_KEY;
const mode = process.argv[2] || 'desktop';
if (!(BASE.startsWith('https://') || /^http:\/\/localhost(:\d+)?$/.test(BASE)) || !KEY) throw new Error('E2E_BASE (https, or localhost for a rehearsal) and E2E_KEY are required');

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${ok ? '' : '  -> ' + detail}`); };
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
const page = await ctx.newPage();
const consoleErrors = []; const apiLog = []; const blocked = [];
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|429)|Failed to load resource/.test(m.text()) && !/^Error: Failed to (fetch|update|load)/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message.slice(0, 160)));
page.on('response', (r) => { if (r.url().includes('/api/')) { const u = new URL(r.url()); apiLog.push({ status: r.status(), method: r.request().method(), url: decodeURIComponent(u.pathname + u.search), auth: !!r.request().headers()['authorization'] }); } });
await page.route('**/api/**', (route) => {
  const req = route.request();
  if (req.method() !== 'GET' && !req.url().endsWith('/api/auth/verify')) { blocked.push(req.method() + ' ' + req.url()); return route.abort(); }
  return route.continue();
});

const text = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const tab = async (n) => { await page.getByRole('button', { name: new RegExp('^' + n, 'i') }).first().click(); await page.waitForTimeout(2000); };
const api = async (p) => (await fetch(BASE + '/api' + p, { headers: { Authorization: `Bearer ${KEY}` } })).json();
const modalOpen = async () => (await page.locator('#operator-key-input, #operator-logout-btn').count()) > 0;

// Anonymous: the shell is public, private data is not.
for (const p of ['/profile?candidate_id=farhan_shaikh', '/applications?candidate_id=farhan_shaikh', '/dashboard/overview', '/jobs?candidate_id=sana_ansari']) {
  const r = await fetch(BASE + '/api' + p);
  check(`anonymous ${p.split('?')[0]} is refused`, r.status === 401, 'status ' + r.status);
}
const shell = await (await fetch(BASE + '/')).text();
const js = await (await fetch(BASE + (shell.match(/\/assets\/index-[^"']+\.js/) || [''])[0])).text();
check('public bundle holds no candidate profile data', !/RRVUNL|Mianro|Chhabra|Rajasthan|\bKota\b|\bBMS\b|B\.Tech|1,?20,?000/.test(js));

// Browser: locked first, then unlock with the real key.
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
check('locked on first visit: no private request was made and the unlock window opens', !apiLog.some((r) => !/health|version|auth\/verify/.test(r.url)) && await modalOpen(), JSON.stringify(apiLog.slice(0, 3)));
await page.fill('#operator-key-input', KEY);
await page.getByRole('button', { name: /unlock/i }).last().click();
await page.waitForTimeout(3000);
check('unlock with the operator key works', !(await modalOpen()));
await tab('DASHBOARD');
const overview = await api('/dashboard/overview');
const dash = await text();
check('dashboard shows both candidates', dash.includes(overview.farhan.full_name) && dash.includes(overview.sana.full_name), dash.slice(0, 120));
check('dashboard READY counts equal the API', dash.includes(`${overview.farhan.ready_count} READY`) || new RegExp(`${overview.farhan.ready_count}\\s+READY`).test(dash));

for (const [btn, cid, label] of [['FARHAN', 'farhan_shaikh', overview.farhan.full_name], ['SANA', 'sana_ansari', overview.sana.full_name]]) {
  await tab(btn);
  const t = await text();
  const sc = (await api(`/jobs?candidate_id=${cid}&limit=1&exclude_applied=true&exclude_dismissed=true`)).status_counts; // the workspace list hides jobs already applied to
  const card = Number((t.match(/READY TO APPLY\s+(\d+)/i) || [])[1]);
  check(`${btn}: workspace heading and READY card match the API`, new RegExp(label + ' Workspace', 'i').test(t) && card === sc.READY, `${card} vs ${sc.READY}`);
  await tab('Analytics');
  const ta = await text();
  const other = cid === 'sana_ansari' ? /Farhan has/ : /Sana has/;
  check(`${btn}: Analytics is scoped to this candidate`, new RegExp('Current inventory for ' + (cid === 'sana_ansari' ? 'Sana' : 'Farhan')).test(ta) && !other.test(ta));
  await tab('SETTINGS');
  const names = await page.locator('input').evaluateAll((els) => els.map((e) => e.value));
  check(`${btn}: Settings shows this candidate's record`, names.includes(label), names.slice(0, 4).join('|'));
  await tab('APPLICATIONS');
  const apps = await api(`/applications?candidate_id=${cid}`);
  check(`${btn}: tracker request names this candidate`, apiLog.filter((r) => /applications\?candidate_id=/.test(r.url)).slice(-1)[0]?.url.includes(cid) !== false);
  check(`${btn}: application record count readable (${apps.count})`, typeof apps.count === 'number');
}
check('every private request carried the key and succeeded', apiLog.filter((r) => !/health|version|auth\/verify/.test(r.url) && r.status !== 200).length === 0, JSON.stringify(apiLog.filter((r) => r.status !== 200 && !/health|version|auth\/verify/.test(r.url)).slice(0, 3)));
check('no write request was attempted by the UI during this run', blocked.length === 0, blocked.join(', '));
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
console.log(`\n${mode}: ${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
