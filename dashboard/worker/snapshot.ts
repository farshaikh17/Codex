// A person's job list kept as a small derived copy (migration 0027), so Today, the job lists, their counts and facets and the twin grouping do
// not re-read every screening row on each uncached view (measured on a local D1 copy of production size: ~94,000 rows per uncached Today,
// ~93,000 per list page; COST_MODEL_2026-11-09.md section 7).
//
// What it holds, per person: every row of the list (the predicate of /api/jobs?exclude_applied=true&exclude_dismissed=true: an active job, a
// status other than INELIGIBLE / CLOSED / HOLD, no such override, not applied) and every Hidden row (active, Hold, "You marked this Not for
// me"), with only the fields the counts, filters, order and grouping use. The job rows shown on a page are still read live, by id.
//
// When it is used: only if it was built under the current cache generation (every import, run, release and operator change raises it), by
// the same code version, and less than the response cache's own time limit ago (30 minutes for visitors, 10 for the operator), so it is
// never staler than a cached answer was. Cron and collector writes appear when it expires, exactly as they did with the response cache.
//
// Tracker actions (save, status, Not for me, restore, un-save, rating, follow-up) mark (person, job) in seeker_dirty before and after their
// write; the next read re-reads those jobs alone (a few rows) and corrects the copy, so an action no longer costs a rebuild.
//
// Concurrency: every write of the copy is one D1 batch (one transaction) that only applies while part 0 still carries the token this request
// read, so two requests that patch or rebuild at once cannot overwrite each other's newer state; the loser's answer is still correct for its
// own request and simply not stored. A dirty mark is removed only with the exact value the request saw, so a mark made after the request read
// survives to the next read.
import { reviewKey } from './twins';

type DB = any;
export type SnapRow = { id: string; st: string; sc: number; f: string; fj: number | null; qj: number | null; el: string; wt: string | null; u: number; k: string; l: string | null; h: number };
export interface Snapshot { rows: SnapRow[]; hidden: SnapRow[]; state: 'built' | 'kept' | 'patched' }

export const SNAPSHOT_VERSION = 's1';
const CHUNK_TARGET = 30_000, CHUNK_MAX = 60_000, DIRTY_MAX = 400;

// The list predicate: exactly the one /api/jobs builds for exclude_dismissed + exclude_applied, and /api/today's listWhere.
export const NOT_APPLIED_SQL = `COALESCE((SELECT a2.status FROM applications a2 WHERE a2.candidate_id = q.candidate_id AND a2.job_id = q.job_id ORDER BY a2.rowid DESC LIMIT 1), 'SAVED') = 'SAVED'`;
const COLS = `q.job_id AS id, q.qualification_status AS st, COALESCE(s.overall_score, 0) AS sc, j.discovered_at AS f, julianday(j.discovered_at) AS fj,
  julianday(q.qualified_at) AS qj, q.eligibility_status AS el, j.workplace_type AS wt,
  CASE WHEN q.qualification_reason LIKE '[GITHUB_COLLECTOR] Unassessed%' THEN 1 ELSE 0 END AS u, j.title AS t, j.company AS c, j.location_restrictions AS l`;
const SCORE = 'LEFT JOIN candidate_job_scores s ON s.candidate_id = q.candidate_id AND s.job_id = q.job_id';
const LIST_REST = `AND j.is_active = 1 AND COALESCE(q.manual_override_status, '') NOT IN ('INELIGIBLE', 'CLOSED', 'HOLD') AND ${NOT_APPLIED_SQL}`;
const HIDDEN_WHERE = `j.is_active = 1 AND q.qualification_status = 'HOLD' AND q.qualification_reason LIKE 'You marked this Not for me%'`;
// "status NOT IN ('INELIGIBLE', 'CLOSED', 'HOLD')" as four ranges of the (candidate, status) index: the same rows, without stepping over the
// person's Hold and Ineligible rows (about two thirds of them).
const RANGES = [`q.qualification_status < 'CLOSED'`, `q.qualification_status > 'CLOSED' AND q.qualification_status < 'HOLD'`,
  `q.qualification_status > 'HOLD' AND q.qualification_status < 'INELIGIBLE'`, `q.qualification_status > 'INELIGIBLE'`];
export const BUILD_SQL = [
  ...RANGES.map((r) => `SELECT ${COLS}, 0 AS h FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id ${SCORE} WHERE q.candidate_id = ?1 AND ${r} ${LIST_REST}`),
  `SELECT ${COLS}, 1 AS h FROM candidate_qualifications q INDEXED BY idx_cq_not_for_me JOIN jobs j ON j.id = q.job_id ${SCORE} WHERE q.candidate_id = ?1 AND ${HIDDEN_WHERE}`,
].join('\nUNION ALL\n');
// The same rows for a few given jobs (?2: a JSON list of ids), each looked up by key.
export const BY_IDS_SQL = [
  `SELECT ${COLS}, 0 AS h FROM json_each(?2) x CROSS JOIN candidate_qualifications q ON q.candidate_id = ?1 AND q.job_id = x.value JOIN jobs j ON j.id = q.job_id ${SCORE}
    WHERE q.qualification_status NOT IN ('INELIGIBLE', 'CLOSED', 'HOLD') ${LIST_REST}`,
  `SELECT ${COLS}, 1 AS h FROM json_each(?2) x CROSS JOIN candidate_qualifications q ON q.candidate_id = ?1 AND q.job_id = x.value JOIN jobs j ON j.id = q.job_id ${SCORE}
    WHERE ${HIDDEN_WHERE}`,
].join('\nUNION ALL\n');

const enc = (r: SnapRow) => [r.id, r.st, r.sc, r.f, r.fj, r.qj, r.el, r.wt, r.u, r.k, r.l, r.h];
const dec = (a: any[]): SnapRow => ({ id: a[0], st: a[1], sc: a[2], f: a[3], fj: a[4], qj: a[5], el: a[6], wt: a[7], u: a[8], k: a[9], l: a[10], h: a[11] });
const fromSql = (r: any): SnapRow => ({ id: r.id, st: r.st, sc: r.sc, f: r.f, fj: r.fj ?? null, qj: r.qj ?? null, el: r.el, wt: r.wt ?? null, u: Number(r.u) ? 1 : 0,
  k: reviewKey(r.c, r.t), l: r.l ?? null, h: Number(r.h) ? 1 : 0 });
const byteLen = (s: string) => (/[^\x00-\x7f]/.test(s) ? new TextEncoder().encode(s).length : s.length);
function fnv(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
function layout(rows: SnapRow[], parts: number): string[] {
  const out: any[][] = Array.from({ length: parts }, () => []);
  for (const r of rows) out[fnv(r.id) % parts].push(enc(r));
  return out.map((x) => JSON.stringify(x));
}
function plan(rows: SnapRow[]): string[] | null {
  let parts = Math.max(1, Math.ceil(JSON.stringify(rows.map(enc)).length / CHUNK_TARGET));
  for (let i = 0; i < 8; i++, parts *= 2) { const b = layout(rows, parts); if (b.every((x) => byteLen(x) <= CHUNK_MAX)) return b; }
  return null;
}
const newToken = () => Math.floor(Math.random() * 2 ** 52) + 1;
const missingTable = (e: any) => /no such (table|index)/i.test(String(e?.message || e));
const split = (all: SnapRow[]) => ({ rows: all.filter((r) => !r.h), hidden: all.filter((r) => r.h) });

/** SQLite's BINARY order (UTF-8 bytes, i.e. code points), which JavaScript's < matches except around surrogate pairs. */
export function cmpBin(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x === y) continue;
    if ((x >= 0xd800 && x <= 0xdfff) || (y >= 0xd800 && y <= 0xdfff)) { const p = a.codePointAt(i)!, q = b.codePointAt(i)!; return p < q ? -1 : p > q ? 1 : 0; }
    return x < y ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
/** ORDER BY score DESC, discovered_at DESC, job_id (the lists' "Best match first" and Today's sections). */
export const byScore = (a: SnapRow, b: SnapRow) => (b.sc - a.sc) || cmpBin(b.f, a.f) || cmpBin(a.id, b.id);
/** ORDER BY discovered_at DESC, job_id ("Newest first"). */
export const byDate = (a: SnapRow, b: SnapRow) => cmpBin(b.f, a.f) || cmpBin(a.id, b.id);
/** ORDER BY score DESC, job_id (any other sort value /api/jobs does not name). */
export const byScoreId = (a: SnapRow, b: SnapRow) => (b.sc - a.sc) || cmpBin(a.id, b.id);
/** The To review rows in the shape worker/twins.ts groups (the key was computed from the employer and title when the copy was built). */
export const twinRows = (rows: SnapRow[]) => rows.map((r) => ({ id: r.id, key: r.k, title: null, company: null, location: r.l, found: r.f, score: r.sc, unscreened: r.u, eligibility: r.el }));

async function persist(db: DB, cid: string, rows: SnapRow[], s: { generation: number; version: string; builtAt: number; token: string; dirty: any[]; old?: { parts: number; bodies: string[] } }) {
  let bodies: string[] | null = s.old ? layout(rows, s.old.parts) : null;
  let changed: number[] | null = null;
  if (bodies && bodies.every((b) => byteLen(b) <= CHUNK_MAX)) changed = bodies.map((b, i) => (b === s.old!.bodies[i] ? -1 : i)).filter((i) => i >= 0);
  else bodies = plan(rows);
  if (!bodies) return;   // a list too large to keep (far beyond today's size): answered from the rows read, not stored
  const tok = String(newToken());
  const mine = `EXISTS (SELECT 1 FROM seeker_snapshot WHERE candidate_id = ? AND part = 0 AND token = ?)`;
  const stmts: any[] = [];
  if (changed) {
    stmts.push(db.prepare('UPDATE seeker_snapshot SET token = ? WHERE candidate_id = ? AND part = 0 AND token = ?').bind(tok, cid, s.token));
    for (const i of changed) stmts.push(db.prepare(`UPDATE seeker_snapshot SET body = ? WHERE candidate_id = ? AND part = ? AND ${mine}`).bind(bodies[i], cid, i + 1, cid, tok));
  } else {
    stmts.push(db.prepare(`UPDATE seeker_snapshot SET generation = ?, version = ?, built_at = ?, token = ?, parts = ?, body = '[]' WHERE candidate_id = ? AND part = 0 AND token = ?`)
      .bind(s.generation, s.version, s.builtAt, tok, bodies.length, cid, s.token));
    bodies.forEach((b, i) => stmts.push(db.prepare(`INSERT OR REPLACE INTO seeker_snapshot(candidate_id, part, generation, version, built_at, token, parts, body)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${mine}`).bind(cid, i + 1, s.generation, s.version, s.builtAt, tok, bodies!.length, b, cid, tok)));
    stmts.push(db.prepare(`DELETE FROM seeker_snapshot WHERE candidate_id = ? AND part > ? AND ${mine}`).bind(cid, bodies.length, cid, tok));
  }
  if (s.dirty.length) stmts.push(db.prepare(`DELETE FROM seeker_dirty WHERE candidate_id = ? AND ${mine}
      AND (job_id, at) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))`).bind(cid, cid, tok, JSON.stringify(s.dirty.map((d) => [d.job_id, d.at]))));
  await db.batch(stmts);
}

/**
 * The person's list and Hidden rows, from the stored copy (corrected for tracker actions since), or rebuilt and stored when the copy is
 * missing, from another generation or code version, or older than maxAge seconds. null: no copy can be used here (tables not installed, a
 * database error); the caller then answers from the full queries, as before.
 */
export async function seekerSnapshot(db: DB, cid: string, opts: { version: string; maxAge: number }): Promise<Snapshot | null> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const { results: parts } = await db.prepare(`SELECT s.generation AS cur, p.part, p.generation, p.version, p.built_at, p.token, p.parts, p.body
      FROM cache_state s LEFT JOIN seeker_snapshot p ON p.candidate_id = ? WHERE s.id = 1 ORDER BY p.part`).bind(cid).all();
    if (!parts?.length) return null;
    const cur = Number(parts[0].cur);
    const { results: dirty } = await db.prepare('SELECT job_id, at FROM seeker_dirty WHERE candidate_id = ?').bind(cid).all();
    const meta = parts.find((p: any) => p.part === 0) || null;
    const chunks = parts.filter((p: any) => p.part != null && p.part > 0);
    const valid = !!meta && meta.version === opts.version && meta.generation === cur && now - Number(meta.built_at) < opts.maxAge
      && meta.parts === chunks.length && chunks.every((c: any, i: number) => c.part === i + 1) && (dirty || []).length <= DIRTY_MAX;
    if (valid) {
      let all: SnapRow[] = chunks.flatMap((c: any) => (JSON.parse(c.body) as any[][]).map(dec));
      if (!dirty?.length) return { ...split(all), state: 'kept' };
      const ids = [...new Set(dirty.map((d: any) => String(d.job_id)))];
      const { results } = await db.prepare(BY_IDS_SQL).bind(cid, JSON.stringify(ids)).all();
      const drop = new Set(ids);
      all = all.filter((r) => !drop.has(r.id)).concat((results || []).map(fromSql));
      try { await persist(db, cid, all, { generation: meta.generation, version: meta.version, builtAt: Number(meta.built_at), token: meta.token, dirty, old: { parts: meta.parts, bodies: chunks.map((c: any) => c.body) } }); }
      catch { /* not stored: the next read patches again */ }
      return { ...split(all), state: 'patched' };
    }
    // Rebuild. With no part 0 yet, one is written first, before the rows are read, so that a write made meanwhile is either seen by the
    // read below or leaves a dirty mark this request does not remove.
    let token: string | null = meta ? meta.token : null;
    if (!meta) {
      try {
        await db.prepare(`INSERT OR IGNORE INTO seeker_snapshot(candidate_id, part, token) VALUES (?, 0, ?)`).bind(cid, String(newToken())).run();
        token = (await db.prepare('SELECT token FROM seeker_snapshot WHERE candidate_id = ? AND part = 0').bind(cid).first())?.token ?? null;
      } catch (e: any) { if (missingTable(e)) throw e; token = null; }   // no write possible (e.g. the daily write allowance is used): answer, do not store
    }
    const { results } = await db.prepare(BUILD_SQL).bind(cid).all();
    const all = (results || []).map(fromSql);
    if (token != null) {
      try { await persist(db, cid, all, { generation: cur, version: opts.version, builtAt: now, token, dirty: dirty || [] }); }
      catch { /* not stored: the next read rebuilds */ }
    }
    return { ...split(all), state: 'built' };
  } catch (e: any) {
    if (!missingTable(e)) console.warn(JSON.stringify({ event: 'seeker_snapshot', status: 'FALLBACK', error: String(e?.message || e).slice(0, 200) }));
    return null;
  }
}

/** A tracker action is about to change, or has changed, this person's row for this job: the next read re-reads it. With no job known, the
 *  person's copy is dropped (rebuilt on the next read). A database without the tables has no copy to correct. */
export async function seekerTouched(db: DB, cid: string, jobId: string | null): Promise<void> {
  try {
    if (jobId) await db.prepare(`INSERT INTO seeker_dirty(candidate_id, job_id, at) VALUES (?, ?, ?) ON CONFLICT(candidate_id, job_id) DO UPDATE SET at = excluded.at`)
      .bind(cid, jobId, newToken()).run();
    else await db.prepare('DELETE FROM seeker_snapshot WHERE candidate_id = ?').bind(cid).run();
  } catch (e: any) { if (!missingTable(e)) throw e; }
}
