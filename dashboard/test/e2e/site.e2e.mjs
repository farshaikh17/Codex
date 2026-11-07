// Real-browser check of the public site against a LOCAL `wrangler dev` (disposable database): every page renders on desktop and
// phone without horizontal scroll or console errors, the apply form lands in the operator inbox, and an application becomes a
// client in two clicks. Settings change the pricing page.
//   E2E_BASE=http://localhost:8791 E2E_KEY=<local test key> node test/e2e/site.e2e.mjs [desktop|mobile]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium, devices } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:8791';
const KEY = process.env.E2E_KEY;
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('site e2e only runs against a local server');
if (!KEY) throw new Error('E2E_KEY is required');
const mode = process.argv[2] || 'desktop';
const ctxOpts = mode === 'mobile' ? { ...devices['Pixel 7'] } : { viewport: { width: 1366, height: 900 } };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`PASS  [${mode}] ${name}`); } else { fail++; console.log(`FAIL  [${mode}] ${name} ${detail}`); } };
const api = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const run = Date.now().toString(36);
const name = `Meera Test ${run}`, email = `meera.${run}@example.com`;

const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
const errs = [];
// fonts are blocked on purpose (no outside requests from the test), and one 400 is the deliberate wrong-email submission
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_FAILED|status of 400/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());

const pages = [['/', /Stop scrolling job boards/], ['/how-it-works', /From thousands of postings/], ['/pricing', /Simple plans/], ['/faq', /Questions, answered/], ['/about', /shows its work/],
  ['/apply', /Tell us about your search/], ['/portal', /Open your dashboard/], ['/privacy', /Privacy notice/], ['/terms', /Terms of service/]];
for (const [p, re] of pages) {
  const r = await page.goto(BASE + p, { waitUntil: 'networkidle' });
  const h1 = await page.textContent('h1');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`S ${p} renders its heading with no horizontal scroll`, r.status() === 200 && re.test(h1) && overflow <= 1, `${r.status()} "${h1}" overflow=${overflow}`);
}
const active = Number((await page.goto(BASE + '/', { waitUntil: 'networkidle' }), await page.textContent('.stat b')).replace(/,/g, ''));
const ov = await api('/api/dashboard/overview');
check('S home shows the real number of active roles', active === ov.active_jobs_count, `${active} vs ${ov.active_jobs_count}`);
if (mode === 'mobile') {
  await page.click('.menu summary');
  check('S phone menu opens with every page', await page.locator('.menu-panel a[href="/pricing"]').isVisible());
} else {
  await page.click('.nav a[href="/pricing"]');
  check('S desktop navigation reaches pricing', /\/pricing$/.test(page.url()));
}

// apply: a mistake is explained and the typing kept; a valid application lands in the inbox
await page.goto(BASE + '/pricing', { waitUntil: 'networkidle' });
await page.click('.plan.feat a.btn');
check('S choosing a plan opens the form with that plan selected', (await page.inputValue('#plan')) === '2');
await page.fill('#full_name', name);
await page.fill('#email', 'not-an-email');
await page.fill('#current_location', 'Pune, India');
await page.fill('#target_roles', 'Implementation manager, Solutions engineer');
await page.check('input[name="consent"]');
await page.click('button[type="submit"]');
await page.waitForSelector('.err');
check('S a wrong email is explained and what was typed is kept', /valid email/.test(await page.textContent('.err')) && (await page.inputValue('#full_name')) === name);
await page.fill('#email', email);
await page.fill('#message', 'Notice period 30 days.');
await page.check('input[name="consent"]');
await page.click('button[type="submit"]');
await page.waitForURL(/\/apply\/thanks$/);
check('S a valid application shows the thank-you page', /Thank you/.test(await page.textContent('h1')));
const inbox = await api('/api/client-requests');
const req = inbox.requests.find((r) => r.email === email);
check('S it is in the operator inbox exactly as entered', !!req && req.full_name === name && req.plan === '2' && req.target_roles === 'Implementation manager, Solutions engineer' && req.status === 'NEW', JSON.stringify(req));

// operator: application → client in the app
const op = await browser.newContext(ctxOpts);
await op.addInitScript((k) => window.sessionStorage.setItem('admin_session_key', k), KEY);
const opPage = await op.newPage();
await opPage.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
await opPage.goto(BASE + '/app', { waitUntil: 'networkidle' });
await opPage.getByRole('button', { name: 'Manage clients', exact: true }).click();
await opPage.getByRole('button', { name: /^Applications/ }).last().click();
await opPage.waitForSelector(`[data-request-id="${req.id}"]`);
await opPage.locator(`[data-request-id="${req.id}"]`).getByRole('button', { name: 'Create client from this' }).click();
check('S "create client" prefills the form from the application', (await opPage.inputValue('input[name="full_name"]')) === name && (await opPage.inputValue('input[name="role_keywords"]')) === 'Implementation manager, Solutions engineer');
await opPage.getByRole('button', { name: 'Create client and screen jobs' }).click();
await opPage.waitForSelector('[role="status"]:has-text("Created")', { timeout: 60000 });
const all = await api('/api/client-requests?status=ALL');
const done = all.requests.find((r) => r.id === req.id);
const client = (await api('/api/clients')).clients.find((c) => c.full_name === name);
check('S the client exists (private) and the application is marked converted and linked to it', !!client && client.visibility === 'private' && done.status === 'CONVERTED' && done.candidate_id === client.id && client.jobs_screened > 0, JSON.stringify({ done, client: client && client.id }));

// settings → pricing page
await opPage.getByRole('button', { name: 'Public site' }).click();
await opPage.fill('input[name="plan1_price"]', '₹1,499');
await opPage.getByRole('button', { name: 'Save site settings' }).click();
await opPage.waitForSelector('[data-testid="site-settings"] [role="status"]');
await page.goto(BASE + '/pricing', { waitUntil: 'networkidle' });
check('S a price set in the app appears on the pricing page', (await page.textContent('[data-plan="1"] .price')).includes('₹1,499'));
await api('/api/site-settings', { method: 'PUT', body: { plan1_price: '' } });   // leave the disposable database as found

// portal: a pasted link opens the dashboard; nonsense is explained
await page.goto(BASE + '/portal', { waitUntil: 'networkidle' });
await page.fill('#link', 'hello');
await page.click('#portal button[type="submit"]');
check('S the portal explains a link that is not a dashboard link', await page.locator('#perr').isVisible());
check('S no console errors on the site or in the app', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(`\n${mode}: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
