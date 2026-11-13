// Real-browser regression for the India Remote filters and the READY dashboard. Runs against a LOCAL `wrangler dev` with a disposable database seeded by
// test/e2e/listing-seed.mjs, signed in as the operator (the operator screens need the key to view since the 13 Nov gap fix; nothing is written).
// Every check names the jobs that must be on screen, not just a control or a counter.
//   E2E_BASE=http://localhost:8787 E2E_KEY=<local test key> node test/e2e/listing.e2e.mjs [desktop|mobile]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:8787';
const mode = process.argv[2] || 'desktop';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('listing e2e only runs against a local server');
const KEY = process.env.E2E_KEY;
if (!KEY) throw new Error('E2E_KEY is required (the operator screens need the key to view)');

let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${ok ? '' : '  -> ' + detail}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
await ctx.addInitScript((k) => window.sessionStorage.setItem('admin_session_key', k), KEY);
const page = await ctx.newPage();
const errors = [], bad = [], writes = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 140)));
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(r.status() + ' ' + new URL(r.url()).pathname); });
page.on('request', (r) => { if (r.url().includes('/api/') && r.method() !== 'GET' && new URL(r.url()).pathname !== '/api/auth/verify') writes.push(r.method() + ' ' + new URL(r.url()).pathname); });

const settle = () => page.waitForTimeout(1200);
const ids = () => page.$$eval('[data-job-id]', (els) => els.map((e) => e.getAttribute('data-job-id')));
const text = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const tab = async (name) => { await page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first().click(); await settle(); };
const waitForIds = async (expected, label) => {   // poll: the server answers asynchronously
  let got = [];
  for (let i = 0; i < 20; i++) { got = await ids(); if (same(got, expected)) break; await page.waitForTimeout(300); }
  check(label, same(got, expected), `expected [${expected}] got [${got}]`);
};
const select = async (labelText, value) => { await page.locator('select').filter({ has: page.locator('option', { hasText: labelText }) }).first().selectOption(value); await settle(); };
const fitSelect = (v) => page.locator('select').nth(0).selectOption(v).then(settle);

const openIndiaRemote = async (btn) => { await tab(btn); await page.getByText('See these jobs').first().click(); await settle(); };
const openReady = async (btn) => { await tab(btn); await page.getByText('View READY').first().click(); await settle(); };
const reset = async () => { await page.getByRole('button', { name: /^Reset$/ }).first().click(); await settle(); };

await page.goto(BASE + '/app?operator=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);

// ===== India Remote, Farhan ======================================================================================================
await openIndiaRemote('FARHAN');
const first25 = ['ir1', 'ir2', 'ir3', 'ir5', 'ir6', 'ir7', 'ir8', 'ir9', 'ir10', ...Array.from({ length: 16 }, (_, i) => 'fx' + String(i).padStart(2, '0'))];
await waitForIds(first25, 'IR1 Farhan default list: the first 25 eligible jobs that are not applied, best score first');
let t = await text();
check('IR2 the range line and the pill counts describe the same 26 jobs', /Showing 1–25 of 26 vacancies/.test(t) && /All eligible 26/i.test(t) && /Ready 4 /i.test(t) && /Stretch 1 /i.test(t) && /Needs review 19 /i.test(t) && /Not fit 2 /i.test(t), t.slice(t.search(/all eligible/i), t.search(/all eligible/i) + 200));
check('IR3 the wording says posting text, not employer confirmation', /not confirmation from the employer/i.test(t) && !/Confirmed India Remote|India Verified|Remote: Confirmed|verified with affirmative evidence/i.test(t));
check('IR4 no invented role family: "Gardener" shows Unclassified, not a default family', (await page.locator('[data-job-id="ir9"] [data-role-family]').innerText()).trim() === 'Unclassified');

await page.getByRole('button', { name: /^Next$/ }).click(); await settle();
await waitForIds(['fx16'], 'IR5 page 2 is the 26th job');
check('IR6 page 2 range text', /Showing 26–26 of 26/.test(await text()));
await page.getByRole('button', { name: /^Previous$/ }).click(); await settle();
await waitForIds(first25, 'IR7 back to page 1');

await page.getByRole('button', { name: /^Ready/ }).first().click(); await settle();
await waitForIds(['ir1', 'ir2', 'ir9', 'ir10'], 'IR8 READY pill: exactly the READY jobs (READY_HIGH included)');
await page.getByRole('button', { name: /^Stretch/ }).first().click(); await settle();
await waitForIds(['ir3'], 'IR9 STRETCH pill: the one STRETCH job that is not applied');
await page.getByRole('button', { name: /^Needs review/ }).first().click(); await settle();
check('IR10 NEEDS REVIEW pill: 19 jobs, 25 per page does not apply', (await ids()).length === 19 && !(await ids()).some((x) => /^ir[1-4]$/.test(x)) , (await ids()).join());
await page.getByRole('button', { name: /^Not fit/ }).first().click(); await settle();
await waitForIds(['ir7', 'ir8'], 'IR11 NOT FIT pill: INELIGIBLE and HOLD jobs');
await reset();
await waitForIds(first25, 'IR12 Reset restores the default list');

await select('Solutions engineering', 'SOLUTIONS');
await waitForIds(['ir2'], 'IR13 role family Solutions: exactly the Solutions job');
await select('Unclassified', 'UNCLASSIFIED');
await waitForIds(['ir7', 'ir9'], 'IR14 role family Unclassified: exactly the jobs no rule matches');
await select('Unclassified', 'ALL');
await select('Salary published', 'PUBLISHED');
await waitForIds(['ir1', 'ir3', 'ir5', 'ir8', 'ir10'], 'IR15 pay Salary published: exactly the jobs with a published salary (the applied one is hidden)');
await select('Salary not published', 'UNPUBLISHED');
check('IR16 pay Salary not published: no published job among them', !(await ids()).some((x) => ['ir1', 'ir3', 'ir5', 'ir8', 'ir10'].includes(x)) && (await ids()).includes('ir2'), (await ids()).join());
await select('Salary not published', 'ALL');
check('IR17 the removed pay-floor option is gone', !/pay floor|60K/i.test(await text()));

await page.getByRole('button', { name: /^Ready/ }).first().click(); await settle();
await select('Salary published', 'PUBLISHED');
await waitForIds(['ir1', 'ir10'], 'IR18 combined: READY + salary published');
await select('Implementation', 'IMPLEMENTATION');
await waitForIds(['ir1'], 'IR19 combined: READY + salary published + Implementation family');
await reset();
await select('Technical account', 'TECHNICAL_ACCOUNT');
await waitForIds(['ir8'], 'IR20a role family Technical account: exactly that job');
await page.getByRole('button', { name: /^Stretch/ }).first().click(); await settle();
check('IR20b an empty combination (Technical account + Stretch) shows the empty state, not stale jobs', (await ids()).length === 0 && /No vacancies match these filters/.test(await text()));
await reset();

await page.getByPlaceholder(/Search title/).fill('analyst'); await page.waitForTimeout(900);
await waitForIds(['ir3', 'ir6'], 'IR21 server-side search "analyst": exactly the two Analyst titles');
await page.getByPlaceholder(/Search title/).fill(''); await page.waitForTimeout(900);
await page.getByLabel(/Hide jobs already applied to/).uncheck(); await settle();
check('IR22 showing applied jobs adds exactly the applied ones', (await ids()).includes('ir4') && (await ids()).includes('ir13') && /of 28 vacancies/.test(await text()), (await ids()).join());
await page.getByLabel(/Hide jobs already applied to/).check(); await settle();

// ===== India Remote, Sana ========================================================================================================
await openIndiaRemote('SANA');
await waitForIds(['s1', 's2', 'ir1'], 'IR23 Sana default list: her own eligible jobs, not Farhan\'s');
await page.getByRole('button', { name: /^Ready/ }).first().click(); await settle();
await waitForIds(['s1'], 'IR24 Sana READY: exactly her READY job');
await reset();
await select('Power', 'POWER_ENERGY');
await waitForIds(['s2'], 'IR25 Sana role family Power / energy: exactly her power job (families come from her own data)');
check('IR26 Sana is not offered Farhan\'s families', !/Revenue systems|CRM \/ go-to-market/i.test(await page.locator('select').nth(1).innerText()));
await reset();
await page.getByRole('button', { name: /^Not fit/ }).first().click(); await settle();
await waitForIds(['ir1'], 'IR27 Sana NOT FIT: the same job is not fit for her but READY for Farhan');

// ===== READY dashboard ===========================================================================================================
const tabButton = (re) => page.getByRole('button', { name: re }).first();
await openReady('SANA');
await waitForIds(['s1', 'rd1', 'rd2', 'rd3', 'rd5', 'rdc'], 'RD1 Sana READY tab: every READY job, including those below the first 100 scores (applied one hidden, saved one shown)');
t = await text();
check('RD2 tab counts equal the lists', /READY to Apply \(6\)/.test(t) && /Stretch \(3\)/.test(t) && /Needs Review \(131\)/.test(t) && /All Apply-Worthy \(9\)/.test(t), t.slice(t.indexOf('READY to Apply'), t.indexOf('READY to Apply') + 200));
check('RD3 a READY job with no stored score is explained, not hidden or changed', /no preliminary score is stored/.test(t) && /has not been changed to match the status/.test(t));
check('RD4 no old "evidence quote" or "strict gate" claims', !/STRICT QUALIFICATION GATE|Evidence:/.test(t));
await tabButton(/^Stretch/).click(); await settle();
await waitForIds(['s2', 'st1', 'st2'], 'RD5 Sana STRETCH tab: exactly the three STRETCH jobs');
await tabButton(/^All Apply-Worthy/).click(); await settle();
await waitForIds(['s1', 's2', 'st1', 'rd1', 'rd2', 'rd3', 'rd5', 'st2', 'rdc'], 'RD6 Apply-worthy: READY and STRETCH together, best score first');
await tabButton(/^Needs Review/).click(); await settle();
let page1 = await ids();
check('RD7 Needs Review page 1: 25 NEEDS_REVIEW jobs, none of them READY or STRETCH', page1.length === 25 && page1.every((x) => /^hi\d{3}$/.test(x)), page1.join());
check('RD8 range text names the whole set', /Showing 1–25 of 131 · page 1 of 6/.test(await text()));
const seen = new Set(page1);
for (let p = 2; p <= 6; p++) { await page.getByRole('button', { name: /^Next$/ }).click(); await settle(); const cur = await ids(); cur.forEach((x) => seen.add(x)); if (p === 6) check('RD9 the last page holds the remaining 6', cur.length === 6, cur.join()); }
check('RD10 paging reached all 131 review jobs once (130 analysts + the Solar Developer)', seen.size === 131 && [...seen].filter((x) => /^hi\d{3}$/.test(x)).length === 130 && seen.has('s4'), String(seen.size));
await tabButton(/^Needs Review/).click(); await settle();
await page.getByRole('button', { name: /^Location unverified$/ }).click(); await settle();
check('RD11 review sub-filter Location unverified: 66 jobs, all of them UNKNOWN-location review jobs', /of 66 · page 1 of 3/.test(await text()), (await text()).replace(/\s+/g, ' ').match(/Showing[^·]*·[^A-Za-z]*/)?.[0] ?? 'no range text');
await page.getByRole('button', { name: /^Salary not published$/ }).click(); await settle();
check('RD12 review sub-filter Salary not published: the 131 unpublished review jobs', /of 131 · page 1 of 6/.test(await text()));
await page.getByRole('button', { name: /^Location stated, review for fit$/ }).click(); await settle();
check('RD13 review sub-filter Location stated: nothing matches here, so the empty state shows (no stale jobs)', (await ids()).length === 0 && /No postings in this category/.test(await text()));
await page.getByRole('button', { name: /^All Review Cases$/ }).click(); await settle();
await page.getByPlaceholder(/Search title/).fill('Analyst Review 77'); await page.waitForTimeout(900);
await waitForIds(['hi077'], 'RD14 server-side search finds a job that is not on the first page');
check('RD14b a narrowed list says so while the tab numbers keep counting the whole queue', /1 job matches your search; the tab numbers above count the whole queue/.test(await text()) && /Needs Review \(131\)/.test(await text()));
await page.getByPlaceholder(/Search title/).fill(''); await page.waitForTimeout(900);
await tabButton(/^Unverified location, score 60\+/).click(); await settle();
check('RD15 the Unverified location, score 60+ tab: 65 jobs with unknown location and score of 60 or more (a different set from the review sub-filter of 66)', /Unverified location, score 60\+ \(65\)/.test(await text()) && /of 65 · page 1 of 3/.test(await text()));
await tabButton(/^All open/).click(); await settle();
check('RD16 All open: 140 jobs, dismissed and applied are not among them', /All open \(140\)/.test(await text()) && !(await ids()).some((x) => ['dis1', 'rd4', 's3'].includes(x)));

await openReady('FARHAN');
await waitForIds(['ir12', 'ir1', 'ir2', 'ir9', 'ir10'], 'RD17 Farhan READY tab: his five READY jobs (READY_HIGH included, applied and closed ones hidden)');
await tabButton(/^Stretch/).click(); await settle();
await waitForIds(['ir3'], 'RD18 Farhan STRETCH tab');

check('RD19 no console errors, no failed request, no write attempted', errors.length === 0 && bad.length === 0 && writes.length === 0, JSON.stringify({ errors: errors.slice(0, 3), bad: bad.slice(0, 3), writes }));
console.log(`\n${mode}: ${total - failed}/${total} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
