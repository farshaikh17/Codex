// The automatic shortlist (Ready and Stretch), chosen from the exported pool (plan phase 3, A2). Replaces the SQL-only rule in dataset_apply.mjs.
//
//   node --import ./test/register.mjs scripts/shortlist_select.mjs --pool ../work/shortlist_pool.json --candidates ../work/candidates.json \
//        [--liveness ../work/liveness_result.json] [--relaxed] --out ../work/shortlist_select.sql
//
// The pool (engine/dataset_discovery.py --shortlist-pool) is exported after the day's import and before the still-open check. --liveness is the
// check's result, passed only when its write to the database succeeded: a posting it found open counts as verified now, one it found closed is out.
// --relaxed: the check verified too few rows today (our fault, not closures), so a row already on the automatic shortlist keeps its place without a
// recent verification; a new row still needs one.
// Writes ONE SQL file of demotions, tier moves and promotions, applied in one `wrangler d1 execute`. Every statement names the row's current state
// and keeps the guards: no manual override, no application, only rows the screen shortlisted (marked by their reason). Running the file twice
// changes nothing. With no pool file nothing is written, so the lists stay as they are.
import fs from 'node:fs';
import { companyKey, familyOf } from '../worker/discovery.ts';

export const MARK = 'Shortlisted automatically. ';
export const TIER_SIZE = 25;
export const VERIFIED_DAYS = 4;
export const OLD_DAYS = 30, OLD_PENALTY = 5;
const DAY = 86400000;
const TIERS = ['READY', 'STRETCH_READY'];

/** ISO or SQLite time text -> milliseconds (NaN when empty or unreadable). */
export function when(s) {
  if (!s) return NaN;
  let t = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += 'T00:00:00Z';
  else if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) t += 'Z';
  return Date.parse(t);
}

const skillsOk = (r) => Number(r.skill_score) >= 40 || !!Number(r.target_exact);   // plan S4
const base = (r) => !!Number(r.active) && !!Number(r.marked) && skillsOk(r) && !r.dead;
/** Ready: score at the person's threshold and eligibility confirmed. */
export const fitsReady = (r) => base(r) && Number(r.score) >= Number(r.threshold) && r.eligibility === 'ELIGIBLE';
/** Stretch's own rule: the threshold with eligibility still to confirm, or confirmed and up to 10 below. */
export const fitsStretchRule = (r) => base(r) && ((Number(r.score) >= Number(r.threshold) && r.eligibility === 'UNKNOWN')
  || (r.eligibility === 'ELIGIBLE' && Number(r.score) >= Number(r.threshold) - 10 && Number(r.score) < Number(r.threshold)));
/** One posting per employer and title. */
export const twinKey = (r) => (companyKey(r.company) || String(r.company || '').trim().toLowerCase()) + '|' + String(r.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const isAuto = (r) => TIERS.includes(r.status) && String(r.reason || '').startsWith(MARK);

export const INCUMBENT_BONUS = 2;
export const SWAP_FLOOR = 5, SWAP_WINDOW = 10;
/** Plan A3.1: rank by score, 2 points for a row already on the automatic shortlist, 5 lower for a row found more than 30 days ago (the only place
 *  age is used; nothing is stored), then matched skills, newest, and the job id (so the result never depends on the input order). */
export function rankKey(r, now) {
  const age = (now - when(r.discovered_at)) / DAY;
  return Number(r.score) + (r.auto ? INCUMBENT_BONUS : 0) - (age > OLD_DAYS ? OLD_PENALTY : 0);
}
export function ranked(rows, now) {
  return [...rows].sort((a, b) => rankKey(b, now) - rankKey(a, now) || Number(b.skill_score) - Number(a.skill_score)
    || String(b.discovered_at || '').localeCompare(String(a.discovered_at || '')) || (String(a.job_id) < String(b.job_id) ? -1 : String(a.job_id) > String(b.job_id) ? 1 : 0));
}

// ---- The rules (plan A4) ----------------------------------------------------------------------------------------------------------------
// Sites that repost other employers' jobs (not agencyPosting(): an agency is still the employer's channel). At most 3 per tier (hard), and a repost
// of a direct employer's row in the pool (same title, same place, same first 200 characters of description) is dropped (hard).
export const REPOSTERS = new Set(['jobgether', 'turing', 'crossover', 'peopleworth', 'pavago', 'paired', 'braintrust']);
export const REPOSTER_CAP = 3;
export const EMPLOYER_TIER_CAP = 2, EMPLOYER_SKILL_CAP = 5, EMPLOYER_BOTH_CAP = 4;
export const employerKey = (r) => companyKey(r.company) || String(r.company || '').trim().toLowerCase();
export const isReposter = (r) => REPOSTERS.has(companyKey(r.company));
// An employer shown by its hiring-system tenant id ('fa espx saasfaprod1', or one short lower-case token from Workday or Oracle) is not shortlisted
// until phase 4 (B1) gives it its real name; the audit (A8) treats one on the shortlist as a broken hard rule. Ids B1 already maps are known employers.
const TENANT_KNOWN = new Set(['abb', 'mdlz']);
export function tenantEmployer(company, source) {
  const c = String(company || '').trim();
  if (/^fa [a-z]{4} saasfaprod\d+$/.test(c)) return true;
  return /^(workday|oracle|oraclehcm)$/.test(String(source || '').toLowerCase()) && /^[a-z]{1,5}$/.test(c) && !TENANT_KNOWN.has(c);
}
const norm = (x) => String(x || '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** Hard: a reposter row duplicating a direct employer's row. */
export function repostDuplicates(rows) {
  const direct = new Set(rows.filter((r) => !isReposter(r)).map((r) => [norm(r.title), norm(r.location), norm(r.description).slice(0, 200)].join('|')));
  return new Set(rows.filter((r) => isReposter(r) && direct.has([norm(r.title), norm(r.location), norm(r.description).slice(0, 200)].join('|'))).map((r) => r.job_id));
}
/** Hard: at most 3 reposter rows per tier. */
export const reposterCap = (r, tier, lists, without) => !isReposter(r) || lists[tier].filter((x) => x !== without && x !== r && isReposter(x)).length < REPOSTER_CAP;

/** The employer is named in the person's skills (e.g. GoHighLevel for Farhan): up to 5 per tier. */
export function skillEmployer(r, skillKeys) {
  const k = employerKey(r);
  return !!k && [...(skillKeys || [])].some((s) => s === k || (k.length >= 5 && s.includes(k)));
}
const tierCap = (r, ctx) => (skillEmployer(r, ctx.skillKeys) ? EMPLOYER_SKILL_CAP : EMPLOYER_TIER_CAP);
const bothCap = (r, ctx) => (skillEmployer(r, ctx.skillKeys) ? 2 * EMPLOYER_SKILL_CAP : EMPLOYER_BOTH_CAP);
const groups = (rows) => { const m = new Map(); for (const r of rows) if (!isReposter(r)) { const k = employerKey(r); m.set(k, [...(m.get(k) || []), r]); } return m; };
/** Soft rule: employers over their per-tier cap (reposters have their own hard cap). */
const employerTier = { name: 'employer_per_tier', tiers: TIERS,
  count: (lists, ctx) => TIERS.reduce((n, t) => n + [...groups(lists[t]).values()].reduce((a, g) => a + Math.max(0, g.length - tierCap(g[0], ctx)), 0), 0),
  breakers: (lists, tier, ctx) => [...groups(lists[tier]).values()].filter((g) => g.length > tierCap(g[0], ctx)).flat() };
/** Soft rule, relaxed last: employers over 4 rows on both tiers together. */
const employerBoth = { name: 'employer_both_tiers', tiers: TIERS,
  count: (lists, ctx) => [...groups([...lists.READY, ...lists.STRETCH_READY]).values()].reduce((a, g) => a + Math.max(0, g.length - bothCap(g[0], ctx)), 0),
  breakers: (lists, tier, ctx) => { const over = new Set([...groups([...lists.READY, ...lists.STRETCH_READY]).entries()].filter(([, g]) => g.length > bothCap(g[0], ctx)).map(([k]) => k));
    return lists[tier].filter((r) => !isReposter(r) && over.has(employerKey(r))); } };

// Plan A5: no role family above 40% of a tier's filled rows (an allowance of at least 4). 'unclassified' is not a family and is not capped.
export const FAMILY_SHARE = 0.4, FAMILY_MIN_ALLOWANCE = 4, DIFFERENT_PLACES = 2;
export const familyCap = (filled) => Math.max(FAMILY_MIN_ALLOWANCE, Math.floor(FAMILY_SHARE * filled));
const famGroups = (rows) => { const m = new Map(); for (const r of rows) if (r.family && r.family !== 'unclassified') m.set(r.family, [...(m.get(r.family) || []), r]); return m; };
const familyRule = { name: 'family_share', tiers: TIERS,
  count: (lists) => TIERS.reduce((n, t) => n + [...famGroups(lists[t]).values()].reduce((a, g) => a + Math.max(0, g.length - familyCap(lists[t].length)), 0), 0),
  breakers: (lists, tier) => [...famGroups(lists[tier]).values()].filter((g) => g.length > familyCap(lists[tier].length)).flat() };

/** The soft rules in the order they are tried (the both-tiers cap last). A soft rule counts how far the lists break it; a swap may fix it (A3.4). */
export function softRules() { return [employerTier, familyRule, employerBoth]; }
export const HARD_RULES = [reposterCap];

/** Plan A3.2-A3.4 for one person. Returns the tier lists and the report. `ctx` carries the person's threshold and what the rules need. */
function pickFor(rows, held, ctx) {
  const { now, size } = ctx;
  const rules = ctx.rules || softRules(ctx);
  const dupes = repostDuplicates(rows);
  const usable = ranked(rows.filter((r) => r.verified && (fitsReady(r) || fitsStretchRule(r)) && !dupes.has(r.job_id) && !tenantEmployer(r.company, r.source)), now);
  const pos = new Map(usable.map((r, i) => [r.job_id, i]));
  const heldKeys = new Set(held.map(twinKey));
  const lists = { READY: [], STRETCH_READY: [] };
  const tierOf = new Map();
  const qualifies = (r, tier) => (tier === 'READY' ? fitsReady(r) : fitsReady(r) || fitsStretchRule(r));
  // Hard rules: one posting per employer and title across both tiers and the rows a person holds; and those of ctx.hard (plan A4).
  const hardOk = (r, tier, without = null) => {
    const k = twinKey(r);
    if (heldKeys.has(k)) return false;
    for (const t of TIERS) for (const x of lists[t]) if (x !== without && x !== r && twinKey(x) === k) return false;
    return (ctx.hard || HARD_RULES).every((h) => h(r, tier, lists, without, ctx));
  };
  const fill = (tier, candidates) => {
    for (const r of candidates) {
      if (lists[tier].length >= size) break;
      if (tierOf.has(r.job_id) || !hardOk(r, tier)) continue;
      tierOf.set(r.job_id, tier); lists[tier].push(r);
    }
  };
  const report = { READY: { swaps: 0, relaxed: [], pool_smaller_than_tier: false }, STRETCH_READY: { swaps: 0, relaxed: [], pool_smaller_than_tier: false } };
  const violations = () => rules.map((rule) => rule.count(lists, ctx));
  // A3.4: while a soft rule is broken and a swap candidate exists, the lowest-ranked row breaking it is replaced by the best row that fixes it.
  // A swap candidate scores at least the threshold + 5 and within 10 of the row it replaces, keeps every hard rule, and makes no other rule worse.
  const swaps = (tier) => {
    const open = usable.filter((r) => !tierOf.has(r.job_id) && qualifies(r, tier));
    if (lists[tier].length + open.length <= size) { report[tier].pool_smaller_than_tier = true; return; }   // only hard rules apply
    rules.forEach((rule, i) => {
      if (!rule.tiers.includes(tier)) return;
      for (let guard = 0; guard < 4 * size; guard++) {
        const before = violations();
        if (before[i] === 0) return;
        const victims = rule.breakers(lists, tier, ctx).sort((a, b) => pos.get(b.job_id) - pos.get(a.job_id));
        let done = false;
        for (const v of victims) {
          for (const c of usable) {
            if (tierOf.has(c.job_id) || !qualifies(c, tier)) continue;
            if (Number(c.score) < Number(ctx.threshold) + SWAP_FLOOR || Number(c.score) < Number(v.score) - SWAP_WINDOW) continue;
            if (!hardOk(c, tier, v)) continue;
            const at = lists[tier].indexOf(v);
            lists[tier][at] = c;
            const after = violations();
            if (after[i] < before[i] && after.every((x, j) => j === i || x <= before[j])) {
              tierOf.delete(v.job_id); tierOf.set(c.job_id, tier); report[tier].swaps++; done = true; break;
            }
            lists[tier][at] = v;
          }
          if (done) break;
        }
        if (!done) { report[tier].relaxed.push(rule.name); return; }
      }
    });
  };
  fill('READY', usable.filter(fitsReady));
  swaps('READY');
  // Plan S10 / A3.3: Ready-quality rows that did not fit in Ready come first in Stretch, then Stretch's own rule.
  fill('STRETCH_READY', [...usable.filter((r) => fitsReady(r) && !tierOf.has(r.job_id)), ...usable.filter((r) => !fitsReady(r) && fitsStretchRule(r))]);
  swaps('STRETCH_READY');
  // Plan A4 "something different": up to 2 places at the end of Stretch for a row from a role family on neither tier (never 'unclassified'), with the
  // same score floor, the hard rules, and no soft rule made worse. Takes a free place, or replaces the lowest-ranked Stretch row.
  report.STRETCH_READY.different = 0;
  if (ctx.different !== false) {
    const picked = new Set();
    for (let k = 0; k < DIFFERENT_PLACES; k++) {
      const present = new Set([...lists.READY, ...lists.STRETCH_READY].map((r) => r.family));
      const v = lists.STRETCH_READY.length >= size ? [...lists.STRETCH_READY].sort((a, b) => pos.get(b.job_id) - pos.get(a.job_id)).find((r) => !picked.has(r.job_id)) : null;
      if (lists.STRETCH_READY.length >= size && !v) break;
      const before = violations();
      let done = false;
      for (const c of usable) {
        if (tierOf.has(c.job_id) || !qualifies(c, 'STRETCH_READY') || !c.family || c.family === 'unclassified' || present.has(c.family)) continue;
        if (Number(c.score) < Number(ctx.threshold) + SWAP_FLOOR || (v && Number(c.score) < Number(v.score) - SWAP_WINDOW)) continue;
        if (!hardOk(c, 'STRETCH_READY', v)) continue;
        const at = v ? lists.STRETCH_READY.indexOf(v) : lists.STRETCH_READY.length;
        lists.STRETCH_READY[at] = c;
        if (violations().every((x, j) => x <= before[j])) {
          if (v) tierOf.delete(v.job_id);
          tierOf.set(c.job_id, 'STRETCH_READY'); picked.add(c.job_id); report.STRETCH_READY.different++; done = true; break;
        }
        if (v) lists.STRETCH_READY[at] = v; else lists.STRETCH_READY.pop();
      }
      if (!done) break;
    }
  }
  for (const t of TIERS) {
    lists[t].sort((a, b) => pos.get(a.job_id) - pos.get(b.job_id));
    const per = new Map(); for (const r of lists[t]) per.set(employerKey(r), (per.get(employerKey(r)) || 0) + 1);
    report[t].employers = per.size;
    report[t].max_employer_share = lists[t].length ? Math.round(100 * Math.max(...per.values()) / lists[t].length) / 100 : 0;
    report[t].reposters = lists[t].filter(isReposter).length;
    report[t].families = {}; for (const r of lists[t]) report[t].families[r.family || 'unclassified'] = (report[t].families[r.family || 'unclassified'] || 0) + 1;
  }
  return { lists, tierOf, report };
}

/** The person's skills from candidates.json (primary_skills is stored as JSON text). */
export function skillsOf(candidates, cid) {
  const c = (candidates || []).find((x) => x && x.id === cid);
  let v = c?.primary_skills; try { if (typeof v === 'string') v = JSON.parse(v); } catch { v = []; }
  return Array.isArray(v) ? v.map(String) : [];
}

/** Pure: pool rows (with kind auto | pool | held) -> the tier every auto or pool row should have, and what changes. Deterministic. */
export function selectShortlist(pool, opts = {}) {
  const now = opts.now ?? Date.now();
  const size = opts.tierSize ?? TIER_SIZE;
  const alive = new Set(opts.alive || []), dead = new Set(opts.dead || []);
  const byCand = new Map();
  for (const r0 of pool || []) {
    if (!r0 || !r0.candidate_id || !r0.job_id) continue;
    const c = byCand.get(r0.candidate_id) || { rows: [], held: [] };
    byCand.set(r0.candidate_id, c);
    if (r0.kind === 'held') { c.held.push(r0); continue; }
    if (r0.kind !== 'auto' && r0.kind !== 'pool') continue;
    if (c.rows.some((x) => x.job_id === r0.job_id)) continue;
    const r = { ...r0, dead: dead.has(r0.job_id) };
    r.auto = isAuto(r);
    r.family = familyOf(r0.candidate_id, r0.title);
    r.verified = alive.has(r.job_id) || now - when(r.last_verified_at) <= VERIFIED_DAYS * DAY || (!!opts.relaxed && r.auto);
    c.rows.push(r);
  }
  const changes = [], report = {};
  for (const cid of [...byCand.keys()].sort()) {
    const { rows, held } = byCand.get(cid);
    const threshold = Number(rows.find((r) => r.threshold !== undefined && r.threshold !== null)?.threshold ?? 60);
    const skillKeys = new Set(skillsOf(opts.candidates, cid).map(companyKey).filter(Boolean));
    const { lists, tierOf, report: rep } = pickFor(rows, held, { now, size, threshold, candidateId: cid, skillKeys, rules: opts.rules, hard: opts.hard, different: opts.different });
    for (const r of [...rows].sort((a, b) => (String(a.job_id) < String(b.job_id) ? -1 : 1))) {
      const to = tierOf.get(r.job_id) || 'NEEDS_REVIEW';
      if (r.auto) {
        if (to === r.status) continue;
        const qualifies = r.verified && (fitsReady(r) || fitsStretchRule(r));
        changes.push({ candidate_id: cid, job_id: r.job_id, from: r.status, to,
          why: to !== 'NEEDS_REVIEW' ? (to === 'READY' ? 'Moved up: qualifies for Ready' : 'Outranked: Ready keeps 25, moved to Stretch') : qualifies ? 'Outranked: the automatic shortlist keeps 25 per tier, or swapped for variety' : 'No longer meets the automatic shortlist rule' });
      } else if (to !== 'NEEDS_REVIEW' && r.status === 'NEEDS_REVIEW') {
        changes.push({ candidate_id: cid, job_id: r.job_id, from: 'NEEDS_REVIEW', to, why: 'Shortlisted automatically by the screen' });
      }
    }
    report[cid] = Object.fromEntries(TIERS.map((t) => [t, { count: lists[t].length, ...rep[t] }]));
    report[cid].pool = rows.length;
  }
  return { changes, report };
}

// SQL literal: quotes doubled, control characters removed.
const q = (v) => `'${String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/'/g, "''")}'`;

/** Pure: changes -> SQL. Demotions first, then moves, then promotions; each with its history row first, under the same guards. */
export function selectionSql(changes, nowIso = new Date().toISOString()) {
  const order = (c) => (c.to === 'NEEDS_REVIEW' ? 0 : c.from === 'NEEDS_REVIEW' ? 2 : 1);
  const out = [];
  for (const c of [...changes].sort((a, b) => order(a) - order(b))) {
    const fromAuto = c.from !== 'NEEDS_REVIEW';
    const where = `candidate_id = ${q(c.candidate_id)} AND job_id = ${q(c.job_id)} AND qualification_status = ${q(c.from)} AND manual_override_status IS NULL
      AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_qualifications.candidate_id AND a.job_id = candidate_qualifications.job_id)
      AND COALESCE(qualification_reason, '') ${fromAuto ? '' : 'NOT '}LIKE ${q(MARK + '%')}`
      + (c.to !== 'NEEDS_REVIEW' ? ` AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = candidate_qualifications.job_id AND j.is_active = 1)` : '');
    out.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
  SELECT candidate_id, job_id, qualification_status, ${q(c.to)}, ${q(c.why)}, 'discovery' FROM candidate_qualifications WHERE ${where};`);
    const set = c.to === 'NEEDS_REVIEW' ? `qualification_status = 'NEEDS_REVIEW', qualification_reason = substr(qualification_reason, ${MARK.length + 1})`
      : fromAuto ? `qualification_status = ${q(c.to)}, qualified_at = ${q(nowIso)}`
      : `qualification_status = ${q(c.to)}, qualification_reason = ${q(MARK)} || COALESCE(qualification_reason, ''), qualified_at = ${q(nowIso)}`;
    out.push(`UPDATE candidate_qualifications SET ${set}, last_reverified_at = ${q(nowIso)} WHERE ${where};`);
  }
  if (out.length) out.push('UPDATE cache_state SET generation = generation + 1 WHERE id = 1;');
  return out.length ? out.join('\n') + '\n' : '';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const read = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const pool = read(opt('--pool'));
  if (!pool || !Array.isArray(pool.rows)) {   // plan A2: no pool, nothing applied
    console.log('No shortlist pool: nothing selected, the lists stay as they are');
    fs.writeFileSync(opt('--out'), '');
    process.exit(0);
  }
  const live = read(opt('--liveness')) || {};
  const { changes, report } = selectShortlist(pool.rows, { alive: live.alive, dead: live.dead, relaxed: args.includes('--relaxed'), candidates: read(opt('--candidates')) || [] });
  fs.writeFileSync(opt('--out'), selectionSql(changes));
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ changes: changes.length, report }));
}
