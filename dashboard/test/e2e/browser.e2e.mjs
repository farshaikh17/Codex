// Real-browser release checks. Runs against a LOCAL `wrangler dev` (workerd + local D1, disposable data) and the built
// frontend. Usage: E2E_BASE=http://localhost:8787 E2E_KEY=<disposable test key> node test/e2e/browser.e2e.mjs [desktop|mobile]
// The key is read from the environment and never printed. Refuses to run against a non-local host.
//   Part A: a visitor with no credentials (public viewing, nothing private, writes refused)
//   Part B: operator sign-in for protected actions only (disposable data)
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url)); // playwright is a frontend devDependency
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:8787';
const KEY = process.env.E2E_KEY;
const mode = process.argv[2] || 'desktop';
if (!KEY) throw new Error('E2E_KEY is required');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('E2E only runs against a local server');

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${ok ? '' : '  -> ' + detail}`); };
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
const page = await ctx.newPage();
const consoleErrors = []; const apiLog = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message.slice(0, 160)));
page.on('response', (r) => { if (r.url().includes('/api/')) { const u = new URL(r.url()); apiLog.push({ status: r.status(), method: r.request().method(), url: decodeURIComponent(u.pathname + u.search), auth: !!r.request().headers()['authorization'] }); } });

const modalOpen = async () => (await page.locator('#operator-key-input, #operator-logout-btn').count()) > 0;
const storedKey = () => page.evaluate(() => window.sessionStorage.getItem('admin_session_key'));
const goto = async () => { await page.goto(BASE + '/app', { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const tab = async (name) => { await page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first().click(); await page.waitForTimeout(1500); };
const bodyText = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const apiPublic = async (p) => (await fetch(BASE + '/api' + p)).json();
const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const PRIVATE = /PRIVATE-|PRIVATECITY|RRVUNL|Mianro|Chhabra|Bengaluru|1,?20,?000|cash floor|notice period/i;

// ===== Part A: visitor, no credentials ============================================================================
await goto();
check('A1 first visit: the dashboard loads with no unlock window', !(await modalOpen()));
check('A2 first visit: no request carried a key and none was refused', apiLog.every((r) => !r.auth && r.status === 200) && apiLog.length > 3, JSON.stringify(apiLog.filter((r) => r.status !== 200).slice(0, 3)));
await tab('DASHBOARD'); await page.waitForTimeout(800);
const overview = await apiPublic('/dashboard/overview');
const dash = await bodyText();
check('A3 dashboard shows both candidates and READY counts equal the API', dash.includes(overview.farhan.full_name) && dash.includes(overview.sana.full_name) && new RegExp(`${overview.farhan.ready_count}\\s+READY`).test(dash), dash.slice(0, 160));
check('A4 nothing private is on the page', !PRIVATE.test(dash), (dash.match(PRIVATE) || [])[0]);

const checkCandidate = async (btn, cid, label, other) => {
  await tab(btn);
  const t = await bodyText();
  const sc = (await apiPublic(`/jobs?candidate_id=${cid}&limit=1&exclude_applied=true&exclude_dismissed=true`)).status_counts;
  const card = Number((t.match(/READY TO APPLY\s+(\d+)/i) || [])[1]);
  check(`A5 ${btn}: workspace heading and READY card match the API, jobs are listed`, new RegExp(label + ' Workspace', 'i').test(t) && !new RegExp(other + ' Workspace', 'i').test(t) && card === sc.READY, `${card} vs ${sc.READY}`);
  check(`A6 ${btn}: job rows are visible without a key`, (await page.locator('[data-job-id]').count()) > 0 || /Role j\d/.test(t));
  await tab('Analytics');
  const ta = await bodyText();
  const who = cid === 'sana_ansari' ? 'Sana' : 'Farhan'; const not = cid === 'sana_ansari' ? /Farhan has/ : /Sana has/;
  check(`A7 ${btn}: Analytics is scoped to this candidate`, new RegExp('Current inventory for ' + who).test(ta) && !not.test(ta));
  await tab('SETTINGS');
  const inputs = await page.locator('input').evaluateAll((els) => els.map((e) => e.value));
  const st = await bodyText();
  check(`A8 ${btn}: profile summary shows this candidate only and no private detail`, (inputs.includes(label) || st.includes(label)) && !inputs.includes(other) && !PRIVATE.test(st + inputs.join(' ')), inputs.slice(0, 4).join('|'));
  await tab('APPLICATIONS');
  const at = await bodyText();
  check(`A9 ${btn}: tracker loads without notes`, !/PRIVATE-/.test(at));
};
await checkCandidate('FARHAN', 'farhan_shaikh', overview.farhan.full_name, overview.sana.full_name);
await checkCandidate('SANA', 'sana_ansari', overview.sana.full_name, overview.farhan.full_name);

// search + filters work for a visitor
await tab('FARHAN');
const search = page.locator('input[placeholder*="Search job title"]').first();
if (await search.count()) {
  apiLog.length = 0;
  await search.fill('zzzz-no-such-role'); await page.waitForTimeout(1500);
  check('A10 search sends a public request with the term and narrows the list', apiLog.some((r) => /search=zzzz/.test(r.url) && r.status === 200 && !r.auth) && (await page.locator('table tbody tr').count()) === 0);
  await search.fill(''); await page.waitForTimeout(1200);
}
// screens a visitor can reach that also have operator-only parts: they must not request or show anything protected
await tab('DASHBOARD');
const autoBtn = page.getByRole('button', { name: /automation|discovery runs|cloud discovery/i }).first();
if (await autoBtn.count()) { await autoBtn.click(); await page.waitForTimeout(2500); }
await tab('DASHBOARD'); await tab('FARHAN');
await page.getByText(/Needs Review/i).first().click(); await page.waitForTimeout(2000);   // review queue (qualification audit is operator-only)
check('A12 across every screen a visitor never triggered a refusal, a key or the unlock window', apiLog.every((r) => r.status === 200 || r.status === 404) && !(await modalOpen()) && !apiLog.some((r) => r.auth), JSON.stringify(apiLog.filter((r) => r.status >= 400 || r.auth).slice(0, 3)));
check('A13 no horizontal scrolling at this width', (await overflowX()) <= 1, String(await overflowX()));

// a visitor cannot change records: the UI asks for sign-in and sends nothing
await tab('FARHAN');
const row = page.locator('table tbody tr').first();
apiLog.length = 0;
if (await row.count()) {
  await row.click(); await page.waitForTimeout(800);
  const upd = page.getByRole('button', { name: /Update Pipeline Status/i }).first();
  if (await upd.count()) { await upd.click(); await page.waitForTimeout(800); }
  check('A14 a visitor trying to change a record gets the sign-in window and no write is sent', (await modalOpen()) && apiLog.every((r) => r.method === 'GET'), JSON.stringify(apiLog.filter((r) => r.method !== 'GET')));
  check('A15 the job detail shows no private application notes or history', !PRIVATE.test(await bodyText()));
}
// anonymous writes straight at the API are refused and change nothing
const before = JSON.stringify(await (await fetch(BASE + '/api/applications?candidate_id=farhan_shaikh')).json());
const attempts = [['POST', '/api/applications', { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'APPLIED' }], ['PUT', '/api/profile?candidate_id=farhan_shaikh', { full_name: 'Hijack' }],
  ['POST', '/api/automation/trigger', {}], ['POST', '/api/jobs/j1/qualification-override', { status: 'INELIGIBLE', reason: 'x', candidate_id: 'farhan_shaikh' }]];
const statuses = [];
for (const [m, u, b] of attempts) statuses.push((await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status);
check('A16 anonymous writes are refused with 401', statuses.every((s) => s === 401), statuses.join());
check('A17 and records are unchanged', JSON.stringify(await (await fetch(BASE + '/api/applications?candidate_id=farhan_shaikh')).json()) === before);

// ===== Part B: operator sign-in, only for protected actions =======================================================
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('[aria-label="Close"]')?.click());
await goto();
await page.locator('button[aria-label*="Viewing only"]').first().click();
await page.waitForSelector('#operator-key-input');
await page.fill('#operator-key-input', 'definitely-wrong'); await page.getByRole('button', { name: /unlock/i }).last().click(); await page.waitForTimeout(1200);
check('B1 wrong key: error shown, nothing stored', (await bodyText()).includes('Invalid operator access key') && (await storedKey()) === null);
await page.fill('#operator-key-input', KEY); await page.getByRole('button', { name: /unlock/i }).last().click(); await page.waitForTimeout(1800);
check('B2 correct key: stored for the session and the window closes', (await storedKey()) === KEY && !(await modalOpen()));
await tab('FARHAN');
const row2 = page.locator('table tbody tr').first();
if (await row2.count()) {
  await row2.click(); await page.waitForTimeout(800);
  apiLog.length = 0;
  const upd2 = page.getByRole('button', { name: /Update Pipeline Status/i }).first();
  if (await upd2.count()) { await upd2.click(); await page.waitForTimeout(1500); }
  const wrote = apiLog.filter((r) => r.method === 'POST' && /\/api\/applications/.test(r.url));
  check('B3 operator: the change is sent with the key and accepted', wrote.length >= 1 && wrote.every((r) => r.auth && r.status === 200), JSON.stringify(wrote));
}
const after = await (await fetch(BASE + '/api/applications?candidate_id=farhan_shaikh', { headers: { Authorization: `Bearer ${KEY}` } })).json();
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('[aria-label="Close"]')?.click()); await page.waitForTimeout(500);
await tab('SETTINGS');
const opInputs = await page.locator('input').evaluateAll((els) => els.map((e) => e.value));
check('B3b public -> operator on Settings: the full editable record replaces the public summary', opInputs.some((v) => /PRIVATECITY-7f3/.test(v)), opInputs.slice(0, 5).join('|'));
check('B4 the operator sees stored records; a visitor still sees none of the notes', after.count >= 2 && !JSON.stringify(await apiPublic('/applications?candidate_id=farhan_shaikh')).includes('PRIVATE-'));
await page.keyboard.press('Escape');
await goto();
check('B5 reload keeps the operator session with no sign-in window', !(await modalOpen()) && (await storedKey()) === KEY);
// rotated/expired key: falls back to the public view with a notice, no window
await page.evaluate(() => window.sessionStorage.setItem('admin_session_key', 'rotated-old-key'));
apiLog.length = 0; await goto(); await page.waitForTimeout(1500);
const staleVerify = apiLog.filter((r) => /auth\/verify/.test(r.url));
{ const t = await bodyText();
  const parts = { oneVerify: staleVerify.length === 1, dropped: (await storedKey()) === null, noWindow: !(await modalOpen()), publicLoaded: t.includes(overview.farhan.full_name), notice: /no longer valid|session ended/.test(t) };
  check('B6 stale key: ONE refused check, key dropped, public view loads, notice shown, no window', Object.values(parts).every(Boolean), JSON.stringify(parts) + ' ' + t.slice(0, 400)); }
// lock
await page.locator('button[aria-label*="Viewing only"]').first().click(); await page.fill('#operator-key-input', KEY); await page.getByRole('button', { name: /unlock/i }).last().click(); await page.waitForTimeout(1500);
await page.locator('button[aria-label*="Operator mode on"]').first().click(); await page.waitForSelector('#operator-logout-btn'); await page.click('#operator-logout-btn'); await page.waitForTimeout(800);
{ const t = await bodyText(); check('B7 sign out: key removed, public view continues, operator data is gone from the screen at once', (await storedKey()) === null && !(await modalOpen()) && !/PRIVATECITY|PRIVATE-/.test(t) && t.length > 200, t.slice(0, 120)); }
// guess limiter
await page.locator('button[aria-label*="Viewing only"]').first().click();
for (let i = 0; i < 9; i++) { await page.fill('#operator-key-input', 'guess-' + i); await page.getByRole('button', { name: /unlock/i }).last().click(); await page.waitForTimeout(350); }
await page.fill('#operator-key-input', KEY); await page.getByRole('button', { name: /unlock/i }).last().click(); await page.waitForTimeout(1200);
check('B8 guess limiter: after repeated wrong keys the correct key is refused with a clear message', /Too many failed attempts/.test(await bodyText()) && (await storedKey()) === null);
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('[aria-label="Close"]')?.click());
apiLog.length = 0; await goto();
check('B9 even while that address is locked out, public pages still load', (await bodyText()).includes(overview.farhan.full_name) && apiLog.every((r) => r.status === 200));

const unexpected = consoleErrors.filter((t) => !/status of (401|403|429)|Failed to load resource|Operator sign-in is required|Failed to (fetch|update|load)/.test(t));
check('no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
console.log(`\n${mode}: ${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
