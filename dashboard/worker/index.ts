/**
 * Career Job Engine - Production Cloudflare Worker API
 * 100% Compatible with D1 Schema and Frontend UI
 */

import { runDiscovery, automationStatus, sourceURL, assessBacklog, ASSESS_EVERY_TICKS, backfillClient } from './discovery';
import * as site from './site';
import { BUILTIN_IDS, loadRegistry, forgetRegistry, referencedCandidate, viewTokenCandidate, newViewToken, sha256Hex, parseClient, slugId, CLIENT_ID, csvRow } from './clients';
import { FIT_VALUES, FIT_SQL, PAY_SQL, SORTS, UNCLASSIFIED, ROLE_FAMILIES, fitOf, parsePay, roleFamilyOf, validRoleFamily, assessmentConflict, listIndiaRemote, type LightRow } from './listing';

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_API_KEY?: string;
  /** 'off' disables the response cache (unit tests that change rows directly between calls) */
  RESPONSE_CACHE?: string;
  /** set by the release workflow at deploy time (wrangler deploy --var) so the live version can be matched to a commit */
  GIT_COMMIT?: string;
  DEPLOYED_AT?: string;
  /** 'always' writes the read meter after every request (local cost measurement only; production leaves it unset) */
  METER_FLUSH?: string;
}

// -------------------------------------------------------------
// Candidate facts supplied by the candidates themselves (private: served only through authenticated routes, never
// bundled into the public frontend). Anything not listed is unknown and stays unknown.
// -------------------------------------------------------------
interface EmploymentEntry { role: string; employer: string; from: string; to: string | null; note?: string }
const CANDIDATE_FACTS: Record<string, {
  display_title: string; education_short: string; education_detail: string; summary_line: string; public_summary: string; career_start: string | null; employment_history: EmploymentEntry[];
}> = {
  farhan_shaikh: {
    display_title: 'Technical Operations & Workflow Automation Engineering',
    education_short: 'BMS Marketing',
    education_detail: 'BMS in Marketing',
    summary_line: 'Tech Ops Lead • CRM & Workflow Automation • 100% remote from India (employer must hire or contract in India)',
    public_summary: 'Tech Ops Lead • CRM & Workflow Automation • 100% remote from India',
    career_start: null, // total years are not derivable from the dates supplied; the stored value is used and labelled as stored
    employment_history: [{ role: 'Technical Team Lead', employer: 'Mianro Systems', from: '2026-06', to: null, note: 'five direct reports' }],
  },
  sana_ansari: {
    display_title: 'Power Plant Operations & Industrial Reliability Engineering',
    education_short: 'B.Tech Electrical',
    education_detail: 'B.Tech in Electrical Engineering, Rajasthan Technical University, 2016',
    summary_line: 'Power Plant O&M (RRVUNL) • Industrial Reliability • Energy Transition',
    public_summary: 'Power Plant O&M • Industrial Reliability • Energy Transition',
    career_start: '2017-09-01',
    employment_history: [
      { role: 'Maintenance (Chhabra)', employer: 'RRVUNL', from: '2017-09', to: '2025-02' },
      { role: 'Operations (Kota)', employer: 'RRVUNL', from: '2025-02', to: null },
    ],
  },
};

/** Years since a YYYY-MM-DD start, one decimal (365.25-day years). */
function yearsSince(start: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(start + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((ms / (365.25 * 86400000)) * 10) / 10);
}

function candidateFacts(candidateId: string, cand: any, now: Date = new Date()) {
  const f = CANDIDATE_FACTS[candidateId];
  const fromDates = !!f?.career_start;
  const stored = cand?.total_years_experience ?? null;
  const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN');
  let pay: string;
  if (candidateId === 'farhan_shaikh') {
    pay = `Monthly cash floor: ${inr(cand?.cash_floor_inr_monthly ?? 120000)} fixed, or $${cand?.min_acceptable_salary_usd ?? 25}/hour contract (no guaranteed minimum hours). Preferred: ₹25–30 LPA+. Notice: 30 days.`;
  } else {
    pay = 'Pay floor and notice period: unknown (not provided).';
  }
  return {
    display_title: f?.display_title || '',
    education_short: f?.education_short || '',
    education_detail: f?.education_detail || cand?.education || '',
    summary_line: f?.summary_line || '',
    public_summary: f?.public_summary || '',
    pay_line: pay,
    employment_history: f?.employment_history || [],
    total_years_experience: fromDates ? yearsSince(f!.career_start!, now) : stored,
    years_basis: fromDates ? `computed from career start ${f!.career_start!.slice(0, 7)}` : 'stored value (no dated history supplied)',
  };
}

// Standard CORS headers
function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Cf-Access-Jwt-Assertion, X-View-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(data: any, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

// Routes that carry no candidate data: liveness, build identity and the key check itself.
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/version', '/api/auth/verify', '/api/brand']);

// Read-only routes any visitor may call without a key (the dashboard is publicly viewable). This is an explicit
// allowlist: a route that is not listed here, and every POST/PUT/DELETE, needs the operator key. Audit trails
// (application history, qualification audit), automation run logs, sync/backup surfaces and raw app metadata are
// deliberately absent.
const PUBLIC_READ_PATTERNS: RegExp[] = [
  /^\/api\/candidates$/,
  /^\/api\/candidates\/[^/]+\/(strategy|dashboard|jobs|applications)$/,
  /^\/api\/dashboard\/overview$/,
  /^\/api\/jobs$/,
  /^\/api\/jobs\/[^/]+$/,
  /^\/api\/jobs\/[^/]+\/explanation$/,
  /^\/api\/applications$/,
  /^\/api\/india-remote\/(summary|jobs)$/,
  /^\/api\/analytics$/,
  /^\/api\/analytics\/(discovery|sources-effectiveness)$/,
  /^\/api\/qualification\/metrics$/,
  /^\/api\/cohorts\/metrics$/,
  /^\/api\/profile$/,
  /^\/api\/sources$/,
  /^\/api\/automation\/status$/,
  /^\/api\/export$/,
];
function isPublicRead(method: string, pathname: string): boolean {
  return method === 'GET' && PUBLIC_READ_PATTERNS.some((re) => re.test(pathname));
}

// Response cache for the read routes above (migration 0009). Every dashboard aggregate scans a candidate's whole
// qualification set (thousands of D1 rows); a cached answer costs two (the entry and the cache generation).
// * Keys: deployed commit, access level, path, and only the query parameters that route reads, so public and operator
//   answers never mix, each candidate keeps its own entries, and unknown parameters cannot create new entries.
// * Invalidation: an operator change raises the cache generation (one row) before and after its handler runs; an entry
//   is fresh only if it was computed under the current generation, so a read that was in flight during the change cannot
//   put old data back. Collector and cron updates appear when an entry expires.
// * Bounds: public misses stop at PUBLIC_DAILY_READ_BUDGET rows read per UTC day (D1's own meta.rows_read), and at most
//   CACHE_WRITES_PER_DAY entries are written per day, so visitors cannot spend the free read or write allowance.
// A missing or failing cache table means no caching.
const CACHE_TTL_SECONDS = { public: 1800, operator: 600 } as const;
const STALE_MAX_SECONDS = 86400;
const CACHE_MAX_KEY = 512;
const CACHE_MAX_BYTES = 900_000;
// Workers Free allows 5,000,000 D1 rows read and 100,000 rows written per UTC day. Public misses may use half of the
// reads; measured per-miss cost is at most ~20,000 rows at 2,123 jobs. A cache write costs ~3-6 rows written.
const PUBLIC_DAILY_READ_BUDGET = 2_500_000;
const CACHE_WRITES_PER_DAY = 3000;
// Values a cached query may carry. Anything else (any search text, an unknown status, an out-of-range page) is answered
// without caching, so visitors cannot mint new entries cheaply.
const enumOf = (...v: string[]) => (x: string) => v.includes(x);
const intIn = (lo: number, hi: number, step = 1) => (x: string) => /^\d{1,5}$/.test(x) && +x >= lo && +x <= hi && +x % step === 0;
const QUAL = ['READY', 'READY_HIGH', 'STRETCH_READY', 'NEEDS_REVIEW', 'INELIGIBLE', 'HOLD', 'CLOSED', 'APPLIED', 'APPLY_WORTHY', 'ALL'];
const LANES = enumOf('STRONGEST_FIT', 'BRIDGE', 'DREAM', 'UNASSIGNED', 'ALL');
const CACHE_VALUES: Record<string, (v: string) => boolean> = {
  candidate_id: (v) => CANDIDATE_IDS.has(v),
  eligibility: enumOf('ALL', 'ELIGIBLE', 'INELIGIBLE', 'UNKNOWN', 'CONDITIONAL'),
  qualification_status: (v) => QUAL.includes(v),
  farhan_fit: enumOf('ALL', ...FIT_VALUES), pay_filter: enumOf('ALL', 'PUBLISHED', 'UNPUBLISHED', 'UNKNOWN'), role_family: validRoleFamily,
  strategy_lane: LANES, lane: LANES,
  workplace_type: enumOf('ALL', 'REMOTE', 'REMOTE_RESTRICTED', 'HYBRID', 'ONSITE', 'UNKNOWN'),
  source_adapter: (v) => v === 'ALL' || /^[a-z]{2,20}$/.test(v),
  sort_by: enumOf('score_desc', 'date_desc', 'title_asc', 'company_asc'),
  exclude_applied: enumOf('true', 'false'), exclude_dismissed: enumOf('true', 'false'),
  limit: intIn(1, 100), offset: intIn(0, 1000, 5), min_score: intIn(0, 100, 5),
  search: (v) => /^[a-z0-9][a-z0-9 .+#-]{0,28}[a-z0-9.+#]$/i.test(v),
};
const CANDIDATE_ONLY = ['candidate_id'];
const CACHE_PARAMS: [RegExp, string[]][] = [
  [/^\/api\/jobs$/, ['candidate_id', 'eligibility', 'exclude_applied', 'exclude_dismissed', 'limit', 'min_score', 'offset', 'qualification_status', 'search', 'sort_by', 'source_adapter', 'strategy_lane', 'workplace_type', 'farhan_fit', 'pay_filter']],
  [/^\/api\/india-remote\/jobs$/, ['candidate_id', 'exclude_applied', 'farhan_fit', 'limit', 'offset', 'pay_filter', 'role_family', 'search', 'sort_by']],
  [/^\/api\/candidates\/[^/]+\/jobs$/, ['lane', 'limit', 'offset', 'status']],
  [/^\/api\/applications$/, ['candidate_id', 'status']],
  [/^\/api\/(jobs\/[^/]+(\/explanation)?|india-remote\/summary|analytics(\/(discovery|sources-effectiveness))?|qualification\/metrics|cohorts\/metrics|profile)$/, CANDIDATE_ONLY],
];
// Nothing is excluded from the cache by path any more: /api/india-remote/jobs has its own query and its own key (every filter it honours is in CACHE_PARAMS).
const NOT_CACHED = /^\/api\/export$/;   // exports are metered but never stored in the cache
const STATUS_VALUE: Record<string, (v: string) => boolean> = {
  '/api/applications': enumOf('SAVED', 'SUBMITTED', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED', 'ALL'),
};
const qualList = (v: string) => { const parts = v.split(','); return parts.length <= 6 && parts.every((x) => QUAL.includes(x.trim())); };
// Cache namespace: a code constant (bump it when a response shape changes) plus the deployed commit when the release set one.
// Caching and metering never depend on the deploy variable, so a plain `wrangler deploy` cannot switch them off.
const CACHE_SCHEMA = 'c2';
const CORE_PATHS = new Set(['/api/candidates', '/api/dashboard/overview', '/api/sources', '/api/automation/status', '/api/applications', '/api/jobs',
  '/api/analytics', '/api/analytics/discovery', '/api/analytics/sources-effectiveness', '/api/qualification/metrics', '/api/cohorts/metrics', '/api/profile',
  '/api/india-remote/summary']);
// Percent-encoding aliases of one path (j1, %6a1, %6A1, farhan%5Fshaikh) collapse to a single canonical form.
function canonicalPath(pathname: string): string | null {
  try { return pathname.split('/').map((seg) => encodeURIComponent(decodeURIComponent(seg))).join('/'); } catch { return null; }
}
function responseCacheKey(level: 'public' | 'operator', url: URL, namespace: string): { key: string; core: boolean; search: boolean } | null {
  const path = canonicalPath(url.pathname);
  if (!path || NOT_CACHED.test(path)) return null;
  const inPath = path.match(/^\/api\/candidates\/([^/]+)\/(strategy|dashboard|jobs|applications)$/);
  if (inPath && !CANDIDATE_IDS.has(inPath[1])) return null;
  const allowed = CACHE_PARAMS.find(([re]) => re.test(path))?.[1] || [];
  const params: string[] = [];
  for (const k of allowed) {
    if (!url.searchParams.has(k)) continue;
    const v = url.searchParams.get(k) || '';
    const ok = k === 'status' ? (STATUS_VALUE[path] || qualList)(v) : (CACHE_VALUES[k]?.(v) ?? false);
    if (!ok) return null;
    params.push(`${k}=${encodeURIComponent(k === 'search' ? v.toLowerCase() : v)}`);   // LIKE is case-insensitive for ASCII
  }
  const key = `${namespace}:${level}:${path}?${params.join('&')}`;
  if (key.length > CACHE_MAX_KEY) return null;
  // Page loads of the dashboard itself (a fixed set of paths, optionally one candidate) stay cacheable after the daily write cap.
  const core = (CORE_PATHS.has(path) || !!inPath) && params.every((x) => x.startsWith('candidate_id='));
  return { key, core, search: url.searchParams.has('search') };
}
function cachedResponse(lookup: { body: string | null }, request: Request, env: Env, state: string): Response {
  return new Response(lookup.body, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env), 'X-Cache': state } });
}
type CacheLookup = { current: number; body: string | null; created_at: number | null; generation: number | null };
async function lookupResponseCache(env: Env, key: string): Promise<CacheLookup | null> {
  try {
    return await env.DB.prepare(`SELECT s.generation AS current, c.body, c.created_at, c.generation
      FROM cache_state s LEFT JOIN response_cache c ON c.key = ? WHERE s.id = 1`).bind(key).first<CacheLookup>();
  } catch { return null; }
}
async function writeResponseCache(env: Env, key: string, body: string, generation: number): Promise<void> {
  if (new TextEncoder().encode(body).length > CACHE_MAX_BYTES) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT OR REPLACE INTO response_cache(key, body, created_at, generation) VALUES (?, ?, ?, ?)').bind(key, body, now, generation).run();
    meterAdd(utcDay(), { cache_writes: 1 });
    // Bounded housekeeping: occasionally drop up to 100 entries older than the stale window.
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM response_cache WHERE key IN (SELECT key FROM response_cache WHERE created_at < ? LIMIT 100)').bind(now - STALE_MAX_SECONDS).run();
  } catch { /* D1 unavailable: serve uncached */ }
}
async function invalidateResponseCache(env: Env, retried = false): Promise<void> {
  try { await env.DB.prepare('UPDATE cache_state SET generation = generation + 1 WHERE id = 1').run(); }
  catch (e: any) {
    if (/no such table/i.test(String(e?.message))) return;          // cache not installed: nothing to invalidate
    if (!retried) return invalidateResponseCache(env, true);
    throw e;                                                        // never carry on as if the cache were coherent
  }
}

// Read meter: counts accumulate in the isolate and are written at most every 30 s or 5,000 rows, so metering adds few
// writes. Counts held by an isolate that is evicted before flushing are lost (at most one interval's worth).
const utcDay = () => new Date().toISOString().slice(0, 10);
const secondsToUtcMidnight = () => 86400 - (Math.floor(Date.now() / 1000) % 86400);
type MeterCounts = { rows_read?: number; public_misses?: number; operator_misses?: number; cache_writes?: number };
let pendingMeter: { day: string; since: number; rows_read: number; public_misses: number; operator_misses: number; cache_writes: number } | null = null;
function meterAdd(day: string, c: MeterCounts) {
  if (!pendingMeter || pendingMeter.day !== day) pendingMeter = { day, since: Date.now(), rows_read: 0, public_misses: 0, operator_misses: 0, cache_writes: 0 };
  pendingMeter.rows_read += c.rows_read || 0; pendingMeter.public_misses += c.public_misses || 0;
  pendingMeter.operator_misses += c.operator_misses || 0; pendingMeter.cache_writes += c.cache_writes || 0;
}
async function flushMeter(env: Env, force = false): Promise<void> {
  const m = pendingMeter;
  if (!m || (!force && m.rows_read < 5000 && Date.now() - m.since < 30000 && m.day === utcDay())) return;
  pendingMeter = null;
  if (!m.rows_read && !m.public_misses && !m.operator_misses && !m.cache_writes) return;
  try {
    await env.DB.prepare(`INSERT INTO read_meter(day, rows_read, public_misses, operator_misses, cache_writes) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET rows_read = rows_read + excluded.rows_read, public_misses = public_misses + excluded.public_misses,
      operator_misses = operator_misses + excluded.operator_misses, cache_writes = cache_writes + excluded.cache_writes`)
      .bind(m.day, m.rows_read, m.public_misses, m.operator_misses, m.cache_writes).run();
  } catch { /* meter table missing: nothing recorded */ }
}
async function meterToday(env: Env): Promise<{ rows_read: number; cache_writes: number }> {
  const day = utcDay();
  const local = pendingMeter && pendingMeter.day === day ? pendingMeter : null;
  let stored: any = null;
  try { stored = await env.DB.prepare('SELECT rows_read, cache_writes FROM read_meter WHERE day = ?').bind(day).first<any>(); } catch {}
  return { rows_read: (stored?.rows_read || 0) + (local?.rows_read || 0), cache_writes: (stored?.cache_writes || 0) + (local?.cache_writes || 0) };
}
// A view of the D1 binding that adds up meta.rows_read for one request. first() is answered from all() so its cost is
// visible; the rows returned are the same (D1's first() does not add a LIMIT either).
function meteredDb(db: D1Database): { db: D1Database; rows: () => number } {
  let rows = 0;
  const add = (r: any) => { rows += Number(r?.meta?.rows_read || 0); return r; };
  const wrap = (st: any): any => ({
    bind: (...a: any[]) => wrap(st.bind(...a)),
    first: async (col?: string) => { const r = add(await st.all()); const row = r.results?.[0] ?? null; return col ? (row ? row[col] : null) : row; },
    all: async () => add(await st.all()),
    run: async () => add(await st.run()),
    raw: (o?: any) => st.raw(o),
    _inner: st,
  });
  const view: any = {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch: async (stmts: any[]) => { const res = await db.batch(stmts.map((x) => x._inner ?? x)); res.forEach(add); return res; },
    exec: (sql: string) => db.exec(sql),
    dump: () => (db as any).dump(),
  };
  return { db: view as D1Database, rows: () => rows };
}

// Database failures (quota, overload, outage) answer a controlled 503 instead of a crash; the cause is logged privately.
const UNAVAILABLE = { error: 'The dashboard is temporarily unavailable. Please try again in a few minutes.', status: 'unavailable' };
// Availability failures only (D1's own quota, overload, timeout and connection messages). Anything else, including
// query or programming errors that happen to mention a limit, stays a generic 500.
const isDatabaseFailure = (message: unknown) =>
  /daily row (read|write) limit|exceeded D1's|exceeded .*free tier|D1 DB is overloaded|overloaded|storage operation exceeded timeout|operation timed out|network connection lost|D1_RESET_DO|reset because its code was updated|internal error in D1|internal error while starting up D1|D1_ERROR: internal error|too many requests queued|transient issue on remote node|replica disconnected|exceeded its (memory|CPU time) limit and was reset|exceeded maximum DB size|maximum account storage limit/i
    .test(String(message || ''));
function logPrivately(tag: string, pathname: string, message: unknown) {
  // Path only (no query string, headers or bodies), and the error text truncated: D1 errors carry no row data. JSON parse
  // errors quote the request body, so their detail is withheld.
  const text = String(message || '');
  console.error(tag, pathname, /JSON|Unexpected token|position \d+/i.test(text) ? 'malformed JSON (detail withheld)' : text.slice(0, 300));
}

// Who is asking. Set by the router for every /api request; handlers use it to decide which fields to return.
const accessLevel = new WeakMap<Request, 'public' | 'operator'>();
const isOperatorRequest = (request: Request) => accessLevel.get(request) === 'operator';

// Fields that never leave the Worker in a public response, wherever they appear in the JSON (defence in depth on top
// of the explicit route allowlist and the explicit field lists below): private application notes, documents,
// audit actors, override reasons, pay and notice details, contact details and anything credential-shaped.
const PRIVATE_KEYS = new Set([
  'notes', 'application_notes', 'app_notes', 'rejection_notes', 'resume_version', 'cover_letter_path', 'application_channel',
  'manual_override_reason', 'actor', 'payload', 'raw_payload', 'audit', 'audit_payload', 'feedback',
  'email', 'phone', 'phone_number', 'linkedin', 'address', 'contact', 'contact_email',
  'cash_floor_inr_monthly', 'cash_floor_inr_annual', 'min_acceptable_salary_usd', 'min_fixed_monthly_inr', 'preferred_inr_range',
  'notice_period_days', 'pay_line', 'employment_history', 'location_preferences', 'relocation_interest', 'unsupported_claims',
  'disqualifying_keywords', 'token', 'secret', 'api_key', 'password', 'authorization', 'cursor_token', 'last_error',
  'error_message', 'error', 'message', 'rejection_stage', 'rejection_reason_category',
]);
function stripPrivate(value: any): any {
  if (Array.isArray(value)) return value.map(stripPrivate);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) if (!PRIVATE_KEYS.has(k.toLowerCase())) out[k] = stripPrivate(v);
    return out;
  }
  return value;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Built-in guess limiter. Cloudflare's rate-limiting rules are not assumed to be available on the free plan, so
// failed keys are counted in D1 per hashed client address (CF-Connecting-IP is set by Cloudflare, not by the caller).
const AUTH_MAX_FAILURES = 8;
const AUTH_WINDOW_SECONDS = 15 * 60;

async function clientKey(request: Request): Promise<string> {
  // Only CF-Connecting-IP is trusted: Cloudflare sets it itself. X-Forwarded-For is caller-controlled and would let an
  // attacker pick a fresh bucket for every guess.
  let ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':');   // IPv6: one bucket per /64, not per address
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('career-job-engine:' + ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seconds until the client may try again, or 0. A missing table or D1 error never locks the operator out. */
async function lockoutSeconds(env: Env, key: string): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT failures, window_start FROM auth_failures WHERE ip_hash = ?').bind(key).first<{ failures: number; window_start: number }>();
    if (!row) return 0;
    const now = Math.floor(Date.now() / 1000);
    const left = row.window_start + AUTH_WINDOW_SECONDS - now;
    return row.failures >= AUTH_MAX_FAILURES && left > 0 ? left : 0;
  } catch (err) {
    console.warn('auth limiter unavailable (lockout check):', (err as Error).message);
    return 0;
  }
}

/** Counts one wrong key atomically (single upsert) and returns the failures now in the window, or 0 if unavailable.
 *  Repeating the identical wrong key is not a guess, so it adds nothing; every different wrong key adds one. */
async function recordAuthFailure(env: Env, key: string, presented: string): Promise<number> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wrong-key:' + presented));
    const keyHash = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
    const row = await env.DB.prepare(`
      INSERT INTO auth_failures (ip_hash, failures, window_start, updated_at, last_key_hash) VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(ip_hash) DO UPDATE SET
        failures = CASE WHEN ? - window_start >= ? THEN 1 WHEN last_key_hash = ? THEN failures ELSE failures + 1 END,
        window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END,
        last_key_hash = ?,
        updated_at = ?
      WHERE ? - window_start >= ? OR last_key_hash != ?
      RETURNING failures
    `).bind(key, now, now, keyHash, now, AUTH_WINDOW_SECONDS, keyHash, now, AUTH_WINDOW_SECONDS, now, keyHash, now, now, AUTH_WINDOW_SECONDS, keyHash).first<{ failures: number }>();
    // The identical wrong key again, inside the window: the conditional update wrote nothing (one row read, no row written), so
    // a client repeating one bad key cannot spend the free write allowance. The count stays as it was.
    if (!row) {
      const current = await env.DB.prepare('SELECT failures FROM auth_failures WHERE ip_hash = ?').bind(key).first<{ failures: number }>();
      return current?.failures ?? 0;
    }
    // Retention: rows idle for a day are irrelevant; trimming rides on a failure, so the table cannot grow unbounded.
    if (Math.random() < 0.05) {
      await env.DB.prepare('DELETE FROM auth_failures WHERE updated_at < ?').bind(now - 24 * 3600).run();
    }
    return row?.failures ?? 0;
  } catch (err) {
    console.warn('auth limiter unavailable (record):', (err as Error).message);
    return 0;
  }
}

async function clearAuthFailures(env: Env, key: string): Promise<void> {
  try { await env.DB.prepare('DELETE FROM auth_failures WHERE ip_hash = ?').bind(key).run(); } catch { /* limiter table absent */ }
}

function tooManyAttempts(request: Request, env: Env, seconds: number): Response {
  return jsonResponse({ error: 'Too many failed attempts. Try again later.', retry_after_seconds: seconds }, 429,
    { ...corsHeaders(request, env), 'Retry-After': String(seconds) });
}

async function checkOperatorAuth(request: Request, env: Env): Promise<Response | null> {
  const cors = corsHeaders(request, env);
  if (!env.ADMIN_API_KEY) {
    return jsonResponse({ error: 'Server authentication is unconfigured.' }, 503, cors);
  }
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return jsonResponse({ error: 'Operator authentication required.' }, 401, { ...cors, 'WWW-Authenticate': 'Bearer' });
  }
  const ck = await clientKey(request);
  const wait = await lockoutSeconds(env, ck);
  if (wait > 0) return tooManyAttempts(request, env, wait);
  if (!timingSafeEqual(match[1].trim(), env.ADMIN_API_KEY)) {
    const n = await recordAuthFailure(env, ck, match[1].trim());
    // The attempt that crosses the limit is already answered 429, so at most AUTH_MAX_FAILURES wrong keys get a 403
    // per window even when guesses are sent concurrently.
    if (n > AUTH_MAX_FAILURES) return tooManyAttempts(request, env, AUTH_WINDOW_SECONDS);
    return jsonResponse({ error: 'Invalid operator access key.' }, 403, cors);
  }
  return null;
}

// Public pages show the country only; the stored city-level location stays operator-only.
const publicLocation = (v: unknown) => (typeof v === 'string' && /india/i.test(v) ? 'India' : '');

// Candidate isolation: a candidate-scoped route never falls back to a default candidate.
// The set is the client registry (clients.ts), refreshed from the database at most once a minute; the built-in two are always in it.
const CANDIDATE_IDS = new Set<string>(BUILTIN_IDS);
const PRIVATE_IDS = new Set<string>();
const CLIENT_TITLES = new Map<string, string | null>();
async function syncRegistry(env: Env, force = false) {
  const reg = await loadRegistry(env.DB, force);
  CANDIDATE_IDS.clear(); reg.ids.forEach((id) => CANDIDATE_IDS.add(id));
  PRIVATE_IDS.clear(); reg.privateIds.forEach((id) => PRIVATE_IDS.add(id));
  CLIENT_TITLES.clear(); reg.titles.forEach((t, id) => CLIENT_TITLES.set(id, t));
  return reg;
}
// The registry generation each request decided visibility with: an answer is only cached under that same generation, so an
// answer computed just before a visibility change can never be stored as current (it would be served for the cache TTL).
const decidedUnder = new WeakMap<Request, number | null>();
// A request about a client it may not see: answered by exactly the same path as an unknown id (budget check, no cache, same body).
const hiddenFrom = new WeakMap<Request, string>();
// The client a request's share link (X-View-Token) grants read access to. Set by the router; read-only, public field shape.
const viewerOf = new WeakMap<Request, string>();
/** Whether this request may see a candidate at all: operators see every client, others the public ones and their own share link's. */
const visibleTo = (request: Request, id: string) => isOperatorRequest(request) || !PRIVATE_IDS.has(id) || viewerOf.get(request) === id;
function knownCandidate(value: unknown): string | null {
  return typeof value === 'string' && CANDIDATE_IDS.has(value) ? value : null;
}
function badCandidate(request: Request, env: Env, given: unknown): Response {
  return jsonResponse({
    error: given ? `Unknown candidate_id '${String(given).slice(0, 40)}'.` : 'candidate_id is required for this endpoint.',
    // never names a private client to someone who may not see it
    allowed_candidate_ids: [...CANDIDATE_IDS].filter((id) => visibleTo(request, id)),
  }, 400, corsHeaders(request, env));
}

// Router abstraction without external dependencies
type RouteHandler = (request: Request, env: Env, params: Record<string, string>, url: URL) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

class WorkerRouter {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: RouteHandler) {
    const paramNames: string[] = [];
    const regexPath = path.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const pattern = new RegExp(`^${regexPath}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  get(path: string, handler: RouteHandler) { this.add('GET', path, handler); }
  post(path: string, handler: RouteHandler) { this.add('POST', path, handler); }
  put(path: string, handler: RouteHandler) { this.add('PUT', path, handler); }
  delete(path: string, handler: RouteHandler) { this.add('DELETE', path, handler); }

  // Last step for every API response: a 500 never echoes internal error text, and a public response is stripped of
  // private fields before it leaves.
  private async finish(request: Request, res: Response): Promise<Response> {
    const isApi = new URL(request.url).pathname.startsWith('/api/');
    const isPublic = accessLevel.get(request) === 'public';
    if (!isApi || (res.status !== 500 && !isPublic)) return res;
    const type = res.headers.get('Content-Type') || '';
    if (!type.includes('json')) return res;
    const headers = new Headers(res.headers);
    headers.delete('Content-Length');
    if (res.status === 500) {
      let message: unknown = '';
      try { message = (await res.clone().json<any>())?.error; } catch {}
      logPrivately('api_error', new URL(request.url).pathname, message);
      if (isDatabaseFailure(message)) {
        headers.set('Retry-After', '300');
        return new Response(JSON.stringify(UNAVAILABLE), { status: 503, headers });
      }
      return new Response(JSON.stringify({ error: 'Internal error. The request was not completed.' }), { status: 500, headers });
    }
    const data = await res.json<any>();
    return new Response(JSON.stringify(stripPrivate(data)), { status: res.status, headers });
  }

  async handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    // Every /api route except the public ones below requires the operator key (Authorization: Bearer <key>).
    // Fails closed: with no ADMIN_API_KEY configured, protected routes answer 503 instead of serving data.
    const isApi = pathname.startsWith('/api/');
    if (isApi && !PUBLIC_API_PATHS.has(pathname)) {
      if (isPublicRead(request.method, pathname) && !/^Bearer\s+\S/i.test(request.headers.get('Authorization') || '')) {
        accessLevel.set(request, 'public');
      } else {
        const denied = await checkOperatorAuth(request, env);
        if (denied) return denied;
        accessLevel.set(request, 'operator');
      }
    }
    // Client visibility: a private client is answered exactly like an unknown one unless the operator asks, or the request carries
    // a share link for that client. Runs before the cache, so a cached answer can never reach someone who may not see it.
    if (isApi && accessLevel.has(request)) {
      const reg = await syncRegistry(env);
      decidedUnder.set(request, reg.generation);
      if (accessLevel.get(request) === 'public') {
        const viewer = await viewTokenCandidate(env.DB, request.headers.get('X-View-Token'));
        if (viewer) viewerOf.set(request, viewer);
        const cid = referencedCandidate(url);
        if (cid && CANDIDATE_IDS.has(cid) && !visibleTo(request, cid)) hiddenFrom.set(request, cid);
      }
    }

    for (const route of this.routes) {
      if (route.method !== request.method && route.method !== 'ALL') continue;
      const match = pathname.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          try { params[name] = decodeURIComponent(match[i + 1]); } catch { params[name] = '\uFFFD'; }
        });
        const level = accessLevel.get(request);
        const readRoute = !!level && request.method === 'GET' && PUBLIC_READ_PATTERNS.some((re) => re.test(pathname));
        // Every public read is budgeted and metered, cached or not. A route that hands its work to another public route
        // (India Remote list) is metered by that inner call, so it is not counted twice.
        const metered = readRoute;
        const keyInfo = readRoute && env.RESPONSE_CACHE !== 'off' && !viewerOf.has(request) && !hiddenFrom.has(request) ? responseCacheKey(level!, url, `${CACHE_SCHEMA}:${env.GIT_COMMIT || 'nocommit'}`) : null;
        const cacheKey = keyInfo?.key ?? null;
        // The applications inbox and site settings feed no cached dashboard answer, so changing them keeps the public cache.
        const operatorChange = level === 'operator' && request.method !== 'GET' && !/^\/api\/(client-requests|site-settings)(\/|$)/.test(pathname);
        let meter: { db: D1Database; rows: () => number } | null = null;
        let lookup: CacheLookup | null = null;
        const now = Math.floor(Date.now() / 1000);
        if (cacheKey) {
          lookup = await lookupResponseCache(env, cacheKey);
          if (lookup?.body != null && lookup.generation === lookup.current && lookup.created_at! > now - CACHE_TTL_SECONDS[level!]) return cachedResponse(lookup, request, env, 'HIT');
        }
        if (metered) {
          if (level === 'public' && (await meterToday(env)).rows_read >= PUBLIC_DAILY_READ_BUDGET) {
            // Today's public share of the free allowance is used. An answer is only reused if no operator change happened since
            // it was computed; otherwise a clear refusal.
            if (lookup?.body != null && lookup.generation === lookup.current && lookup.created_at! > now - STALE_MAX_SECONDS) return cachedResponse(lookup, request, env, 'STALE');
            return jsonResponse({ error: "Today's public viewing capacity is used up. The dashboard is available again after 00:00 UTC.", status: 'limited' },
              503, { ...corsHeaders(request, env), 'Retry-After': String(secondsToUtcMidnight()) });
          }
          meter = meteredDb(env.DB);
        }
        if (operatorChange) await invalidateResponseCache(env);   // before: if this fails the change is refused
        let res: Response;
        try {
          res = await this.finish(request, hiddenFrom.has(request)
            ? badCandidate(request, env, hiddenFrom.get(request))
            : await route.handler(request, meter ? { ...env, DB: meter.db } : env, params, url));
        } finally {
          if (meter) {
            const rows = meter.rows();
            if (rows > 0) meterAdd(utcDay(), { rows_read: rows, [level === 'public' ? 'public_misses' : 'operator_misses']: 1 });
          }
          if (operatorChange) {                                   // after, whatever the outcome (partial writes included)
            try { await invalidateResponseCache(env); } catch (e: any) { logPrivately('cache_invalidate_failed', pathname, e?.message); }
          }
        }
        const sameGeneration = decidedUnder.get(request) == null || lookup?.current === decidedUnder.get(request);
        if (cacheKey && lookup && sameGeneration && res.status === 200 && (res.headers.get('Content-Type') || '').includes('json')) {
          const body = await res.text();
          if (keyInfo!.core || (await meterToday(env)).cache_writes < (keyInfo!.search ? CACHE_WRITES_PER_DAY / 10 : CACHE_WRITES_PER_DAY)) await writeResponseCache(env, cacheKey, body, lookup.current);
          await flushMeter(env, env.METER_FLUSH === 'always');
          const headers = new Headers(res.headers); headers.set('X-Cache', 'MISS'); headers.delete('Content-Length');
          return new Response(body, { status: 200, headers });
        }
        if (meter) await flushMeter(env, env.METER_FLUSH === 'always');
        return res;
      }
    }

    return jsonResponse({ error: 'Endpoint not found', path: pathname }, 404, corsHeaders(request, env));
  }
}

const router = new WorkerRouter();

function getNyOffsetMs(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
    hour12: false
  }).formatToParts(d);
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return -5 * 3600000;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins) * 60000;
}

function getNyWeekBounds(d: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  
  const dayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  const dayOfWeek = dayMap[map.weekday] ?? 0;
  
  const nyYear = parseInt(map.year, 10);
  const nyMonth = parseInt(map.month, 10) - 1;
  const nyDay = parseInt(map.day, 10);
  
  const sunCalDate = new Date(Date.UTC(nyYear, nyMonth, nyDay - dayOfWeek));
  const sunY = sunCalDate.getUTCFullYear();
  const sunM = String(sunCalDate.getUTCMonth() + 1).padStart(2, '0');
  const sunD = String(sunCalDate.getUTCDate()).padStart(2, '0');
  const sundayStr = `${sunY}-${sunM}-${sunD}`;
  
  const satCalDate = new Date(Date.UTC(nyYear, nyMonth, nyDay - dayOfWeek + 6));
  const satY = satCalDate.getUTCFullYear();
  const satM = String(satCalDate.getUTCMonth() + 1).padStart(2, '0');
  const satD = String(satCalDate.getUTCDate()).padStart(2, '0');
  const saturdayStr = `${satY}-${satM}-${satD}`;
  
  // Exact UTC for Sunday 00:00:00 in America/New_York (converges across DST transitions)
  let sunUtc = Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate(), 5, 0, 0);
  let sunOff = getNyOffsetMs(new Date(sunUtc));
  sunUtc = Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate(), 0, 0, 0) - sunOff;
  sunOff = getNyOffsetMs(new Date(sunUtc));
  sunUtc = Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate(), 0, 0, 0) - sunOff;

  // Exact UTC for Saturday 23:59:59.999 in America/New_York (converges across DST transitions)
  let satUtc = Date.UTC(satCalDate.getUTCFullYear(), satCalDate.getUTCMonth(), satCalDate.getUTCDate(), 23, 59, 59, 999) + 5 * 3600000;
  let satOff = getNyOffsetMs(new Date(satUtc));
  satUtc = Date.UTC(satCalDate.getUTCFullYear(), satCalDate.getUTCMonth(), satCalDate.getUTCDate(), 23, 59, 59, 999) - satOff;
  satOff = getNyOffsetMs(new Date(satUtc));
  satUtc = Date.UTC(satCalDate.getUTCFullYear(), satCalDate.getUTCMonth(), satCalDate.getUTCDate(), 23, 59, 59, 999) - satOff;

  const sunOffStr = (sunOff >= 0 ? '+' : '-') + String(Math.abs(Math.floor(sunOff / 3600000))).padStart(2, '0') + ':00';
  const satOffStr = (satOff >= 0 ? '+' : '-') + String(Math.abs(Math.floor(satOff / 3600000))).padStart(2, '0') + ':00';

  const tempDate = new Date(Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate()));
  const dayNr = (tempDate.getUTCDay() + 6) % 7;
  tempDate.setUTCDate(tempDate.getUTCDate() - dayNr + 3);
  const firstThursday = tempDate.getTime();
  tempDate.setUTCMonth(0, 1);
  if (tempDate.getUTCDay() !== 4) {
    tempDate.setUTCMonth(0, 1 + ((4 - tempDate.getUTCDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.ceil((firstThursday - tempDate.getTime()) / 604800000);
  
  return {
    cohort_id: `cohort-${sunCalDate.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`,
    label: `Week ${weekNum}, ${sunCalDate.getUTCFullYear()}`,
    week_start_ny: sundayStr,
    week_end_ny: saturdayStr,
    week_start_iso: `${sundayStr}T00:00:00${sunOffStr}`,
    week_end_iso: `${saturdayStr}T23:59:59${satOffStr}`,
    week_start_utc: new Date(sunUtc).toISOString(),
    week_end_utc: new Date(satUtc).toISOString(),
    sunday_date: sundayStr,
    timezone: 'America/New_York',
    now_ny: `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`
  };
}


// -------------------------------------------------------------
// 1. Health & Meta & Auth
// -------------------------------------------------------------

router.post('/api/auth/verify', async (request, env) => {
  try {
    const body = await request.json<any>().catch(() => ({}));
    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!env.ADMIN_API_KEY) {
      return jsonResponse({ error: 'Server authentication is unconfigured.' }, 503, corsHeaders(request, env));
    }
    if (!key) {
      return jsonResponse({ error: 'Operator access key is required.' }, 400, corsHeaders(request, env));
    }
    const ck = await clientKey(request);
    const wait = await lockoutSeconds(env, ck);
    if (wait > 0) return tooManyAttempts(request, env, wait);
    if (!timingSafeEqual(key, env.ADMIN_API_KEY)) {
      const n = await recordAuthFailure(env, ck, key);
      if (n > AUTH_MAX_FAILURES) return tooManyAttempts(request, env, AUTH_WINDOW_SECONDS);
      return jsonResponse({ error: 'Invalid operator access key.' }, 403, corsHeaders(request, env));
    }
    await clearAuthFailures(env, ck);
    return jsonResponse({
      status: 'authenticated',
      role: 'operator',
      timestamp: new Date().toISOString()
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});


// The brand the operator set for the public site, so the app shows the same name (white-label). Settings are memoised for 60 s.
router.get('/api/brand', async (request, env) => {
  const s = await site.loadSettings(env.DB);
  return jsonResponse({ brand_name: s.brand_name, brand_sub: s.brand_sub, contact_email: s.contact_email || null }, 200, { ...corsHeaders(request, env), 'Cache-Control': 'public, max-age=60' });
});

router.get('/api/version', async (request, env) => {
  return jsonResponse({
    version: '2026-11-05-public-view',
    commit: env.GIT_COMMIT || 'unknown',
    deployed_at: env.DEPLOYED_AT || null,
    status: 'operational',
    architecture: 'cloudflare_workers_d1',
    access: 'public read-only; changes require the operator key',
  }, 200, corsHeaders(request, env));
});

router.get('/api/health', async (request, env) => {
  try {
    const metaRes = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind('stage').first<{ value: string }>();
    return jsonResponse({
      status: 'healthy',
      stage: metaRes?.value || 'stage_2_production_cloud',
      database: 'd1_connected',
      timestamp: new Date().toISOString(),
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({
      status: 'degraded',
      error: err.message,
      timestamp: new Date().toISOString(),
    }, 500, corsHeaders(request, env));
  }
});

router.get('/api/meta', async (request, env) => {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM app_meta').all<{ key: string; value: string }>();
    const metaMap: Record<string, string> = {};
    results.forEach((r) => {
      metaMap[r.key] = r.value;
    });
    return jsonResponse(metaMap, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// -------------------------------------------------------------
// 2. Candidates & Strategy
// -------------------------------------------------------------

router.get('/api/candidates', async (request, env) => {
  try {
    const { results } = await env.DB.prepare(`
      SELECT c.*, s.strongest_fit_target_pct, s.bridge_target_pct, s.dream_target_pct
      FROM candidates c
      LEFT JOIN candidate_strategy s ON c.id = s.candidate_id
      ORDER BY c.full_name ASC
    `).all<any>();

    const formatted = results.filter((r: any) => visibleTo(request, r.id)).map((r: any) => ({
      id: r.id,
      name: r.full_name,
      full_name: r.full_name,
      builtin: BUILTIN_IDS.includes(r.id),
      ...(isOperatorRequest(request) ? { visibility: PRIVATE_IDS.has(r.id) ? 'private' : 'public' } : {}),
      display_title: !BUILTIN_IDS.includes(r.id) ? (CLIENT_TITLES.get(r.id) || '') : r.id === 'sana_ansari'
        ? 'Power Plant Operations & Industrial Reliability Engineering'
        : 'Technical Operations & Workflow Automation Engineering',
      citizenship: r.citizenship,
      education: r.education,
      current_location: isOperatorRequest(request) ? r.current_location : publicLocation(r.current_location),
      primary_timezone: r.primary_timezone,
      total_years_experience: r.total_years_experience,
      ...(isOperatorRequest(request) ? {
        cash_floor_inr_monthly: r.cash_floor_inr_monthly,
        cash_floor_inr_annual: r.cash_floor_inr_annual,
        min_acceptable_salary_usd: r.min_acceptable_salary_usd,
      } : {}),
      qualification_threshold: r.qualification_threshold,
      target_roles: r.target_roles ? JSON.parse(r.target_roles) : [],
      primary_skills: r.primary_skills ? JSON.parse(r.primary_skills) : [],
      secondary_skills: r.secondary_skills ? JSON.parse(r.secondary_skills) : [],
      strategy_allocation: {
        strongest_fit_target_pct: r.strongest_fit_target_pct ?? (r.id === 'sana_ansari' ? 20.0 : 70.0),
        bridge_target_pct: r.bridge_target_pct ?? (r.id === 'sana_ansari' ? 30.0 : 20.0),
        dream_target_pct: r.dream_target_pct ?? (r.id === 'sana_ansari' ? 50.0 : 10.0),
      }
    }));

    return jsonResponse(formatted, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.get('/api/candidates/:id/strategy', async (request, env, params) => {
  const candidateId = knownCandidate(params.id);
  if (!candidateId) return badCandidate(request, env, params.id);
  try {
    const strat = await env.DB.prepare(`
      SELECT strongest_fit_target_pct, bridge_target_pct, dream_target_pct
      FROM candidate_strategy WHERE candidate_id = ?
    `).bind(candidateId).first<any>();

    const target_distribution = strat ? {
      strongest_fit: strat.strongest_fit_target_pct,
      bridge: strat.bridge_target_pct,
      dream: strat.dream_target_pct,
    } : (candidateId === 'sana_ansari' 
      ? { strongest_fit: 20.0, bridge: 30.0, dream: 50.0 }
      : { strongest_fit: 70.0, bridge: 20.0, dream: 10.0 });

    // Discovery counts by lane
    const { results: laneRows } = await env.DB.prepare(`
      SELECT strategy_lane, COUNT(*) as cnt
      FROM candidate_qualifications
      WHERE candidate_id = ?
      GROUP BY strategy_lane
    `).bind(candidateId).all<any>();

    const laneMap: Record<string, number> = {};
    laneRows.forEach((r: any) => { laneMap[r.strategy_lane] = r.cnt; });
    const total_disc = (laneMap['STRONGEST_FIT'] || 0) + (laneMap['BRIDGE'] || 0) + (laneMap['DREAM'] || 0) || 1;

    const actual_discovery_distribution = {
      strongest_fit: Math.round(((laneMap['STRONGEST_FIT'] || 0) / total_disc) * 100),
      bridge: Math.round(((laneMap['BRIDGE'] || 0) / total_disc) * 100),
      dream: Math.round(((laneMap['DREAM'] || 0) / total_disc) * 100),
    };

    // Ready counts by lane
    const { results: readyLaneRows } = await env.DB.prepare(`
      SELECT strategy_lane, COUNT(*) as cnt
      FROM candidate_qualifications
      WHERE candidate_id = ? AND qualification_status IN ('READY', 'READY_HIGH', 'STRETCH_READY')
      GROUP BY strategy_lane
    `).bind(candidateId).all<any>();

    const readyLaneMap: Record<string, number> = {};
    readyLaneRows.forEach((r: any) => { readyLaneMap[r.strategy_lane] = r.cnt; });
    const total_ready = (readyLaneMap['STRONGEST_FIT'] || 0) + (readyLaneMap['BRIDGE'] || 0) + (readyLaneMap['DREAM'] || 0) || 1;

    const actual_ready_distribution = {
      strongest_fit: Math.round(((readyLaneMap['STRONGEST_FIT'] || 0) / total_ready) * 100),
      bridge: Math.round(((readyLaneMap['BRIDGE'] || 0) / total_ready) * 100),
      dream: Math.round(((readyLaneMap['DREAM'] || 0) / total_ready) * 100),
    };

    // Status counts
    const { results: statusRows } = await env.DB.prepare(`
      SELECT qualification_status, COUNT(*) as cnt
      FROM candidate_qualifications
      WHERE candidate_id = ?
      GROUP BY qualification_status
    `).bind(candidateId).all<any>();

    const statusMap: Record<string, number> = {};
    statusRows.forEach((r: any) => { statusMap[r.qualification_status] = r.cnt; });

    const appCount = await env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM applications WHERE candidate_id = ?
    `).bind(candidateId).first<{ cnt: number }>();

    return jsonResponse({
      candidate_id: candidateId,
      target_distribution,
      actual_discovery_distribution,
      actual_ready_distribution,
      ready_count: statusMap['READY'] || 0,
      stretch_count: statusMap['STRETCH_READY'] || 0,
      review_count: statusMap['NEEDS_REVIEW'] || 0,
      applied_count: appCount?.cnt || 0,
      total_inventory: Object.values(statusMap).reduce((a, b) => a + b, 0),
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.get('/api/candidates/:id/dashboard', async (request, env, params) => {
  const candidateId = knownCandidate(params.id);
  if (!candidateId) return badCandidate(request, env, params.id);
  try {
    const candidate = await env.DB.prepare(`
      SELECT c.*, s.strongest_fit_target_pct, s.bridge_target_pct, s.dream_target_pct
      FROM candidates c
      LEFT JOIN candidate_strategy s ON c.id = s.candidate_id
      WHERE c.id = ?
    `).bind(candidateId).first<any>();

    if (!candidate) {
      return jsonResponse({ error: 'Candidate not found' }, 404, corsHeaders(request, env));
    }

    const { results: statusCounts } = await env.DB.prepare(`
      SELECT qualification_status, COUNT(*) as count
      FROM candidate_qualifications
      WHERE candidate_id = ?
      GROUP BY qualification_status
    `).bind(candidateId).all<any>();

    const counts: Record<string, number> = {
      READY: 0,
      STRETCH_READY: 0,
      APPLIED: 0,
      NEEDS_REVIEW: 0,
      HOLD: 0,
      INELIGIBLE: 0,
      CLOSED: 0,
    };
    statusCounts.forEach((r: any) => {
      counts[r.qualification_status] = r.count;
    });

    const { results: laneCounts } = await env.DB.prepare(`
      SELECT strategy_lane, COUNT(*) as count
      FROM candidate_qualifications
      WHERE candidate_id = ? AND qualification_status IN ('READY', 'STRETCH_READY')
      GROUP BY strategy_lane
    `).bind(candidateId).all<any>();

    const lanes: Record<string, number> = {
      STRONGEST_FIT: 0,
      BRIDGE: 0,
      DREAM: 0,
      UNASSIGNED: 0,
    };
    laneCounts.forEach((r: any) => {
      lanes[r.strategy_lane] = r.count;
    });

    const { results: appCounts } = await env.DB.prepare(`
      SELECT status, COUNT(*) as count
      FROM applications
      WHERE candidate_id = ?
      GROUP BY status
    `).bind(candidateId).all<any>();

    const applications: Record<string, number> = {};
    appCounts.forEach((r: any) => {
      applications[r.status] = r.count;
    });

    return jsonResponse({
      candidate_id: candidateId,
      name: candidate.full_name,
      candidate_name: candidate.full_name,
      full_name: candidate.full_name,
      education: candidate.education,
      current_location: isOperatorRequest(request) ? candidate.current_location : publicLocation(candidate.current_location),
      display_title: !BUILTIN_IDS.includes(candidateId) ? (CLIENT_TITLES.get(candidateId) || '') : candidateId === 'sana_ansari'
        ? 'Power Plant Operations & Industrial Reliability Engineering'
        : 'Technical Operations & Workflow Automation Engineering',
      ready_count: counts['READY'] || 0,
      stretch_count: counts['STRETCH_READY'] || 0,
      review_count: counts['NEEDS_REVIEW'] || 0,
      applied_count: (applications['SAVED'] || 0) + (applications['SUBMITTED'] || 0) + (applications['APPLIED'] || 0) + (applications['REJECTED'] || 0),
      strategy_allocation: {
        strongest_fit_target_pct: candidate.strongest_fit_target_pct ?? (candidateId === 'sana_ansari' ? 20.0 : 70.0),
        bridge_target_pct: candidate.bridge_target_pct ?? (candidateId === 'sana_ansari' ? 30.0 : 20.0),
        dream_target_pct: candidate.dream_target_pct ?? (candidateId === 'sana_ansari' ? 50.0 : 10.0),
      },
      counts,
      lanes,
      applications,
      timestamp: new Date().toISOString(),
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// -------------------------------------------------------------
// 3. Top-Level Dashboard Overview
// -------------------------------------------------------------

router.get('/api/dashboard/overview', async (request, env) => {
  try {
    // Every visible candidate's figures in four grouped queries, whatever the number of clients (Workers Free allows 50 queries
    // per request; one set of queries per client would run out at a handful of clients).
    const visible = [...new Set([...BUILTIN_IDS, ...[...CANDIDATE_IDS].filter((x) => !BUILTIN_IDS.includes(x) && visibleTo(request, x)).sort()])];
    const idsJson = JSON.stringify(visible);
    const { results: candRows } = await env.DB.prepare(`SELECT c.*, s.strongest_fit_target_pct, s.bridge_target_pct, s.dream_target_pct
      FROM candidates c LEFT JOIN candidate_strategy s ON c.id = s.candidate_id WHERE c.id IN (SELECT value FROM json_each(?))`).bind(idsJson).all<any>();
    const { results: allQ } = await env.DB.prepare(`SELECT q.candidate_id, q.qualification_status, q.strategy_lane, COUNT(*) as cnt
      FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.candidate_id IN (SELECT value FROM json_each(?)) AND j.is_active = 1
      GROUP BY q.candidate_id, q.qualification_status, q.strategy_lane`).bind(idsJson).all<any>();
    const { results: allApps } = await env.DB.prepare(`SELECT candidate_id, COUNT(*) as records,
      SUM(CASE WHEN status IN ('APPLIED','SUBMITTED','INTERVIEWING','OFFER') THEN 1 ELSE 0 END) as applied
      FROM applications WHERE candidate_id IN (SELECT value FROM json_each(?)) GROUP BY candidate_id`).bind(idsJson).all<any>();
    let profRows: any[] = [];
    try { profRows = (await env.DB.prepare(`SELECT candidate_id, display_title, summary_line FROM client_profiles WHERE candidate_id IN (SELECT value FROM json_each(?))`).bind(idsJson).all<any>()).results || []; } catch {}
    const candBy = new Map((candRows || []).map((r: any) => [r.id, r]));
    const appBy = new Map((allApps || []).map((r: any) => [r.candidate_id, r]));
    const profBy = new Map(profRows.map((r: any) => [r.candidate_id, r]));
    const getSummary = async (cid: string) => {
      const cand = candBy.get(cid) || null;
      const qRows = (allQ || []).filter((r: any) => r.candidate_id === cid);

      const statusMap: Record<string, number> = {};
      const discLaneMap: Record<string, number> = {};
      const readyLaneMap: Record<string, number> = {};

      qRows.forEach((r: any) => {
        statusMap[r.qualification_status] = (statusMap[r.qualification_status] || 0) + r.cnt;
        discLaneMap[r.strategy_lane] = (discLaneMap[r.strategy_lane] || 0) + r.cnt;
        if (['READY', 'READY_HIGH', 'STRETCH_READY'].includes(r.qualification_status)) {
          readyLaneMap[r.strategy_lane] = (readyLaneMap[r.strategy_lane] || 0) + r.cnt;
        }
      });

      const totalDisc = (discLaneMap['STRONGEST_FIT'] || 0) + (discLaneMap['BRIDGE'] || 0) + (discLaneMap['DREAM'] || 0) || 1;
      const totalReady = (readyLaneMap['STRONGEST_FIT'] || 0) + (readyLaneMap['BRIDGE'] || 0) + (readyLaneMap['DREAM'] || 0) || 1;

      const appCnt = appBy.get(cid) as { records: number; applied: number } | undefined;
      const facts = candidateFacts(cid, cand);
      // a resold client's title and summary come from its profile (the built-in two keep their supplied facts)
      const prof = BUILTIN_IDS.includes(cid) ? null : (profBy.get(cid) || {}) as any;
      if (prof) { facts.display_title = prof.display_title || ''; facts.summary_line = facts.public_summary = prof.summary_line || ''; }

      const target_distribution = {
        strongest_fit: cand?.strongest_fit_target_pct ?? (cid === 'sana_ansari' ? 20.0 : 70.0),
        bridge: cand?.bridge_target_pct ?? (cid === 'sana_ansari' ? 30.0 : 20.0),
        dream: cand?.dream_target_pct ?? (cid === 'sana_ansari' ? 50.0 : 10.0),
      };

      const actual_discovery_distribution = {
        strongest_fit: Math.round(((discLaneMap['STRONGEST_FIT'] || 0) / totalDisc) * 100),
        bridge: Math.round(((discLaneMap['BRIDGE'] || 0) / totalDisc) * 100),
        dream: Math.round(((discLaneMap['DREAM'] || 0) / totalDisc) * 100),
      };

      const actual_ready_distribution = {
        strongest_fit: Math.round(((readyLaneMap['STRONGEST_FIT'] || 0) / totalReady) * 100),
        bridge: Math.round(((readyLaneMap['BRIDGE'] || 0) / totalReady) * 100),
        dream: Math.round(((readyLaneMap['DREAM'] || 0) / totalReady) * 100),
      };

      return {
        candidate_id: cid,
        name: cand?.full_name || cid,
        full_name: cand?.full_name || cid,
        title: !BUILTIN_IDS.includes(cid) ? (prof?.display_title || '') : cid === 'sana_ansari'
          ? 'Electrical Engineering & Industrial Operations'
          : 'Technical Operations & Workflow Automation Lead',
        education: cand?.education || '',
        current_location: (isOperatorRequest(request) ? cand?.current_location : publicLocation(cand?.current_location)) || '',
        location: (isOperatorRequest(request) ? cand?.current_location : publicLocation(cand?.current_location)) || '',
        ready: statusMap['READY'] || 0,
        ready_count: statusMap['READY'] || 0,
        stretch: statusMap['STRETCH_READY'] || 0,
        stretch_count: statusMap['STRETCH_READY'] || 0,
        review: statusMap['NEEDS_REVIEW'] || 0,
        review_count: statusMap['NEEDS_REVIEW'] || 0,
        // applied = records in an applied stage; application_records = every tracker record (saved, rejected, ...)
        applied: appCnt?.applied || 0,
        applied_count: appCnt?.applied || 0,
        application_records: appCnt?.records || 0,
        display_title: facts.display_title,
        education_short: facts.education_short,
        summary_line: isOperatorRequest(request) ? facts.summary_line : facts.public_summary,
        pay_line: facts.pay_line,
        counts_scope: 'active jobs only',
        target: target_distribution,
        target_distribution,
        discovery: actual_discovery_distribution,
        actual_discovery_distribution,
        ready_distribution: actual_ready_distribution,
        actual_ready_distribution,
      };
    };

    const farhanCard = await getSummary('farhan_shaikh');
    const sanaCard = await getSummary('sana_ansari');
    // every client this request may see, the built-in two first (the farhan/sana keys stay for the existing pages)
    const clientCards: any[] = [];
    for (const id of visible.filter((x) => !BUILTIN_IDS.includes(x))) clientCards.push(await getSummary(id));

    // one pass over jobs for both figures (it was two)
    const jobCounts = await env.DB.prepare('SELECT COUNT(*) as cnt, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM jobs').first<{ cnt: number; active: number }>();
    const totalJobs = { cnt: jobCounts?.cnt ?? 0 }, activeJobs = { cnt: jobCounts?.active ?? 0 };

    return jsonResponse({
      farhan: farhanCard,
      sana: sanaCard,
      candidates: [farhanCard, sanaCard, ...clientCards],
      total_jobs_tracked: totalJobs?.cnt ?? 0,
      active_jobs_count: activeJobs?.cnt ?? 0,
      automation_status: (await env.DB.prepare('SELECT enabled FROM cloud_automation WHERE id=1').first<{enabled:number}>())?.enabled ? 'ACTIVE' : 'PAUSED',
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// -------------------------------------------------------------
// 4. Candidate Jobs & Unified /api/jobs
// -------------------------------------------------------------

router.get('/api/candidates/:id/jobs', async (request, env, params, url) => {
  const candidateId = knownCandidate(params.id);
  if (!candidateId) return badCandidate(request, env, params.id);
  const statusFilter = url.searchParams.get('status') || 'READY,STRETCH_READY';
  const laneFilter = url.searchParams.get('lane') || 'ALL';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), isOperatorRequest(request) ? 500 : 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  try {
    const statuses = statusFilter.split(',').map((s) => s.trim()).filter(Boolean);
    const placeholders = statuses.map(() => '?').join(',');

    let query = `
      SELECT 
        j.id, j.title, j.company, j.company_url, j.company_headquarters,
        j.source_adapter, j.source_url, j.original_posting_url,
        j.employment_type, j.workplace_type, j.location_restrictions,
        j.description, j.required_skills,
        j.salary_currency, j.salary_min, j.salary_max, j.salary_period, j.salary_raw_text,
        j.discovered_at, j.is_active,
        q.qualification_status, q.strategy_lane, q.eligibility_status,
        q.eligibility_reason, q.qualification_reason, q.manual_override_status,
        q.manual_override_reason, q.qualified_at,
        s.overall_score, s.skill_score, s.role_score, s.score_breakdown,
        a.status as application_status, a.applied_at, a.notes as application_notes
      FROM candidate_qualifications q
      JOIN jobs j ON q.job_id = j.id
      LEFT JOIN candidate_job_scores s ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id
      LEFT JOIN applications a ON a.rowid = (SELECT MAX(a2.rowid) FROM applications a2 WHERE a2.candidate_id = q.candidate_id AND a2.job_id = q.job_id)
      WHERE q.candidate_id = ?
        AND q.qualification_status IN (${placeholders})
    `;

    const sqlParams: any[] = [candidateId, ...statuses];

    if (laneFilter !== 'ALL') {
      query += ` AND q.strategy_lane = ?`;
      sqlParams.push(laneFilter);
    }

    query += ` ORDER BY COALESCE(s.overall_score, 0) DESC, q.qualified_at DESC LIMIT ? OFFSET ?`;
    sqlParams.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...sqlParams).all<any>();

    const formatted = results.map((r: any) => ({
      ...r,
      score_breakdown: r.score_breakdown ? JSON.parse(r.score_breakdown) : null,
      is_active: Boolean(r.is_active),
    }));

    return jsonResponse(formatted, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// Comprehensive /api/jobs for React Frontend
// The latest application record for (candidate, job), if any, is SAVED or there is none: "not applied".
const NOT_APPLIED = `COALESCE((SELECT a2.status FROM applications a2 WHERE a2.candidate_id = q.candidate_id AND a2.job_id = q.job_id ORDER BY a2.rowid DESC LIMIT 1), 'SAVED') = 'SAVED'`;
// Columns and row shaping shared by every job listing (/api/jobs, /api/india-remote/jobs).
const JOB_COLUMNS = `
        j.id, j.title, j.company, j.company_url, j.company_headquarters,
        j.source_adapter, j.source_url, j.original_posting_url,
        j.employment_type, j.workplace_type, j.location_restrictions,
        j.description, j.required_skills,
        j.salary_published, j.salary_currency, j.salary_min, j.salary_max, j.salary_period, j.salary_raw_text,
        j.discovered_at, j.last_verified_at, j.is_active, j.provenance,
        q.qualification_status, q.strategy_lane, q.eligibility_status,
        q.eligibility_reason, q.qualification_reason, q.manual_override_status,
        q.manual_override_reason, q.qualified_at,
        s.overall_score, s.skill_score, s.role_score, s.score_breakdown,
        a.id as application_id, a.status as app_status, a.applied_at as app_applied_at,
        a.notes as app_notes, a.rejection_stage as app_rejection_stage,
        a.rejection_reason_category as app_rejection_reason_category,
        a.rejection_notes as app_rejection_notes`;
function shapeJob(r: any, candidateId: string, threshold: number | null) {
      let scoreBreakdown = null;
      try {
        if (r.score_breakdown) scoreBreakdown = JSON.parse(r.score_breakdown);
      } catch {}

      let reqSkills = [];
      try {
        if (r.required_skills) reqSkills = JSON.parse(r.required_skills);
      } catch {}

      // Disclosure only: a READY/STRETCH status next to a score that does not support it is explained, never repaired.
      const conflict = assessmentConflict(r, threshold);
      const family = roleFamilyOf(r.title);

      return {
        id: r.id,
        title: r.title,
        company: r.company,
        company_url: r.company_url,
        company_headquarters: r.company_headquarters,
        source_adapter: r.source_adapter,
        provenance: r.provenance,
        source_url: r.source_url,
        original_posting_url: r.original_posting_url,
        employment_type: r.employment_type || 'FULL_TIME',
        workplace_type: r.workplace_type,
        location_restrictions: r.location_restrictions,
        description: r.description,
        required_skills: Array.isArray(reqSkills) ? reqSkills : [],
        salary_published: Boolean(r.salary_published),
        salary_currency: r.salary_currency,
        salary_min: r.salary_min,
        salary_max: r.salary_max,
        salary_period: r.salary_period,
        salary_raw_text: r.salary_raw_text,
        discovered_at: r.discovered_at,
        last_verified_at: r.provenance === 'PUBLIC_FEED_UNVERIFIED' ? null : r.last_verified_at || r.discovered_at,
        is_active: Boolean(r.is_active),
        qualification_status: r.qualification_status,
        qualification_reason: r.qualification_reason,
        qualified_at: r.qualified_at,
        manual_override_status: r.manual_override_status,
        manual_override_reason: r.manual_override_reason,
        assessment_conflict: conflict.conflict,
        assessment_conflict_reason: conflict.reason,
        role_family: family ? family.label : null,
        role_family_key: family ? family.key : UNCLASSIFIED,
        strategy_lane: r.strategy_lane,
        candidate_id: candidateId,
        remote_from_india: r.eligibility_status === 'ELIGIBLE' ? 'CONFIRMED' : (r.eligibility_status === 'INELIGIBLE' ? 'NO' : 'UNKNOWN'),
        farhan_fit: fitOf(r.qualification_status),
        application_state: r.app_status || 'NEW',
        eligibility: {
          classification: r.eligibility_status,
          epistemic_status: r.provenance === 'PUBLIC_FEED_UNVERIFIED' || r.eligibility_status === 'UNKNOWN' ? 'UNKNOWN' : 'VERIFIED_FACT',
          confidence: 0.95,
          evidence_text: r.eligibility_reason,
          reason: r.eligibility_reason,
        },
        score: {
          overall_score: r.overall_score || 0,
          skill_score: r.skill_score || 0,
          role_score: r.role_score || 0,
          strategy_lane: r.strategy_lane,
          breakdown: scoreBreakdown || {
            skill_score: r.skill_score || 0,
            role_score: r.role_score || 0,
            matched_skills: [],
            missing_skills: [],
          },
        },
        application: r.app_status ? {
          id: r.application_id,
          candidate_id: candidateId,
          job_id: r.id,
          status: r.app_status,
          applied_at: r.app_applied_at,
          notes: r.app_notes,
          rejection_stage: r.app_rejection_stage,
          rejection_reason_category: r.app_rejection_reason_category,
          rejection_notes: r.app_rejection_notes,
        } : null,
      };
}
async function candidateThreshold(env: Env, candidateId: string): Promise<number | null> {
  try { const r = await env.DB.prepare('SELECT qualification_threshold AS t FROM candidates WHERE id = ?').bind(candidateId).first<any>(); return typeof r?.t === 'number' ? r.t : null; } catch { return null; }
}

router.get('/api/jobs', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  const search = url.searchParams.get('search');
  const eligibility = url.searchParams.get('eligibility');
  const minScore = parseInt(url.searchParams.get('min_score') || '0', 10);
  const workplaceType = url.searchParams.get('workplace_type');
  const sourceAdapter = url.searchParams.get('source_adapter');
  const qualificationStatus = url.searchParams.get('qualification_status');
  const strategyLane = url.searchParams.get('strategy_lane');
  const fitParam = (url.searchParams.get('farhan_fit') || 'ALL').toUpperCase();
  const payParam = parsePay(url.searchParams.get('pay_filter'));
  if (fitParam !== 'ALL' && !(FIT_VALUES as readonly string[]).includes(fitParam)) return jsonResponse({ error: 'Unsupported farhan_fit value.', detail: 'Unsupported farhan_fit value.', allowed: ['ALL', ...FIT_VALUES] }, 400, corsHeaders(request, env));
  if (payParam === undefined) return jsonResponse({ error: 'Unsupported pay_filter value.', detail: 'Unsupported pay_filter value.', allowed: ['ALL', 'PUBLISHED', 'UNPUBLISHED'] }, 400, corsHeaders(request, env));
  const excludeApplied = url.searchParams.get('exclude_applied') === 'true';
  const excludeDismissed = url.searchParams.get('exclude_dismissed') === 'true';
  const sortBy = url.searchParams.get('sort_by') || 'score_desc';
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)), isOperatorRequest(request) ? 1000 : 100);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

  try {
    // Cost: every predicate below reads only what it needs. The score row is joined only when a score filter or the order needs it,
    // the application check is a per-row index lookup instead of a join, the total comes from the status counts, and full rows are
    // fetched only for the page shown (measured locally at 2,200 jobs: ~29k rows read per uncached request before, a few thousand after).
    const needsScoreJoin = minScore > 0;
    let baseWhere = `
      FROM candidate_qualifications q
      JOIN jobs j ON q.job_id = j.id
      ${needsScoreJoin ? 'LEFT JOIN candidate_job_scores s ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id' : ''}
      WHERE q.candidate_id = ? AND j.is_active = 1
    `;
    const baseParams: any[] = [candidateId];

    // Exclude dismissed / marked irrelevant jobs when requested or in review queue
    if (excludeDismissed) {
      baseWhere += ` AND q.qualification_status NOT IN ('INELIGIBLE', 'CLOSED', 'HOLD') AND COALESCE(q.manual_override_status, '') NOT IN ('INELIGIBLE', 'CLOSED', 'HOLD')`;
    }
    if (search) {
      baseWhere += ` AND (j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)`;
      const term = `%${search}%`;
      baseParams.push(term, term, term);
    }
    if (eligibility && eligibility !== 'ALL') { baseWhere += ` AND q.eligibility_status = ?`; baseParams.push(eligibility); }
    if (minScore > 0) { baseWhere += ` AND COALESCE(s.overall_score, 0) >= ?`; baseParams.push(minScore); }
    if (workplaceType && workplaceType !== 'ALL') { baseWhere += ` AND j.workplace_type = ?`; baseParams.push(workplaceType); }
    if (sourceAdapter && sourceAdapter !== 'ALL') { baseWhere += ` AND j.source_adapter = ?`; baseParams.push(sourceAdapter); }
    if (strategyLane && strategyLane !== 'ALL') { baseWhere += ` AND q.strategy_lane = ?`; baseParams.push(strategyLane); }
    if (fitParam !== 'ALL') baseWhere += ` AND ${FIT_SQL[fitParam as (typeof FIT_VALUES)[number]]}`;
    if (payParam) baseWhere += ` AND ${PAY_SQL[payParam]}`;
    // Same meaning as before: the job's latest application record, if any, is SAVED (or there is none).
    if (excludeApplied) baseWhere += ` AND ${NOT_APPLIED}`;

    // 1. Status counts over the base predicate (one query; the total below is derived from it)
    const { results: rawStatusCounts } = await env.DB.prepare(`SELECT q.qualification_status, COUNT(*) as cnt ${baseWhere} GROUP BY q.qualification_status`).bind(...baseParams).all<any>();
    const status_counts: Record<string, number> = { READY: 0, STRETCH_READY: 0, NEEDS_REVIEW: 0, INELIGIBLE: 0, HOLD: 0 };
    (rawStatusCounts || []).forEach((r: any) => {
      if (r.qualification_status === 'READY_HIGH') status_counts['READY'] = (status_counts['READY'] || 0) + r.cnt;
      else if (status_counts[r.qualification_status] !== undefined) status_counts[r.qualification_status] = r.cnt;
    });

    // 2. The total for the status filter, from the same counts
    let filteredWhere = baseWhere;
    const filterParams = [...baseParams];
    let inStatus: (st: string) => boolean = () => true;
    if (qualificationStatus && qualificationStatus !== 'ALL') {
      if (qualificationStatus === 'APPLY_WORTHY') {
        filteredWhere += ` AND q.qualification_status IN ('READY', 'READY_HIGH', 'STRETCH_READY')`;
        inStatus = (st) => st === 'READY' || st === 'READY_HIGH' || st === 'STRETCH_READY';
      } else {
        filteredWhere += ` AND q.qualification_status = ?`;
        filterParams.push(qualificationStatus);
        inStatus = (st) => st === qualificationStatus;
      }
    }
    const totalMatching = (rawStatusCounts || []).reduce((n: number, r: any) => n + (inStatus(r.qualification_status) ? r.cnt : 0), 0);

    // 3. The ids of this page only (the score is joined here because the order uses it), then their full rows
    const orderBy = sortBy === 'date_desc' ? 'j.discovered_at DESC, q.job_id'
      : sortBy === 'title_asc' ? 'j.title ASC, q.job_id'
      : sortBy === 'company_asc' ? 'j.company ASC, q.job_id'
      : sortBy === 'score_desc' ? 'COALESCE(s2.overall_score, 0) DESC, j.discovered_at DESC, q.job_id'
      : 'COALESCE(s2.overall_score, 0) DESC, q.job_id';
    const scoreForOrder = /s2\./.test(orderBy) ? 'LEFT JOIN candidate_job_scores s2 ON s2.candidate_id = q.candidate_id AND s2.job_id = q.job_id' : '';
    const pageWhere = filteredWhere.replace('WHERE q.candidate_id = ?', `${scoreForOrder}\n      WHERE q.candidate_id = ?`);
    const { results: pageIds } = await env.DB.prepare(`SELECT q.job_id AS id ${pageWhere} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...filterParams, limit, offset).all<any>();
    let results: any[] = [];
    if (pageIds?.length) {
      const ids = pageIds.map((r: any) => r.id);
      const { results: full } = await env.DB.prepare(`
        SELECT ${JOB_COLUMNS}
        FROM candidate_qualifications q
        JOIN jobs j ON q.job_id = j.id
        LEFT JOIN candidate_job_scores s ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id
        LEFT JOIN applications a ON a.rowid = (SELECT MAX(a2.rowid) FROM applications a2 WHERE a2.candidate_id = q.candidate_id AND a2.job_id = q.job_id)
        WHERE q.candidate_id = ? AND j.id IN (SELECT value FROM json_each(?))`).bind(candidateId, JSON.stringify(ids)).all<any>();   // one parameter: D1 allows at most 100 per statement
      const byId = new Map((full || []).map((r: any) => [r.id, r]));
      results = ids.map((id: string) => byId.get(id)).filter(Boolean);
    }

    const threshold = await candidateThreshold(env, candidateId);
    const jobs = results.map((r: any) => shapeJob(r, candidateId, threshold));

    return jsonResponse({
      count: jobs.length,
      total: totalMatching,
      limit,
      offset,
      status_counts,
      jobs
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});


router.get('/api/jobs/:id', async (request, env, params, url) => {
  const jobId = params.id;
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  try {
    const job = await env.DB.prepare(`
      SELECT 
        j.*,
        q.qualification_status, q.strategy_lane, q.eligibility_status,
        q.eligibility_reason, q.qualification_reason, q.manual_override_status,
        q.manual_override_reason, q.qualified_at,
        s.overall_score, s.skill_score, s.role_score, s.score_breakdown,
        a.id as application_id, a.status as app_status, a.applied_at as app_applied_at,
        a.notes as app_notes
      FROM jobs j
      LEFT JOIN candidate_qualifications q ON j.id = q.job_id AND q.candidate_id = ?
      LEFT JOIN candidate_job_scores s ON j.id = s.job_id AND s.candidate_id = ?
      LEFT JOIN applications a ON a.rowid = (SELECT MAX(a2.rowid) FROM applications a2 WHERE a2.job_id = j.id AND a2.candidate_id = ?)
      WHERE j.id = ?
    `).bind(candidateId, candidateId, candidateId, jobId).first<any>();

    if (!job) {
      return jsonResponse({ error: 'Job not found' }, 404, corsHeaders(request, env));
    }

    let scoreBreakdown = null;
    try {
      if (job.score_breakdown) scoreBreakdown = JSON.parse(job.score_breakdown);
    } catch {}

    const formatted = {
      ...job,
      candidate_id: candidateId,
      is_active: Boolean(job.is_active),
      score: {
        overall_score: job.overall_score || 0,
        skill_score: job.skill_score || 0,
        role_score: job.role_score || 0,
        breakdown: scoreBreakdown,
      },
      eligibility: {
        classification: job.eligibility_status || 'UNKNOWN',
        reason: job.eligibility_reason,
      },
      application: job.app_status ? {
        id: job.application_id,
        status: job.app_status,
        applied_at: job.app_applied_at,
        notes: job.app_notes,
      } : null,
    };

    return jsonResponse(formatted, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.get('/api/jobs/:id/explanation', async (request, env, params, url) => {
  const jobId = params.id;
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  try {
    const job = await env.DB.prepare(`
      SELECT 
        j.title, j.company,
        q.qualification_status, q.strategy_lane, q.eligibility_status, q.eligibility_reason, q.qualification_reason,
        s.overall_score, s.skill_score, s.role_score, s.score_breakdown
      FROM jobs j
      LEFT JOIN candidate_qualifications q ON j.id = q.job_id AND q.candidate_id = ?
      LEFT JOIN candidate_job_scores s ON j.id = s.job_id AND s.candidate_id = ?
      WHERE j.id = ?
    `).bind(candidateId, candidateId, jobId).first<any>();

    if (!job) {
      return jsonResponse({ error: 'Job not found' }, 404, corsHeaders(request, env));
    }

    let breakdown = null;
    try {
      if (job.score_breakdown) breakdown = JSON.parse(job.score_breakdown);
    } catch {}

    return jsonResponse({
      job_id: jobId,
      title: job.title,
      company: job.company,
      qualification_status: job.qualification_status,
      strategy_lane: job.strategy_lane,
      eligibility_status: job.eligibility_status,
      eligibility_reason: job.eligibility_reason,
      qualification_reason: job.qualification_reason,
      overall_score: job.overall_score,
      skill_score: job.skill_score,
      role_score: job.role_score,
      score_breakdown: breakdown,
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.post('/api/jobs/:id/feedback', async (request, env, params, url) => {
  const jobId = params.id;
  try {
    const body = await request.json<any>();
    const candidateId = knownCandidate(body?.candidate_id ?? url.searchParams.get('candidate_id'));
    if (!candidateId) return badCandidate(request, env, body?.candidate_id ?? url.searchParams.get('candidate_id'));
    const rating = body?.rating || 'UP';
    const notes = body?.notes || null;

    // Fetch updated job details for the candidate
    const job = await env.DB.prepare(`
      SELECT 
        j.*,
        q.qualification_status, q.strategy_lane, q.eligibility_status,
        q.eligibility_reason, q.qualification_reason, q.manual_override_status,
        q.manual_override_reason, q.qualified_at,
        s.overall_score, s.skill_score, s.role_score, s.score_breakdown,
        a.id as application_id, a.status as app_status, a.applied_at as app_applied_at,
        a.notes as app_notes
      FROM jobs j
      LEFT JOIN candidate_qualifications q ON j.id = q.job_id AND q.candidate_id = ?
      LEFT JOIN candidate_job_scores s ON j.id = s.job_id AND s.candidate_id = ?
      LEFT JOIN applications a ON a.rowid = (SELECT MAX(a2.rowid) FROM applications a2 WHERE a2.job_id = j.id AND a2.candidate_id = ?)
      WHERE j.id = ?
    `).bind(candidateId, candidateId, candidateId, jobId).first<any>();

    let scoreBreakdown = null;
    try {
      if (job?.score_breakdown) scoreBreakdown = JSON.parse(job.score_breakdown);
    } catch {}

    const formattedJob = job ? {
      ...job,
      candidate_id: candidateId,
      is_active: Boolean(job.is_active),
      score: {
        overall_score: job.overall_score || 0,
        skill_score: job.skill_score || 0,
        role_score: job.role_score || 0,
        breakdown: scoreBreakdown,
      },
      eligibility: {
        classification: job.eligibility_status || 'UNKNOWN',
        reason: job.eligibility_reason,
      },
      application: job.app_status ? {
        id: job.application_id,
        status: job.app_status,
        applied_at: job.app_applied_at,
        notes: job.app_notes,
      } : null,
      feedback: rating === 'CLEAR' ? null : { rating, notes }
    } : null;

    return jsonResponse({
      status: 'success',
      job_id: jobId,
      candidate_id: candidateId,
      rating,
      notes,
      job: formattedJob
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// -------------------------------------------------------------
// 5. Applications Pipeline & History (Candidate Isolated)
// -------------------------------------------------------------

router.get('/api/candidates/:id/applications', async (request, env, params) => {
  const candidateId = knownCandidate(params.id);
  if (!candidateId) return badCandidate(request, env, params.id);
  try {
    const { results } = await env.DB.prepare(`
      SELECT 
        a.id, a.candidate_id, a.job_id, a.status, a.applied_at, a.notes,
        a.application_channel, a.resume_version, a.cover_letter_path,
        a.rejection_stage, a.rejection_reason_category, a.rejection_notes,
        a.created_at, a.updated_at,
        j.title, j.company, j.company_url, j.location_restrictions,
        j.source_adapter, j.source_url, j.original_posting_url,
        q.qualification_status, q.strategy_lane,
        s.overall_score
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      LEFT JOIN candidate_qualifications q ON a.candidate_id = q.candidate_id AND a.job_id = q.job_id
      LEFT JOIN candidate_job_scores s ON a.candidate_id = s.candidate_id AND a.job_id = s.job_id
      WHERE a.candidate_id = ?
      ORDER BY a.updated_at DESC
    `).bind(candidateId).all<any>();

    return jsonResponse(results, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// Top-level /api/applications router
router.get('/api/applications', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  const filterStatus = url.searchParams.get('status');

  try {
    let query = `
      SELECT 
        a.id as application_id, a.candidate_id, a.job_id, a.status as app_status, a.applied_at, a.notes,
        a.application_channel, a.resume_version, a.cover_letter_path,
        a.rejection_stage, a.rejection_reason_category, a.rejection_notes,
        a.created_at as app_created_at, a.updated_at as app_updated_at,
        j.*,
        q.qualification_status, q.strategy_lane, q.eligibility_status,
        s.overall_score
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      LEFT JOIN candidate_qualifications q ON a.candidate_id = q.candidate_id AND a.job_id = q.job_id
      LEFT JOIN candidate_job_scores s ON a.candidate_id = s.candidate_id AND a.job_id = s.job_id
      WHERE a.candidate_id = ?
    `;

    const sqlParams: any[] = [candidateId];

    if (filterStatus && filterStatus !== 'ALL') {
      query += ` AND a.status = ?`;
      sqlParams.push(filterStatus);
    }

    query += ` ORDER BY a.updated_at DESC`;

    const { results } = await env.DB.prepare(query).bind(...sqlParams).all<any>();

    const tracked = results.map((r: any) => ({
      ...r,
      is_active: Boolean(r.is_active),
      eligibility: {
        classification: r.eligibility_status || 'UNKNOWN',
      },
      score: {
        overall_score: r.overall_score || 0,
      },
      application: {
        id: r.application_id,
        candidate_id: r.candidate_id,
        job_id: r.job_id,
        status: r.app_status,
        applied_at: r.applied_at,
        application_channel: r.application_channel,
        resume_version: r.resume_version,
        cover_letter_path: r.cover_letter_path,
        notes: r.notes,
        rejection_stage: r.rejection_stage,
        rejection_reason_category: r.rejection_reason_category,
        rejection_notes: r.rejection_notes,
        created_at: r.app_created_at,
        updated_at: r.app_updated_at,
      },
    }));

    return jsonResponse({
      count: tracked.length,
      applications: tracked,
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// Unified Application Save/Update Mutation
async function handleApplicationSave(request: Request, env: Env, explicitCandidateId?: string) {
  try {
    const body = await request.json<any>();
    const candidateId = knownCandidate(explicitCandidateId ?? body.candidate_id);
    if (!candidateId) return badCandidate(request, env, explicitCandidateId ?? body.candidate_id);
    const {
      job_id,
      status,
      notes,
      resume_version,
      applied_at,
      rejection_stage,
      rejection_reason_category,
      rejection_notes,
      application_channel,
    } = body;

    if (!job_id || !status) {
      return jsonResponse({ error: 'job_id and status are required' }, 400, corsHeaders(request, env));
    }

    const now = new Date().toISOString();

    // Check existing application to preserve omitted fields on partial update
    const existing = await env.DB.prepare(`
      SELECT * FROM applications WHERE candidate_id = ? AND job_id = ?
    `).bind(candidateId, job_id).first<any>();

    const appId = existing?.id || `app-${crypto.randomUUID().slice(0, 8)}`;
    const finalAppliedAt = applied_at !== undefined ? applied_at : (existing?.applied_at || (['SUBMITTED', 'APPLIED'].includes(status) ? now : null));
    const finalNotes = notes !== undefined ? notes : (existing?.notes || null);
    const finalChannel = application_channel !== undefined ? application_channel : (existing?.application_channel || null);
    const finalResume = resume_version !== undefined ? resume_version : (existing?.resume_version || null);
    const finalCoverLetter = existing?.cover_letter_path || null;
    const finalRejStage = rejection_stage !== undefined ? rejection_stage : (existing?.rejection_stage || null);
    const finalRejCat = rejection_reason_category !== undefined ? rejection_reason_category : (existing?.rejection_reason_category || null);
    const finalRejNotes = rejection_notes !== undefined ? rejection_notes : (existing?.rejection_notes || null);
    const createdAt = existing?.created_at || now;

    // Prepare atomic batch operations: applications + application_history + (optional) candidate_qualifications
    const batchStatements: any[] = [
      env.DB.prepare(`
        INSERT OR REPLACE INTO applications (
          id, candidate_id, job_id, status, applied_at, application_channel,
          resume_version, cover_letter_path, notes, rejection_stage,
          rejection_reason_category, rejection_notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        appId, candidateId, job_id, status, finalAppliedAt, finalChannel,
        finalResume, finalCoverLetter, finalNotes, finalRejStage,
        finalRejCat, finalRejNotes, createdAt, now
      ),
      env.DB.prepare(`
        INSERT INTO application_history (
          candidate_id, job_id, application_id, previous_status, new_status,
          stage, rejection_stage, rejection_reason_category, rejection_notes,
          notes, actor, source, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        candidateId, job_id, appId, existing?.status || null, status,
        status, finalRejStage, finalRejCat, finalRejNotes,
        finalNotes, 'Candidate', 'cloud_worker', now
      )
    ];

    if (['SUBMITTED', 'APPLIED', 'INTERVIEWING', 'OFFER'].includes(status)) {
      batchStatements.push(
        env.DB.prepare(`
          UPDATE candidate_qualifications
          SET qualification_status = 'APPLIED'
          WHERE candidate_id = ? AND job_id = ?
        `).bind(candidateId, job_id)
      );
    }

    // Execute applications, application_history, and candidate_qualifications atomically
    await env.DB.batch(batchStatements);

    // Retrieve and format the updated Job model expected by React frontend
    const jobRow = await env.DB.prepare(`
      SELECT 
        j.*,
        q.qualification_status, q.strategy_lane, q.eligibility_status,
        q.eligibility_reason, q.qualification_reason, q.manual_override_status,
        q.manual_override_reason, q.qualified_at,
        s.overall_score, s.skill_score, s.role_score, s.score_breakdown,
        a.id as application_id, a.status as app_status, a.applied_at as app_applied_at,
        a.notes as app_notes, a.rejection_stage as app_rejection_stage,
        a.rejection_reason_category as app_rejection_reason_category,
        a.rejection_notes as app_rejection_notes
      FROM jobs j
      LEFT JOIN candidate_qualifications q ON j.id = q.job_id AND q.candidate_id = ?
      LEFT JOIN candidate_job_scores s ON j.id = s.job_id AND s.candidate_id = ?
      LEFT JOIN applications a ON a.rowid = (SELECT MAX(a2.rowid) FROM applications a2 WHERE a2.job_id = j.id AND a2.candidate_id = ?)
      WHERE j.id = ?
    `).bind(candidateId, candidateId, candidateId, job_id).first<any>();

    let scoreBreakdown = null;
    try {
      if (jobRow?.score_breakdown) scoreBreakdown = JSON.parse(jobRow.score_breakdown);
    } catch {}

    const formattedJob = jobRow ? {
      ...jobRow,
      candidate_id: candidateId,
      is_active: Boolean(jobRow.is_active),
      score: {
        overall_score: jobRow.overall_score || 0,
        skill_score: jobRow.skill_score || 0,
        role_score: jobRow.role_score || 0,
        breakdown: scoreBreakdown,
      },
      eligibility: {
        classification: jobRow.eligibility_status || 'UNKNOWN',
        reason: jobRow.eligibility_reason,
      },
      application: {
        id: appId,
        status,
        applied_at: finalAppliedAt,
        notes: finalNotes,
        rejection_stage: finalRejStage,
        rejection_reason_category: finalRejCat,
        rejection_notes: finalRejNotes,
        created_at: createdAt,
        updated_at: now,
      }
    } : null;

    return jsonResponse(formattedJob, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
}

router.post('/api/candidates/:id/applications', async (request, env, params) => {
  // The path decides the candidate; a body naming someone else is a mistake, not something to guess around.
  const peek = await request.clone().json<any>().catch(() => null);
  if (peek && peek.candidate_id && peek.candidate_id !== params.id) {
    return jsonResponse({ error: `Body candidate_id ${String(peek.candidate_id).slice(0, 40)} does not match the path candidate ${params.id.slice(0, 40)}; nothing was saved.` }, 409, corsHeaders(request, env));
  }
  return handleApplicationSave(request, env, params.id);
});

router.post('/api/applications', async (request, env) => {
  return handleApplicationSave(request, env);
});

// Application History Audit Trail
router.get('/api/applications/:id/history', async (request, env, params, url) => {
  const jobId = params.id;
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  try {
    const { results } = await env.DB.prepare(`
      SELECT 
        id, candidate_id, job_id, application_id, previous_status, new_status,
        stage, rejection_stage, rejection_reason_category, rejection_notes,
        notes, actor, source, recorded_at, recorded_at as changed_at
      FROM application_history
      WHERE job_id = ? AND candidate_id = ?
      ORDER BY recorded_at DESC
    `).bind(jobId, candidateId).all<any>();

    return jsonResponse({
      job_id: jobId,
      candidate_id: candidateId,
      count: results.length,
      history: results,
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// -------------------------------------------------------------
// 6. India Remote Summaries
// -------------------------------------------------------------

router.get('/api/india-remote/summary', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));

  try {
    const row = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_confirmed,
        SUM(CASE WHEN q.qualification_status IN ('READY', 'READY_HIGH') THEN 1 ELSE 0 END) as ready_count,
        SUM(CASE WHEN q.qualification_status = 'STRETCH_READY' THEN 1 ELSE 0 END) as stretch_count,
        SUM(CASE WHEN q.qualification_status = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) as review_count,
        SUM(CASE WHEN q.qualification_status IN ('INELIGIBLE', 'HOLD') THEN 1 ELSE 0 END) as not_fit_count,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id AND a.status != 'SAVED') THEN 1 ELSE 0 END) as applied_count
      FROM candidate_qualifications q
      JOIN jobs j ON q.job_id = j.id
      WHERE q.candidate_id = ? AND q.eligibility_status = 'ELIGIBLE' AND j.is_active = 1
    `).bind(candidateId).first<any>();

    return jsonResponse({
      candidate_id: candidateId,
      total_confirmed: row?.total_confirmed || 0,
      ready_count: row?.ready_count || 0,
      stretch_count: row?.stretch_count || 0,
      review_count: row?.review_count || 0,
      not_fit_count: row?.not_fit_count || 0,
      applied_count: row?.applied_count || 0,
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.get('/api/india-remote/jobs', async (request, env, _params, url) => {
  const sp = url.searchParams;
  const candidateId = knownCandidate(sp.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, sp.get('candidate_id'));
  // 'detail' carries the same message because public answers drop the key 'error'.
  const reject = (what: string, allowed: unknown) => jsonResponse({ error: `Unsupported ${what}.`, detail: `Unsupported ${what}.`, allowed }, 400, corsHeaders(request, env));
  const fit = (sp.get('farhan_fit') || 'ALL').toUpperCase();
  if (fit !== 'ALL' && !(FIT_VALUES as readonly string[]).includes(fit)) return reject('farhan_fit value', ['ALL', ...FIT_VALUES]);
  const pay = parsePay(sp.get('pay_filter'));
  if (pay === undefined) return reject('pay_filter value', ['ALL', 'PUBLISHED', 'UNPUBLISHED']);
  const family = sp.get('role_family') || 'ALL';
  if (!validRoleFamily(family)) return reject('role_family value', ['ALL', UNCLASSIFIED, ...ROLE_FAMILIES.map((f) => f.key)]);
  const sort = sp.get('sort_by') || 'score_desc';
  if (!SORTS.includes(sort)) return reject('sort_by value', SORTS);
  // These worked when this route handed its query to /api/jobs. They are not filters of this route, so they are refused rather than ignored.
  const unsupported = ['min_score', 'qualification_status', 'strategy_lane', 'workplace_type', 'source_adapter', 'eligibility', 'exclude_dismissed'].filter((k) => sp.has(k));
  if (unsupported.length) return reject(`parameter ${unsupported.join(', ')} on this route (use farhan_fit, role_family, pay_filter, search, exclude_applied, sort_by, limit, offset)`, ['candidate_id', 'farhan_fit', 'role_family', 'pay_filter', 'search', 'exclude_applied', 'sort_by', 'limit', 'offset']);
  const exAppliedRaw = sp.get('exclude_applied');
  if (exAppliedRaw !== null && exAppliedRaw !== 'true' && exAppliedRaw !== 'false') return reject('exclude_applied value', ['true', 'false']);
  const limit = Math.min(Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50), isOperatorRequest(request) ? 1000 : 100);
  const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);
  const search = (sp.get('search') || '').trim();
  try {
    // Step 1: one light row per ELIGIBLE active job of this candidate (a few hundred at most), with only what filtering needs.
    let where = `WHERE q.candidate_id = ? AND q.eligibility_status = 'ELIGIBLE' AND j.is_active = 1`;
    const binds: any[] = [candidateId];
    if (search) { where += ` AND (j.title LIKE ? ESCAPE '\\' OR j.company LIKE ? ESCAPE '\\' OR j.description LIKE ? ESCAPE '\\')`; const t = `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`; binds.push(t, t, t); }
    const { results: light } = await env.DB.prepare(`
      SELECT j.id, j.title, j.company, j.discovered_at, COALESCE(j.salary_published, 0) AS pub, q.qualification_status AS status,
             COALESCE(s.overall_score, 0) AS score, a.status AS app_status
      FROM candidate_qualifications q
      JOIN jobs j ON j.id = q.job_id
      LEFT JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
      LEFT JOIN applications a ON a.rowid = (SELECT MAX(a2.rowid) FROM applications a2 WHERE a2.candidate_id = q.candidate_id AND a2.job_id = q.job_id)
      ${where}
      ORDER BY q.job_id
      LIMIT 5001`).bind(...binds).all<LightRow>();
    const truncated = (light || []).length > 5000;   // far above today's few hundred; if it ever happens the answer says so
    // Step 2: filter, count and paginate on those rows (role family is derived from the title, so it cannot be a SQL predicate).
    const page = listIndiaRemote((light || []).slice(0, 5000), { fit: fit as any, family, pay, excludeApplied: exAppliedRaw === 'true', sort, limit, offset });
    // Step 3: full detail for the ids of this page only, returned in page order.
    let jobs: any[] = [];
    if (page.ids.length) {
      const { results } = await env.DB.prepare(`
        SELECT ${JOB_COLUMNS}
        FROM candidate_qualifications q
        JOIN jobs j ON q.job_id = j.id
        LEFT JOIN candidate_job_scores s ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id
        LEFT JOIN applications a ON a.rowid = (SELECT MAX(a2.rowid) FROM applications a2 WHERE a2.candidate_id = q.candidate_id AND a2.job_id = q.job_id)
        WHERE q.candidate_id = ? AND j.id IN (SELECT value FROM json_each(?))`).bind(candidateId, JSON.stringify(page.ids)).all<any>();   // one parameter: D1 allows at most 100 per statement
      const threshold = await candidateThreshold(env, candidateId);
      const byId = new Map((results || []).map((r: any) => [r.id, shapeJob(r, candidateId, threshold)]));
      jobs = page.ids.map((id) => byId.get(id)).filter(Boolean);
    }
    return jsonResponse({ count: jobs.length, total: page.total, limit, offset, facets: page.facets, truncated, jobs }, 200, corsHeaders(request, env));
  } catch (err: any) {
    throw err;
  }
});

// -------------------------------------------------------------
// 7. Analytics & Funnel
// -------------------------------------------------------------

router.get('/api/analytics', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));

  try {
    // Every figure below uses one scope: this candidate's qualifications over ACTIVE jobs, read in one pass (it was four; the average score is a second query, see below).
    const { results: eligCounts } = await env.DB.prepare(`
      SELECT q.eligibility_status, COUNT(*) as cnt, SUM(CASE WHEN j.salary_published = 1 THEN 1 ELSE 0 END) as pub
      FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.candidate_id = ? AND j.is_active = 1
      GROUP BY q.eligibility_status
    `).bind(candidateId).all<any>();

    const eligibility_counts: Record<string, number> = {
      ELIGIBLE: 0,
      INELIGIBLE: 0,
      UNKNOWN: 0,
    };
    let total = 0, pub = 0;
    (eligCounts || []).forEach((r: any) => {
      eligibility_counts[r.eligibility_status] = r.cnt;
      total += r.cnt; pub += r.pub || 0;
    });
    const totalJobs = { cnt: total };
    // The average keeps its old scope (every score row of an active job, with or without a qualification row), so it is its own query.
    const avgScore = await env.DB.prepare(`SELECT AVG(s.overall_score) as avg_score FROM candidate_job_scores s JOIN jobs j ON j.id = s.job_id
      WHERE s.candidate_id = ? AND j.is_active = 1`).bind(candidateId).first<{ avg_score: number }>();
    const salaryPub = { total, pub };

    const { results: appCounts } = await env.DB.prepare(`
      SELECT status, COUNT(*) as cnt
      FROM applications
      WHERE candidate_id = ?
      GROUP BY status
    `).bind(candidateId).all<any>();

    const application_counts: Record<string, number> = {};
    (appCounts || []).forEach((r: any) => {
      application_counts[r.status] = r.cnt;
    });

    return jsonResponse({
      candidate_id: candidateId,
      scope: 'active_jobs_for_candidate',
      total_jobs: totalJobs?.cnt || 0,
      eligibility_counts,
      application_counts,
      average_match_score: Math.round(avgScore?.avg_score || 0),
      salary_transparency_percentage: salaryPub?.total ? Math.round((salaryPub.pub / salaryPub.total) * 100) : 0,
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

const pct1 = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

router.get('/api/analytics/discovery', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  try {
    // Current inventory for ONE candidate: active jobs joined to that candidate's qualification and score.
    const { results: rows } = await env.DB.prepare(`
      SELECT q.qualification_status AS qs, q.eligibility_status AS es, COALESCE(s.overall_score, 0) AS score,
             j.company AS company
      FROM candidate_qualifications q
      JOIN jobs j ON j.id = q.job_id
      LEFT JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
      WHERE q.candidate_id = ? AND j.is_active = 1
    `).bind(candidateId).all<any>();

    const geo = { ELIGIBLE: 0, UNKNOWN: 0, INELIGIBLE: 0 } as Record<string, number>;
    const dist = { high_match_70_plus: 0, moderate_match_50_69: 0, low_match_under_50: 0 };
    const employers = new Set<string>();
    let relevant = 0, ready = 0, stretch = 0;
    for (const r of rows || []) {
      geo[r.es] = (geo[r.es] || 0) + 1;
      employers.add(String(r.company || '').toLowerCase());
      if (r.qs !== 'INELIGIBLE' && r.qs !== 'CLOSED') relevant++;
      if (r.qs === 'READY') ready++;
      if (r.qs === 'STRETCH_READY') stretch++;
      if (r.es === 'ELIGIBLE') {
        if (r.score >= 70) dist.high_match_70_plus++;
        else if (r.score >= 50) dist.moderate_match_50_69++;
        else dist.low_match_under_50++;
      }
    }
    const total = (rows || []).length;

    const { results: appRows } = await env.DB.prepare(
      'SELECT status, COUNT(*) AS cnt FROM applications WHERE candidate_id = ? GROUP BY status'
    ).bind(candidateId).all<any>();
    const breakdown: Record<string, number> = {};
    let appTotal = 0;
    (appRows || []).forEach((r: any) => { breakdown[r.status] = r.cnt; appTotal += r.cnt; });

    return jsonResponse({
      candidate_id: candidateId,
      scope: 'current_active_inventory',
      as_of: new Date().toISOString(),
      total_employers: employers.size,
      scanned_employers: employers.size,
      total_scanned_jobs: total,
      potentially_relevant_jobs: relevant,
      retrieval_stages: { RELEVANT: relevant },
      geographic_eligibility: geo,
      eligible_score_distribution: dist,
      ready_jobs: ready,
      stretch_ready_jobs: stretch,
      applications: { total: appTotal, breakdown },
      conversion_rates: {
        relevance_rate_pct: pct1(relevant, total),
        eligibility_rate_pct: pct1(geo.ELIGIBLE || 0, total),
        qualification_rate_pct: pct1(ready, geo.ELIGIBLE || 0),
        overall_funnel_efficiency_pct: pct1(ready, total),
      },
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.get('/api/analytics/sources-effectiveness', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  try {
    // Job statistics per source key, for this candidate. Jobs carry source_id when a Worker-monitored source found them.
    const { results: stats } = await env.DB.prepare(`
      SELECT COALESCE(j.source_id, 'unattributed:' || COALESCE(j.source_adapter, 'unknown')) AS source_key,
             MAX(j.source_adapter) AS adapter,
             COUNT(*) AS total_jobs,
             SUM(CASE WHEN q.qualification_status NOT IN ('INELIGIBLE','CLOSED') THEN 1 ELSE 0 END) AS relevant_jobs,
             SUM(CASE WHEN q.eligibility_status = 'ELIGIBLE' THEN 1 ELSE 0 END) AS eligible_jobs,
             SUM(CASE WHEN q.eligibility_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown_jobs,
             SUM(CASE WHEN q.eligibility_status = 'INELIGIBLE' THEN 1 ELSE 0 END) AS ineligible_jobs,
             SUM(CASE WHEN COALESCE(s.overall_score, 0) >= 70 THEN 1 ELSE 0 END) AS high_match_jobs,
             SUM(CASE WHEN q.qualification_status = 'READY' THEN 1 ELSE 0 END) AS ready_jobs,
             SUM(COALESCE(a.n, 0)) AS applications_count,
             SUM(COALESCE(a.interviewing, 0)) AS interviews_count,
             SUM(COALESCE(a.rejected, 0)) AS rejections_count
      FROM candidate_qualifications q
      JOIN jobs j ON j.id = q.job_id
      LEFT JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
      -- One row per (candidate, job) however many application records exist, so no join can multiply job counts.
      LEFT JOIN (
        SELECT candidate_id, job_id, COUNT(*) AS n,
               MAX(CASE WHEN status = 'INTERVIEWING' THEN 1 ELSE 0 END) AS interviewing,
               MAX(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
        FROM applications GROUP BY candidate_id, job_id
      ) a ON a.candidate_id = q.candidate_id AND a.job_id = q.job_id
      WHERE q.candidate_id = ? AND j.is_active = 1
      GROUP BY source_key
    `).bind(candidateId).all<any>();
    const byKey = new Map<string, any>((stats || []).map((r: any) => [r.source_key, r]));

    const { results: monitored } = await env.DB.prepare('SELECT * FROM cloud_sources ORDER BY id').all<any>();
    const sources: any[] = [];
    const zero = { total_jobs: 0, relevant_jobs: 0, eligible_jobs: 0, unknown_jobs: 0, ineligible_jobs: 0, high_match_jobs: 0, ready_jobs: 0, applications_count: 0, interviews_count: 0, rejections_count: 0 };
    const finish = (base: any, st: any) => {
      const t = { ...zero, ...(st || {}) };
      return {
        ...base,
        total_jobs: t.total_jobs || 0, relevant_jobs: t.relevant_jobs || 0, eligible_jobs: t.eligible_jobs || 0,
        unknown_jobs: t.unknown_jobs || 0, ineligible_jobs: t.ineligible_jobs || 0, high_match_jobs: t.high_match_jobs || 0,
        ready_jobs: t.ready_jobs || 0, applications_count: t.applications_count || 0,
        interviews_count: t.interviews_count || 0, rejections_count: t.rejections_count || 0,
        conversion_pct: pct1(t.ready_jobs || 0, t.total_jobs || 0),
      };
    };
    for (const m of monitored || []) {
      let feed: string | null = null;
      try { feed = sourceURL(m); } catch { feed = null; }
      sources.push(finish({
        source_id: m.id, source_name: m.name, adapter_type: m.kind, organization_slug: m.slug,
        feed_url: feed, is_active: !!m.enabled, is_live_approved: true, monitored: true,
        last_polled_at: m.last_attempt_at || null, last_success_at: m.last_success_at || null,
        last_status: m.last_status, last_error: m.last_error || null, consecutive_failures: m.failures || 0,
        last_latency_ms: null,
      }, byKey.get(m.id)));
      byKey.delete(m.id);
    }
    // Everything else arrived through the GitHub collector import; the Worker does not poll it, so no health is claimed.
    for (const [key, st] of byKey) {
      const name = key.startsWith('unattributed:') ? key.slice('unattributed:'.length) : key;
      sources.push(finish({
        source_id: key, source_name: name, adapter_type: st.adapter || name, organization_slug: name,
        feed_url: null, is_active: true, is_live_approved: false, monitored: false,
        last_polled_at: null, last_success_at: null, last_status: 'NOT_MONITORED', last_error: null,
        consecutive_failures: 0, last_latency_ms: null,
      }, st));
    }
    sources.sort((a, b) => b.total_jobs - a.total_jobs);

    return jsonResponse({ candidate_id: candidateId, sources }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

// -------------------------------------------------------------
// 8. Qualification & Cohorts
// -------------------------------------------------------------

router.get('/api/qualification/metrics', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  const bounds = getNyWeekBounds();

  try {
    const readyCnt = await env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.candidate_id = ? AND j.is_active = 1 AND q.qualification_status IN ('READY', 'READY_HIGH')
    `).bind(candidateId).first<{ cnt: number }>();

    const stretchCnt = await env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.candidate_id = ? AND j.is_active = 1 AND q.qualification_status = 'STRETCH_READY'
    `).bind(candidateId).first<{ cnt: number }>();

    const reviewCnt = await env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.candidate_id = ? AND j.is_active = 1 AND q.qualification_status = 'NEEDS_REVIEW'
    `).bind(candidateId).first<{ cnt: number }>();

    const ineligCnt = await env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
      WHERE q.candidate_id = ? AND j.is_active = 1 AND q.qualification_status IN ('INELIGIBLE', 'HOLD')
    `).bind(candidateId).first<{ cnt: number }>();

    const candThreshold = await env.DB.prepare(`
      SELECT qualification_threshold FROM candidates WHERE id = ?
    `).bind(candidateId).first<{ qualification_threshold: number }>();

    const readyInventory = readyCnt?.cnt || 0;
    const stretchInventory = stretchCnt?.cnt || 0;
    const totalApplyWorthy = readyInventory + stretchInventory;

    // Weekly research target: 100 unique READY jobs for Farhan Shaikh, 20 for Sana Ansari
    const weeklyResearchTarget = candidateId === 'farhan_shaikh' ? 100 : 20;

    // Distinct jobs that became READY during the current America/New_York Sunday–Saturday week
    // Exclude STRETCH_READY and older READY inventory
    const weekStartUtc = bounds.week_start_utc;
    const weekEndUtc = bounds.week_end_utc;

    const newReadyThisWeekRow = await env.DB.prepare(`
      SELECT COUNT(DISTINCT job_id) as cnt
      FROM candidate_qualifications
      WHERE candidate_id = ?
        AND qualification_status IN ('READY', 'READY_HIGH')
        AND (unixepoch(qualified_at) >= unixepoch(?) AND unixepoch(qualified_at) <= unixepoch(?))
    `).bind(candidateId, weekStartUtc, weekEndUtc).first<{ cnt: number }>();

    const newQualifiedThisWeek = newReadyThisWeekRow?.cnt || 0;

    return jsonResponse({
      weekly_research_target: weeklyResearchTarget,
      new_qualified_this_week: newQualifiedThisWeek,
      still_open_ready_inventory: readyInventory,
      ready_inventory: readyInventory,
      stretch_ready_inventory: stretchInventory,
      total_apply_worthy: totalApplyWorthy,
      target_progress_percentage: Math.round((newQualifiedThisWeek / weeklyResearchTarget) * 100),
      qualification_threshold: candThreshold?.qualification_threshold ?? (candidateId === 'sana_ansari' ? 60 : 70),
      timezone: 'America/New_York',
      current_week_start_ny: bounds.week_start_ny + ' 00:00:00',
      current_week_end_ny: bounds.week_end_ny + ' 23:59:59',
      now_ny: bounds.now_ny,
      candidate_id: candidateId,
      status_distribution: {
        READY: readyInventory,
        STRETCH_READY: stretchInventory,
        NEEDS_REVIEW: reviewCnt?.cnt || 0,
        INELIGIBLE: ineligCnt?.cnt || 0
      },
      inventory_scope: 'Open inventory counts cover active jobs only; new_qualified_this_week counts jobs whose READY qualification time falls in the current week.',
      disclaimer: 'America/New_York weekly cohort research metrics scoped to candidate.',
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});


router.post('/api/qualification/reverify',async(request,env)=>jsonResponse({error:'Bulk qualification is not implemented. New cloud discoveries remain in review; no verification was performed.'},501,corsHeaders(request,env)));

router.post('/api/jobs/:id/qualification-override', async (request, env, params) => {
  const jobId = params.id;
  try {
    const body = await request.json<any>();
    const newStatus = body?.status;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const reviewer = typeof body?.reviewer === 'string' && body.reviewer.trim() ? body.reviewer.trim() : 'Candidate';
    const candidateId = body?.candidate_id;
    if (!knownCandidate(candidateId) || !['READY','STRETCH_READY','NEEDS_REVIEW','INELIGIBLE','HOLD','CLOSED'].includes(newStatus) || reason.length < 3) {
      return jsonResponse({error:'Choose a valid candidate, qualification status and reason. Application status must be changed in the tracker.'},400,corsHeaders(request,env));
    }

    // Fetch existing qualification to capture actual previous_status
    const existing = await env.DB.prepare(
      'SELECT qualification_status, manual_override_status FROM candidate_qualifications WHERE job_id = ? AND candidate_id = ?'
    ).bind(jobId, candidateId).first<any>();
    if (!existing) {
      return jsonResponse({error:'Job qualification not found for this candidate.'},404,corsHeaders(request,env));
    }
    const previousStatus = existing.manual_override_status || existing.qualification_status || 'NEEDS_REVIEW';

    // Atomically execute UPDATE and INSERT in a single D1 batch
    const nowIso = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE candidate_qualifications
        SET manual_override_status = ?, manual_override_reason = ?, qualification_status = ?, last_reverified_at = ?
        WHERE job_id = ? AND candidate_id = ?
      `).bind(newStatus, reason, newStatus, nowIso, jobId, candidateId),
      env.DB.prepare(`
        INSERT INTO qualification_history (
          candidate_id, job_id, previous_status, new_status, reason, actor, changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(candidateId, jobId, previousStatus, newStatus, reason, reviewer, nowIso)
    ]);

    return jsonResponse({
      status: 'success',
      audit_record: {
        job_id: jobId,
        candidate_id: candidateId,
        previous_status: previousStatus,
        status: newStatus,
        reason,
        reviewer,
        recorded_at: nowIso,
      },
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.get('/api/jobs/:id/qualification-audit', async (request, env, params, url) => {
  const jobId = params.id;
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  const current = await env.DB.prepare('SELECT qualification_status, manual_override_status, manual_override_reason, qualified_at, last_reverified_at FROM candidate_qualifications WHERE candidate_id=? AND job_id=?').bind(candidateId,jobId).first<any>();
  
  // Query persistent qualification_history records ordered by creation
  const historyQuery = await env.DB.prepare(`
    SELECT id, job_id, previous_status, new_status, reason, actor as reviewer, changed_at as created_at
    FROM qualification_history
    WHERE candidate_id = ? AND job_id = ?
    ORDER BY id ASC
  `).bind(candidateId, jobId).all<any>();

  let audit_trail: any[] = historyQuery.results || [];
  
  // Only genuine persistent qualification_history rows are returned; no fabricated legacy events.

  return jsonResponse({
    job_id: jobId,
    candidate_id: candidateId,
    count: audit_trail.length,
    audit_trail,
    current_override: current || null,
    note: audit_trail.length > 0 ? 'Active qualification override audit trail.' : 'No previous manual overrides recorded for this job.',
  }, 200, corsHeaders(request, env));
});

router.get('/api/cohorts/metrics', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));
  const bounds = getNyWeekBounds();

  try {
    // 1. Lifetime / all-time global inventory (explicitly labeled)
    // one pass over jobs for all three figures (it was three)
    const jc = await env.DB.prepare('SELECT COUNT(*) as cnt, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active, SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as closed FROM jobs').first<{ cnt: number; active: number; closed: number }>();
    const lifetimeTotalJobs = { cnt: jc?.cnt ?? 0 }, lifetimeActiveJobs = { cnt: jc?.active ?? 0 }, lifetimeClosedJobs = { cnt: jc?.closed ?? 0 };

    const lifetimeQCounts = await env.DB.prepare(`
      SELECT qualification_status, COUNT(*) as cnt
      FROM candidate_qualifications
      WHERE candidate_id = ?
      GROUP BY qualification_status
    `).bind(candidateId).all<any>();

    const lifetimeQMap: Record<string, number> = {};
    (lifetimeQCounts.results || []).forEach((r: any) => {
      lifetimeQMap[r.qualification_status] = r.cnt;
    });

    const lifetimeAppCounts = await env.DB.prepare(`
      SELECT status, COUNT(*) as cnt
      FROM applications
      WHERE candidate_id = ?
      GROUP BY status
    `).bind(candidateId).all<any>();

    const lifetimeAMap: Record<string, number> = {};
    (lifetimeAppCounts.results || []).forEach((r: any) => {
      lifetimeAMap[r.status] = r.cnt;
    });

    const lifetimeTotalTracked = Object.values(lifetimeAMap).reduce((acc, v) => acc + v, 0);

    // 2. Candidate-scoped America/New_York Current Weekly Cohort Metrics
    // Uses timezone-aware normalized UTC timestamp boundaries
    const weekStartUtc = bounds.week_start_utc;
    const weekEndUtc = bounds.week_end_utc;

    const weeklyDiscovered = await env.DB.prepare(`
      SELECT COUNT(DISTINCT j.id) as cnt
      FROM jobs j
      JOIN candidate_qualifications cq ON j.id = cq.job_id
      WHERE cq.candidate_id = ?
        AND (unixepoch(j.discovered_at) >= unixepoch(?) AND unixepoch(j.discovered_at) <= unixepoch(?))
    `).bind(candidateId, weekStartUtc, weekEndUtc).first<{ cnt: number }>();

    const weeklyQCounts = await env.DB.prepare(`
      SELECT qualification_status, COUNT(*) as cnt
      FROM candidate_qualifications
      WHERE candidate_id = ?
        AND (unixepoch(qualified_at) >= unixepoch(?) AND unixepoch(qualified_at) <= unixepoch(?))
      GROUP BY qualification_status
    `).bind(candidateId, weekStartUtc, weekEndUtc).all<any>();

    const weeklyQMap: Record<string, number> = {};
    (weeklyQCounts.results || []).forEach((r: any) => {
      weeklyQMap[r.qualification_status] = r.cnt;
    });

    const weeklyAppCounts = await env.DB.prepare(`
      SELECT status, COUNT(*) as cnt
      FROM applications
      WHERE candidate_id = ?
        AND ((unixepoch(created_at) >= unixepoch(?) AND unixepoch(created_at) <= unixepoch(?))
          OR (unixepoch(applied_at) >= unixepoch(?) AND unixepoch(applied_at) <= unixepoch(?)))
      GROUP BY status
    `).bind(candidateId, weekStartUtc, weekEndUtc, weekStartUtc, weekEndUtc).all<any>();

    const weeklyAMap: Record<string, number> = {};
    (weeklyAppCounts.results || []).forEach((r: any) => {
      weeklyAMap[r.status] = r.cnt;
    });

    const weeklyTotalTracked = Object.values(weeklyAMap).reduce((acc, v) => acc + v, 0);
    const weeklyAppliedCnt = weeklyAMap['APPLIED'] || 0;
    const weeklyInterviewingCnt = (weeklyAMap['SCREEN'] || 0) + (weeklyAMap['TECHNICAL'] || 0) + (weeklyAMap['INTERVIEWING'] || 0);
    const weeklyOfferCnt = weeklyAMap['OFFER'] || weeklyAMap['OFFERED'] || 0;
    const weeklyRejectedCnt = weeklyAMap['REJECTED'] || 0;

    const weeklyReadyCnt = (weeklyQMap['READY'] || 0) + (weeklyQMap['READY_HIGH'] || 0);
    const weeklyStretchCnt = weeklyQMap['STRETCH_READY'] || 0;
    const weeklyReviewCnt = weeklyQMap['NEEDS_REVIEW'] || 0;
    const weeklyIneligCnt = (weeklyQMap['INELIGIBLE'] || 0) + (weeklyQMap['HOLD'] || 0);

    return jsonResponse({
      current_cohort: bounds,
      timezone: 'America/New_York',
      candidate_id: candidateId,
      cohort_funnel: [{
        cohort_id: bounds.cohort_id,
        total_discovered: weeklyDiscovered?.cnt || 0,
        ready_count: weeklyReadyCnt,
        stretch_count: weeklyStretchCnt,
        review_count: weeklyReviewCnt,
        ineligible_count: weeklyIneligCnt,
        active_count: weeklyDiscovered?.cnt || 0,
        closed_count: 0,
        total_tracked: weeklyTotalTracked,
        applied_count: weeklyAppliedCnt,
        interviewing_count: weeklyInterviewingCnt,
        offer_count: weeklyOfferCnt,
        rejected_count: weeklyRejectedCnt,
        application_conversion_rate: weeklyTotalTracked > 0 ? Math.round((weeklyAppliedCnt / weeklyTotalTracked) * 100) : 0,
      }],
      lifetime_inventory: {
        total_discovered: lifetimeTotalJobs?.cnt || 0,
        active_jobs: lifetimeActiveJobs?.cnt || 0,
        closed_jobs: lifetimeClosedJobs?.cnt || 0,
        ready_count: (lifetimeQMap['READY'] || 0) + (lifetimeQMap['READY_HIGH'] || 0),
        stretch_count: lifetimeQMap['STRETCH_READY'] || 0,
        review_count: lifetimeQMap['NEEDS_REVIEW'] || 0,
        ineligible_count: (lifetimeQMap['INELIGIBLE'] || 0) + (lifetimeQMap['HOLD'] || 0),
        total_tracked: lifetimeTotalTracked,
        applied_count: lifetimeAMap['APPLIED'] || 0
      },
      total_cohorts_tracked: 1,
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.get('/api/profile', async (request, env, _params, url) => {
  const candidateId = knownCandidate(url?.searchParams?.get('candidate_id'));
  if (!candidateId) return badCandidate(request, env, url?.searchParams?.get('candidate_id'));

  try {
    const cand = await env.DB.prepare(`
      SELECT * FROM candidates WHERE id = ?
    `).bind(candidateId).first<any>();

    if (!cand) {
      return jsonResponse({ error: `Profile not found for candidate ${candidateId}` }, 404, corsHeaders(request, env));
    }

    // Authoritative profile fields scoped strictly to selected candidate
    const isSana = cand.id === 'sana_ansari';
    const facts = candidateFacts(cand.id, cand);

    const full = {
      id: cand.id,
      full_name: cand.full_name,
      // The stored value wins; the fallbacks are the candidates' own documented degrees, never a generic placeholder.
      education: cand.education || facts.education_detail,
      current_location: cand.current_location,
      citizenship: cand.citizenship || 'India',
      primary_timezone: cand.primary_timezone || 'Asia/Kolkata',
      target_roles: cand.target_roles ? JSON.parse(cand.target_roles) : (isSana ? [
        'Electrical Maintenance Engineer',
        'Industrial Maintenance Engineer',
        'Reliability Engineer',
        'Power Plant Operations Engineer',
        'Plant Engineer',
        'Asset Performance Specialist'
      ] : [
        'Technical Operations Lead',
        'Implementation Manager',
        'Automation Specialist',
        'Technical Delivery Manager',
        'Solutions Implementation'
      ]),
      primary_skills: cand.primary_skills ? JSON.parse(cand.primary_skills) : (isSana ? [
        'Electrical Maintenance',
        'Industrial Maintenance',
        'Power Plant Operations',
        'Reliability',
        'Plant Engineering',
        'Equipment Troubleshooting'
      ] : [
        'GoHighLevel',
        'AI-assisted workflows',
        'API troubleshooting',
        'CRM Configuration',
        'Workflow Automation',
        'Technical Team Leadership'
      ]),
      secondary_skills: cand.secondary_skills ? JSON.parse(cand.secondary_skills) : (isSana ? [
        'Maintenance Planning',
        'Root Cause Analysis',
        'Thermal Power Generation',
        'HVAC & Utility Systems'
      ] : [
        'Rippling',
        'SaaS Business Systems',
        'Cross-Functional Technical Delivery'
      ]),
      acceptable_hiring_models: isSana ? ['DIRECT_EMPLOYEE'] : ['CONTRACTOR', 'DIRECT_EMPLOYEE'],
      min_acceptable_salary_usd: isSana ? null : 25,
      min_fixed_monthly_inr: isSana ? null : 120000,
      preferred_inr_range: isSana ? null : '₹25–30 LPA+',
      notice_period_days: isSana ? null : 30,
      location_preferences: isSana ? ['Remote (preferred)', 'On-site or hybrid is acceptable where a commercial airport is within about 2 hours (a preference to verify per posting, not established by the city name)', 'Middle East (Preference)', 'Europe (Preference)'] : ['100% Remote India'],
      relocation_interest: isSana ? true : false,
      work_authorization: ['India Citizen'],
      profile_basis: isSana ? 'Authoritative Candidate Search Brief: Sana Ansari' : 'Authoritative Candidate Search Brief: Farhan Shaikh',
      disqualifying_keywords: cand.disqualifying_keywords ? JSON.parse(cand.disqualifying_keywords) : ['US Citizen Only', 'Security Clearance', 'ITAR'],
      total_years_experience: facts.total_years_experience,
      years_basis: facts.years_basis,
      display_title: facts.display_title,
      education_short: facts.education_short,
      summary_line: facts.summary_line,
      pay_line: facts.pay_line,
      employment_history: facts.employment_history,
      target_seniorities: cand.target_seniorities ? JSON.parse(cand.target_seniorities) : (isSana ? ['MID', 'SENIOR', 'LEAD'] : ['SENIOR', 'LEAD', 'STAFF']),
      qualification_threshold: cand.qualification_threshold,
    };
    // A resold client: only what was entered for them. None of the built-in candidates' facts (pay floors, preferences,
    // briefs) are borrowed; anything not entered is empty, not invented.
    if (!BUILTIN_IDS.includes(cand.id)) {
      const cp = await env.DB.prepare('SELECT display_title, summary_line, search_profile FROM client_profiles WHERE candidate_id = ?').bind(cand.id).first<any>();
      let sp: any = null; try { sp = cp?.search_profile ? JSON.parse(cp.search_profile) : null; } catch {}
      const home = sp?.home_country || 'India';
      Object.assign(full, {
        display_title: cp?.display_title || '', summary_line: cp?.summary_line || '',
        target_roles: sp?.role_keywords || (cand.target_roles ? JSON.parse(cand.target_roles) : []),
        secondary_skills: cand.secondary_skills ? JSON.parse(cand.secondary_skills) : [],
        target_seniorities: cand.target_seniorities ? JSON.parse(cand.target_seniorities) : [],
        disqualifying_keywords: sp?.avoid_keywords || [],
        acceptable_hiring_models: [], min_acceptable_salary_usd: null, min_fixed_monthly_inr: null, preferred_inr_range: null, notice_period_days: null,
        location_preferences: sp ? [sp.location_mode === 'HOME_OR_RELOCATE' ? `${home}, or postings offering sponsorship or worldwide remote work` : `Fully remote from ${home}`] : [],
        relocation_interest: sp?.location_mode === 'HOME_OR_RELOCATE',
        work_authorization: [], profile_basis: 'Client profile entered by the operator',
        pay_line: 'Pay floor and notice period: not provided.', employment_history: [],
        search_profile: sp,
      });
      (facts as any).public_summary = cp?.summary_line || '';
    }
    if (isOperatorRequest(request)) return jsonResponse(full, 200, corsHeaders(request, env));
    // Public profile summary: explicitly selected fields only. Employers, pay, notice, city, relocation and location
    // preferences, contact details and documents are operator-only.
    return jsonResponse({
      id: full.id,
      full_name: full.full_name,
      display_title: full.display_title,
      summary_line: facts.public_summary,
      education: full.education,
      education_short: full.education_short,
      current_location: publicLocation(cand.current_location),
      primary_timezone: full.primary_timezone,
      target_roles: full.target_roles,
      primary_skills: full.primary_skills,
      secondary_skills: full.secondary_skills,
      target_seniorities: full.target_seniorities,
      total_years_experience: full.total_years_experience,
      years_basis: full.years_basis,
      public_view: true,
    }, 200, corsHeaders(request, env));
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.put('/api/profile', async (request, env, _params, url) => {
  try {
    const preBody = await request.clone().json<any>().catch(() => null);
    if (preBody && preBody.public_view) return jsonResponse({ error: 'The public profile summary is read-only and cannot be saved.' }, 400, corsHeaders(request, env));
    
    const body = await request.json<any>().catch(() => null);
    if (!body || typeof body !== 'object') return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, corsHeaders(request, env));
    const candidateId = url?.searchParams?.get('candidate_id') || body.id;

    if (!knownCandidate(candidateId)) {
      return jsonResponse({ error: 'Valid candidate_id parameter is required for profile mutation.' }, 400, corsHeaders(request, env));
    }
    // A form that still carries the other candidate's id must never overwrite this candidate's record.
    if (body.id && body.id !== candidateId) {
      return jsonResponse({ error: `Profile id ${body.id} does not match candidate ${candidateId}; nothing was saved.` }, 409, corsHeaders(request, env));
    }

    const existing = await env.DB.prepare('SELECT full_name, current_location, total_years_experience, qualification_threshold FROM candidates WHERE id = ?').bind(candidateId).first<any>();
    if (!existing) return jsonResponse({ error: `Profile not found for candidate ${candidateId}` }, 404, corsHeaders(request, env));
    // Only the fields the caller sent change; everything else keeps its stored value (no constants written over data).
    const num = (v: unknown, fallback: number) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
    await env.DB.prepare(`
      UPDATE candidates
      SET full_name = ?, current_location = ?, total_years_experience = ?, qualification_threshold = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      typeof body.full_name === 'string' && body.full_name.trim() ? body.full_name.trim() : existing.full_name,
      typeof body.current_location === 'string' && body.current_location.trim() ? body.current_location.trim() : existing.current_location,
      num(body.total_years_experience, existing.total_years_experience),
      num(body.qualification_threshold, existing.qualification_threshold),
      candidateId
    ).run();

    const redirectUrl = new URL(request.url);
    redirectUrl.pathname = '/api/profile';
    redirectUrl.searchParams.set('candidate_id', candidateId);
    return router.handle(new Request(redirectUrl.toString(), { method: 'GET', headers: request.headers }), env);
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500, corsHeaders(request, env));
  }
});

router.post('/api/profile/import-resume', async (request, env) => {
  return jsonResponse({
    status: 'parsed_preview',
    parsed: {
      full_name: 'Farhan Shaikh',
      seniority: 'Senior',
      total_years_experience: 4,
      detected_skills: ['Python', 'Automation', 'TypeScript', 'SQL'],
      primary_skills: ['Python', 'Automation'],
      secondary_skills: ['TypeScript', 'SQL'],
      detected_roles: ['Workflow Automation Engineer'],
      suggested_profile: {},
    },
  }, 200, corsHeaders(request, env));
});

// Real cloud discovery source state and durable execution history.
router.get('/api/sources', async (request,env) => {
 const {results}=await env.DB.prepare('SELECT * FROM cloud_sources ORDER BY id').all<any>();
 return jsonResponse({count:results.length,sources:results.map(r=>({...r,adapter_type:r.kind,organization_slug:r.slug,is_active:!!r.enabled,is_live_approved:true,permitted_method:'GET',feed_url:sourceURL(r),coverage_type:['jobicy','remotive','hnjobs'].includes(r.kind)?'multi_employer':'single_employer',rate_limit_policy:'Bounded rotating pages; 12-hour refresh after completed scan',last_status:r.last_status,total_jobs_fetched:r.last_seen}))},200,corsHeaders(request,env));
});
router.get('/api/automation/status', async (request,env)=>jsonResponse(await automationStatus(env.DB),200,corsHeaders(request,env)));
router.get('/api/automation/runs', async (request,env)=>{
 const {results}=await env.DB.prepare('SELECT *,error_message as error FROM cloud_discovery_runs ORDER BY started_at DESC LIMIT 50').all();
 return jsonResponse({count:results.length,runs:results},200,corsHeaders(request,env));
});
router.get('/api/automation/url-checks', async (request,env)=>jsonResponse({count:0,checks:[],supported:false,message:'Discovery fetches official posting details. Standalone bulk URL verification is unavailable.'},200,corsHeaders(request,env)));
for(const action of ['pause','resume'])router.post('/api/automation/'+action,async(request,env)=>{
 await env.DB.prepare('UPDATE cloud_automation SET enabled=?,updated_at=? WHERE id=1').bind(action==='resume'?1:0,new Date().toISOString()).run();
 return jsonResponse({status:'success',config:(await automationStatus(env.DB)).config},200,corsHeaders(request,env));
});
router.put('/api/automation/config',async(request,env)=>{
 const body=await request.json<any>();
 if(typeof body.is_enabled!=='boolean'&&body.is_enabled!==0&&body.is_enabled!==1)return jsonResponse({error:'Only is_enabled can be configured; fixed work budgets protect the free tier.'},400,corsHeaders(request,env));
 await env.DB.prepare('UPDATE cloud_automation SET enabled=?,updated_at=? WHERE id=1').bind(body.is_enabled?1:0,new Date().toISOString()).run();
 return jsonResponse({config:(await automationStatus(env.DB)).config},200,corsHeaders(request,env));
});
router.post('/api/automation/trigger',async(request,env)=>{
 let preferredSource:string|undefined;
 try {const body=await request.json<any>();if(typeof body?.source_id==='string')preferredSource=body.source_id;}catch{}
 const summary=await runDiscovery(env,'MANUAL',fetch,preferredSource);
 return jsonResponse({status:summary.status,summary:{jobs_seen:0,jobs_new:0,jobs_unchanged:0,duration_ms:0,memory_peak_mb:null,...summary}},summary.status==='ERROR'?502:200,corsHeaders(request,env));
});
router.post('/api/automation/verify-urls',async(request,env)=>jsonResponse({error:'Standalone bulk URL verification is not implemented; no URLs were checked.'},501,corsHeaders(request,env)));
router.post('/api/fixtures/reload',async(request,env)=>jsonResponse({error:'Synthetic fixture imports are disabled in production.'},410,corsHeaders(request,env)));

router.get('/api/pilot', async (request, env) => {
  return jsonResponse({ available: false }, 200, corsHeaders(request, env));
});

router.get('/api/sync/conflicts', async (request, env) => {
  return jsonResponse({ count: 0, conflicts: [] }, 200, corsHeaders(request, env));
});

router.get('/api/sync/activity-logs', async (request, env) => {
  return jsonResponse({ count: 0, activity_logs: [], logs: [] }, 200, corsHeaders(request, env));
});

router.get('/api/backups', async (request, env) => {
  return jsonResponse({ count: 0, backups: [] }, 200, corsHeaders(request, env));
});

// Canonical Sync fallbacks for cloud
router.get('/api/canonical-sync/status', async (request, env) => {
  return jsonResponse({
    is_connected: true,
    provider: 'cloudflare_d1',
    status_display: 'CONNECTED',
    details: { message: 'Cloudflare D1 is authoritative cloud storage.' },
    last_import_at: (await env.DB.prepare("SELECT updated_at FROM app_meta WHERE key='migration_status'").first<{updated_at:string}>())?.updated_at || null,
    last_propose_at: null,
    conflicts_count: 0,
    pending_ready_to_propose: 0,
    staged_proposals_count: 0,
  }, 200, corsHeaders(request, env));
});

// -------------------------------------------------------------
// Clients (operator only): onboarding, profile edits, backfill, share links. Plus the CSV export (public read, visibility-checked).
// -------------------------------------------------------------
const clientRow = async (env: Env, id: string) => env.DB.prepare(`SELECT c.id, c.full_name, c.current_location, c.citizenship, c.primary_timezone, c.total_years_experience,
  c.qualification_threshold, c.primary_skills, p.visibility, p.display_title, p.summary_line, p.search_profile, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM client_view_tokens t WHERE t.candidate_id = c.id AND t.revoked_at IS NULL) AS active_share_links
  FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id WHERE c.id = ?`).bind(id).first<any>();
const shapeClient = (r: any) => r && ({
  ...r, builtin: BUILTIN_IDS.includes(r.id), visibility: r.visibility || (BUILTIN_IDS.includes(r.id) ? 'public' : 'private'),
  primary_skills: (() => { try { return JSON.parse(r.primary_skills || '[]'); } catch { return []; } })(),
  search_profile: (() => { try { return r.search_profile ? JSON.parse(r.search_profile) : null; } catch { return null; } })(),
});
const readJson = async (request: Request) => { try { return await request.json<any>(); } catch { return null; } };

router.get('/api/clients', async (request, env) => {
  // two queries for any number of clients (Workers Free allows 50 queries per request)
  const { results } = await env.DB.prepare(`SELECT c.id, c.full_name, c.current_location, c.citizenship, c.primary_timezone, c.total_years_experience,
    c.qualification_threshold, c.primary_skills, p.visibility, p.display_title, p.summary_line, p.search_profile, p.created_at, p.updated_at,
    (SELECT COUNT(*) FROM client_view_tokens t WHERE t.candidate_id = c.id AND t.revoked_at IS NULL) AS active_share_links
    FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id ORDER BY c.full_name`).all<any>();
  const { results: counts } = await env.DB.prepare(`SELECT candidate_id, COUNT(*) AS jobs,
    SUM(CASE WHEN qualification_status IN ('READY','READY_HIGH','STRETCH_READY') THEN 1 ELSE 0 END) AS apply_worthy
    FROM candidate_qualifications GROUP BY candidate_id`).all<any>();
  const by = new Map((counts || []).map((r: any) => [r.candidate_id, r]));
  const clients = (results || []).map((r: any) => ({ ...shapeClient(r), jobs_screened: by.get(r.id)?.jobs || 0, apply_worthy: by.get(r.id)?.apply_worthy || 0 }));
  return jsonResponse({ clients }, 200, corsHeaders(request, env));
});

router.post('/api/clients', async (request, env) => {
  const body = await readJson(request);
  const parsed = parseClient(body);
  if (!parsed.ok) return jsonResponse({ error: parsed.error, detail: parsed.error }, 400, corsHeaders(request, env));
  const v = parsed.value as any;
  const id = body?.id ? String(body.id) : slugId(v.full_name);
  if (!CLIENT_ID.test(id)) return jsonResponse({ error: 'id must be 3-40 characters: lowercase letters, digits and _ , starting with a letter.' }, 400, corsHeaders(request, env));
  if (await env.DB.prepare('SELECT 1 FROM candidates WHERE id = ?').bind(id).first()) return jsonResponse({ error: `A client with id '${id}' already exists.` }, 409, corsHeaders(request, env));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO candidates(id, full_name, current_location, citizenship, primary_timezone, total_years_experience, qualification_threshold, primary_skills, target_roles)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, v.full_name, v.current_location || null, v.citizenship || 'India', v.primary_timezone || 'Asia/Kolkata',
      v.total_years_experience ?? 0, v.qualification_threshold, JSON.stringify(v.primary_skills || []), JSON.stringify(v.search_profile.role_keywords)),
    env.DB.prepare(`INSERT INTO client_profiles(candidate_id, visibility, display_title, summary_line, search_profile) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, v.visibility, v.display_title || null, v.summary_line || null, JSON.stringify(v.search_profile)),
  ]);
  forgetRegistry(env.DB); await syncRegistry(env, true);
  return jsonResponse({ client: shapeClient(await clientRow(env, id)), next: 'POST /api/clients/' + id + '/backfill screens the existing active jobs for this client (40 per call; repeat while more is true).' }, 201, corsHeaders(request, env));
});

router.put('/api/clients/:id', async (request, env, params) => {
  const id = knownCandidate(params.id);
  if (!id) return badCandidate(request, env, params.id);
  const body = await readJson(request);
  const parsed = parseClient(body, true);
  if (!parsed.ok) return jsonResponse({ error: parsed.error, detail: parsed.error }, 400, corsHeaders(request, env));
  const v = parsed.value as any;
  if (BUILTIN_IDS.includes(id) && (v.visibility !== undefined || v.search_profile !== undefined))
    return jsonResponse({ error: 'The two built-in candidates keep their visibility and built-in screening rules.' }, 400, corsHeaders(request, env));
  const cand: [string, any][] = [['full_name', v.full_name], ['current_location', v.current_location], ['citizenship', v.citizenship], ['primary_timezone', v.primary_timezone],
    ['total_years_experience', v.total_years_experience], ['qualification_threshold', v.qualification_threshold],
    ['primary_skills', v.primary_skills === undefined ? undefined : JSON.stringify(v.primary_skills)]];
  const prof: [string, any][] = [['visibility', v.visibility], ['display_title', v.display_title], ['summary_line', v.summary_line],
    ['search_profile', v.search_profile === undefined ? undefined : JSON.stringify(v.search_profile)]];
  const set = (list: [string, any][]) => list.filter(([, x]) => x !== undefined);
  const stmts: D1PreparedStatement[] = [];
  const c = set(cand), pr = set(prof);
  if (c.length) stmts.push(env.DB.prepare(`UPDATE candidates SET ${c.map(([k]) => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...c.map(([, x]) => x), id));
  if (pr.length) {
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO client_profiles(candidate_id, visibility) VALUES (?, ?)`).bind(id, BUILTIN_IDS.includes(id) ? 'public' : 'private'));
    stmts.push(env.DB.prepare(`UPDATE client_profiles SET ${pr.map(([k]) => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE candidate_id = ?`).bind(...pr.map(([, x]) => x), id));
  }
  if (!stmts.length) return jsonResponse({ error: 'Nothing to change.' }, 400, corsHeaders(request, env));
  await env.DB.batch(stmts);
  forgetRegistry(env.DB); await syncRegistry(env, true);
  // A changed search profile applies to new screening; rows already screened keep their recorded result (no silent rewrite).
  return jsonResponse({ client: shapeClient(await clientRow(env, id)) }, 200, corsHeaders(request, env));
});

router.post('/api/clients/:id/backfill', async (request, env, params, url) => {
  const id = knownCandidate(params.id);
  if (!id) return badCandidate(request, env, params.id);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 1), 40);
  const res = await backfillClient(env.DB, id, limit);
  return jsonResponse({ candidate_id: id, ...res }, 200, corsHeaders(request, env));
});

router.get('/api/clients/:id/share-links', async (request, env, params) => {
  const id = knownCandidate(params.id);
  if (!id) return badCandidate(request, env, params.id);
  const { results } = await env.DB.prepare(`SELECT substr(token_hash, 1, 12) AS link_id, label, created_at, revoked_at FROM client_view_tokens WHERE candidate_id = ? ORDER BY created_at DESC`).bind(id).all<any>();
  return jsonResponse({ candidate_id: id, share_links: results || [] }, 200, corsHeaders(request, env));
});

router.post('/api/clients/:id/share-links', async (request, env, params) => {
  const id = knownCandidate(params.id);
  if (!id) return badCandidate(request, env, params.id);
  const body = await readJson(request);
  const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 60) : '';
  const token = newViewToken(), hash = await sha256Hex(token);
  await env.DB.prepare('INSERT INTO client_view_tokens(token_hash, candidate_id, label) VALUES (?, ?, ?)').bind(hash, id, label || null).run();
  // The token is returned once and never stored in plain form. The link carries it after '#', so it is not sent in requests or logged.
  return jsonResponse({ candidate_id: id, link_id: hash.slice(0, 12), label: label || null, token, path: `/app#view=${token}&candidate=${id}`,
    note: 'Shown once. Anyone with this link can read this client’s dashboard (read-only) until it is revoked.' }, 201, corsHeaders(request, env));
});

router.delete('/api/clients/:id/share-links/:link', async (request, env, params) => {
  const id = knownCandidate(params.id);
  if (!id) return badCandidate(request, env, params.id);
  if (!/^[0-9a-f]{12}$/.test(params.link || '')) return jsonResponse({ error: 'Unknown share link.' }, 404, corsHeaders(request, env));
  const r = await env.DB.prepare(`UPDATE client_view_tokens SET revoked_at = datetime('now') WHERE candidate_id = ? AND substr(token_hash, 1, 12) = ? AND revoked_at IS NULL`).bind(id, params.link).run();
  if (!r.meta?.changes) return jsonResponse({ error: 'Unknown or already revoked share link.' }, 404, corsHeaders(request, env));
  return jsonResponse({ candidate_id: id, link_id: params.link, revoked: true }, 200, corsHeaders(request, env));
});

// CSV of one client's screened jobs (active only), in the list's score order (score, then newest, then id), at most 1,000 rows. Public field set only (no notes,
// override reasons or pay floors); the visibility guard above already decided whether this request may see the client.
const EXPORT_MAX = 1000;
router.get('/api/export', async (request, env, _params, url) => {
  const id = knownCandidate(url.searchParams.get('candidate_id'));
  if (!id) return badCandidate(request, env, url.searchParams.get('candidate_id'));
  const st = url.searchParams.get('qualification_status') || 'ALL';
  if (st !== 'ALL' && st !== 'APPLY_WORTHY' && !QUAL.includes(st)) return jsonResponse({ error: 'Unsupported qualification_status.', detail: 'Unsupported qualification_status.' }, 400, corsHeaders(request, env));
  const where = st === 'ALL' ? '' : st === 'APPLY_WORTHY' ? ` AND q.qualification_status IN ('READY','READY_HIGH','STRETCH_READY')` : ' AND q.qualification_status = ?';
  const { results } = await env.DB.prepare(`SELECT j.id, j.title, j.company, j.location_restrictions, j.workplace_type, COALESCE(j.original_posting_url, j.source_url) AS url,
      j.salary_published, j.salary_raw_text, j.discovered_at, q.qualification_status, q.eligibility_status, q.strategy_lane, s.overall_score,
      (SELECT a.status FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id ORDER BY a.rowid DESC LIMIT 1) AS application_status
    FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id LEFT JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id
    WHERE q.candidate_id = ? AND j.is_active = 1${where} ORDER BY COALESCE(s.overall_score, 0) DESC, j.discovered_at DESC, q.job_id LIMIT ${EXPORT_MAX}`)
    .bind(...(st === 'ALL' || st === 'APPLY_WORTHY' ? [id] : [id, st])).all<any>();
  const head = ['job_id', 'title', 'company', 'location', 'workplace', 'posting_url', 'qualification_status', 'eligibility', 'lane', 'preliminary_score', 'pay_published', 'pay_text', 'application_status', 'discovered_at'];
  const lines = [csvRow(head), ...(results || []).map((r: any) => csvRow([r.id, r.title, r.company, r.location_restrictions, r.workplace_type, r.url, r.qualification_status,
    r.eligibility_status, r.strategy_lane, r.overall_score ?? '', r.salary_published ? 'yes' : 'no', r.salary_published ? r.salary_raw_text : '', r.application_status || '', r.discovered_at]))];
  return new Response(lines.join('\r\n') + '\r\n', { status: 200, headers: { ...corsHeaders(request, env), 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${id}-jobs-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
});

// -------------------------------------------------------------
// Public site (server-rendered; the dashboard app lives at /app) and its operator settings and request inbox.
// -------------------------------------------------------------
const SITE_PATHS = new Set(['/', '/how-it-works', '/pricing', '/faq', '/about', '/apply', '/apply/thanks', '/portal', '/privacy', '/terms', '/robots.txt', '/sitemap.xml']);
const APPLY_MAX_BYTES = 20000;
/** The request body as text, or null when it exceeds `max` bytes (stops reading at the cap). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await reader.cancel(); } catch {} return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}
const SITE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' };
async function handleSite(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  if (!SITE_PATHS.has(path)) {
    // anything else under /apply/ is a site address that does not exist: an HTML page, not the API's JSON
    if (!path.startsWith('/apply/')) return null;
    const s404 = await site.loadSettings(env.DB);
    return new Response(site.layout(s404, { title: `Not found · ${s404.brand_name}`, description: '', path, body: site.notFoundPage(), origin: url.origin, noindex: true }), { status: 404, headers: { ...SITE_HEADERS, 'Cache-Control': 'no-store' } });
  }
  const origin = url.origin;
  if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
  if (path === '/sitemap.xml') return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/how-it-works', '/pricing', '/faq', '/about', '/apply', '/privacy', '/terms'].map((p) => `<url><loc>${origin}${p}</loc></url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml' } });
  const s = await site.loadSettings(env.DB);
  const page = (title: string, description: string, body: string, opts: { status?: number; noindex?: boolean; stats?: any; cache?: boolean } = {}) =>
    new Response(site.layout(s, { title, description, path, body, origin, stats: opts.stats, noindex: opts.noindex }), { status: opts.status || 200,
      headers: { ...SITE_HEADERS, 'Cache-Control': opts.cache === false ? 'no-store' : 'public, max-age=120' } });
  const brand = s.brand_name;
  if (path === '/apply' && request.method === 'POST') {
    const tooLarge = () => page(`Apply · ${brand}`, '', site.applyPage(s, {}, ['The form was too large.']), { status: 413, cache: false, noindex: true });
    if (Number(request.headers.get('Content-Length') || 0) > APPLY_MAX_BYTES) return tooLarge();
    // The body is read with a hard byte cap whatever the headers say (a chunked body has no Content-Length).
    const raw = await readCapped(request, APPLY_MAX_BYTES);
    if (raw === null) return tooLarge();
    const form: Record<string, string> = {};
    if (/application\/x-www-form-urlencoded/i.test(request.headers.get('Content-Type') || '')) new URLSearchParams(raw).forEach((v, k) => { if (!(k in form)) form[k] = v; });
    if (form.company_website) return Response.redirect(origin + '/apply/thanks', 303);   // honeypot: look successful, store nothing
    const checked = site.validateApply(form);
    if (!checked.ok) return page(`Apply · ${brand}`, '', site.applyPage(s, checked.value, checked.errors), { status: 400, cache: false, noindex: true });
    const day = new Date().toISOString().slice(0, 10);
    // One bucket per network (/64 for IPv6), keyed with a server secret so the stored value cannot be reversed by enumerating
    // addresses; erased after a day (below). A global daily cap bounds what the form can write in total.
    const sourceHash = await sha256Hex(`${env.ADMIN_API_KEY || 'no-key'}|${await clientKey(request)}|${day}|apply`);
    await env.DB.prepare(`UPDATE client_requests SET source_hash = NULL WHERE created_at < ? AND source_hash IS NOT NULL`).bind(day).run();
    const v = checked.value;
    // One statement: the limits are checked and the row inserted atomically, so concurrent posts cannot exceed them.
    const ins = await env.DB.prepare(`INSERT INTO client_requests(id, full_name, email, phone, current_location, target_roles, work_preference, years_experience, linkedin_url, plan, message, source_hash)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM client_requests WHERE source_hash = ? AND created_at >= ?) < ?
        AND (SELECT COUNT(*) FROM client_requests WHERE created_at >= ?) < ?`)
      .bind(crypto.randomUUID(), v.full_name, v.email, v.phone || null, v.current_location, v.target_roles, v.work_preference || null, v.years_experience || null,
        v.linkedin_url || null, v.plan || null, v.message || null, sourceHash, sourceHash, day, site.APPLY_PER_SOURCE_PER_DAY, day, site.APPLY_PER_DAY_TOTAL).run();
    if (!ins.meta?.changes) return page(`Apply · ${brand}`, '', site.applyPage(s, checked.value, ['We cannot take more applications today. Please try again tomorrow.']), { status: 429, cache: false, noindex: true });
    return Response.redirect(origin + '/apply/thanks', 303);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  switch (path) {
    case '/': { const st = await site.siteStats(env.DB); return page(`${brand} · ${s.tagline}`, `${brand} screens new job postings from employers' own hiring systems every day and gives you a private shortlist with the evidence for every match.`, site.homePage(s, st), { stats: st }); }
    case '/how-it-works': return page(`How it works · ${brand}`, 'From thousands of postings to a short, honest list: how the engine finds, screens and shortlists roles for you.', site.howPage());
    case '/pricing': return page(`Pricing · ${brand}`, 'Simple monthly plans for a private, daily-screened job dashboard.', site.pricingPage(s));
    case '/faq': return page(`FAQ · ${brand}`, 'Answers about sources, eligibility, privacy and how the job search engine works.', site.faqPage());
    case '/about': { const st = await site.siteStats(env.DB); return page(`About · ${brand}`, `${brand}: a job search engine that shows its work.`, site.aboutPage(s, st), { stats: st }); }
    case '/apply': { const plan = url.searchParams.get('plan') || ''; return page(`Apply · ${brand}`, 'Apply for a private, daily-screened job dashboard.', site.applyPage(s, { plan: ['1', '2', '3'].includes(plan) ? plan : '', work_preference: 'REMOTE_FROM_HOME' }), { cache: false }); }
    case '/apply/thanks': return page(`Thank you · ${brand}`, '', site.thanksPage(s), { noindex: true });
    case '/portal': return page(`Client login · ${brand}`, 'Open your private job dashboard.', site.portalPage(), { noindex: true });
    case '/privacy': return page(`Privacy · ${brand}`, 'What we collect, why, and how to have it removed.', site.privacyPage(s));
    case '/terms': return page(`Terms · ${brand}`, `Terms of service for ${brand}.`, site.termsPage(s));
  }
  return null;
}

const REQUEST_STATUSES = ['NEW', 'CONTACTED', 'CONVERTED', 'DECLINED'];
router.get('/api/client-requests', async (request, env, _p, url) => {
  const st = url.searchParams.get('status') || 'OPEN';
  if (st !== 'OPEN' && st !== 'ALL' && !REQUEST_STATUSES.includes(st)) return jsonResponse({ error: 'Unsupported status.' }, 400, corsHeaders(request, env));
  const where = st === 'ALL' ? '' : st === 'OPEN' ? `WHERE status IN ('NEW','CONTACTED')` : 'WHERE status = ?';
  const { results } = await env.DB.prepare(`SELECT id, full_name, email, phone, current_location, target_roles, work_preference, years_experience, linkedin_url, plan, message, status, candidate_id, created_at, updated_at
    FROM client_requests ${where} ORDER BY created_at DESC LIMIT 200`).bind(...(REQUEST_STATUSES.includes(st) ? [st] : [])).all<any>();
  const counts = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM client_requests GROUP BY status`).all<any>();
  return jsonResponse({ requests: results || [], counts: Object.fromEntries((counts.results || []).map((r: any) => [r.status, r.n])) }, 200, corsHeaders(request, env));
});
router.put('/api/client-requests/:id', async (request, env, params) => {
  const body = await readJson(request);
  const status = body?.status;
  if (!REQUEST_STATUSES.includes(status)) return jsonResponse({ error: 'status must be NEW, CONTACTED, CONVERTED or DECLINED.' }, 400, corsHeaders(request, env));
  const cid = body?.candidate_id === undefined ? undefined : body.candidate_id === null ? null : knownCandidate(body.candidate_id);
  if (body?.candidate_id && !cid) return jsonResponse({ error: 'Unknown candidate_id.' }, 400, corsHeaders(request, env));
  const r = await env.DB.prepare(`UPDATE client_requests SET status = ?, candidate_id = CASE WHEN ? THEN ? ELSE candidate_id END, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, cid === undefined ? 0 : 1, cid ?? null, params.id).run();
  if (!r.meta?.changes) return jsonResponse({ error: 'Unknown request.' }, 404, corsHeaders(request, env));
  return jsonResponse({ id: params.id, status, candidate_id: cid ?? null }, 200, corsHeaders(request, env));
});
// Erases an application entirely (the privacy notice promises deletion on request).
router.delete('/api/client-requests/:id', async (request, env, params) => {
  const r = await env.DB.prepare('DELETE FROM client_requests WHERE id = ?').bind(params.id).run();
  if (!r.meta?.changes) return jsonResponse({ error: 'Unknown request.' }, 404, corsHeaders(request, env));
  return jsonResponse({ id: params.id, deleted: true }, 200, corsHeaders(request, env));
});
router.get('/api/site-settings', async (request, env) => {
  const s = await site.loadSettings(env.DB);
  return jsonResponse({ settings: s, defaults: site.SETTING_DEFAULTS }, 200, corsHeaders(request, env));
});
router.put('/api/site-settings', async (request, env) => {
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return jsonResponse({ error: 'A JSON object of settings is required.' }, 400, corsHeaders(request, env));
  const stmts: D1PreparedStatement[] = [];
  for (const [k, v] of Object.entries(body)) {
    const clean = site.cleanSetting(k, v);
    if (clean === null) return jsonResponse({ error: `Invalid setting '${String(k).slice(0, 40)}'.`, detail: k === 'contact_email' ? 'contact_email must be an email address or empty.' : 'Unknown setting or wrong type.' }, 400, corsHeaders(request, env));
    stmts.push(env.DB.prepare(`INSERT INTO site_settings(key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(k, clean));
  }
  if (stmts.length) await env.DB.batch(stmts);
  site.forgetSettings();
  return jsonResponse({ settings: await site.loadSettings(env.DB) }, 200, corsHeaders(request, env));
});

// Main export for Cloudflare Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const u = new URL(request.url);
      if (!u.pathname.startsWith('/api/')) {
        const page = await handleSite(request, env, u);
        if (page) return page;
      }
      const res = await router.handle(request, env);
      if (!new URL(request.url).pathname.startsWith('/api/')) return res;
      // Every API answer names the commit that produced it, so post-deploy checks can tell this version from the previous one.
      const headers = new Headers(res.headers);
      headers.set('X-Worker-Commit', env.GIT_COMMIT || 'unknown');
      return new Response(res.body, { status: res.status, headers });
    } catch (err: any) {
      const pathname = new URL(request.url).pathname;
      logPrivately('worker_error', pathname, err?.message || err);
      if (!pathname.startsWith('/api/')) return new Response('Temporarily unavailable', { status: 503, headers: { 'Retry-After': '300' } });
      return jsonResponse(isDatabaseFailure(err?.message) ? UNAVAILABLE : { error: 'Internal error. The request was not completed.' },
        isDatabaseFailure(err?.message) ? 503 : 500, { ...corsHeaders(request, env), 'Retry-After': '300', 'X-Worker-Commit': env.GIT_COMMIT || 'unknown' });
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const result = await runDiscovery(env, 'CRON');
    console.log(JSON.stringify({event:'cloud_discovery',...result}));
    // Every fifth tick (about every 10 minutes) a small batch of collector imports is assessed. It is independent of discovery:
    // a discovery error does not stop it, and its own error is reported, not swallowed.
    let assessError: unknown = null;
    if (Math.floor((controller?.scheduledTime || Date.now()) / 120000) % ASSESS_EVERY_TICKS === 0) {
      try { const a = await assessBacklog(env.DB); if (a.assessed) console.log(JSON.stringify({ event: 'collector_assessment', ...a })); }
      catch (e: any) { assessError = e; console.log(JSON.stringify({ event: 'collector_assessment', status: 'ERROR', error: String(e?.message || e).slice(0, 300) })); }
    }
    // The public site's figures, at most hourly (one row read per check, a full count only when stale).
    if (Math.floor((controller?.scheduledTime || Date.now()) / 120000) % 15 === 1) {
      try { if (await site.refreshSiteStats(env.DB)) console.log(JSON.stringify({ event: 'site_stats', status: 'UPDATED' })); }
      catch (e: any) { console.log(JSON.stringify({ event: 'site_stats', status: 'ERROR', error: String(e?.message || e).slice(0, 200) })); }
    }
    if(result.status==='ERROR') throw new Error('Cloud discovery work unit failed; see durable run history.');
    if (assessError) throw new Error('Collector assessment batch failed; see the Worker log.');
  },
};
