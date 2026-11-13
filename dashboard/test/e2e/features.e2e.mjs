// Real-browser checks for the 2026-11-10 additions, against a LOCAL `wrangler dev` with the general seed (test/seed-sql.mjs) in a disposable database:
//   * "Find people at this company" links in the job panel (LinkedIn searches that open in a new tab, nothing is sent)
//   * the skill list in the job panel (what the posting names against the profile's listed skills)
//   * follow-up dates and the overdue flag in the application tracker (operator only; a visitor sees no date input and makes no request)
//   * the workspace "Applied" card (same definition as the Dashboard card, tracker size underneath)
//   * the "What arrived each day" card
// Setup (once, before running): every seeded job gets a description naming skills, and Farhan's profile lists two of them:
//   DELETE FROM response_cache;  (the public list is cached for a short time)
//   UPDATE jobs SET description = 'We need Salesforce, SQL, Python and Zapier experience for workflow automation.';
//   UPDATE candidates SET primary_skills = '["Salesforce","Python"]' WHERE id = 'farhan_shaikh';
//   UPDATE candidate_qualifications SET qualification_reason = '[GITHUB_COLLECTOR] Unassessed public ATS posting from acme; review pending.'
//     WHERE candidate_id = 'farhan_shaikh' AND job_id IN ('job_001','job_002','job_008');   (three rows the screen "has not judged yet")
//   E2E_BASE=http://localhost:8787 E2E_KEY=<local test key> node test/e2e/features.e2e.mjs [desktop|mobile]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:8787';
const KEY = process.env.E2E_KEY;
const OPEN = (await (await fetch(BASE + '/api/version')).json().catch(() => ({}))).open_tracker === true;   // open tracker (owner decision 2026-11-12)
const mode = process.argv[2] || 'desktop';
if (!KEY) throw new Error('E2E_KEY is required');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('features e2e only runs against a local server');

let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 300)}`); };
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
const page = await ctx.newPage();
const consoleErrors = []; const followUpRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message.slice(0, 160)));
let lastJobs = null;   // the job list answer the page itself received (its request carries the page's own filters)
page.on('response', async (r) => { if (/\/api\/jobs\?/.test(r.url()) && r.url().includes('farhan_shaikh') && r.status() === 200) { try { lastJobs = await r.json(); } catch { /* not JSON */ } } });
page.on('request', (r) => { if (r.url().includes('/api/follow-ups') || /\/follow-up(\?|$)/.test(r.url())) followUpRequests.push(r.method() + ' ' + new URL(r.url()).pathname); });
const body = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const goto = async () => { await page.goto(BASE + '/app?operator=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
const tab = async (name) => { await page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first().click(); await page.waitForTimeout(1500); };
const isoDay = (offset) => { const d = new Date(Date.now() + offset * 86400000); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };   // the viewer's own calendar day

// ===== Part A: a visitor (no key) =================================================================================
// The expected numbers come from the API, so records added by earlier suites on the same database do not matter.
const apiApps = await (await fetch(BASE + '/api/applications?candidate_id=farhan_shaikh')).json();
const appList = Array.isArray(apiApps) ? apiApps : (apiApps.applications || apiApps.jobs || []);
const TRACKED = appList.length;
const APPLIED = appList.filter((j) => ['APPLIED', 'SUBMITTED', 'INTERVIEWING', 'OFFER'].includes(String(j.application?.status || j.app_status || ''))).length;
await goto();
await page.locator('button[aria-label*="Analytics"]').first().click(); await page.waitForTimeout(1800);
check('F1 Analytics shows the "What arrived each day" card', (await body()).includes('What arrived each day'));
await page.goto(BASE + '/app?operator=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await tab('FARHAN');
const text = await body();
check('F2 Farhan workspace: the card reads Applied with the tracker size underneath', new RegExp(`APPLIED\\s*${APPLIED}\\s*${TRACKED} in tracker`, 'i').test(text), text.match(/APPLIED[^]{0,60}/i)?.[0]);
const counts = lastJobs || {};
const shownReview = Number((await page.locator('[data-testid="to-review-count"]').innerText()).replace(/\D/g, ''));
check('F2b To review shows screened jobs only, with the unscreened ones named apart', counts.unscreened_count > 0 && shownReview === counts.status_counts.NEEDS_REVIEW - counts.unscreened_count && text.includes(`+ ${counts.unscreened_count} not screened yet`), `shown ${shownReview}, api ${JSON.stringify([counts.status_counts?.NEEDS_REVIEW, counts.unscreened_count])}`);
const row = page.locator('[data-job-id]').first();
check('F3 job rows are listed', (await row.count()) > 0);
await row.click(); await page.waitForTimeout(1500);
const people = page.locator('[data-testid="people-links"]');
check('F4 the job panel has "Find people at <company>"', (await people.count()) === 1 && /Find people at Company/i.test(await people.innerText()), await people.count());
const links = await people.locator('a').evaluateAll((as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
check('F5 three LinkedIn search links', links.length === 3 && links.every((l) => /^https:\/\/www\.linkedin\.com\/search\/results\/(people|companies)\//.test(l.href)), JSON.stringify(links));
check('F6 every link opens in a new tab without giving the page access', links.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel)), JSON.stringify(links));
check('F7 the links name the employer, not a candidate detail', links.every((l) => /Company(%20|\+)/.test(l.href) && !/Test(%20|\+)Farhan/i.test(l.href)), JSON.stringify(links));
const gaps = page.locator('[data-testid="skill-gaps"]');
const gapText = (await gaps.count()) ? await gaps.innerText() : '';
check('F8 the skill list shows what the profile already has', /salesforce/i.test(gapText.split('Not on the profile')[0]) && /python/i.test(gapText.split('Not on the profile')[0]), gapText);
check('F9 the skill list shows what is not on the profile', /Not on the profile/.test(gapText) && /sql/i.test(gapText.split('Not on the profile')[1] || '') && /zapier/i.test(gapText.split('Not on the profile')[1] || ''), gapText);
check('F10 the wording is a note, not a verdict', /worth a look/i.test(gapText) && !/reject|disqualif|not qualified/i.test(gapText), gapText);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[aria-label="Close"]')?.click());
await page.waitForTimeout(500);
await tab('APPLICATIONS');
if (OPEN) check('F11 open tracker: a visitor gets the follow-up dates', followUpRequests.length > 0, 'no follow-up request');
else check('F11 visitor tracker: no follow-up date input and no follow-up request', (await page.locator('input[type="date"]').count()) === 0 && followUpRequests.length === 0, followUpRequests.join());

// ===== Part B: operator ===========================================================================================
await goto();
await page.locator('button[aria-label*="Viewing only"]').first().click();
await page.waitForSelector('#operator-key-input');
await page.fill('#operator-key-input', KEY); await page.getByRole('button', { name: /unlock/i }).last().click(); await page.waitForTimeout(1800);
await tab('FARHAN'); await tab('APPLICATIONS');
const inputs = page.locator('input[type="date"]');
check('F12 operator tracker: every record has a follow-up date input', (await inputs.count()) === TRACKED, await inputs.count());
check('F13 no overdue banner before any date is set', !/follow-ups? (is|are) overdue/i.test(await body()));
const first = inputs.first();
const label = await first.getAttribute('aria-label');
await first.fill(isoDay(-3)); await page.waitForTimeout(1200);
check('F14 a past date shows "Overdue by 3 days" and the banner', /Overdue by 3 days/.test(await body()) && /1 follow-up is overdue/i.test(await body()), (await body()).match(/overdue[^]{0,60}/i)?.[0]);
const second = inputs.nth(1);
await second.fill(isoDay(0)); await page.waitForTimeout(1000);
check('F15 today shows "Follow up today"', /Follow up today/.test(await body()));
await inputs.nth(2).fill(isoDay(2)); await page.waitForTimeout(1000);
check('F16 a near date shows "In 2 days" and is not counted as overdue', /In 2 days/.test(await body()) && /1 follow-up is overdue/i.test(await body()));
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
await tab('APPLICATIONS');
check('F17 the dates are still there after a reload', (await page.locator(`input[aria-label="${label}"]`).inputValue()) === isoDay(-3));
await page.locator(`input[aria-label="${label}"]`).fill(''); await page.waitForTimeout(1000);
check('F18 clearing a date removes its flag and the banner', !/follow-ups? (is|are) overdue/i.test(await body()) && !/Overdue by 3 days/.test(await body()));
// ===== Part C: fixes from the 10 Nov code review (operator signed in) ==========================================================
const selectedTab = async (re) => /shadow-sm/.test((await page.getByRole('button', { name: re }).first().getAttribute('class')) || '');
await tab('FARHAN');
await page.getByText('Stretch Matches').first().click(); await page.waitForTimeout(1800);
check('G1 the Stretch card opens the Stretch list', await selectedTab(/^Stretch \(/));
await tab('FARHAN');
const readyCard = page.locator('div[role="button"]').filter({ hasText: 'Ready to Apply' }).first();
await readyCard.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1800);
check('G2 a summary card works from the keyboard (Enter on the Ready card opens the Ready list)', await selectedTab(/^READY to Apply/));
await page.getByRole('button', { name: /^Stretch \(/ }).first().click(); await page.waitForTimeout(1500);
const jobRow = page.locator('[data-job-id]').first();
if (await jobRow.count()) {
  await page.getByRole('button', { name: /Inspect Explanations/ }).first().click(); await page.waitForTimeout(1500);   // the Ready cards open a job from the title or this button
  const notes = page.locator('input[aria-label="Private candidate notes"]');
  await notes.fill('draft-note-kept');
  await page.locator('button[title^="Thumbs Up"]').first().click(); await page.waitForTimeout(2000);
  check('G3 notes typed in the job panel survive a refresh of the screen behind it', (await notes.inputValue()) === 'draft-note-kept', await notes.inputValue());
  check('G3b the thumbs choice is shown as selected', /bg-emerald-100/.test((await page.locator('button[title^="Thumbs Up"]').first().getAttribute('class')) || ''));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  await tab('FARHAN'); await page.getByText('Stretch Matches').first().click(); await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /^Stretch \(/ }).first().click(); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Inspect Explanations/ }).first().click(); await page.waitForTimeout(2000);
  check('G3c the stored thumbs choice is still there after a reload', /bg-emerald-100/.test((await page.locator('button[title^="Thumbs Up"]').first().getAttribute('class')) || ''));
  await page.locator('button[title^="Thumbs Up"]').first().click(); await page.waitForTimeout(1200);   // clear it again
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  check('G4 opening and closing a job does not reset the list (the Stretch tab is still selected)', await selectedTab(/^Stretch \(/));
} else { check('G3 notes survive a refresh (no stretch row in this data)', false, 'no row'); check('G4 list not reset', false, 'no row'); }
await tab('FARHAN');
await page.route('**/api/applications', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced"}' }) : route.continue()));
const saveBtn = page.locator('button[aria-label^="Save this job"]').first();
if (await saveBtn.count()) {
  await saveBtn.click(); await page.waitForTimeout(1500);
  check('G5 a failed Save shows a message and keeps the list on screen', /Unable to save this job/.test(await body()) && (await page.locator('[data-job-id]').count()) > 0 && !/The dashboard could not load/.test(await body()), (await body()).slice(0, 200));
} else check('G5 a failed Save keeps the list', false, 'no Save button');
await page.unroute('**/api/applications');
await tab('APPLICATIONS');
await page.locator('button[title="View complete application audit timeline"]').first().click(); await page.waitForTimeout(1000);
check('G6 the history window is a dialog with a labelled close button', (await page.locator('[role="dialog"][aria-label="Application stage history"]').count()) === 1 && (await page.locator('button[aria-label="Close history"]').count()) === 1);
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
check('G7 Escape closes the history window', (await page.locator('[role="dialog"][aria-label="Application stage history"]').count()) === 0);
check('F19 no unexpected console errors', consoleErrors.filter((e) => !/429/.test(e) && !/status of 500/.test(e)).length === 0, consoleErrors.join(' | '));
const status = await page.evaluate(async (k) => (await fetch('/api/follow-ups?candidate_id=sana_ansari', { headers: { Authorization: 'Bearer ' + k } })).status, KEY);
const anon = await page.evaluate(async () => (await fetch('/api/follow-ups?candidate_id=farhan_shaikh')).status);
check(OPEN ? 'F20 open tracker: the follow-up list answers with or without a key' : 'F20 the follow-up list is protected: 401 without a key, 200 with it', (OPEN ? anon === 200 : anon === 401) && status === 200, `${anon}/${status}`);
const bad = await page.evaluate(async (k) => (await fetch('/api/applications/x/follow-up?candidate_id=farhan_shaikh', { method: 'PUT', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ follow_up_at: 'not-a-date' }) })).status, KEY);
check('F21 a malformed date is refused', bad >= 400 && bad < 500, bad);
await browser.close();
console.log(`${mode}: ${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
