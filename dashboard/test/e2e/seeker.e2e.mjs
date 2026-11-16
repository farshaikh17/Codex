// The job seeker's page (plan phase 5, U5-U14), in a real browser, against a LOCAL `wrangler dev` with the open tracker on and the general seed
// (test/seed-sql.mjs) in a disposable database. Setup once, after seeding (postings need a link to open):
//   UPDATE jobs SET source_url = 'https://example.invalid/posting/' || id; DELETE FROM response_cache;
//   E2E_BASE=http://localhost:8787 node test/e2e/seeker.e2e.mjs [desktop|mobile]
// The journey: open the site, Sana, Today, open a posting, "Yes, I applied", see it in her applications, Not for me, Undo, then reload and land on
// the same screen. Plus: sizes (14 px text, 44 px targets, 12 px gaps), the first job near the top, counts equal /api/today, one load per screen,
// Back closes the panel, nothing operator-only on screen, and a stale write is refused with a message.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:8787';
const mode = process.argv[2] || 'desktop';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('seeker e2e only runs against a local server');
const OPEN = (await (await fetch(BASE + '/api/version')).json()).open_tracker === true;
if (!OPEN) throw new Error('run with OPEN_TRACKER on (wrangler.toml sets it)');

let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${ok ? '' : '  -> ' + String(detail).slice(0, 300)}`); };
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const ctx = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
await ctx.route('https://example.invalid/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Posting</title><h1>The employer posting</h1>' }));
const page = await ctx.newPage();
const errors = []; const apiCalls = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 160)));
page.on('request', (r) => { if (r.url().includes('/api/')) { const u = new URL(r.url()); apiCalls.push(r.method() + ' ' + u.pathname + u.search); } });
const body = async () => (await page.innerText('body')).replace(/\s+/g, ' ');
const api = async (p) => (await fetch(BASE + '/api' + p)).json();
// the toast of the NEXT action: an earlier one is dismissed first
const clearToast = async () => { const x = page.locator('[data-testid="toast"] button[aria-label="Dismiss message"]'); if (await x.count()) await x.click(); };
const toast = async () => { try { await page.waitForSelector('[data-testid="toast"]', { timeout: 6000 }); return (await page.innerText('[data-testid="toast"]')).replace(/\s+/g, ' '); } catch { return ''; } };
const OPERATOR = /Unlock|Operator|Override|Audit Trail|Export CSV|Analytics|Tracker open|operator key|Weekly Cohort|Min Match Threshold|Reverify/i;
const started = Date.now();

// ---- first visit: the two names, then Sana's Today ----------------------------------------------------------------------------------
await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
check('S1 a first visit asks whose jobs, in plain words', /Whose jobs\?/.test(await body()) && (await page.getByRole('button', { name: 'Sana', exact: true }).count()) > 0);
apiCalls.length = 0;
await page.getByRole('button', { name: 'Sana', exact: true }).last().click();
await page.waitForSelector('[data-testid="section-best"]');
await page.waitForTimeout(800);
check('S2 tapping a name opens that person\'s Today screen (#sana/today)', (await page.evaluate(() => location.hash)) === '#sana/today');
const loads = apiCalls.filter((c) => c.startsWith('GET'));
const dup = loads.filter((c, i) => loads.indexOf(c) !== i);
check('S3 load once: each request is made once, and only for the chosen person', dup.length === 0 && loads.some((c) => c.includes('/api/today?candidate_id=sana_ansari')) && !loads.some((c) => c.includes('farhan_shaikh')), loads.join(' | '));
const today = await api('/today?candidate_id=sana_ansari');
const t = await body();
check('S4 the counts on screen are the ones /api/today computes (one definition per number)',
  t.includes(`Best matches (${today.counts.best})`) && t.includes(`Worth a try (${today.counts.worth_a_try})`) && t.includes(`Show everything else (${today.counts.everything - today.counts.best - today.counts.worth_a_try})`)
  && t.includes(`${today.counts.more_good} more good match`) && (await page.innerText('[data-testid="my-applications"]')).includes(`(${today.counts.applications.total})`), t.slice(0, 300));
check('S5 the status line has the date, new since the last visit, more good matches and the update time', /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}\b/.test(await page.innerText('[data-testid="status-line"]')) && /new since your last visit/.test(t) && /(Updated (\d{1,2} [A-Z][a-z]{2}, )?\d{2}:\d{2}|Not updated today)/.test(t), await page.innerText('[data-testid="status-line"]'));
const firstCard = await page.locator('[data-testid="job-card"]').first().boundingBox();
check('S6 the first job starts within 200 px of the top', !!firstCard && firstCard.y <= 200, JSON.stringify(firstCard));
// Job titles are data, not screen chrome ("Field Operator - Turbine" is a real posting): read the page without the job cards and the panel's job text.
const chrome = async (sel) => (await page.evaluate((s) => { const b = document.querySelector(s).cloneNode(true); b.querySelectorAll('[data-testid="job-card"], [data-job-id], [role=dialog] h2, [data-testid="panel-why"]').forEach((e) => e.remove()); return b.textContent || ''; }, sel)).replace(/\s+/g, ' ');
const chromeT = await chrome('body');
check('S7 nothing operator-only is on the page', !OPERATOR.test(chromeT), (chromeT.match(OPERATOR) || [])[0]);
check('S8 no sideways scrolling', (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
const sizes = await page.evaluate(() => {
  const small = [], tiny = [], gaps = [];
  for (const el of document.querySelectorAll('header *, main *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const r = el.getBoundingClientRect();
    if (own && r.width && parseFloat(getComputedStyle(el).fontSize) < 14) small.push(el.textContent.trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll('main button, main a[href], header button, main select, main input')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height < 44 && !el.closest('[role=group][aria-label="Whose jobs"]')) tiny.push((el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) + ' ' + Math.round(r.height));
  }
  for (const row of document.querySelectorAll('[data-testid="job-card"] .flex-wrap')) {
    const bs = [...row.children].map((c) => c.getBoundingClientRect());
    for (let i = 1; i < bs.length; i++) if (Math.abs(bs[i].top - bs[i - 1].top) < 2 && bs[i].left - bs[i - 1].right < 11.5) gaps.push(Math.round(bs[i].left - bs[i - 1].right));
  }
  return { small: [...new Set(small)].slice(0, 5), tiny: [...new Set(tiny)].slice(0, 5), gaps: gaps.slice(0, 5) };
});
check('S9 text is at least 14 px', sizes.small.length === 0, sizes.small.join(' | '));
check('S10 tap targets are at least 44 px tall, with 12 px between card buttons', sizes.tiny.length === 0 && sizes.gaps.length === 0, JSON.stringify(sizes));
const sw = await page.locator('[role=group][aria-label="Whose jobs"] button').evaluateAll((bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-pressed'), Math.round(b.getBoundingClientRect().height)]));
check('S11 the Farhan | Sana switch shows who is chosen (aria-pressed) and its buttons are 40 px or more inside a 44 px bar', JSON.stringify(sw.map((x) => x.slice(0, 2))) === JSON.stringify([['Farhan', 'false'], ['Sana', 'true']]) && sw.every((x) => x[2] >= 40), JSON.stringify(sw));
const why = await page.locator('[data-testid="why-line"]').first().innerText().catch(() => '');
check('S12 every card says in one line why the job is here', why.length > 5 && why.includes('·'), why);

// ---- open a posting, come back, "Yes, I applied" ----------------------------------------------------------------------------------
const card = page.locator('[data-testid="section-best"] [data-testid="job-card"], [data-testid="section-new"] [data-testid="job-card"]').first();
const jobId = await card.getAttribute('data-job-id');
const title = (await card.locator('h3').innerText()).trim();
const [popup] = await Promise.all([ctx.waitForEvent('page'), card.getByRole('link', { name: /^Open posting/ }).click()]);
check('S13 Open posting opens the employer posting in a new tab', /posting/.test(popup.url()), popup.url());
await popup.close();
await page.bringToFront();
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForSelector('[role=dialog][aria-label="Did you apply?"]', { timeout: 5000 }).catch(() => {});
check('S14 coming back asks "Did you apply?" with the three answers', (await page.locator('[role=dialog][aria-label="Did you apply?"]').count()) === 1
  && /Yes, I applied/.test(await body()) && /Not yet \(keep saved\)/.test(await body()));
await clearToast();
await page.getByRole('button', { name: 'Yes, I applied' }).click();
const tst = await toast();
check('S15 one tap records it, and the page says so', /you applied/i.test(tst), tst);
await page.waitForTimeout(1200);
check('S16 the applied job leaves Today', (await page.locator(`[data-testid="job-card"][data-job-id="${jobId}"]`).count()) === 0);
await page.locator('[data-testid="my-applications"]').click();
await page.waitForSelector('[data-testid="group-waiting"]');
const waiting = await page.innerText('[data-testid="group-waiting"]');
check('S17 it is in "Sana\'s applications" under "Applied, waiting"', /Sana's applications/.test(await body()) && waiting.includes(title), waiting.slice(0, 200));
check('S18 the whole thing took under a minute', Date.now() - started < 60000, `${Math.round((Date.now() - started) / 1000)} s`);
check('S19 the applications view has three groups and no cohort ledger', (await page.locator('[data-testid^="group-"]').count()) === 3 && !/Cohort/i.test(await body()));

// ---- a stale write is refused, an empty note does not wipe one ----------------------------------------------------------------------
await page.evaluate(async ([id]) => fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate_id: 'sana_ansari', job_id: id, status: 'INTERVIEWING' }) }), [jobId]);
await clearToast();
await page.locator(`[data-job-id="${jobId}"] select`).selectOption('SCREENING');
const stale = await toast();
check('S20 a change made from an old copy is refused: "This changed elsewhere; reload"', /changed elsewhere; reload/i.test(stale), stale);

// ---- Not for me, Undo -----------------------------------------------------------------------------------------------------------
await page.getByRole('button', { name: /^Today$/ }).click();
await page.waitForSelector('[data-testid="job-card"]');
const victim = page.locator('[data-testid="job-card"]').first();
const vid = await victim.getAttribute('data-job-id');
await clearToast();
await victim.getByRole('button', { name: /^Not for me/ }).click();
const hid = await toast();
await page.waitForTimeout(500);
check('S21 Not for me hides the job at once and offers Undo', /Hidden/.test(hid) && /Undo/.test(hid) && (await page.locator(`[data-testid="job-card"][data-job-id="${vid}"]`).count()) === 0, hid);
await page.locator('[data-testid="toast"]').getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(1500);
check('S22 Undo puts it back', (await page.locator(`[data-job-id="${vid}"]`).count()) === 1 || (await api('/jobs?candidate_id=sana_ansari&hidden=true')).jobs.every((j) => j.id !== vid));

// ---- tenth-man fixes: a double tap is one save; the panel's stage saves when chosen; "more good matches" opens its list ---------------
{
  await page.goto(BASE + '/app#sana/today', { waitUntil: 'networkidle' }); await page.waitForSelector('[data-testid="job-card"]');
  const c2 = page.locator('[data-testid="job-card"]').filter({ has: page.getByRole('button', { name: /^Save: / }) }).first();
  const id2 = await c2.getAttribute('data-job-id');
  await clearToast();
  const save = c2.getByRole('button', { name: /^Save: / });
  await save.dblclick();
  await page.waitForTimeout(1500);
  const t2 = await page.locator('[data-testid="toast"]').innerText().catch(() => '');
  const rec = (await (await fetch(`${BASE}/api/applications?candidate_id=sana_ansari`)).json()).applications.find((j) => j.id === id2);
  check('S32 a double tap on Save saves once and never says "changed elsewhere"', !/changed elsewhere/i.test(t2) && rec?.application?.status === 'SAVED', t2 + ' / ' + rec?.application?.status);
  const c3 = page.locator('[data-testid="job-card"]').filter({ has: page.getByRole('button', { name: /^Save: / }) }).first();
  const id3 = await c3.getAttribute('data-job-id');
  await c3.locator('h3 a').click(); await page.waitForSelector('[role=dialog]');
  const sel = page.locator('[role=dialog] select[aria-label="Where are you with this job?"]');
  const first = await sel.locator('option').first().innerText();
  await sel.selectOption('APPLIED'); await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(500);
  const one = await (await fetch(`${BASE}/api/jobs/${encodeURIComponent(id3)}?candidate_id=sana_ansari`)).json();
  check('S33 in the panel, an unsaved job says "Not saved yet", and choosing "I applied" saves it without another button', first === 'Not saved yet' && one.application?.status === 'APPLIED', first + ' / ' + JSON.stringify(one.application));
  await page.locator('[data-testid="more-good"]').click(); await page.waitForTimeout(1200);
  const good = (await api('/today?candidate_id=sana_ansari')).counts.more_good;
  check('S34 "N more good matches" opens that list, with the same number', (await page.evaluate(() => location.hash)) === '#sana/good' && (await body()).includes(`More good matches (${good})`), (await body()).slice(0, 160));
  await page.goto(BASE + '/app#sana/today', { waitUntil: 'networkidle' }); await page.waitForSelector('[data-testid="job-card"]');
}

// ---- the panel: the address follows it, Back closes it, reload keeps it ------------------------------------------------------------
await page.locator('[data-testid="job-card"] h3 a').first().click();
await page.waitForSelector('[role=dialog]');
const panelHash = await page.evaluate(() => location.hash);
check('S23 a job has its own address (#sana/job/<id>)', /^#sana\/job\/.+/.test(panelHash), panelHash);
const panelText = (await page.innerText('[role=dialog]')).replace(/\s+/g, ' ');
check('S24 the panel speaks plainly: Open the posting, your progress, and the details folded under "How this was scored"',
  /Open the posting|No link available/.test(panelText) && /Where are you with this job\?/.test(panelText) && /How this was scored/.test(panelText)
  && (await page.locator('[data-testid="how-scored"]').evaluate((d) => !d.open)) && !OPERATOR.test(await chrome('[role=dialog]')) && !/Explainable|ADAPTER|Pipeline/i.test(panelText), panelText.slice(0, 200));
check('S25 the Good match button has aria-pressed', (await page.locator('[role=dialog] button[aria-pressed]').count()) >= 1);
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
check('S26 a reload lands on the same job', (await page.evaluate(() => location.hash)) === panelHash && (await page.locator('[role=dialog]').count()) === 1);
await page.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(500);
await page.locator('[data-testid="job-card"] h3 a').first().click(); await page.waitForSelector('[role=dialog]');
await page.goBack(); await page.waitForTimeout(600);
check('S27 Back closes the panel and stays on Today', (await page.locator('[role=dialog]').count()) === 0 && (await page.evaluate(() => location.hash)) === '#sana/today');
await page.goto(BASE + '/app#sana/applications', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
check('S28 a bookmark of the applications opens them', /Sana's applications/.test(await body()));

// ---- remembered on the device; the operator screens are behind ?operator=1 -----------------------------------------------------------
const again = await ctx.newPage();
await again.goto(BASE + '/app', { waitUntil: 'networkidle' }); await again.waitForTimeout(800);
check('S29 the chosen person is remembered on this device (/app opens Sana\'s Today)', (await again.evaluate(() => location.hash)) === '#sana/today');
await again.goto(BASE + '/app?operator=1', { waitUntil: 'networkidle' }); await again.waitForTimeout(800);
check('S30 ?operator=1 opens the operator sign-in, not the operator screens, without the key', (await again.locator('[data-testid="operator-gate"] #operator-key-input').count()) === 1 && (await again.locator('[data-job-id]').count()) === 0);
await again.close();
check('S31 no console errors', errors.filter((e) => !/409|Conflict/.test(e)).length === 0, errors.join(' | '));
await browser.close();
console.log(`${mode}: ${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
