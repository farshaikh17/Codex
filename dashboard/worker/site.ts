// The public site: server-rendered pages in the same visual language as the Goes Local sites (cream, navy, coral, Fraunces + Inter).
// Every figure on a page is read from the database; nothing is invented. Brand, contact and plan prices are operator settings.
type DB = D1Database;

// ---- Settings -----------------------------------------------------------------------------------------------------------------
export const SETTING_DEFAULTS: Record<string, string> = {
  brand_name: 'Career Job Engine',
  brand_sub: 'Job search engine',
  tagline: 'Your job search, screened every day.',
  contact_email: '',
  announcement: 'Fresh roles screened every day · Private client dashboards',
  plan1_name: 'Dashboard',
  plan1_price: '',
  plan1_period: 'per month',
  plan1_blurb: 'Your own private job dashboard, screened every day.',
  plan1_features: 'Daily screening of new postings against your profile\nEligibility evidence quoted from each posting\nReady, stretch and review lists\nApplication tracker, kept by your advisor\nCSV export any time\nPrivate access link',
  plan2_name: 'Managed search',
  plan2_price: '',
  plan2_period: 'per month',
  plan2_blurb: 'We review your matches with you and keep your pipeline moving.',
  plan2_features: 'Everything in Dashboard\nWeekly human review of your matches\nRoles promoted to Ready with written reasons\nApplications tracked for you\nSearch profile tuned as you go',
  plan3_name: 'Concierge',
  plan3_price: '',
  plan3_period: 'per month',
  plan3_blurb: 'Hands-on support for a focused, time-boxed search.',
  plan3_features: 'Everything in Managed search\nTwice-weekly review of your matches\nNotes for each application\nDirect contact with your advisor',
};
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);
const SETTING_MAX: Record<string, number> = { plan1_features: 800, plan2_features: 800, plan3_features: 800, announcement: 160, tagline: 120 };
export function cleanSetting(key: string, value: unknown): string | null {
  if (!SETTING_KEYS.includes(key) || typeof value !== 'string') return null;
  const max = SETTING_MAX[key] || 80;
  const v = value.replace(/\r/g, '').trim().slice(0, max);
  if (key === 'contact_email' && v && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(v)) return null;
  return v;
}
let settingsMemo: { at: number; v: Record<string, string> } | null = null;
export function forgetSettings() { settingsMemo = null; }
export async function loadSettings(db: DB): Promise<Record<string, string>> {
  if (settingsMemo && Date.now() - settingsMemo.at < 60_000) return settingsMemo.v;
  const v = { ...SETTING_DEFAULTS };
  try { const { results } = await db.prepare('SELECT key, value FROM site_settings').all<any>(); for (const r of results || []) if (SETTING_KEYS.includes(r.key)) v[r.key] = r.value; } catch {}
  settingsMemo = { at: Date.now(), v };
  return v;
}

// ---- Live figures ------------------------------------------------------------------------------------------------------------------
// Computed by the cron at most hourly (refreshSiteStats) into one row; a page view reads that row (memoised 60 s per isolate). If the
// figures cannot be read, the pages leave them out rather than showing zeros.
export type Stats = { active: number; employers: number; week: number; sources: number; latest: any[]; computed_at?: string };
let statsMemo: { at: number; v: Stats } | null = null;
export function forgetStats() { statsMemo = null; }
export const STATS_MAX_AGE_MS = 3600_000;
export async function computeStats(db: DB): Promise<Stats> {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const a = await db.prepare(`SELECT COUNT(*) AS active, COUNT(DISTINCT company) AS employers, SUM(CASE WHEN discovered_at >= ? THEN 1 ELSE 0 END) AS week FROM jobs WHERE is_active = 1`).bind(weekAgo).first<any>();
  const sources = (await db.prepare(`SELECT COUNT(*) AS n FROM cloud_sources WHERE enabled = 1`).first<any>())?.n || 0;
  const latest = (await db.prepare(`SELECT title, company, location_restrictions AS location, workplace_type, discovered_at FROM jobs
    WHERE is_active = 1 AND provenance = 'LIVE_PUBLIC' ORDER BY discovered_at DESC LIMIT 6`).all<any>()).results || [];
  return { active: a?.active || 0, employers: a?.employers || 0, week: a?.week || 0, sources, latest, computed_at: new Date().toISOString() };
}
/** Cron: recompute when the stored figures are older than an hour (or missing). Returns true when it wrote. */
export async function refreshSiteStats(db: DB, now = Date.now()): Promise<boolean> {
  const row = await db.prepare('SELECT computed_at FROM site_stats WHERE id = 1').first<any>();
  if (row && now - Date.parse(row.computed_at) < STATS_MAX_AGE_MS) return false;
  const st = await computeStats(db);
  await db.prepare(`INSERT INTO site_stats(id, body, computed_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, computed_at = excluded.computed_at`)
    .bind(JSON.stringify(st), st.computed_at!).run();
  statsMemo = null;
  return true;
}
export async function siteStats(db: DB): Promise<Stats | null> {
  if (statsMemo && Date.now() - statsMemo.at < 60_000) return statsMemo.v;
  try {
    const row = await db.prepare('SELECT body FROM site_stats WHERE id = 1').first<any>();
    // Not computed yet (first visit after a deploy): compute once and store it, so later views read the stored row.
    if (!row) { await refreshSiteStats(db); return siteStats(db); }
    const v = JSON.parse(row.body) as Stats;
    statsMemo = { at: Date.now(), v };
    return v;
  } catch { return null; }   // not memoised: the next view tries again
}

// ---- HTML helpers -------------------------------------------------------------------------------------------------------------------
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (n: number) => Number(n || 0).toLocaleString('en-US');
const ago = (iso: string) => { const h = Math.max(0, (Date.now() - Date.parse(iso)) / 3600_000); return !isFinite(h) ? '' : h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`; };

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
:root{--cream:#FBF5EA;--card:#FFFFFF;--sand:#F1E7D6;--navy:#12263F;--ink:#1B2A3A;--body:#42556B;--muted:#5F7186;--faint:#A4B2C0;
--coral:#E4572E;--coral-d:#C6461F;--teal:#2E8B8B;--teal-s:#E4F1F1;--gold:#C8901F;--line:#E8DCC8;--line-s:#F0E8DA;
--r:14px;--r-lg:20px;--pill:999px;--sh:0 1px 2px rgba(18,38,63,.04),0 8px 24px rgba(18,38,63,.06);--sh-lg:0 2px 4px rgba(18,38,63,.05),0 18px 44px rgba(18,38,63,.10);--wrap:1240px}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--cream);color:var(--ink);font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;font-family:'Fraunces',Georgia,serif;font-weight:600;line-height:1.15;letter-spacing:-.01em;color:var(--navy)}
h1{font-size:52px}h2{font-size:34px}h3{font-size:20px}
p{margin:0 0 12px}a{color:#B23F1A;text-decoration:none}a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--coral);outline-offset:3px;border-radius:4px}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 24px}
.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;background:var(--navy);color:#fff;padding:10px 18px;z-index:999;border-radius:8px}
.topbar{background:linear-gradient(90deg,#173a4f,var(--navy));color:#fff;font-size:13px;font-weight:600;text-align:center;padding:9px 16px}
.topbar b{color:#F5C451}
.hdr{background:var(--cream);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:50}
.hdr .wrap{display:flex;align-items:center;gap:28px;min-height:72px}
.logo{display:flex;align-items:center;gap:12px;color:var(--navy)}.logo:hover{text-decoration:none}
.logo i{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#F5A35C,var(--coral) 70%);display:block;box-shadow:inset 0 -3px 6px rgba(0,0,0,.08)}
.logo b{display:block;font-family:'Fraunces',Georgia,serif;font-size:19px;font-weight:600;letter-spacing:.02em;line-height:1.1}
.logo small{display:block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
.nav{display:flex;gap:26px;flex:1}.nav a{color:var(--ink);font-weight:500;font-size:15px}.nav a.on{color:#B23F1A}
.hdr-cta{display:flex;align-items:center;gap:18px}.hdr-cta .login{color:var(--ink);font-weight:500}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--pill);padding:12px 22px;font-weight:600;font-size:15px;border:0;cursor:pointer;font-family:inherit;text-decoration:none}
.btn:hover{text-decoration:none}.btn-coral{background:var(--coral-d);color:#fff;box-shadow:0 6px 18px rgba(228,87,46,.25)}.btn-coral:hover{background:#A93D17}
.btn-ghost{background:#fff;color:var(--navy);border:1px solid var(--line)}.btn-ghost:hover{border-color:var(--coral)}
.btn-lg{padding:15px 28px;font-size:16px}
.menu{display:none;margin-left:auto}.menu summary{list-style:none;cursor:pointer;font-weight:600;color:var(--navy);padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:#fff}
.menu summary::-webkit-details-marker{display:none}.menu[open] .menu-panel{display:flex}
.menu-panel{display:none;flex-direction:column;position:absolute;left:0;right:0;top:100%;background:var(--cream);border-bottom:1px solid var(--line);padding:12px 24px 18px;gap:12px;box-shadow:var(--sh)}
.menu-panel a{color:var(--ink);font-weight:500;padding:6px 0}
.hero{padding:72px 0 56px}.hero .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:8px;background:#fff3e8;border:1px solid #ffd2b8;color:#c2410c;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:8px 14px;border-radius:999px;margin-bottom:16px}
.hero h1 span{color:var(--coral)}
.sub{font-size:19px;line-height:1.55;color:var(--body);margin:16px 0 26px;max-width:600px}
.ctas{display:flex;flex-wrap:wrap;gap:12px}
.trust{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:20px;font-size:14px;font-weight:600;color:var(--ink)}
.trust span{display:inline-flex;align-items:center;gap:7px}
.trust span::before{content:"✓";display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#e2f4ef;color:#0f7b67;font-size:12px;font-weight:800}
.mock{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--sh-lg);overflow:hidden}
.mock-h{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--line-s);font-weight:600;color:var(--navy);font-size:14px}
.mock-h em{font-style:normal;font-size:12px;color:var(--muted);font-weight:500}
.mock-r{display:flex;gap:12px;align-items:flex-start;padding:13px 18px;border-bottom:1px solid var(--line-s)}.mock-r:last-child{border-bottom:0}
.mock-r b{display:block;color:var(--navy);font-size:14px;line-height:1.35}.mock-r small{color:var(--muted);font-size:12.5px}
.dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--teal);margin-top:6px}
.chip{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;background:var(--teal-s);color:#1f6161;margin-left:6px;white-space:nowrap}
.stats{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.stats .wrap{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding-top:28px;padding-bottom:28px}
.stat b{display:block;font-family:'Fraunces',Georgia,serif;font-size:34px;color:var(--navy);line-height:1.1}.stat span{font-size:13px;color:var(--muted);font-weight:500}
.sec{padding:76px 0}.sec-alt{background:var(--sand)}
.sec-h{text-align:center;max-width:720px;margin:0 auto 44px}.sec-h p{color:var(--body);font-size:17px;margin-top:12px}
.kicker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#B23F1A;margin-bottom:10px;display:block}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:28px;box-shadow:var(--sh)}
.card h3{margin-bottom:8px}.card p{color:var(--body);margin:0}
.num{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--navy);color:#fff;font-family:'Fraunces',Georgia,serif;font-weight:700;margin-bottom:16px}
.ico{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--teal-s);color:var(--teal);font-size:20px;margin-bottom:14px}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;align-items:stretch}
.plan{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:var(--r-lg);padding:30px;box-shadow:var(--sh)}
.plan.feat{border:2px solid var(--coral);box-shadow:var(--sh-lg);position:relative}
.plan h3{font-size:22px}.plan .blurb{color:var(--body);margin:8px 0 18px;min-height:48px}
.price{font-family:'Fraunces',Georgia,serif;font-size:40px;color:var(--navy);line-height:1}.price small{font-family:'Inter',sans-serif;font-size:14px;color:var(--muted);font-weight:500;margin-left:6px}
.price.quote{font-size:26px}
.plan ul{list-style:none;padding:0;margin:22px 0 26px;flex:1}.plan li{padding:7px 0 7px 28px;position:relative;color:var(--ink);border-bottom:1px dashed var(--line-s)}
.plan li::before{content:"✓";position:absolute;left:0;top:7px;width:19px;height:19px;border-radius:50%;background:#e2f4ef;color:#0f7b67;font-size:11px;font-weight:800;display:grid;place-items:center}
.faq details{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:18px 22px;margin-bottom:12px}
.faq summary{cursor:pointer;font-weight:600;color:var(--navy);font-size:16px;list-style:none;display:flex;justify-content:space-between;gap:16px}
.faq summary::-webkit-details-marker{display:none}.faq summary::after{content:"+";color:var(--coral);font-size:22px;line-height:1}
.faq details[open] summary::after{content:"–"}.faq details p{margin:12px 0 0;color:var(--body)}
.band{background:var(--navy);color:#fff;border-radius:var(--r-lg);padding:48px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.band h2{color:#fff}.band p{color:#C9D3DF;margin:8px 0 0}
.page-h{padding:60px 0 20px;text-align:center}.page-h p{color:var(--body);font-size:18px;max-width:680px;margin:14px auto 0}
.prose{max-width:760px;margin:0 auto;padding:10px 24px 70px}.prose h2{font-size:24px;margin:34px 0 10px}.prose p,.prose li{color:var(--body)}
form.f{background:#fff;border:1px solid var(--line);border-radius:var(--r-lg);padding:32px;box-shadow:var(--sh);max-width:780px;margin:0 auto}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:16px 18px}.fg .full{grid-column:1/-1}
label.l{display:block;font-weight:600;font-size:14px;color:var(--navy);margin-bottom:6px}label.l em{font-style:normal;color:#B23F1A}
.in{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;font:inherit;color:var(--ink);background:#fff}
.in:focus{outline:none;border-color:var(--coral);box-shadow:0 0 0 3px rgba(228,87,46,.12)}
textarea.in{min-height:110px;resize:vertical}
.hint{font-size:12.5px;color:var(--muted);margin-top:5px}
.err{background:#FFF1EE;border:1px solid #F5C2B4;color:#9A3412;border-radius:12px;padding:12px 16px;margin-bottom:18px}
.ok{background:#EAF6F2;border:1px solid #BFE3D6;color:#0F5E4E;border-radius:12px;padding:14px 18px}
.chk{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--body)}.chk input{margin-top:4px;accent-color:var(--coral)}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.ftr{background:#EFE6D8;border-top:1px solid var(--line);margin-top:0;padding:52px 0 26px}
.ftr .cols{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:32px}
.ftr h4{font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:var(--navy);margin-bottom:14px;font-family:'Fraunces',Georgia,serif}
.ftr a{display:block;color:var(--body);padding:4px 0}.ftr a.logo{display:flex;color:var(--navy)}.ftr p{color:var(--body);font-size:14px;margin-top:12px;max-width:340px}
.ftr .base{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:36px;padding-top:18px;font-size:13px;color:#4F6075}
@media(max-width:960px){h1{font-size:38px}h2{font-size:28px}.hero{padding:44px 0 36px}.hero .wrap,.grid3,.grid2,.plans{grid-template-columns:1fr}
.stats .wrap{grid-template-columns:repeat(2,1fr)}.nav,.hdr-cta{display:none}.menu{display:block}.hdr .wrap{position:relative}
.ftr .cols{grid-template-columns:1fr 1fr}.fg{grid-template-columns:1fr}.band{padding:32px}.sec{padding:52px 0}form.f{padding:22px}}
@media(max-width:520px){.ftr .cols{grid-template-columns:1fr}h1{font-size:33px}.stat b{font-size:28px}}
`;

const NAV: [string, string][] = [['/how-it-works', 'How it works'], ['/pricing', 'Pricing'], ['/faq', 'FAQ'], ['/about', 'About'], ['/app', 'Live dashboard']];

export function layout(s: Record<string, string>, opts: { title: string; description: string; path: string; body: string; stats?: Stats; origin: string; noindex?: boolean }): string {
  const brand = esc(s.brand_name);
  const navLinks = NAV.map(([h, t]) => `<a href="${h}"${opts.path === h ? ' class="on" aria-current="page"' : ''}>${t}</a>`).join('');
  const announce = opts.stats ? `${esc(s.announcement)} · Active roles tracked: <b>${fmt(opts.stats.active)}</b>` : esc(s.announcement);
  const contact = s.contact_email ? `<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.origin + opts.path)}">${opts.noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${esc(opts.title)}"><meta property="og:description" content="${esc(opts.description)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(opts.origin + opts.path)}">
<meta name="theme-color" content="#12263F">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23E4572E'/%3E%3C/svg%3E">
<style>${CSS}</style>
<script>if(/[#&]view=v1_/.test(location.hash))location.replace('/app'+location.hash);</script>
</head><body>
<a class="skip" href="#main">Skip to content</a>
<div class="topbar">${announce}</div>
<header class="hdr"><div class="wrap">
<a class="logo" href="/" aria-label="${brand} home"><i></i><span><b>${brand}</b><small>${esc(s.brand_sub)}</small></span></a>
<nav class="nav" aria-label="Main">${navLinks}</nav>
<div class="hdr-cta"><a class="login" href="/portal">Client login</a><a class="btn btn-coral" href="/apply">Apply now</a></div>
<details class="menu"><summary aria-label="Menu">Menu</summary><div class="menu-panel">${navLinks}<a href="/portal">Client login</a><a class="btn btn-coral" href="/apply">Apply now</a></div></details>
</div></header>
<main id="main">${opts.body}</main>
<footer class="ftr"><div class="wrap"><div class="cols">
<div><a class="logo" href="/"><i></i><span><b>${brand}</b><small>${esc(s.brand_sub)}</small></span></a><p>${esc(s.tagline)} Postings are read straight from employers' own hiring systems and screened against your profile, with the evidence quoted.</p></div>
<div><h4>Product</h4><a href="/how-it-works">How it works</a><a href="/pricing">Pricing</a><a href="/app">Live dashboard</a><a href="/faq">FAQ</a></div>
<div><h4>Clients</h4><a href="/apply">Apply</a><a href="/portal">Client login</a>${contact}</div>
<div><h4>Company</h4><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/app">Operator sign-in</a></div>
</div><div class="base"><span>© ${new Date().getUTCFullYear()} ${brand}</span><span>Screening is automated and conservative; final decisions are always made by people.</span></div></div></footer>
</body></html>`;
}

// ---- Pages --------------------------------------------------------------------------------------------------------------------------
const workplace = (w: string, loc: string) => {
  const remote = /^REMOTE/.test(w || '') || /remote/i.test(loc || '');
  return remote ? 'Remote' : w === 'HYBRID' ? 'Hybrid' : w === 'ONSITE' ? 'On-site' : '';
};
export function homePage(s: Record<string, string>, st: Stats | null): string {
  const rows = st && st.latest.length ? st.latest.map((j) => `<div class="mock-r"><span class="dot"></span><div><b>${esc(j.title)}</b><small>${esc(j.company)}${j.location ? ' · ' + esc(String(j.location).slice(0, 60)) : ''}${workplace(j.workplace_type, j.location) ? `<span class="chip">${workplace(j.workplace_type, j.location)}</span>` : ''} · ${esc(ago(j.discovered_at))}</small></div></div>`).join('')
    : '<div class="mock-r"><div><small>New postings appear here as the engine finds them.</small></div></div>';
  return `
<section class="hero"><div class="wrap"><div>
<span class="pill">Job search, done daily</span>
<h1>Stop scrolling job boards. <span>Get a shortlist.</span></h1>
<p class="sub">${esc(s.brand_name)} reads new postings straight from employers' own hiring systems every day, screens each one against your profile, and shows you only the roles worth your time, with the reason quoted from the posting.</p>
<div class="ctas"><a class="btn btn-coral btn-lg" href="/apply">Apply for a dashboard</a><a class="btn btn-ghost btn-lg" href="/app">See a live dashboard</a></div>
<div class="trust"><span>Private dashboard</span><span>Evidence for every match</span><span>Export any time</span></div>
</div>
<div class="mock" role="region" aria-label="Latest postings the engine found"><div class="mock-h">Latest postings found <em>live from the engine</em></div>${rows}</div>
</div></section>
${st ? `<section class="stats" aria-label="Live figures"><div class="wrap">
<div class="stat"><b>${fmt(st.active)}</b><span>active roles tracked</span></div>
<div class="stat"><b>${fmt(st.employers)}</b><span>employers hiring</span></div>
<div class="stat"><b>${fmt(st.week)}</b><span>new roles this week</span></div>
<div class="stat"><b>${fmt(st.sources)}</b><span>hiring systems monitored</span></div>
</div></section>` : ''}
<section class="sec"><div class="wrap">
<div class="sec-h"><span class="kicker">How it works</span><h2>Three steps, then it runs every day</h2><p>You tell us what you are looking for once. The engine does the reading.</p></div>
<div class="grid3">
<div class="card"><div class="num">1</div><h3>Tell us your search</h3><p>The roles you want, where you can work from, and the titles you would rather skip. We write them into your search profile.</p></div>
<div class="card"><div class="num">2</div><h3>The engine screens daily</h3><p>New postings from employers' own hiring systems are checked against your profile: the job title against your roles, and the posting's own words about where the work can be done and who can be hired.</p></div>
<div class="card"><div class="num">3</div><h3>You get a shortlist</h3><p>Your private dashboard shows ready, stretch and review lists, with the posting's own words for every decision, and the applications your advisor tracks for you.</p></div>
</div></div></section>
<section class="sec sec-alt"><div class="wrap">
<div class="sec-h"><span class="kicker">What you get</span><h2>Built to save hours, not add noise</h2></div>
<div class="grid3">
<div class="card"><div class="ico">◎</div><h3>Location rules that are checked</h3><p>"Remote" is not taken at face value. A posting counts as eligible only when it says you can work from where you are; when it does not say, it stays "unknown".</p></div>
<div class="card"><div class="ico">❝</div><h3>Evidence, not guesses</h3><p>Each match shows the sentence from the posting it is based on, so you can judge it in seconds.</p></div>
<div class="card"><div class="ico">⚑</div><h3>Nothing promoted automatically</h3><p>The engine never marks a role "ready" on its own. A person reviews it first, so your shortlist stays honest.</p></div>
<div class="card"><div class="ico">↻</div><h3>New roles every day</h3><p>Employers' hiring systems are visited on a rolling schedule, so new postings reach your lists within days of going up, not weeks.</p></div>
<div class="card"><div class="ico">▤</div><h3>Your pipeline in one place</h3><p>Saved, applied, interviewing, offer: your advisor keeps your applications up to date next to your matches.</p></div>
<div class="card"><div class="ico">⇩</div><h3>Your data, exportable</h3><p>Download your list as a spreadsheet whenever you like. Your dashboard is private to you and anyone you share it with.</p></div>
</div></div></section>
<section class="sec"><div class="wrap"><div class="band"><div><h2>Ready to hand over the scrolling?</h2><p>Apply in two minutes. We set up your search and send you your private dashboard link.</p></div><a class="btn btn-coral btn-lg" href="/apply">Apply now</a></div></div></section>`;
}

export function howPage(): string {
  return `<section class="page-h"><div class="wrap"><span class="kicker">How it works</span><h1>From thousands of postings to a short, honest list</h1><p>What happens between a job being posted and it appearing on your dashboard.</p></div></section>
<section class="sec" style="padding-top:30px"><div class="wrap grid2">
<div class="card"><div class="num">1</div><h3>We set up your search profile</h3><p>From your application we record the role keywords that matter (for example "implementation", "data analyst"), titles to rank down, your location rule (fully remote from your country, or open to relocation) and your main skills.</p></div>
<div class="card"><div class="num">2</div><h3>Postings come from the source</h3><p>The engine checks employers' own applicant-tracking systems and a few public job feeds on a rolling schedule. It stores each posting's full text, so every decision can be traced back to it.</p></div>
<div class="card"><div class="num">3</div><h3>Every posting is screened for you</h3><p>The title against your role keywords; the location wording against your rule; security-clearance, citizenship or export-control requirements; sponsorship or worldwide-remote wording; your skills against the description. The result is a preliminary score and a status. Published pay is shown and can be filtered on.</p></div>
<div class="card"><div class="num">4</div><h3>People make the final call</h3><p>Matches start as "needs review". A role becomes "ready" or "stretch" only after a person has looked at it, and the reason is written down. Decisions made by people (applied, dismissed, promoted) are never overwritten by the engine.</p></div>
<div class="card"><div class="num">5</div><h3>Your private dashboard</h3><p>Ready, stretch and review lists, the posting evidence, filters by fit, role family and published pay, and the applications your advisor tracks for you. Open it with your private link from any device; it is read-only for you.</p></div>
<div class="card"><div class="num">6</div><h3>Removed postings are closed</h3><p>When the engine fetches a posting and the employer's system reports it as removed, it is closed on our side, unless you have already applied, in which case it stays in your tracker. Check the posting before applying; some close without notice.</p></div>
</div></section>
<section class="sec sec-alt"><div class="wrap"><div class="sec-h"><h2>What the engine will not do</h2><p>Being clear about limits is part of the product.</p></div>
<div class="grid3"><div class="card"><h3>Apply for you</h3><p>Applications are yours. We help you choose where; you decide and submit.</p></div>
<div class="card"><h3>Guess eligibility</h3><p>If a posting does not say you can work from where you are, it stays "unknown", not "eligible".</p></div>
<div class="card"><h3>Promise interviews</h3><p>We make your search faster and better targeted. Hiring decisions are the employer's.</p></div></div>
<p style="text-align:center;margin-top:34px"><a class="btn btn-coral btn-lg" href="/apply">Apply now</a></p></div></section>`;
}

function priceBlock(price: string, period: string) {
  const p = price.trim();
  return p ? `<div class="price">${esc(p)}<small>${esc(period)}</small></div>` : `<div class="price quote">Ask for a quote</div>`;
}
export function pricingPage(s: Record<string, string>): string {
  const plan = (i: number, feat: boolean) => `<div class="plan${feat ? ' feat' : ''}" data-plan="${i}"><h3>${esc(s[`plan${i}_name`])}</h3><p class="blurb">${esc(s[`plan${i}_blurb`])}</p>
${priceBlock(s[`plan${i}_price`], s[`plan${i}_period`])}
<ul>${s[`plan${i}_features`].split('\n').map((x) => x.trim()).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<a class="btn ${feat ? 'btn-coral' : 'btn-ghost'}" href="/apply?plan=${i}">Choose ${esc(s[`plan${i}_name`])}</a></div>`;
  return `<section class="page-h"><div class="wrap"><span class="kicker">Pricing</span><h1>Simple plans, cancel any time</h1><p>Every plan includes a private dashboard, daily screening and your data to export.</p></div></section>
<section class="sec" style="padding-top:34px"><div class="wrap"><div class="plans">${plan(1, false)}${plan(2, true)}${plan(3, false)}</div>
<div class="faq" style="max-width:820px;margin:52px auto 0"><h2 style="text-align:center;margin-bottom:22px">Pricing questions</h2>
<details><summary>Is there a contract?</summary><p>No. Plans run month to month. If you cancel, access ends at the end of the paid period, and you can export your list before then.</p></details>
<details><summary>Can I change plans?</summary><p>Yes, up or down at any time; tell us and it applies from your next period.</p></details>
<details><summary>Do you guarantee a job?</summary><p>No one honestly can. We guarantee the work: daily screening, honest statuses and a dashboard you can check any time.</p></details>
</div></div></section>`;
}

export function faqPage(): string {
  const qa: [string, string][] = [
    ['Where do the postings come from?', 'Mostly from employers’ own hiring systems (applicant-tracking systems such as Lever and Greenhouse), plus a few public job feeds. Each posting is stored in full so every decision can be traced back to its text.'],
    ['How do you decide whether I am eligible?', 'Only from what the posting says. A role counts as eligible for "fully remote from your country" only if the posting says that work from your country is supported. Requirements such as a security clearance, specific citizenship or export-control eligibility exclude it. If the posting is silent, it stays "unknown".'],
    ['Will the engine apply to jobs for me?', 'No. It finds and screens roles and tracks your applications. You decide and apply.'],
    ['What does "ready", "stretch" and "needs review" mean?', 'New matches start as "needs review". After a person has checked them, they become "ready" (a strong fit), "stretch" (worth a try) or are set aside. The screen never promotes a role on its own.'],
    ['Who can see my dashboard?', 'Only you, anyone you share your private link with, and your advisor. Your dashboard is not listed publicly.'],
    ['Can I update my applications myself?', 'Your link is read-only, so nothing can be changed by accident or by anyone you share it with. Tell your advisor what you applied to and they update your tracker.'],
    ['Can I download my matches?', 'Yes. Every dashboard has an export button that downloads your list as a spreadsheet file.'],
    ['What if I lose my link?', 'Ask your advisor for a new one; the old link can be switched off at the same time.'],
    ['Which roles and countries do you cover?', 'The engine is strongest for roles posted on employers’ own hiring systems, which covers most technology, operations and many engineering roles. Tell us your target in the application and we will say honestly how well we can cover it.'],
  ];
  return `<section class="page-h"><div class="wrap"><span class="kicker">FAQ</span><h1>Questions, answered plainly</h1></div></section>
<section class="sec" style="padding-top:30px"><div class="wrap faq" style="max-width:860px">${qa.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
<p style="text-align:center;margin-top:34px">Still unsure? <a href="/apply">Apply</a> and ask in the message box; there is no commitment.</p></div></section>`;
}

export function aboutPage(s: Record<string, string>, st: Stats | null): string {
  return `<section class="page-h"><div class="wrap"><span class="kicker">About</span><h1>A job search engine that shows its work</h1><p>${esc(s.brand_name)} started as a private tool to run two real job searches without drowning in listings.</p></div></section>
<section class="prose"><p>Job boards are built to show you more postings. We wanted the opposite: fewer, better ones, and a clear reason for each. So the engine reads postings at the source, screens them against a written profile and keeps a record of every decision, including the ones made by people.</p>
<h2>What we believe</h2><ul><li>Every match should come with evidence you can check in seconds.</li><li>"Unknown" is an honest answer; guessing is not.</li><li>People make the final call, and their decisions are never silently overwritten.</li><li>Your data is yours to export.</li></ul>
${st ? `<h2>Right now</h2><p>The engine is tracking ${fmt(st.active)} active roles from ${fmt(st.employers)} employers and monitors ${fmt(st.sources)} hiring systems on a rolling schedule.</p>` : ''}
<p style="margin-top:28px"><a class="btn btn-coral" href="/apply">Apply now</a></p></section>`;
}

export type ApplyValues = Record<string, string>;
export const APPLY_FIELDS = ['full_name', 'email', 'phone', 'current_location', 'target_roles', 'work_preference', 'years_experience', 'linkedin_url', 'plan', 'message'];
export function applyPage(s: Record<string, string>, v: ApplyValues = {}, errors: string[] = []): string {
  const val = (k: string) => esc(v[k] || '');
  const sel = (k: string, opts: [string, string][]) => opts.map(([o, t]) => `<option value="${esc(o)}"${v[k] === o ? ' selected' : ''}>${esc(t)}</option>`).join('');
  return `<section class="page-h"><div class="wrap"><span class="kicker">Apply</span><h1>Tell us about your search</h1><p>Two minutes. We read every application and reply with next steps.</p></div></section>
<section class="sec" style="padding-top:26px"><div class="wrap">
<form class="f" method="post" action="/apply" novalidate>
${errors.length ? `<div class="err" role="alert"><b>Please check:</b> ${errors.map(esc).join(' ')}</div>` : ''}
<div class="fg">
<div><label class="l" for="full_name">Full name <em>*</em></label><input class="in" id="full_name" name="full_name" required maxlength="80" autocomplete="name" value="${val('full_name')}"></div>
<div><label class="l" for="email">Email <em>*</em></label><input class="in" id="email" name="email" type="email" required maxlength="120" autocomplete="email" value="${val('email')}"></div>
<div><label class="l" for="phone">Phone or WhatsApp</label><input class="in" id="phone" name="phone" maxlength="40" autocomplete="tel" value="${val('phone')}"></div>
<div><label class="l" for="current_location">Where you live now <em>*</em></label><input class="in" id="current_location" name="current_location" required maxlength="80" placeholder="City, country" value="${val('current_location')}"></div>
<div class="full"><label class="l" for="target_roles">Roles you are looking for <em>*</em></label><input class="in" id="target_roles" name="target_roles" required maxlength="200" placeholder="e.g. Implementation manager, Solutions engineer" value="${val('target_roles')}"><div class="hint">Separate several with commas.</div></div>
<div><label class="l" for="work_preference">Where you can work</label><select class="in" id="work_preference" name="work_preference">${sel('work_preference', [['REMOTE_FROM_HOME', 'Fully remote from my country'], ['HOME_OR_RELOCATE', 'Remote, or I would relocate'], ['LOCAL', 'On-site or hybrid near me'], ['UNSURE', 'Not sure yet']])}</select></div>
<div><label class="l" for="years_experience">Years of experience</label><select class="in" id="years_experience" name="years_experience">${sel('years_experience', [['', 'Choose'], ['0-2', '0–2'], ['3-5', '3–5'], ['6-9', '6–9'], ['10+', '10 or more']])}</select></div>
<div><label class="l" for="linkedin_url">LinkedIn or CV link</label><input class="in" id="linkedin_url" name="linkedin_url" maxlength="200" placeholder="https://" value="${val('linkedin_url')}"></div>
<div><label class="l" for="plan">Plan you are interested in</label><select class="in" id="plan" name="plan">${sel('plan', [['', 'Not sure yet'], ['1', s.plan1_name], ['2', s.plan2_name], ['3', s.plan3_name]])}</select></div>
<div class="full"><label class="l" for="message">Anything else we should know?</label><textarea class="in" id="message" name="message" maxlength="1500" placeholder="Visa situation, notice period, salary expectations, companies you love…">${val('message')}</textarea></div>
<div class="hp" aria-hidden="true"><label>Leave this empty <input name="company_website" tabindex="-1" autocomplete="off"></label></div>
<div class="full"><label class="chk"><input type="checkbox" name="consent" value="yes" required${v.consent ? ' checked' : ''}> <span>I agree that you store these details to set up and run my job search, as described in the <a href="/privacy">privacy notice</a>. <em style="color:var(--coral);font-style:normal">*</em></span></label></div>
</div>
<p style="margin:24px 0 0"><button class="btn btn-coral btn-lg" type="submit">Send application</button></p>
</form></div></section>`;
}
export function thanksPage(s: Record<string, string>): string {
  return `<section class="page-h"><div class="wrap"><span class="kicker">Application received</span><h1>Thank you, we have it</h1><p>We read every application and will reply with next steps${s.contact_email ? ` from ${esc(s.contact_email)}` : ''}. In the meantime you can look around a live dashboard.</p>
<p style="margin-top:26px"><a class="btn btn-coral" href="/app">See a live dashboard</a> <a class="btn btn-ghost" href="/how-it-works">How it works</a></p></div></section><div style="height:60px"></div>`;
}

export function portalPage(): string {
  return `<section class="page-h"><div class="wrap"><span class="kicker">Client login</span><h1>Open your dashboard</h1><p>Use the private link your advisor sent you. You can paste the whole link below.</p></div></section>
<section class="sec" style="padding-top:26px"><div class="wrap">
<form class="f" id="portal" style="max-width:620px" onsubmit="return go(event)">
<div id="perr" class="err" role="alert" style="display:none">That does not look like a dashboard link. Paste the whole link you received, or ask your advisor for a new one.</div>
<label class="l" for="link">Your private link</label><input class="in" id="link" name="link" autocomplete="off" placeholder="https://…#view=v1_…&amp;candidate=…">
<div class="hint">Your link stays in this browser. It is never sent to our server in a page address and is removed from the address bar once opened.</div>
<p style="margin:22px 0 0"><button class="btn btn-coral btn-lg" type="submit">Open my dashboard</button></p>
<p style="margin:18px 0 0;font-size:14px;color:var(--muted)">No link yet? <a href="/apply">Apply</a>. Lost it? Ask your advisor for a new one.</p>
</form></div></section>
<script>function go(e){e.preventDefault();var v=(document.getElementById('link').value||'').trim();var t=/(v1_[0-9a-f]{48})/.exec(v),c=/candidate=([a-z][a-z0-9_]{2,39})/.exec(v);
if(!t||!c){document.getElementById('perr').style.display='block';return false}location.href='/app#view='+t[1]+'&candidate='+c[1];return false}</script>`;
}

export function privacyPage(s: Record<string, string>): string {
  const brand = esc(s.brand_name), mail = s.contact_email ? `<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>` : 'the address any email from us came from (reply to it)';
  return `<section class="page-h"><div class="wrap"><span class="kicker">Privacy</span><h1>Privacy notice</h1><p>Plain language: what we keep, why, and how to have it removed.</p></div></section>
<section class="prose">
<h2>What we collect</h2><p>When you apply: your name, email, optional phone number, location, the roles you are looking for, your work preferences, experience range, an optional profile link and anything you write in the message box. To protect the form from abuse we keep a keyed fingerprint of your network for at most a day, then erase it; we do not store your IP address.</p>
<p>When you are a client: your search profile, the postings screened for you, the statuses decided for them and the applications you track.</p>
<h2>Why</h2><p>Only to set up and run your job search and to contact you about it. We do not sell your data and do not use it for advertising.</p>
<h2>Who can see it</h2><p>${brand} staff who run your search. Your dashboard is visible only to you and anyone you share your private link with. Job postings themselves are public information from employers.</p>
<h2>Where it is stored</h2><p>On Cloudflare's infrastructure (Workers and the D1 database). Pages load their typefaces from Google Fonts, which receives your IP address when it serves them.</p>
<h2>Keeping and deleting</h2><p>We keep your details while you are a client and for as long as needed to answer your application. Ask us at ${mail} to receive a copy or to have everything deleted; we delete it from our database.</p>
<h2>Cookies</h2><p>This site does not set tracking cookies. Your dashboard link is kept in your browser tab's own storage until you close it.</p>
<p style="color:var(--muted);font-size:13px">Last updated ${new Date().toISOString().slice(0, 10)}.</p></section>`;
}
export function termsPage(s: Record<string, string>): string {
  const brand = esc(s.brand_name);
  return `<section class="page-h"><div class="wrap"><span class="kicker">Terms</span><h1>Terms of service</h1><p>The short version of how ${brand} works with you.</p></div></section>
<section class="prose">
<h2>The service</h2><p>${brand} finds and screens job postings against the search profile agreed with you, and gives you a private dashboard to review them and track applications. The plan you choose sets how much human review is included.</p>
<h2>What it is not</h2><p>We do not apply for jobs on your behalf, do not represent you to employers and cannot guarantee interviews or offers. Automated screening is conservative and can miss or misjudge a posting; always read the posting before applying.</p>
<h2>Your link</h2><p>Your dashboard link is private. Anyone who has it can view your dashboard, so share it only with people you trust; we can switch it off and issue a new one at any time.</p>
<h2>Payment and cancellation</h2><p>Plans run month to month unless agreed otherwise in writing. You can cancel at any time; access ends at the end of the paid period, and you can export your list before then.</p>
<h2>Postings</h2><p>Job postings belong to the employers that published them. Links on your dashboard go to the employer's own page; apply there.</p>
<p style="color:var(--muted);font-size:13px">Last updated ${new Date().toISOString().slice(0, 10)}.</p></section>`;
}
export function notFoundPage(): string {
  return `<section class="page-h"><div class="wrap"><h1>Page not found</h1><p>The page you were looking for is not here.</p><p style="margin-top:24px"><a class="btn btn-coral" href="/">Go to the home page</a></p></div></section><div style="height:80px"></div>`;
}

// ---- Apply form handling ---------------------------------------------------------------------------------------------------------
export function validateApply(form: Record<string, string>): { ok: true; value: ApplyValues } | { ok: false; errors: string[]; value: ApplyValues } {
  const t = (k: string, max: number) => String(form[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const value: ApplyValues = {
    full_name: t('full_name', 80), email: t('email', 120).toLowerCase(), phone: t('phone', 40), current_location: t('current_location', 80),
    target_roles: t('target_roles', 200), work_preference: t('work_preference', 20), years_experience: t('years_experience', 8), linkedin_url: t('linkedin_url', 200),
    plan: t('plan', 2), message: String(form.message ?? '').replace(/\r/g, '').trim().slice(0, 1500), consent: form.consent === 'yes' ? 'yes' : '',
  };
  const errors: string[] = [];
  if (value.full_name.length < 2) errors.push('Your name is required.');
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(value.email)) errors.push('A valid email address is required.');
  if (value.current_location.length < 2) errors.push('Where you live is required.');
  if (value.target_roles.length < 2) errors.push('The roles you are looking for are required.');
  if (value.linkedin_url && !/^https:\/\/[^\s<>"]+$/i.test(value.linkedin_url)) errors.push('The profile link must start with https://.');
  if (!['', 'REMOTE_FROM_HOME', 'HOME_OR_RELOCATE', 'LOCAL', 'UNSURE'].includes(value.work_preference)) value.work_preference = '';
  if (!['', '0-2', '3-5', '6-9', '10+'].includes(value.years_experience)) value.years_experience = '';
  if (!['', '1', '2', '3'].includes(value.plan)) value.plan = '';
  if (!value.consent) errors.push('Please agree to the privacy notice so we can store your details.');
  return errors.length ? { ok: false, errors, value } : { ok: true, value };
}
export const APPLY_PER_SOURCE_PER_DAY = 5;
// at most this many stored applications per UTC day in total (bounds what the public form can write: ~4 row writes each)
export const APPLY_PER_DAY_TOTAL = 200;
