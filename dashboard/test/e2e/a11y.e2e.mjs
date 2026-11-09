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
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  let bad = await scan(page); check(`[${mode}] /app dashboard`, bad.length === 0, bad.join('; '));
  for (const name of ['FARHAN', 'SANA', 'Analytics', 'APPLICATIONS']) {
    await page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first().click(); await page.waitForTimeout(1200);
    bad = await scan(page); check(`[${mode}] /app ${name}`, bad.length === 0, bad.join('; '));
  }
  await ctx.close();
}
// keyboard: open a job from the list with Enter, the dialog is labelled and holds focus, Escape closes it and returns to the row
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE + '/app', { waitUntil: 'networkidle' }); await page.getByRole('button', { name: /^FARHAN/i }).first().click(); await page.waitForTimeout(1200);
await page.locator('[data-job-id]').first().focus();
check('a job row can take keyboard focus', await page.evaluate(() => document.activeElement?.hasAttribute('data-job-id')));
await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const dlg = await page.evaluate(() => { const d = document.querySelector('[role=dialog],[aria-modal=true]'); return d && { labelled: !!(d.getAttribute('aria-label') || d.getAttribute('aria-labelledby')), focusInside: d.contains(document.activeElement) }; });
check('Enter opens the job details as a labelled dialog that holds focus', !!dlg && dlg.labelled && dlg.focusInside, JSON.stringify(dlg));
check('no sign-in window appears for a visitor who only reads', (await page.locator('#operator-key-input').count()) === 0);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
check('Escape closes the dialog and focus returns to the list', (await page.locator('[role=dialog],[aria-modal=true]').count()) === 0 && await page.evaluate(() => !!document.activeElement?.closest('[data-job-id]')));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
process.exit(failed ? 1 : 0);
