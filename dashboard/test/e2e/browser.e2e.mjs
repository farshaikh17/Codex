// Real-browser release checks. Runs against a LOCAL `wrangler dev` (workerd + local D1, disposable data) and the built
// frontend. Usage: E2E_BASE=http://localhost:8787 E2E_KEY=<test key> node test/e2e/browser.e2e.mjs [desktop|mobile]
// The key is read from the environment and never printed. Refuses to run against a non-local host.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url)); // playwright is a frontend devDependency
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:8787';
const KEY = process.env.E2E_KEY;
const mode = process.argv[2] || 'desktop';
if (!KEY) throw new Error('E2E_KEY is required');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('E2E only runs against a local server');

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
const page = await ctx.newPage();
const consoleErrors = []; const expectedAuthLogs = []; const apiLog = [];
// The app logs 'Failed to fetch ...' when the Worker refuses a request; that is the expected result of the
// no-key / wrong-key / expired steps and is counted separately. Anything else is an unexpected error.
page.on('console', (m) => {
  if (m.type() !== 'error' || /status of (401|403|429)|Failed to load resource/.test(m.text())) return;
  (/^Error: Failed to (fetch|update|load)/.test(m.text()) ? expectedAuthLogs : consoleErrors).push(m.text().slice(0, 160));
});
page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message.slice(0, 160)));
page.on('response', (r) => { if (r.url().includes('/api/')) apiLog.push({ status: r.status(), method: r.request().method(), url: decodeURIComponent(new URL(r.url()).pathname + new URL(r.url()).search), auth: !!r.request().headers()['authorization'] }); });

const modalOpen = async () => (await page.locator('#operator-key-input, #operator-logout-btn').count()) > 0;
const storedKey = () => page.evaluate(() => window.sessionStorage.getItem('admin_session_key'));
const goto = async () => { await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const tab = async (name) => { await page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first().click(); await page.waitForTimeout(1500); };
const bodyText = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const unlock = async (key) => { await page.fill('#operator-key-input', key); await page.getByRole('button', { name: /unlock actions|unlock/i }).last().click(); await page.waitForTimeout(1500); };

// 1. No credentials: protected data is refused and the unlock window opens by itself.
await goto();
check('no key: no private data is requested at all, and nothing is counted against the limiter', !apiLog.some((r) => !/health|version|auth\/verify/.test(r.url)), JSON.stringify(apiLog.slice(0, 3)));
check('no key: unlock window opens automatically', await modalOpen());

// 2. Invalid key.
await page.waitForSelector('#operator-key-input');
await unlock('definitely-wrong');
check('invalid key: error is shown, window stays open', (await bodyText()).includes('Invalid operator access key') && await modalOpen());
check('invalid key: nothing stored', (await storedKey()) === null);

// 3. Valid key.
await unlock(KEY);
await page.waitForTimeout(1500);
check('valid key: stored for the session and window closes', (await storedKey()) === KEY && !(await modalOpen()));
await tab('DASHBOARD'); await page.waitForTimeout(800);
const dash = await bodyText();
check('valid key: dashboard shows both candidates with data', dash.includes('Test Farhan') && dash.includes('Test Sana') && /READY/.test(dash));
check('valid key: later API calls carry the key and succeed', apiLog.filter((r) => /\/api\/(dashboard|profile|analytics)/.test(r.url)).slice(-3).every((r) => r.auth && r.status === 200));

// 4. Reload keeps the session; no unlock prompt.
await goto();
check('reload: session survives, no unlock window', !(await modalOpen()) && (await bodyText()).includes('Test Farhan'));

// 5. Switching between both candidates, Analytics scoped to the selected one.
const analyticsFor = async (cand, label) => {
  await tab(cand); await tab('Analytics');
  const t = await bodyText();
  const mentionsOther = label === 'Sana' ? /Farhan has/.test(t) : /Sana has/.test(t);
  return { t, mentionsOther, sentence: (t.match(/Current inventory for (\w+):[^.]*\./) || [''])[0] };
};
const a1 = await analyticsFor('FARHAN', 'Farhan');
const a2 = await analyticsFor('SANA', 'Sana');
const a3 = await analyticsFor('FARHAN', 'Farhan');
check('Farhan -> Analytics names Farhan', a1.sentence.startsWith('Current inventory for Farhan'), a1.sentence);
check('Sana -> Analytics names Sana and never says "Farhan has"', a2.sentence.startsWith('Current inventory for Sana') && !a2.mentionsOther, a2.sentence);
check('back to Farhan restores Farhan figures', a3.sentence === a1.sentence, a3.sentence);
const recent = apiLog.filter((r) => /analytics\/(discovery|sources)/.test(r.url));
check('every Analytics request names the selected candidate', recent.length >= 6 && recent.every((r) => /candidate_id=(farhan_shaikh|sana_ansari)/.test(r.url)));
const sanaReq = recent.filter((r) => r.url.includes('sana_ansari')).length, farReq = recent.filter((r) => r.url.includes('farhan_shaikh')).length;
check('both candidates were queried', sanaReq >= 2 && farReq >= 4, `${sanaReq}/${farReq}`);
const fFunnel = await (await fetch(`${BASE}/api/analytics/discovery?candidate_id=farhan_shaikh`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
check('displayed READY equals the API figure for Farhan', a1.sentence.includes(`${fFunnel.ready_jobs} READY`), `${a1.sentence} vs ${fFunnel.ready_jobs}`);
await tab('SANA'); await tab('SETTINGS');
check('Sana Settings shows her record, not Farhan\'s', await page.locator('input').evaluateAll((els) => els.some((e) => e.value === 'Test Sana')) && !(await page.locator('input').evaluateAll((els) => els.some((e) => e.value === 'Test Farhan'))));
await tab('FARHAN'); await tab('SETTINGS');
check('Farhan Settings shows his record', await page.locator('input').evaluateAll((els) => els.some((e) => e.value === 'Test Farhan')));

// 5b. Overlapping requests: Farhan's responses are held back while Sana is selected; they must not paint over Sana's screen.
const readyOf = async (cid) => (await (await fetch(`${BASE}/api/jobs?candidate_id=${cid}&limit=1`, { headers: { Authorization: `Bearer ${KEY}` } })).json()).status_counts.READY;
const fReady = await readyOf('farhan_shaikh'), sReady = await readyOf('sana_ansari');
check('fixture sanity: the two candidates have different READY counts', fReady !== sReady, `${fReady}/${sReady}`);
await page.route('**/api/**', async (route) => {
  if (/candidate_id=farhan_shaikh/.test(route.request().url())) await new Promise((r) => setTimeout(r, 2500));
  await route.continue();
});
await tab('DASHBOARD');
await page.getByRole('button', { name: /^FARHAN/i }).first().click();      // Farhan starts loading (slow)
await page.waitForTimeout(250);
await page.getByRole('button', { name: /^SANA/i }).first().click();        // user switches to Sana before it finishes
await page.waitForTimeout(4500);                                             // Farhan's late responses arrive now
const raceText = await bodyText();
const readyCard = Number((raceText.match(/READY TO APPLY\s+(\d+)/i) || [])[1]);
check('slow Farhan response does not overwrite Sana: heading and READY card are Sana\'s', /Test Sana Workspace/i.test(raceText) && !/Test Farhan Workspace/i.test(raceText) && readyCard === sReady, `${readyCard} vs ${sReady}; ${(raceText.match(/Test \w+ Workspace/i) || [])[0]}`);
await tab('Analytics');
await page.waitForTimeout(3500);
check('slow Farhan analytics does not overwrite Sana: still Sana\'s sentence', /Current inventory for Sana/.test(await bodyText()));
await page.unroute('**/api/**');
await tab('APPLICATIONS'); await page.waitForTimeout(800);
const appsRequests = apiLog.filter((r) => /cohorts\/metrics/.test(r.url)).slice(-1)[0];
check('Applications tab asks for the selected candidate\'s cohort ledger', !!appsRequests && /candidate_id=sana_ansari/.test(appsRequests.url), appsRequests && appsRequests.url);

// 6. Expired/rotated credentials mid-session: the server answers 401 -> window opens, key dropped.
await page.route('**/api/profile**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Operator authentication required."}' }));
await tab('SANA'); await page.waitForTimeout(1200);
check('expired session (401 mid-session): unlock window opens and the stored key is cleared', (await modalOpen()) && (await storedKey()) === null);
await page.unroute('**/api/profile**');
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('[aria-label="Close"]')?.click());

// 7. Rejected credentials after a reload (rotated key stored in the session).
await page.evaluate(() => window.sessionStorage.setItem('admin_session_key', 'rotated-old-key'));
apiLog.length = 0;
await goto();
const staleVerify = apiLog.filter((r) => /auth\/verify/.test(r.url));
check('stale key after reload: ONE refused check (not one per request), window opens, stale key removed', staleVerify.length === 1 && staleVerify[0].status === 403 && (await modalOpen()) && (await storedKey()) === null, JSON.stringify(staleVerify));

// 8. Lock: unlock again, then Log Out / Lock.
if (!(await page.locator('#operator-key-input').count())) await page.locator('button[aria-label*="Operator session"]').first().click();
await unlock(KEY);
check('unlock again works', (await storedKey()) === KEY);
await page.locator('button[aria-label*="Operator session"]').first().click();
await page.waitForSelector('#operator-logout-btn');
await page.click('#operator-logout-btn'); await page.waitForTimeout(800);
check('lock: key removed and window closed', (await storedKey()) === null && !(await modalOpen()));
apiLog.length = 0;
await goto();
check('after lock: reload requests no private data and asks for the key again', !apiLog.some((r) => !/health|version|auth\/verify/.test(r.url)) && (await modalOpen()), JSON.stringify(apiLog.slice(0, 3)));

// 9. Guess limiter through the UI: eight wrong keys, then even the right key is refused.
if (!(await page.locator('#operator-key-input').count())) await page.locator('button[aria-label*="Operator session"]').first().click();
for (let i = 0; i < 9; i++) { await page.fill('#operator-key-input', 'guess-' + i); await page.locator('form button[type="submit"], form button:has-text("Unlock")').first().click(); await page.waitForTimeout(350); }
await unlock(KEY);
check('guess limiter: after repeated wrong keys the correct key is refused with a clear message', /Too many failed attempts/.test(await bodyText()) && (await storedKey()) === null);

check(`no unexpected console errors (${expectedAuthLogs.length} expected 'Failed to fetch' logs from refused requests)`, consoleErrors.length === 0, consoleErrors.join(' | '));
console.log(`\n${mode}: ${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
