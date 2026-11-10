// Real-browser fault injection against a LOCAL server: the app must never end on a blank page. Every API answer is replaced in turn by an error,
// a dropped connection, a captive-portal page, or a 200 in the wrong shape; the page must still show text, and a visitor must be able to recover.
//   E2E_BASE=http://localhost:8787 node test/e2e/faults.e2e.mjs [desktop|mobile]      (no key needed; nothing is written)
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = (process.env.E2E_BASE || 'http://localhost:8787').replace(/\/$/, '');
const mode = process.argv[2] || 'mobile';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('fault e2e only runs against a local server');
const viewport = mode === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const json = (status, body) => (r) => r.fulfill({ status, contentType: 'application/json', body });
const SCENARIOS = {
  'API answers 503 (outage or read cap)': json(503, '{"error":"The database is temporarily unavailable."}'),
  'API answers 500': json(500, '{"error":"Internal error."}'),
  'connection dropped': (r) => r.abort('failed'),
  'captive-portal HTML with status 200': (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>sign in to the wifi</html>' }),
  'API answers {} (unexpected shape)': json(200, '{}'),
  'API answers [] (unexpected shape)': json(200, '[]'),
  'API answers null': json(200, 'null'),
};
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${ok ? '' : '  -> ' + detail}`); };
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
for (const [name, handler] of Object.entries(SCENARIOS)) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route('**/api/**', handler);
  await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const text = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').trim();
  check(`${name}: the page is not blank`, text.length > 40, `body text "${text.slice(0, 40)}"`);
  check(`${name}: the page says what happened or offers a reload`, /could not|unable|try again|unexpected|reload|unavailable/i.test(text), text.slice(0, 120));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
process.exit(failed ? 1 : 0);
