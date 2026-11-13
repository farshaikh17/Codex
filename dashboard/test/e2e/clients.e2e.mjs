// Real-browser regression for resold clients against a LOCAL `wrangler dev` with a disposable database (listing-seed + migrations).
// The operator onboards a client through the UI, a visitor cannot see it, a share-link viewer sees exactly that client, the CSV
// export matches the list, and revoking the link closes it. Each check names the client and the jobs expected.
//   E2E_BASE=http://localhost:8791 E2E_KEY=<local test key> node test/e2e/clients.e2e.mjs [desktop|mobile]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium, devices } = require('playwright');

const BASE = process.env.E2E_BASE || 'http://localhost:8791';
const KEY = process.env.E2E_KEY;
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('clients e2e only runs against a local server');
if (!KEY) throw new Error('E2E_KEY is required');
const mode = process.argv[2] || 'desktop';
const ctxOpts = mode === 'mobile' ? { ...devices['Pixel 7'] } : { viewport: { width: 1366, height: 900 } };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const suffix = mode === 'mobile' ? 'm' : 'd';
const run = suffix + Date.now().toString(36);   // a fresh client per run, so the suite can be repeated on one database
const NAME = `Priya Analyst ${run}`, ID = `priya_analyst_${run}`;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`PASS  [${mode}] ${name}`); } else { fail++; console.log(`FAIL  [${mode}] ${name} ${detail}`); } };
const api = async (path, { key = KEY, view, method = 'GET', body } = {}) => {
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (view) headers['X-View-Token'] = view;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const sorted = (a) => [...a].sort();
const watch = (page, label) => {
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errs.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
  return errs;
};
const tableIds = (page) => page.$$eval('[data-job-id]', (rows) => rows.map((r) => r.getAttribute('data-job-id')));

// ---- operator onboards a client in the UI -------------------------------------------------------------------------------
const opCtx = await browser.newContext({ ...ctxOpts, acceptDownloads: true });
await opCtx.addInitScript((k) => window.sessionStorage.setItem('admin_session_key', k), KEY);
const op = await opCtx.newPage();
const opErrs = watch(op, 'operator');
await op.goto(BASE + '/app?operator=1');
await op.getByRole('button', { name: 'Manage clients' }).click();
await op.waitForSelector('[data-testid="clients-view"]');
await op.fill('input[name="full_name"]', NAME);
await op.fill('input[name="display_title"]', 'Implementation & Delivery');
await op.fill('input[name="role_keywords"]', 'implementation, delivery');
await op.fill('input[name="avoid_keywords"]', 'director');
await op.fill('input[name="primary_skills"]', 'CRM, Onboarding');
await op.getByRole('button', { name: 'Create client and screen jobs' }).click();
await op.waitForSelector('[role="status"]:has-text("Created")', { timeout: 30000 });
const notice = await op.textContent('[role="status"]:has-text("Created")');
const ov = await api('/api/dashboard/overview');
const active = ov.json.active_jobs_count;
check('C1 the client is created and every active job is screened for it', notice.includes(`(${ID})`) && notice.includes(`screened ${active} active jobs`), notice);
const rec = (await api('/api/clients')).json.clients.find((c) => c.id === ID);
check('C2 private by default, with the keywords given', rec?.visibility === 'private' && rec.search_profile.role_keywords.join() === 'implementation,delivery', JSON.stringify(rec));
check('C3 nothing was marked READY or STRETCH automatically', rec?.apply_worthy === 0, String(rec?.apply_worthy));

// the client's workspace in the operator view lists exactly what the API returns for it
await op.selectOption('[data-testid="client-select"]', ID);
await op.waitForSelector('[data-job-id]', { timeout: 15000 });
const apiFirst = (await api(`/api/jobs?candidate_id=${ID}&limit=50&exclude_applied=true&exclude_dismissed=true&sort_by=score_desc`)).json.jobs.map((j) => j.id);
const opRows = await tableIds(op);
check('C4 the workspace table shows the client’s jobs (same identities as the API)', opRows.length > 0 && JSON.stringify(sorted(opRows)) === JSON.stringify(sorted(apiFirst)), `${opRows} vs ${apiFirst}`);
const top = (await api(`/api/jobs?candidate_id=${ID}&limit=3&sort_by=score_desc`)).json.jobs;
check('C5 its own keywords rank its jobs: the top jobs are implementation/delivery titles, the avoided one is not on top',
  top.every((j) => /implementation|delivery/i.test(j.title) && !/director/i.test(j.title)), top.map((j) => j.title).join(' | '));

// share link
await op.getByRole('button', { name: 'Manage clients' }).click();
await op.locator(`tr[data-client-id="${ID}"]`).getByRole('button', { name: 'New share link' }).click();
await op.waitForSelector('[data-testid="new-share-link"] input');
const shareUrl = await op.inputValue('[data-testid="new-share-link"] input');
const token = /#view=(v1_[0-9a-f]{48})&candidate=/.exec(shareUrl)?.[1];
check('C6 a share link is shown once, carrying the token after #', !!token && shareUrl.startsWith(BASE + '/app#view='), shareUrl);

// ---- an anonymous visitor cannot see the client ------------------------------------------------------------------------
const anonCtx = await browser.newContext(ctxOpts);
const anon = await anonCtx.newPage();
const anonErrs = watch(anon, 'visitor');
await anon.goto(BASE + '/app?operator=1');
await anon.waitForSelector('[data-testid="operator-gate"]', { timeout: 15000 });
check('C7 a visitor gets only the operator sign-in: no tab, no dashboard card, no client',
  (await anon.locator(`[data-testid="client-select"] option[value="${ID}"]`).count()) === 0 && (await anon.locator(`[data-candidate-id="${ID}"]`).count()) === 0
  && !(await anon.innerText('body')).includes(NAME));
check('C8 and the API refuses it without naming it', (await api(`/api/jobs?candidate_id=${ID}`, { key: null })).status === 400
  && !(await api(`/api/jobs?candidate_id=nobody_x`, { key: null })).text.includes(ID));

// ---- the share-link viewer sees exactly that client ----------------------------------------------------------------------
const viewCtx = await browser.newContext({ ...ctxOpts, acceptDownloads: true });
const viewer = await viewCtx.newPage();
const viewErrs = watch(viewer, 'viewer');
await viewer.goto(shareUrl);
await viewer.waitForSelector('[data-testid="share-banner"]', { timeout: 15000 });
await viewer.waitForSelector('[data-job-id]', { timeout: 15000 });
const banner = await viewer.textContent('[data-testid="share-banner"]');
check('C9 the viewer lands in the client’s workspace with a read-only banner naming the client', banner.includes(NAME) && /read-only/i.test(banner), banner);
check('C9b the viewer\u2019s menu offers only their own dashboard: no other candidates, no client picker, no operator pages',
  (await viewer.getByRole('button', { name: 'My jobs' }).count()) === 1 && (await viewer.getByRole('button', { name: 'Farhan', exact: true }).count()) === 0
  && (await viewer.getByRole('button', { name: 'Dashboard', exact: true }).count()) === 0 && (await viewer.locator('[data-testid="client-select"]').count()) === 0
  && (await viewer.getByRole('button', { name: 'Manage clients', exact: true }).count()) === 0);
check('C10 the token is removed from the address bar', !viewer.url().includes('view=') && !viewer.url().includes(token), viewer.url());
const viewRows = await tableIds(viewer);
const viewApi = (await api(`/api/jobs?candidate_id=${ID}&limit=50&exclude_applied=true&exclude_dismissed=true&sort_by=score_desc`, { key: null, view: token })).json.jobs.map((j) => j.id);
check('C11 the viewer’s table shows the same jobs as the API answers for that link', viewRows.length > 0 && JSON.stringify(sorted(viewRows)) === JSON.stringify(sorted(viewApi)), `${viewRows} vs ${viewApi}`);
const [dl] = await Promise.all([viewer.waitForEvent('download'), viewer.click('[data-testid="export-csv"]')]);
const csv = fs.readFileSync(await dl.path(), 'utf8');
const csvIds = csv.trim().split('\r\n').slice(1).map((l) => l.split(',')[0]);
const all = (await api(`/api/jobs?candidate_id=${ID}&limit=100&sort_by=score_desc`, { key: null, view: token })).json;
const firstPage = all.jobs.map((j) => j.id);
check('C12 the viewer can export the list; the CSV holds every active job of the client (count = API total, first 100 by score identical)',
  csv.startsWith('job_id,title,') && csvIds.length === all.total && new Set(csvIds).size === csvIds.length
  && JSON.stringify(csvIds.slice(0, 100)) === JSON.stringify(firstPage) && dl.suggestedFilename().startsWith(ID), `${csvIds.length} vs ${all.total}`);
const saveButtons = await viewer.locator('button[title*="Save"], button:has-text("Save")').count();
const writeAttempt = await api(`/api/clients/${ID}/backfill`, { key: null, view: token, method: 'POST' });
check('C13 a share link cannot change anything', writeAttempt.status === 401, String(writeAttempt.status));
void saveButtons;

const errsBeforeRevoke = [...opErrs, ...anonErrs, ...viewErrs];
// ---- revoke ------------------------------------------------------------------------------------------------------------
await op.locator(`tr[data-client-id="${ID}"]`).getByRole('button', { name: 'Links' }).click();
await op.locator('[data-link-id]').first().getByRole('button', { name: 'Revoke' }).click();
await op.waitForSelector('[data-link-id] >> text=revoked', { timeout: 10000 });
await viewer.reload();
await viewer.waitForSelector('[data-testid="share-link-invalid"]', { timeout: 15000 });
check('C14 after revoking, the same browser is told the link is no longer valid and sees no dashboard and none of the client’s jobs (the operator screens need the key)',
  (await tableIds(viewer)).length === 0 && (await viewer.locator('[data-testid="share-banner"]').count()) === 0 && (await viewer.locator('text=Open Sana').count()) === 0
  && (await api(`/api/jobs?candidate_id=${ID}`, { key: null, view: token })).status === 400);

// ---- making it public shows it to everyone, private hides it again -------------------------------------------------------
await op.locator(`tr[data-client-id="${ID}"]`).getByRole('button', { name: 'Make public' }).click();
await op.waitForSelector(`tr[data-client-id="${ID}"] >> text=public`, { timeout: 10000 });
// visitors no longer see the operator screens (gap fix, 13 Nov), so "public" is checked where a visitor reads it: the public API
const anonList = async () => (await api('/api/candidates', { key: null })).text;
check('C15 made public: the public API lists it and answers for its jobs', (await anonList()).includes(ID) && (await api(`/api/jobs?candidate_id=${ID}`, { key: null })).status === 200);
await op.locator(`tr[data-client-id="${ID}"]`).getByRole('button', { name: 'Make private' }).click();
await op.waitForSelector(`tr[data-client-id="${ID}"] >> text=private`, { timeout: 10000 });
check('C16 made private again: gone for visitors at once', !(await anonList()).includes(ID) && (await api(`/api/jobs?candidate_id=${ID}`, { key: null })).status === 400);

check('C17 no console errors or page errors (operator, visitor, viewer before revoking)', errsBeforeRevoke.length === 0, errsBeforeRevoke.join(' | '));
await browser.close();
console.log(`\n${mode}: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
