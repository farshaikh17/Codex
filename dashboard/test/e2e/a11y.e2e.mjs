// Real-browser accessibility checks against a LOCAL server (seeded database): axe-core (WCAG 2.0/2.1 A and AA) on the public site and every visitor screen at
// desktop and phone width must report no serious or critical violation, and a job must be openable and closable from the keyboard.
//   E2E_BASE=http://localhost:8787 node test/e2e/a11y.e2e.mjs      (no key needed; nothing is written)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = (process.env.E2E_BASE || 'http://localhost:8787').replace(/\/$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('a11y e2e only runs against a local server');
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
const scan = async (page) => {
  await page.evaluate(AXE);
  const r = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations);
  return r.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}(${v.nodes.length}) e.g. ${v.nodes[0].target.join(' ')}`);
};
for (const [mode, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 375, height: 812 }, true]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  for (const path of ['/', '/how-it-works', '/pricing', '/faq', '/about', '/apply', '/portal', '/privacy', '/terms']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const bad = await scan(page); check(`[${mode}] ${path}: no serious or critical accessibility violation`, bad.length === 0, bad.join('; '));
  }
  // the job seeker's page (plan phase 5): Today, the full list, applications, hidden jobs, and a job's panel
  let bad;
  for (const hash of ['#sana/today', '#farhan/today', '#sana/all', '#sana/applications', '#sana/hidden']) {
    await page.goto(BASE + '/app' + hash, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
    bad = await scan(page); check(`[${mode}] /app${hash}`, bad.length === 0, bad.join('; '));
  }
  await page.goto(BASE + '/app#sana/today', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  await page.locator('[data-testid="job-card"] h3 a').first().click(); await page.waitForSelector('[role=dialog]');
  await page.locator('[data-testid="how-scored"] summary').click(); await page.waitForTimeout(300);
  bad = await scan(page); check(`[${mode}] /app job panel (details open)`, bad.length === 0, bad.join('; '));
  await page.goto(BASE + '/app?operator=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  bad = await scan(page); check(`[${mode}] /app?operator=1 dashboard`, bad.length === 0, bad.join('; '));
  for (const name of ['FARHAN', 'SANA', 'Analytics', 'APPLICATIONS']) {
    await page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first().click(); await page.waitForTimeout(1200);
    bad = await scan(page); check(`[${mode}] /app ${name}`, bad.length === 0, bad.join('; '));
  }
  await ctx.close();
}
// keyboard on the job seeker's page: the title link opens the panel, which is a labelled dialog holding focus; Escape closes it and focus returns
{
  const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p2.goto(BASE + '/app#sana/today', { waitUntil: 'networkidle' }); await p2.waitForTimeout(700);
  await p2.locator('[data-testid="job-card"] h3 a').first().focus(); await p2.keyboard.press('Enter'); await p2.waitForTimeout(600);
  const d2 = await p2.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d && { labelled: !!d.getAttribute('aria-label'), focusInside: d.contains(document.activeElement) }; });
  check('seeker: Enter on a job title opens a labelled dialog that holds focus', !!d2 && d2.labelled && d2.focusInside, JSON.stringify(d2));
  await p2.keyboard.press('Escape'); await p2.waitForTimeout(600);
  check('seeker: Escape closes it and focus returns to the card', (await p2.locator('[role=dialog]').count()) === 0 && await p2.evaluate(() => !!document.activeElement?.closest('[data-job-id]')));
  const names = await p2.$$eval('[data-testid="job-card"] button[aria-label], [data-testid="job-card"] a[aria-label]', (els) => els.map((e) => e.getAttribute('aria-label')));
  check('seeker: card buttons have names that tell the cards apart', names.length > 0 && names.every((n, i) => names.indexOf(n) === i), names.slice(0, 4).join(' | '));
  await p2.context().close();
}
// keyboard: open a job from the list with Enter, the dialog is labelled and holds focus, Escape closes it and returns to the row
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE + '/app?operator=1', { waitUntil: 'networkidle' }); await page.getByRole('button', { name: /^FARHAN/i }).first().click(); await page.waitForTimeout(1200);
await page.locator('[data-job-id]').first().focus();
check('a job row can take keyboard focus', await page.evaluate(() => document.activeElement?.hasAttribute('data-job-id')));
await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const dlg = await page.evaluate(() => { const d = document.querySelector('[role=dialog],[aria-modal=true]'); return d && { labelled: !!(d.getAttribute('aria-label') || d.getAttribute('aria-labelledby')), focusInside: d.contains(document.activeElement) }; });
check('Enter opens the job details as a labelled dialog that holds focus', !!dlg && dlg.labelled && dlg.focusInside, JSON.stringify(dlg));
check('no sign-in window appears for a visitor who only reads', (await page.locator('#operator-key-input').count()) === 0);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
check('Escape closes the dialog and focus returns to the list', (await page.locator('[role=dialog],[aria-modal=true]').count()) === 0 && await page.evaluate(() => !!document.activeElement?.closest('[data-job-id]')));
// every job row's action buttons carry the job's title, so a screen-reader user can tell the rows apart (they used to read "Save this job" fifty times over)
{
  const names = await page.$$eval('[data-job-id] button[aria-label]', (els) => els.map((e) => e.getAttribute('aria-label')));
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check('job-row buttons have names that tell the rows apart', names.length > 0 && dupes.length === 0, `${names.length} buttons, duplicates e.g. ${dupes.slice(0, 2).join(' | ')}`);
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
process.exit(failed ? 1 : 0);
