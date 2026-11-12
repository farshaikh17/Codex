// The public site: pages render real figures and escape what they show, the apply form stores exactly one request (validated,
// honeypot, per-source limit), the inbox and settings are operator-only, and settings change what the site shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, loadWorker, makeEnv, ADMIN_KEY } from './harness.mjs';
import { forgetSettings, forgetStats } from '../worker/site.ts';

const worker = await loadWorker();
function world() {
  const { sqlite, d1 } = createDb();
  const run = (sql, ...p) => sqlite.prepare(sql).run(...p);
  run(`INSERT INTO candidates(id,full_name) VALUES ('farhan_shaikh','F'),('sana_ansari','S')`);
  run(`INSERT INTO jobs(id,title,company,source_adapter,is_active,discovered_at,provenance,location_restrictions,workplace_type) VALUES
    ('j1','<script>alert(1)</script> Engineer','Acme & Co','lever',1,?, 'LIVE_PUBLIC','Remote - India','REMOTE'),
    ('j2','Analyst','Beta','lever',1,'2026-01-01T00:00:00Z','LIVE_PUBLIC','Pune','ONSITE'),
    ('j3','Closed role','Gamma','lever',0,?, 'LIVE_PUBLIC','x','REMOTE')`, new Date().toISOString(), new Date().toISOString());
  forgetSettings(); forgetStats();
  return { sqlite, d1, run, env: makeEnv(d1) };
}
async function get(env, path, init = {}) {
  const res = await worker.fetch(new Request('https://site.test' + path, { redirect: 'manual', ...init }), env, { waitUntil() {} });
  return { status: res.status, text: await res.text(), headers: res.headers };
}
const form = (o) => new URLSearchParams(o).toString();
const post = (env, body, ip = '1.2.3.4') => get(env, '/apply', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip } });
const valid = { full_name: 'Asha Rao', email: 'asha@example.com', current_location: 'Pune, India', target_roles: 'Data analyst, BI analyst', work_preference: 'REMOTE_FROM_HOME', years_experience: '3-5', plan: '2', consent: 'yes', message: 'Notice: 30 days' };

test('every site page renders, with real figures and escaped content', async () => {
  const w = world();
  for (const p of ['/', '/how-it-works', '/pricing', '/faq', '/about', '/apply', '/apply/thanks', '/portal', '/privacy', '/terms']) {
    const r = await get(w.env, p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('Content-Type'), /text\/html/, p);
    assert.equal(r.headers.get('X-Frame-Options'), 'DENY', p);
    assert.ok(r.text.includes('Career Job Engine'), p);
  }
  const home = await get(w.env, '/');
  assert.match(home.text, /<b>2<\/b><span>active roles tracked/, 'two active jobs; the closed one is not counted');
  assert.ok(home.text.includes('&lt;script&gt;alert(1)&lt;/script&gt; Engineer') && !home.text.includes('<script>alert(1)'), 'job titles are escaped');
  assert.ok(home.text.includes('Acme &amp; Co'));
  assert.ok(!home.text.includes('Closed role'), 'only active postings are shown');
  const pricing = await get(w.env, '/pricing');
  assert.equal((pricing.text.match(/Ask for a quote/g) || []).length, 3, 'no invented prices');
  const robots = await get(w.env, '/robots.txt');
  assert.equal(robots.status, 200);
  assert.equal(robots.text, 'User-agent: *\nDisallow: /\n', 'owner decision: no crawlers anywhere');
  assert.equal((await get(w.env, '/sitemap.xml')).status, 404, 'no sitemap');
  assert.ok(home.text.includes('<meta name="robots" content="noindex, nofollow">'));
});

test('bots: crawler, AI and link-preview user agents get 403 everywhere but robots.txt; browsers and plain clients are served, never indexed', async () => {
  const w = world();
  const BOTS = ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
    'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'CCBot/2.0 (https://commoncrawl.org/faq/)', 'facebookexternalhit/1.1', 'WhatsApp/2.23.20.0 A', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'TelegramBot (like TwitterBot)', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)', 'Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'Mozilla/5.0 (Linux; Android 5.0) (compatible; Bytespider; spider-feedback@bytedance.com)'];
  for (const ua of BOTS) {
    for (const path of ['/', '/pricing', '/api/jobs?candidate_id=farhan_shaikh', '/api/candidates']) {
      const r = await get(w.env, path, { headers: { 'User-Agent': ua } });
      assert.equal(r.status, 403, `${ua} on ${path}`);
      assert.match(r.headers.get('X-Robots-Tag') || '', /noindex/);
    }
    assert.equal((await get(w.env, '/robots.txt', { headers: { 'User-Agent': ua } })).status, 200, 'robots.txt stays readable, so polite bots learn to stay away');
  }
  const PEOPLE = ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; CUBOT_X30 Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36', 'curl/8.5.0', 'node', ''];
  for (const ua of PEOPLE) {
    for (const path of ['/', '/api/candidates']) {
      const r = await get(w.env, path, { headers: ua ? { 'User-Agent': ua } : {} });
      assert.equal(r.status, 200, `${ua || '(none)'} on ${path}`);
      assert.match(r.headers.get('X-Robots-Tag') || '', /noindex, nofollow/, 'never indexed even when served');
    }
  }
});

test('apply: a valid application is stored once, then redirects; invalid input is refused with the reason and nothing stored', async () => {
  const w = world();
  const ok = await post(w.env, form(valid));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('Location'), 'https://site.test/apply/thanks');
  const rows = w.sqlite.prepare('SELECT full_name, email, target_roles, plan, status, source_hash FROM client_requests').all();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].full_name, rows[0].email, rows[0].target_roles, rows[0].plan, rows[0].status], ['Asha Rao', 'asha@example.com', 'Data analyst, BI analyst', '2', 'NEW']);
  assert.match(rows[0].source_hash, /^[0-9a-f]{64}$/, 'only a one-way fingerprint of the connection');
  assert.ok(!JSON.stringify(rows).includes('1.2.3.4'));
  for (const [bad, why] of [[{ email: 'not-an-email' }, /valid email/], [{ consent: '' }, /privacy notice/], [{ target_roles: '' }, /roles you are looking for/], [{ linkedin_url: 'javascript:alert(1)' }, /https:\/\//]]) {
    const r = await post(w.env, form({ ...valid, ...bad }));
    assert.equal(r.status, 400); assert.match(r.text, why);
    assert.ok(r.text.includes('value="Asha Rao"'), 'what was typed is kept');
  }
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) n FROM client_requests').get().n, 1);
  // escaped when shown back
  const xss = await post(w.env, form({ ...valid, email: 'x', full_name: '"><img src=x onerror=alert(1)>' }));
  assert.ok(!xss.text.includes('<img src=x') && xss.text.includes('&quot;&gt;&lt;img'));
});

test('apply: the honeypot looks successful but stores nothing; one connection is limited to 5 a day', async () => {
  const w = world();
  const bot = await post(w.env, form({ ...valid, company_website: 'http://spam.example' }));
  assert.equal(bot.status, 303);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) n FROM client_requests').get().n, 0);
  for (let i = 0; i < 5; i++) assert.equal((await post(w.env, form({ ...valid, email: `a${i}@example.com` }), '9.9.9.9')).status, 303);
  const sixth = await post(w.env, form(valid), '9.9.9.9');
  assert.equal(sixth.status, 429);
  assert.equal((await post(w.env, form(valid), '8.8.8.8')).status, 303, 'another connection is not affected');
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) n FROM client_requests').get().n, 6);
});

test('the inbox and site settings are operator-only; settings change the site; invalid settings are refused', async () => {
  const w = world();
  await post(w.env, form(valid));
  const call = (method, path, body, key = ADMIN_KEY) => worker.fetch(new Request('https://site.test' + path, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), w.env, { waitUntil() {} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  assert.equal((await call('GET', '/api/client-requests', null, null)).status, 401, 'applicants’ details are never public');
  assert.equal((await call('PUT', '/api/site-settings', { brand_name: 'X' }, null)).status, 401);
  const inbox = await call('GET', '/api/client-requests');
  assert.equal(inbox.json.requests.length, 1);
  assert.equal(inbox.json.requests[0].email, 'asha@example.com');
  assert.equal(inbox.json.counts.NEW, 1);
  const id = inbox.json.requests[0].id;
  assert.equal((await call('PUT', `/api/client-requests/${id}`, { status: 'CONTACTED' })).status, 200);
  assert.equal((await call('PUT', `/api/client-requests/${id}`, { status: 'BOGUS' })).status, 400);
  assert.equal((await call('PUT', `/api/client-requests/${id}`, { status: 'CONVERTED', candidate_id: 'nobody' })).status, 400);
  assert.equal((await call('PUT', `/api/client-requests/${id}`, { status: 'CONVERTED', candidate_id: 'farhan_shaikh' })).status, 200);
  assert.equal((await call('GET', '/api/client-requests')).json.requests.length, 0, 'converted requests leave the open inbox');
  assert.equal((await call('GET', '/api/client-requests?status=ALL')).json.requests[0].candidate_id, 'farhan_shaikh');

  const saved = await call('PUT', '/api/site-settings', { brand_name: 'HireLane', plan2_price: '₹2,999', contact_email: 'hello@hirelane.example' });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.settings.brand_name, 'HireLane');
  const pricing = await get(w.env, '/pricing');
  assert.ok(pricing.text.includes('HireLane') && pricing.text.includes('₹2,999'));
  assert.equal((pricing.text.match(/Ask for a quote/g) || []).length, 2);
  assert.ok((await get(w.env, '/privacy')).text.includes('hello@hirelane.example'));
  assert.equal((await call('PUT', '/api/site-settings', { contact_email: 'nope' })).status, 400);
  assert.equal((await call('PUT', '/api/site-settings', { not_a_setting: 'x' })).status, 400);
  assert.equal((await call('PUT', '/api/site-settings', { brand_name: '<b>X</b>' })).status, 200);
  assert.ok((await get(w.env, '/')).text.includes('&lt;b&gt;X&lt;/b&gt;'), 'settings are escaped when shown');
});

test('old share links that land on the site root are forwarded to the dashboard app', async () => {
  const w = world();
  const home = await get(w.env, '/');
  assert.ok(home.text.includes("if(/[#&]view=v1_/.test(location.hash))location.replace('/app'+location.hash);"));
});

test('apply limits: one bucket per IPv6 /64, a global daily cap, and a body cap that holds without Content-Length', async () => {
  const w = world();
  for (let i = 0; i < 5; i++) assert.equal((await post(w.env, form({ ...valid, email: `v${i}@example.com` }), `2001:db8:1:2:${i}::1`)).status, 303);
  assert.equal((await post(w.env, form(valid), '2001:db8:1:2:ffff::9')).status, 429, 'same /64: same bucket');
  assert.equal((await post(w.env, form(valid), '2001:db8:1:3::1')).status, 303, 'another /64');
  const today = new Date().toISOString().slice(0, 10);
  const insert = w.sqlite.prepare(`INSERT INTO client_requests(id, full_name, email, current_location, target_roles, created_at) VALUES (?, 'x', 'x@example.com', 'x', 'x', ?)`);
  for (let i = w.sqlite.prepare('SELECT COUNT(*) n FROM client_requests').get().n; i < 200; i++) insert.run('fill' + i, today + ' 00:00:01');
  assert.equal((await post(w.env, form(valid), '7.7.7.7')).status, 429, 'global daily cap');
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) n FROM client_requests').get().n, 200);
  // a 30 KB body sent without Content-Length (chunked) is refused without being parsed
  const big = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(form({ ...valid, message: 'x'.repeat(30000) }))); c.close(); } });
  const r = await worker.fetch(new Request('https://site.test/apply', { method: 'POST', body: big, duplex: 'half', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), w.env, { waitUntil() {} });
  assert.equal(r.status, 413);
});

test('the stored fingerprint is keyed (not a plain hash of the address) and erased after its day', async () => {
  const w = world();
  w.run(`INSERT INTO client_requests(id, full_name, email, current_location, target_roles, source_hash, created_at) VALUES ('old', 'x', 'x@example.com', 'x', 'x', 'abc', '2020-01-01 10:00:00')`);
  await post(w.env, form(valid), '5.6.7.8');
  const { createHash } = await import('node:crypto');
  const today = new Date().toISOString().slice(0, 10);
  const row = w.sqlite.prepare(`SELECT source_hash FROM client_requests WHERE id <> 'old'`).get();
  assert.notEqual(row.source_hash, createHash('sha256').update(`5.6.7.8|${today}|apply`).digest('hex'));
  assert.match(row.source_hash, /^[0-9a-f]{64}$/);
  assert.equal(w.sqlite.prepare(`SELECT source_hash FROM client_requests WHERE id = 'old'`).get().source_hash, null, 'yesterday’s fingerprints are erased');
});

test('site figures come from one stored row; a database failure hides them instead of showing zeros', async () => {
  const w = world();
  assert.match((await get(w.env, '/')).text, /<b>2<\/b><span>active roles tracked/);
  const stored = JSON.parse(w.sqlite.prepare('SELECT body FROM site_stats WHERE id = 1').get().body);
  assert.equal(stored.active, 2);
  // later views read the stored row (no scan of jobs)
  forgetStats();
  const real = w.d1.prepare.bind(w.d1); const seen = [];
  w.d1.prepare = (sql) => { seen.push(sql); return real(sql); };
  await get(w.env, '/');
  assert.ok(!seen.some((q) => /FROM jobs/.test(q)), seen.join(' | '));
  // failure: no figures at all
  forgetStats();
  w.d1.prepare = (sql) => { if (/site_stats/.test(sql)) throw new Error('D1 down'); return real(sql); };
  const down = await get(w.env, '/');
  assert.equal(down.status, 200);
  assert.ok(!/active roles tracked/.test(down.text) && !/<b>0<\/b>/.test(down.text));
  w.d1.prepare = real;
});

test('inbox: delete erases an application, a null candidate_id clears the link, and inbox changes keep the public cache', async () => {
  const w = world();
  w.env.RESPONSE_CACHE = 'on'; w.env.GIT_COMMIT = 't';
  await post(w.env, form(valid));
  const call = (method, path, body) => worker.fetch(new Request('https://site.test' + path, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), w.env, { waitUntil() {} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));
  const id = (await call('GET', '/api/client-requests')).json.requests[0].id;
  await call('PUT', `/api/client-requests/${id}`, { status: 'CONVERTED', candidate_id: 'farhan_shaikh' });
  await call('PUT', `/api/client-requests/${id}`, { status: 'CONTACTED', candidate_id: null });
  assert.equal(w.sqlite.prepare('SELECT candidate_id FROM client_requests WHERE id = ?').get(id).candidate_id, null);
  const pub = () => worker.fetch(new Request('https://site.test/api/candidates'), w.env, { waitUntil() {} });
  await pub();
  assert.equal((await pub()).headers.get('X-Cache'), 'HIT');
  await call('PUT', `/api/client-requests/${id}`, { status: 'DECLINED' });
  await call('PUT', '/api/site-settings', { tagline: 'New line' });
  assert.equal((await pub()).headers.get('X-Cache'), 'HIT', 'inbox and settings changes do not empty the dashboard cache');
  assert.equal((await call('DELETE', `/api/client-requests/${id}`)).status, 200);
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) n FROM client_requests').get().n, 0);
  assert.equal((await call('DELETE', `/api/client-requests/${id}`)).status, 404);
});

test('an unknown address under /apply/ is an HTML 404 page, not JSON', async () => {
  const w = world();
  const r = await get(w.env, '/apply/whatever');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.match(r.text, /Page not found/);
});

test('the cron refreshes the site figures only when they are older than an hour', async () => {
  const { refreshSiteStats } = await import('../worker/site.ts');
  const w = world();
  assert.equal(await refreshSiteStats(w.d1), true, 'missing: computed');
  assert.equal(await refreshSiteStats(w.d1), false, 'fresh: left alone');
  assert.equal(await refreshSiteStats(w.d1, Date.now() + 2 * 3600_000), true, 'stale: recomputed');
});
