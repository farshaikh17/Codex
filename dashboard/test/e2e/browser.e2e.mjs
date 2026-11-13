// Real-browser release checks. Runs against a LOCAL `wrangler dev` (workerd + local D1, disposable data) and the built
// frontend. Usage: E2E_BASE=http://localhost:8787 E2E_KEY=<disposable test key> node test/e2e/browser.e2e.mjs [desktop|mobile]
// The key is read from the environment and never printed. Refuses to run against a non-local host.
//   Part A: a visitor with no credentials: the operator screens are locked (gap fix, 13 Nov: only the sign-in prompt, no data), a made-up share
//           link shows nothing, writes are refused
//   Part B: operator sign-in through that prompt, protected actions (disposable data), stale key, sign out, guess limiter
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url)); // playwright is a frontend devDependency
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:8787';
const KEY = process.env.E2E_KEY;
// Open tracker (owner decision 2026-11-12): when the Worker says open_tracker, a visitor may use the tracker; every other change still needs the key.
const OPEN = (await (await fetch(BASE + '/api/version')).json().catch(() => ({}))).open_tracker === true;
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

const modalOpen = async () => (await page.locator('[role=dialog] #operator-key-input, #operator-logout-btn').count()) > 0;   // the in-page unlock window
const gateShown = async () => (await page.locator('[data-testid="operator-gate"] #operator-key-input').count()) === 1;    // the operator sign-in prompt
const DATA_API = /^\/api\/(jobs|candidates|profile|applications|dashboard|analytics|india-remote|today)/;
const signIn = async (key) => { await page.fill('#operator-key-input', key); await page.locator('[data-testid="operator-gate"] button[type=submit]').click(); await page.waitForTimeout(1500); };
const storedKey = () => page.evaluate(() => window.sessionStorage.getItem('admin_session_key'));
const goto = async () => { await page.goto(BASE + '/app?operator=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const tab = async (name) => { await page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first().click(); await page.waitForTimeout(1500); };
const bodyText = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const apiPublic = async (p) => (await fetch(BASE + '/api' + p)).json();
const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const PRIVATE = /PRIVATE-|PRIVATECITY|RRVUNL|Mianro|Chhabra|Bengaluru|1,?20,?000|cash floor|notice period/i;

// ===== Part A: visitor, no credentials ============================================================================
await goto();
const overview = await apiPublic('/dashboard/overview');
{
  const t = await bodyText();
  check('A1 /app?operator=1 without a key shows only the sign-in prompt: no dashboard, no job, no candidate name', await gateShown()
    && (await page.locator('[data-job-id]').count()) === 0 && !t.includes(overview.farhan.full_name) && !t.includes(overview.sana.full_name) && !/Workspace|READY TO APPLY/i.test(t), t.slice(0, 160));
  check('A2 the locked prompt makes no data request and sends no key', !apiLog.some((r) => DATA_API.test(r.url) || r.auth), JSON.stringify(apiLog.slice(0, 3)));
  check('A3 the prompt links the job seeker to their own page', (await page.locator('[data-testid="operator-gate"] a[href="/app"]').count()) === 1);
  check('A13 no horizontal scrolling at this width', (await overflowX()) <= 1, String(await overflowX()));
}
// a made-up share link no longer falls back to the public dashboard
await page.goto(BASE + '/app#view=v1_' + '0'.repeat(48) + '&candidate=client_nobody', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
{
  const t = await bodyText();
  check('A4 a made-up share link says it is not valid and shows no dashboard', (await page.locator('[data-testid="share-link-invalid"]').count()) === 1
    && (await page.locator('[data-job-id]').count()) === 0 && !t.includes(overview.farhan.full_name) && !/Workspace|READY TO APPLY/i.test(t), t.slice(0, 160));
}
await page.evaluate(() => window.sessionStorage.clear());
// anonymous writes straight at the API are refused and change nothing
const before = JSON.stringify(await (await fetch(BASE + '/api/applications?candidate_id=farhan_shaikh')).json());
const attempts = [['PUT', '/api/profile?candidate_id=farhan_shaikh', { full_name: 'Hijack' }], ['POST', '/api/automation/trigger', {}], ['PUT', '/api/site-settings', { brand_name: 'Hijack' }]]
  .concat(OPEN ? [] : [['POST', '/api/applications', { candidate_id: 'farhan_shaikh', job_id: 'j4', status: 'APPLIED' }], ['POST', '/api/jobs/j1/qualification-override', { status: 'INELIGIBLE', reason: 'x', candidate_id: 'farhan_shaikh' }]]);
const statuses = [];
for (const [m, u, b] of attempts) statuses.push((await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status);
check('A16 anonymous writes are refused with 401', statuses.every((s) => s === 401), statuses.join());
check('A17 and records are unchanged', JSON.stringify(await (await fetch(BASE + '/api/applications?candidate_id=farhan_shaikh')).json()) === before);

// ===== Part B: operator sign-in through the prompt ================================================================
await goto();
await signIn('definitely-wrong');
check('B1 wrong key: error shown, nothing stored, still locked', (await bodyText()).includes('Invalid operator access key') && (await storedKey()) === null && await gateShown());
await signIn(KEY); await page.waitForTimeout(500);
check('B2 correct key: stored for the session, the prompt is gone and the dashboard loads', (await storedKey()) === KEY && !(await gateShown()) && !(await modalOpen()) && (await bodyText()).includes(overview.farhan.full_name));
await tab('FARHAN');
const row2 = page.locator('[data-job-id]').first();
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
check(OPEN ? 'B4 the operator sees stored records (open tracker: a visitor sees the notes too)' : 'B4 the operator sees stored records; a visitor still sees none of the notes', after.count >= 2 && (OPEN || !JSON.stringify(await apiPublic('/applications?candidate_id=farhan_shaikh')).includes('PRIVATE-')));
await page.keyboard.press('Escape');
await goto();
check('B5 reload keeps the operator session with no prompt and no window', !(await gateShown()) && !(await modalOpen()) && (await storedKey()) === KEY);
// rotated/expired key: one refused check, key dropped, the screens lock again with a notice
await page.evaluate(() => window.sessionStorage.setItem('admin_session_key', 'rotated-old-key'));
apiLog.length = 0; await goto(); await page.waitForTimeout(1500);
const staleVerify = apiLog.filter((r) => /auth\/verify/.test(r.url));
{ const t = await bodyText();
  const parts = { oneVerify: staleVerify.length === 1, dropped: (await storedKey()) === null, locked: await gateShown(), noData: !apiLog.some((r) => DATA_API.test(r.url)), notice: /no longer accepted/.test(t) };
  check('B6 stale key: ONE refused check, key dropped, the prompt shows with a notice, no data loaded', Object.values(parts).every(Boolean), JSON.stringify(parts) + ' ' + t.slice(0, 300)); }
// sign out locks the screens again at once
await signIn(KEY);
await page.locator('button[aria-label*="Operator mode on"]').first().click(); await page.waitForSelector('#operator-logout-btn'); await page.click('#operator-logout-btn'); await page.waitForTimeout(800);
{ const t = await bodyText(); check('B7 sign out: key removed, the prompt is back, operator data is gone from the screen at once', (await storedKey()) === null && await gateShown() && !/PRIVATECITY|PRIVATE-/.test(t) && !t.includes(overview.farhan.full_name), t.slice(0, 120)); }
// guess limiter
for (let i = 0; i < 9; i++) await signIn('guess-' + i);
await signIn(KEY);
check('B8 guess limiter: after repeated wrong keys the correct key is refused with a clear message', /Too many failed attempts/.test(await bodyText()) && (await storedKey()) === null && await gateShown());
apiLog.length = 0; await page.goto(BASE + '/app#farhan/today', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
check('B9 even while that address is locked out, the job seeker\'s page and public reads still load', /Best matches/.test(await bodyText()) && apiLog.length > 0 && apiLog.every((r) => r.status === 200));

const unexpected = consoleErrors.filter((t) => !/status of (401|403|429)|Failed to load resource|Operator sign-in is required|Failed to (fetch|update|load)/.test(t));
check('no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
console.log(`\n${mode}: ${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
