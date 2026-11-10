// Client registry, visibility and read-only share links for resold client profiles.
// The two original candidates are built in (public, built-in screening rules). Every other client is created by the operator,
// is private by default, and is readable without the operator key only with a share link made for that client.
import { parseProfile, type SearchProfile } from './discovery';

export const BUILTIN_IDS = ['farhan_shaikh', 'sana_ansari'];
export type Registry = { at: number; generation: number | null; ids: Set<string>; privateIds: Set<string>; titles: Map<string, string | null> };
const REGISTRY_TTL_MS = 60_000;
const registries = new WeakMap<object, Registry>();

/** Candidates and their visibility, read at most once a minute per database binding. A candidate without a profile row is
 *  private unless it is one of the two built-in ones (so a row added by hand is never exposed by accident). */
// Every operator change bumps the cache generation (index.ts), so a registry read under an older generation is reloaded at once: a
// client made private is never served as public by another isolate, nor re-cached as public.
export async function loadRegistry(db: D1Database, force = false, now = Date.now()): Promise<Registry> {
  const key = db as unknown as object;
  const cur = registries.get(key);
  let generation: number | null = null;
  try { generation = (await db.prepare('SELECT generation FROM cache_state WHERE id = 1').first<any>())?.generation ?? null; } catch {}
  if (cur && !force && now - cur.at < REGISTRY_TTL_MS && cur.generation === generation) return cur;
  const reg: Registry = { at: now, generation, ids: new Set(BUILTIN_IDS), privateIds: new Set(), titles: new Map() };
  try {
    const { results } = await db.prepare(`SELECT c.id, p.visibility, p.display_title FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id`).all<any>();
    for (const r of results || []) {
      reg.ids.add(r.id);
      reg.titles.set(r.id, r.display_title ?? null);
      if (r.visibility === 'private' || (r.visibility == null && !BUILTIN_IDS.includes(r.id))) reg.privateIds.add(r.id);
    }
  } catch {
    // client_profiles not migrated yet: the built-in candidates only, as before
    try { const { results } = await db.prepare('SELECT id FROM candidates').all<any>(); for (const r of results || []) { reg.ids.add(r.id); if (!BUILTIN_IDS.includes(r.id)) reg.privateIds.add(r.id); } } catch {}
  }
  registries.set(key, reg);
  return reg;
}
export function forgetRegistry(db: D1Database) { registries.delete(db as unknown as object); }

/** Every candidate a request names: the query parameter AND the /api/candidates/:id/... path segment. A request that names two must be allowed for both:
 *  the /api/candidates/:id/... handlers answer for the path id and ignore the query, so checking only one would let `?candidate_id=<visible>` unlock a private path id. */
export function referencedCandidates(url: URL): string[] {
  const ids: string[] = [];
  const q = url.searchParams.get('candidate_id');
  if (q) ids.push(q);
  const m = url.pathname.match(/^\/api\/candidates\/([^/]+)(\/|$)/);
  if (m) { let id = m[1]; try { id = decodeURIComponent(m[1]); } catch { /* keep the raw segment */ } if (!ids.includes(id)) ids.push(id); }
  return ids;
}
/** The first candidate a request names (kept for callers that need one). */
export function referencedCandidate(url: URL): string | null { return referencedCandidates(url)[0] ?? null; }

// ---- Share links ---------------------------------------------------------------------------------------------------------
export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function newViewToken(): string {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return 'v1_' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const TOKEN_SHAPE = /^v1_[0-9a-f]{48}$/;
/** The client a share token grants read access to, or null (unknown, revoked or malformed). */
export async function viewTokenCandidate(db: D1Database, token: string | null): Promise<string | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  try {
    const row = await db.prepare('SELECT candidate_id FROM client_view_tokens WHERE token_hash = ? AND revoked_at IS NULL').bind(await sha256Hex(token)).first<any>();
    return row?.candidate_id ?? null;
  } catch { return null; }
}

// ---- Client input validation -----------------------------------------------------------------------------------------------
export const CLIENT_ID = /^[a-z][a-z0-9_]{2,39}$/;
export function slugId(name: string): string {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return /^[a-z]/.test(s) ? s : 'client_' + s;
}
const text = (v: any, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const words = (v: any) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((w: any) => text(String(w), 60)).filter((w: string) => w.length >= 2).slice(0, 40);
export type ClientInput = {
  full_name: string; current_location: string; citizenship: string; primary_timezone: string; total_years_experience: number | null;
  qualification_threshold: number; primary_skills: string[]; visibility: 'public' | 'private'; display_title: string; summary_line: string;
  search_profile: SearchProfile;
};
/** Validates a client body. `partial` = an update: only the fields given are checked and returned. */
export function parseClient(body: any, partial = false): { ok: true; value: Partial<ClientInput> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'A JSON object is required.' };
  const out: Partial<ClientInput> = {};
  const has = (k: string) => body[k] !== undefined;
  if (!partial || has('full_name')) { const n = text(body.full_name, 80); if (n.length < 2) return { ok: false, error: 'full_name is required (2-80 characters).' }; out.full_name = n; }
  if (has('current_location')) out.current_location = text(body.current_location, 80);
  if (has('citizenship')) out.citizenship = text(body.citizenship, 60);
  if (has('primary_timezone')) { const tz = text(body.primary_timezone, 60); try { if (tz) new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { return { ok: false, error: 'primary_timezone must be an IANA time zone, e.g. Asia/Kolkata.' }; } out.primary_timezone = tz; }
  if (has('total_years_experience')) { const y = body.total_years_experience === null || body.total_years_experience === '' ? null : Number(body.total_years_experience); if (y !== null && !(y >= 0 && y <= 60)) return { ok: false, error: 'total_years_experience must be 0-60.' }; out.total_years_experience = y; }
  if (!partial || has('qualification_threshold')) { const t = has('qualification_threshold') ? Number(body.qualification_threshold) : 65; if (!(Number.isInteger(t) && t >= 30 && t <= 95)) return { ok: false, error: 'qualification_threshold must be a whole number 30-95.' }; out.qualification_threshold = t; }
  if (!partial || has('primary_skills')) out.primary_skills = words(body.primary_skills);
  if (!partial || has('visibility')) { const v = has('visibility') ? body.visibility : 'private'; if (v !== 'public' && v !== 'private') return { ok: false, error: "visibility must be 'public' or 'private'." }; out.visibility = v; }
  if (has('display_title')) out.display_title = text(body.display_title, 100);
  if (has('summary_line')) out.summary_line = text(body.summary_line, 160);
  if (!partial || has('search_profile')) {
    const sp = body.search_profile || {};
    const prof = parseProfile({ ...sp, role_keywords: words(sp.role_keywords), avoid_keywords: words(sp.avoid_keywords) });
    if (!prof) return { ok: false, error: 'search_profile.role_keywords needs at least one keyword (plain words, matched against posting titles).' };
    out.search_profile = prof;
  }
  return { ok: true, value: out };
}

// ---- CSV ---------------------------------------------------------------------------------------------------------------------
/** RFC 4180 field, with a leading quote on values a spreadsheet would run as a formula. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const csvRow = (fields: unknown[]) => fields.map(csvField).join(',');
