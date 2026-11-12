// Read-only real-browser verification of a DEPLOYED public dashboard. It needs NO credentials and makes no write:
// every non-GET request is aborted before it leaves the browser.
//   E2E_BASE=https://career-job-engine.<account>.workers.dev node test/e2e/production-readonly.e2e.mjs [desktop|mobile]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = (process.env.E2E_BASE || '').replace(/\/$/, '');
const mode = process.argv[2] || 'desktop';
if (!(BASE.startsWith('https://') || /^http:\/\/localhost(:\d+)?$/.test(BASE))) throw new Error('E2E_BASE (https, or localhost for a rehearsal) is required');

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${ok ? '' : '  -> ' + detail}`); };
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
const page = await ctx.newPage();
const consoleErrors = []; const apiLog = []; const blocked = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message.slice(0, 160)));
page.on('response', (r) => { if (r.url().includes('/api/')) { const u = new URL(r.url()); apiLog.push({ status: r.status(), method: r.request().method(), url: decodeURIComponent(u.pathname + u.search), auth: !!r.request().headers()['authorization'] }); } });
await page.route('**/api/**', (route) => {
  const req = route.request();
  if (req.method() !== 'GET') { blocked.push(req.method() + ' ' + req.url()); return route.abort(); }
  return route.continue();
});
const text = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const tab = async (n) => { await page.getByRole('button', { name: new RegExp('^' + n, 'i') }).first().click(); await page.waitForTimeout(2000); };
const api = async (p) => (await fetch(BASE + '/api' + p)).json();
const modalOpen = async () => (await page.locator('#operator-key-input, #operator-logout-btn').count()) > 0;
const PRIVATE_TEXT = /RRVUNL|Mianro|Chhabra|1,?20,?000|\bnotice period\b|cash floor/i;          // employers and pay: nowhere in public output
const PRIVATE_CITY = /\bKota\b|Bengaluru|Hyderabad|Chennai|Pune|Mumbai/i;            // candidate-side only (job postings legitimately name cities)

// Open tracker (owner decision 2026-11-12): /api/version says open_tracker. Then the tracker routes answer without a key (a nonexistent job
// gives 404 and changes nothing) and the tracker's own notes may appear publicly; every other protected route must still refuse with 401.
const TRACKER = [/^\/api\/jobs\/[^/?]+\/feedback/, /^\/api\/candidates\/[^/]+\/applications$/, /^\/api\/applications(\?|$)/, /^\/api\/applications\/[^/?]+\/follow-up/, /^\/api\/applications\/[^/?]+\/history/, /^\/api\/jobs\/[^/?]+\/qualification-(override|audit)/];
const isTracker = (p) => TRACKER.some((re) => re.test(p.startsWith('/api') ? p : '/api' + p));
const OPEN = (await (await fetch(BASE + '/api/version')).json().catch(() => ({}))).open_tracker === true;
// Anonymous API: the protected surface refuses, the public surface answers.
for (const p of ['/applications/x/history?candidate_id=farhan_shaikh', '/jobs/x/qualification-audit?candidate_id=farhan_shaikh', '/automation/runs', '/meta', '/backups']) {
  const r = await fetch(BASE + '/api' + p);
  if (OPEN && isTracker(p)) check(`open tracker GET ${p.split('?')[0]} answers without a key`, r.status === 200 || r.status === 404, 'status ' + r.status);
  else check(`anonymous GET ${p.split('?')[0]} is refused`, r.status === 401, 'status ' + r.status);
}
for (const [m, p, b] of [['POST', '/applications', { candidate_id: 'farhan_shaikh', job_id: 'x', status: 'APPLIED' }], ['PUT', '/profile?candidate_id=smoke-nonexistent', {}], ['POST', '/automation/smoke-nonexistent', {}], ['POST', '/jobs/x/qualification-override', { candidate_id: 'farhan_shaikh', status: 'READY', reason: 'x' }]]) {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  if (OPEN && isTracker(p)) check(`open tracker ${m} ${p.split('?')[0]} on a nonexistent job changes nothing (400/404)`, r.status === 404 || r.status === 400, 'status ' + r.status);
  else check(`anonymous ${m} ${p.split('?')[0]} is refused (no record can be changed)`, r.status === 401, 'status ' + r.status);
}
const leaks = [];
for (const p of ['/candidates', '/profile?candidate_id=farhan_shaikh', '/profile?candidate_id=sana_ansari', '/applications?candidate_id=farhan_shaikh', '/applications?candidate_id=sana_ansari', '/dashboard/overview', '/jobs?candidate_id=farhan_shaikh&limit=50', '/sources']) {
  const r = await fetch(BASE + '/api' + p); const t = await r.text();
  if (r.status !== 200) leaks.push(`${p} -> ${r.status}`);
  if ((/^\/(candidates|profile|dashboard)/.test(p) && PRIVATE_TEXT.test(t)) || (/^\/(candidates|profile|dashboard)/.test(p) && PRIVATE_CITY.test(t)) || (OPEN ? /"(error_message|cover_letter_path|actor|cash_floor_inr_monthly|pay_line|employment_history|location_preferences)"/ : /"(error_message|rejection_stage|rejection_reason_category|notes|application_notes|rejection_notes|resume_version|cover_letter_path|actor|cash_floor_inr_monthly|pay_line|employment_history|location_preferences)"/).test(t) || (/^\/(candidates|profile|dashboard)/.test(p) && /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(t))) leaks.push(`${p} private field/value`);
}
check('public endpoints answer 200 and expose no private field, employer, pay, city, note or email', leaks.length === 0, leaks.join('; '));

// Browser: public view first, no credentials involved at any point.
await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
check('first visit: no unlock window, no key sent, no request refused', !(await modalOpen()) && apiLog.length > 3 && apiLog.every((r) => !r.auth && r.status === 200), JSON.stringify(apiLog.filter((r) => r.status !== 200).slice(0, 3)));
const shell = await (await fetch(BASE + '/app')).text();   // the app shell (the site root is the public website)
const js = await (await fetch(BASE + (shell.match(/\/assets\/index-[^"']+\.js/) || [''])[0])).text();
check('public bundle holds no candidate profile data', js.length > 50000 && !/RRVUNL|Mianro|Chhabra|1,?20,?000/.test(js) && !/B\.Tech|\bBMS\b|Rajasthan/.test(js));
await tab('DASHBOARD');
const overview = await api('/dashboard/overview');
const dash = await text();
check('dashboard shows both candidates', dash.includes(overview.farhan.full_name) && dash.includes(overview.sana.full_name), dash.slice(0, 120));
check('dashboard READY counts equal the API', new RegExp(`${overview.farhan.ready_count}\\s+READY`).test(dash));
check('no private text on the dashboard', !PRIVATE_TEXT.test(dash) && !PRIVATE_CITY.test(dash), (dash.match(PRIVATE_TEXT) || dash.match(PRIVATE_CITY) || [])[0]);

for (const [btn, cid, label, other] of [['FARHAN', 'farhan_shaikh', overview.farhan.full_name, overview.sana.full_name], ['SANA', 'sana_ansari', overview.sana.full_name, overview.farhan.full_name]]) {
  await tab(btn);
  let t = await text();
  const sc = (await api(`/jobs?candidate_id=${cid}&limit=1&exclude_applied=true&exclude_dismissed=true`)).status_counts;
  // The card shows 0 until the candidate's first jobs query returns, which is slow right after a deploy flushes the cache. Wait (up to 20 s) for the
  // value to settle; a count that never matches the API still fails.
  const readCard = (x) => Number((x.match(/READY TO APPLY\s+(\d+)/i) || [])[1]);
  for (let i = 0; i < 20 && readCard(t) !== sc.READY; i++) { await page.waitForTimeout(1000); t = await text(); }
  const card = readCard(t);
  check(`${btn}: workspace heading and READY card match the API`, new RegExp(label + ' Workspace', 'i').test(t) && !new RegExp(other + ' Workspace', 'i').test(t) && card === sc.READY, `${card} vs ${sc.READY}`);
  await tab('Analytics');
  const ta = await text();
  check(`${btn}: Analytics is scoped to this candidate`, new RegExp('Current inventory for ' + (cid === 'sana_ansari' ? 'Sana' : 'Farhan')).test(ta) && !(cid === 'sana_ansari' ? /Farhan has/ : /Sana has/).test(ta));
  await tab('SETTINGS');
  const names = await page.locator('input').evaluateAll((els) => els.map((e) => e.value));
  const st = await text();
  check(`${btn}: profile summary names this candidate and holds no private detail`, (names.includes(label) || st.includes(label)) && !names.includes(other) && !PRIVATE_TEXT.test(st + names.join(' ')) && !PRIVATE_CITY.test(names.join(' ')), names.slice(0, 4).join('|'));
  await tab('APPLICATIONS');
  if (!OPEN) check(`${btn}: tracker shows no private notes`, !/PRIVATE-|Playwright verified rejection test/i.test(await text()));   // open tracker: the tracker's notes are visible by design
}
// India Remote and READY lists: the jobs on screen are exactly the server's filtered first page (same query the screen sends; reads are cache hits after the visit).
const onScreen = () => page.$$eval('[data-job-id]', (els) => els.map((e) => e.getAttribute('data-job-id')));
const sameAsApi = async (expected) => { let got = []; for (let i = 0; i < 20; i++) { got = await onScreen(); if (JSON.stringify(got) === JSON.stringify(expected)) return { ok: true, got }; await page.waitForTimeout(1000); } return { ok: false, got }; };
for (const [btn, cid] of [['FARHAN', 'farhan_shaikh'], ['SANA', 'sana_ansari']]) {
  await tab(btn);
  await page.getByText('See these jobs').first().click(); await page.waitForTimeout(1500);
  const all = await api(`/india-remote/jobs?candidate_id=${cid}&sort_by=score_desc&exclude_applied=true&limit=25&offset=0`);
  let r = await sameAsApi(all.jobs.map((j) => j.id));
  check(`${btn}: India Remote shows exactly the server's first page (${all.jobs.length} of ${all.total})`, r.ok, `screen [${r.got}] api [${all.jobs.map((j) => j.id)}]`);
  await page.getByRole('button', { name: /^Ready/ }).first().click();
  const ready = await api(`/india-remote/jobs?candidate_id=${cid}&farhan_fit=READY&sort_by=score_desc&exclude_applied=true&limit=25&offset=0`);
  r = await sameAsApi(ready.jobs.map((j) => j.id));
  check(`${btn}: India Remote READY filter shows exactly the READY jobs, and the pill count is their total`, r.ok && ready.jobs.every((j) => j.farhan_fit === 'READY') && ready.facets.fit.READY === ready.total, `screen [${r.got}] api [${ready.jobs.map((j) => j.id)}]`);
  await tab(btn);
  await page.getByText('View READY').first().click(); await page.waitForTimeout(1500);
  const rd = await api(`/jobs?candidate_id=${cid}&farhan_fit=READY&sort_by=score_desc&exclude_applied=true&exclude_dismissed=true&limit=25&offset=0`);
  // The tab count loads a moment after the list; right after a deploy (cold cache) the first read raced it and failed a release once. Wait for it, up to 10 s.
  await page.waitForFunction((n) => new RegExp(`READY to Apply \\(${n}\\)`, 'i').test(document.body.innerText), rd.status_counts.READY, { timeout: 10000 }).catch(() => {});
  r = await sameAsApi(rd.jobs.map((j) => j.id));
  check(`${btn}: READY dashboard shows exactly the server's READY jobs and its tab count is their total`, r.ok && rd.jobs.every((j) => j.farhan_fit === 'READY') && new RegExp(`READY to Apply \\(${rd.status_counts.READY}\\)`, 'i').test(await text()), `screen [${r.got}] api [${rd.jobs.map((j) => j.id)}]`);
}
// The navbar refresh button only re-reads data: no write is attempted and no unlock window opens for a visitor.
{
  const before = blocked.length;
  await page.locator('button[title="Sync / Refresh"]').first().click(); await page.waitForTimeout(1500);
  check('navbar refresh re-reads data: no write attempted, no unlock window', blocked.length === before && !(await modalOpen()), blocked.slice(before).join(', '));
}
check('across the whole visit no request was refused and no key was used', apiLog.filter((r) => r.status >= 400).length === 0 && apiLog.every((r) => !r.auth), JSON.stringify(apiLog.filter((r) => r.status >= 400).slice(0, 3)));
check('no write request was attempted by the UI during this run', blocked.length === 0, blocked.join(', '));
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
console.log(`\n${mode}: ${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
