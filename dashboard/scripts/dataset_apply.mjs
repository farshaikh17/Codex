// Turns discovery matches into SQL for D1, scoring every (job, candidate) pair with the Worker's own evaluate() so stored rows
// and the live screen can never disagree. Also closes jobs that left the dataset, and re-scores earlier preliminary rows with
// the candidates' now-stored skills (owner-approved 2026-11-06).
//
//   node --import ./test/register.mjs scripts/dataset_apply.mjs --candidates work/candidates.json \
//        --in work/matches.json [--in work/jobsite_matches.json] [--rescore work/rescore.json] [--global-hirers work/global_hirers.json] [--signals work/signals.json] --out work/apply.sql [--max-new 1500]
//
// Guarantees: nothing is ever marked READY or STRETCH; no row with a human override or an application is written; an existing
// job or qualification is never overwritten by an insert; closures skip jobs someone applied to or decided on.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { evaluate, RULE_VERSION, RULES_MARKER, companyKey, onsiteByText } from '../worker/discovery.ts';
import { safeApplicationUrl } from './posting_urls.mjs';
import { buildMarks, tasteAdjust, withTasteSentence } from './taste_rules.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const many = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const maxNewInput = Number(opt('--max-new', 1500));
if (!Number.isInteger(maxNewInput) || maxNewInput < 0) throw new Error('--max-new must be a non-negative whole number');
const MAX_NEW = maxNewInput;
const MAX_CLOSE = Number(opt('--max-close', 2000));
const MIN_SCORE = Number(opt('--min-score', 30));
const now = new Date().toISOString();
const MARKED = `'%"${RULES_MARKER}":true%'`;   // SQL LIKE pattern: a breakdown scored under the current rules

// SQL literal: control characters removed (a NUL byte would abort the whole import), quotes doubled, non-finite numbers NULL.
const q = (v) => (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? 'NULL' : typeof v === 'number' ? String(v)
  : `'${String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/'/g, "''")}'`);
const cap = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n));
const plain = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const adapter = (s) => String(s || 'ats').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20) || 'ats';
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const candidates = JSON.parse(fs.readFileSync(opt('--candidates'), 'utf8'));   // [{ id, primary_skills, search_profile }]
const byId = new Map(candidates.map((c) => [c.id, c]));
// Daily-discovery context: employers listed publicly as hiring worldwide (engine/global_hirers.py, no credentials) and, per
// candidate, employers that rejected them before (dashboard applications marked REJECTED and past applications entered by hand).
const hirersFile = opt('--global-hirers');
const hirers = hirersFile && fs.existsSync(hirersFile) ? JSON.parse(fs.readFileSync(hirersFile, 'utf8')) : {};
const globalHirers = new Set(hirers.keys || []);
const yc = new Map(Object.entries(hirers.yc || {}));
// Signals (engine/signals.py): UK Skilled Worker sponsors, and the taste model learned from the operator's own decisions.
const signalsFile = opt('--signals');
const signals = signalsFile && fs.existsSync(signalsFile) ? JSON.parse(fs.readFileSync(signalsFile, 'utf8')) : {};
const ukSponsors = new Set(signals.uk_sponsors || []);
// Plan U3 (phase 5): the score now learns only from a person's own marks, by employer and role family (scripts/taste_rules.mjs), within +-5.
// The marks are the taste rows engine/signals.py passes through (signals.taste_rows); the word model it trains is no longer used for the score.
const marks = buildMarks(signals.taste_rows || []);
const taste = (cid, title, company) => tasteAdjust(marks, cid, title, company);
const ctxFor = new Map(candidates.map((c) => {
  let rows = []; try { rows = JSON.parse(c.rejected_companies || '[]') || []; } catch {}
  const rejected = new Map();
  for (const r of Array.isArray(rows) ? rows : []) { const k = companyKey(r?.company); if (k && !rejected.has(k)) rejected.set(k, r?.on ? String(r.on).slice(0, 10) : null); }
  return [c.id, { globalHirers, rejected, yc, ukSponsors }];
}));

// A row is tagged as scored with stored skills only when the candidate has skills; otherwise the later re-score must still see it.
const hasSkills = (c) => { try { const v = JSON.parse(c?.primary_skills || '[]'); return Array.isArray(v) && v.length > 0; } catch { return false; } };
const out = [];
const report = { new_jobs: 0, rows: 0, skipped_low: 0, skipped_ineligible: 0, capped: 0, closed: 0, rescored: 0, by_status: {}, global_hirers: globalHirers.size };

// ---- new jobs -----------------------------------------------------------------------------------------------------------
const planned = [];
const closed = new Set();
for (const file of many('--in')) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of m.closed || []) closed.add(id);
  for (const j of m.jobs || []) {
    const board = !!j.board;
    const description = plain(j.description).slice(0, 6000);
    if (!j.url || String(j.url).length > 2000 || !/^https:\/\//.test(String(j.url))) continue;
    // Jobs QA 13 Nov: the source's remote flag is wrong for some postings whose own text places the job in an office ('The position is based in
    // Bengaluru', '#LI-Onsite', 'two days a week from our London office'); the text wins (evaluate() reads it the same way).
    const textOnsite = j.is_remote === true && onsiteByText(description);
    const remote = (j.is_remote === true && !textOnsite) || /\bremote\b/i.test(j.location || '');
    const onsite = j.is_remote === false || (textOnsite && !remote);
    const posting = { id: j.id, title: j.title, company: j.company || '', url: j.url, location: j.location || '', description, remote, repost: !!j.repost, salary: { min: j.salary_min, max: j.salary_max, currency: j.salary_currency, period: j.salary_period } };
    const rows = [];
    for (const cid of j.candidates || []) {
      const cand = byId.get(cid);
      if (!cand) continue;
      const r = evaluate(cand, posting, ctxFor.get(cid));
      // A board posting whose own text rules the candidate out (not remote, US only, clearance...) is not stored. Only a
      // positive eligibility claim is never taken from a board.
      if (board && r.status === 'INELIGIBLE') { report.skipped_ineligible++; continue; }
      if (board) {   // a job-board report: eligibility is never taken from the board (same rule as the Worker's persist())
        r.eligibility = 'UNKNOWN';
        r.reason = `Reported by ${j.ats_type}; employer availability and eligibility are unverified.`;
        r.status = r.status === 'HOLD' ? 'HOLD' : 'NEEDS_REVIEW';
        r.qualification_reason = 'Cloud discovery match. Public job-board/startup announcement; employer verification, full requirements and compensation review pending.';
      }
      const t = taste(cid, j.title, j.company);
      if (t.adj && r.status !== 'INELIGIBLE') { r.score = Math.max(0, Math.min(100, r.score + t.adj)); r.qualification_reason = withTasteSentence(r.qualification_reason, t.sentence); }
      if (r.status === 'INELIGIBLE') { report.skipped_ineligible++; continue; }
      if (r.score < MIN_SCORE) { report.skipped_low++; continue; }
      rows.push({ cid, r });
    }
    if (rows.length) planned.push({ j, board, description, remote, onsite, rows, best: Math.max(...rows.map((x) => x.r.score)) });
  }
}
planned.sort((a, b) => b.best - a.best || String(b.j.posted_at || '').localeCompare(String(a.j.posted_at || '')));
// Do not collapse postings based only on title and employer: location and requisition can differ.
// Only exact duplicates collapse: same employer, same title AND same stated location (a recruiter's repost or an aggregator's second copy).
// Different cities or countries are different openings and all stay. The best-scored copy is the first after the sort. Stored rows are never closed.
{
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const seen = new Set(), kept = [];
  for (const x of planned) {
    const k = norm(x.j.company) + '|' + norm(x.j.title) + '|' + norm(x.j.location);
    if (seen.has(k)) continue;
    seen.add(k); kept.push(x);
  }
  report.collapsed_copies = planned.length - kept.length;
  planned.length = 0; planned.push(...kept);
}
report.capped = Math.max(0, planned.length - MAX_NEW);
// source_id, source_channel, provenance. A job-site result (id "js:...") read from an employer's own career site (engine/more_sources.py: Workday, Oracle,
// SuccessFactors, SmartRecruiters, Siemens Energy, Eightfold; board: false) is the employer's posting: verified now, provenance LIVE_PUBLIC. It keeps the
// JOB_SITES channel, so it is never closed by the dataset snapshot rule and still expires after 30 days like every job-site result.
const channel = (j, board) => (board ? [`jobsites:${adapter(j.ats_type)}`, 'JOB_SITES', 'PUBLIC_FEED_UNVERIFIED']
  : /^js:/.test(String(j.id)) ? [`jobsites:${adapter(j.ats_type)}`, 'JOB_SITES', 'LIVE_PUBLIC'] : [`dataset:${adapter(j.ats_type)}`, 'ATS_DATASET', 'ATS_DATASET']);
for (const { j, board, description, remote, onsite, rows } of planned.slice(0, MAX_NEW)) {
  const sha = crypto.createHash('sha256').update(JSON.stringify([j.title, j.location, description])).digest('hex');
  const salary = num(j.salary_min) !== null || num(j.salary_max) !== null;
  out.push(`INSERT OR IGNORE INTO jobs(id,title,company,source_adapter,source_url,original_posting_url,employment_type,workplace_type,location_restrictions,description,required_skills,salary_published,salary_currency,salary_min,salary_max,salary_period,salary_raw_text,discovered_at,last_verified_at,is_active,content_sha256,source_id,source_channel,provenance) VALUES (${[
    j.id, cap(j.title, 300), cap(j.company, 200), adapter(j.ats_type), cap(j.url, 2000), safeApplicationUrl(j.apply_url, j.url), cap(j.employment_type || 'FULL_TIME', 40),
    remote ? 'REMOTE_RESTRICTED' : onsite && !board ? 'ONSITE' : 'UNKNOWN', cap(j.location || '', 300), description, '[]', salary ? 1 : 0,
    cap(j.salary_currency, 10), num(j.salary_min), num(j.salary_max), cap(j.salary_period, 20), cap(j.salary_summary, 300), now, board ? null : now, 1, sha,
    ...channel(j, board)].map(q).join(',')});`);
  report.new_jobs++;
  for (const { cid, r } of rows) {
    const guard = `WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ${q(j.id)}) AND NOT EXISTS (SELECT 1 FROM applications WHERE candidate_id = ${q(cid)} AND job_id = ${q(j.id)})`;
    out.push(`INSERT OR IGNORE INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,eligibility_reason,qualification_reason,last_reverified_at) SELECT ${[cid, j.id, r.status, r.lane, r.eligibility, r.reason, r.qualification_reason, now].map(q).join(',')} ${guard};`);
    out.push(`INSERT OR IGNORE INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,role_score,strategy_lane,score_breakdown,calculated_at) SELECT ${[cid, j.id, r.score, Math.min(100, r.skills.length * 20), r.lane === 'STRONGEST_FIT' ? 70 : 0, r.lane,
      JSON.stringify({ rule_version: RULE_VERSION, preliminary: true, ranking_v2: true, [RULES_MARKER]: true, target_exact: !!r.target_exact, skills_v1: hasSkills(byId.get(cid)), assessed_from: board ? 'job_sites' : 'ats_dataset', matched_skills: r.skills, missing_skills: [], note: 'Conservative discovery screen; full qualification review pending.' }), now].map(q).join(',')} ${guard};`);
    report.rows++; report.by_status[r.status] = (report.by_status[r.status] || 0) + 1;
  }
}

// Distinct requisitions are not closed based only on company and title.
// ---- the best new rows per candidate, for the free AI review (engine/ai_triage.py); no names, a generic profile line ----
{
  const PROFILE = {
    farhan_shaikh: 'About 9 years in CRM/GoHighLevel implementation, workflow automation and technical operations; leads a small team. Wants fully remote work open to someone living in India (any employer country, employee or contractor); builder roles: implementation, RevOps/technical ops, automation, GTM engineering, Chief of Staff or Founder\'s Office. Not a software developer.',
    sana_ansari: 'Electrical engineer, about 9 years at thermal power plants (operations on a 195 MW unit; maintenance of water-treatment and auxiliary systems on a 660 MW supercritical unit): reliability, root-cause analysis, maintenance planning, procurement. Based in India, will relocate anywhere. Wants plant O&M, reliability, energy-efficiency, decarbonisation or technical-consulting roles.',
  };
  const per = {};
  for (const { j, description, rows } of planned.slice(0, MAX_NEW)) for (const { cid, r } of rows) {
    if (!PROFILE[cid]) continue;
    (per[cid] = per[cid] || []).push({ candidate_id: cid, job_id: j.id, title: cap(j.title, 200), company: cap(j.company, 120), location: cap(j.location || '', 200), description: description.slice(0, 2000), profile: PROFILE[cid], score: r.score });
  }
  const top = [];
  for (const list of Object.values(per)) { list.sort((a, b) => b.score - a.score); top.push(...list.slice(0, 50)); }
  fs.writeFileSync(opt('--out').replace(/\.sql$/, '') + '.top.json', JSON.stringify(top));
  report.ai_review_candidates = top.length;
}

// ---- reopen, two-run closures, expiry --------------------------------------------------------------------------------
const reopen = [], missingMark = [], missingClear = [];
let atsCounts = null;
for (const file of many('--in')) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  reopen.push(...(m.reopen || [])); missingMark.push(...(m.missing_mark || [])); missingClear.push(...(m.missing_clear || []));
  if (m.ats_counts && Object.keys(m.ats_counts).length) atsCounts = m.ats_counts;
}
const guarded = `AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id) AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND x.manual_override_status IS NOT NULL)`;
const inList = (ids) => `(SELECT value FROM json_each(${q(JSON.stringify(ids))}))`;
for (let i = 0; i < reopen.length; i += 200)   // a dataset job that came back after being closed
  out.push(`UPDATE jobs SET is_active = 1, expired_at = NULL, last_verified_at = ${q(now)} WHERE id IN ${inList(reopen.slice(i, i + 200))} AND source_channel = 'ATS_DATASET' AND is_active = 0;`);
const toClose = [...closed].slice(0, MAX_CLOSE);   // missing from two consecutive full snapshots, ATS count healthy
for (let i = 0; i < toClose.length; i += 200) {
  const part = toClose.slice(i, i + 200);
  out.push(`UPDATE jobs SET is_active = 0, expired_at = ${q(now)} WHERE id IN ${inList(part)} AND source_channel = 'ATS_DATASET' AND is_active = 1 ${guarded};`);
  out.push(`DELETE FROM discovery_missing WHERE job_id IN ${inList(part)};`);
}
for (let i = 0; i < missingMark.length; i += 200) out.push(`INSERT OR IGNORE INTO discovery_missing(job_id, first_missing_at) SELECT value, ${q(now)} FROM json_each(${q(JSON.stringify(missingMark.slice(i, i + 200)))});`);
for (let i = 0; i < missingClear.length; i += 200) out.push(`DELETE FROM discovery_missing WHERE job_id IN ${inList(missingClear.slice(i, i + 200))};`);
if (atsCounts) out.push(`INSERT INTO discovery_state(key, value, updated_at) VALUES ('ats_counts', ${q(JSON.stringify(atsCounts))}, ${q(now)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
// job-site reports are never re-checked, so they expire after 30 days (unless someone applied or decided)
const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
out.push(`UPDATE jobs SET is_active = 0, expired_at = ${q(now)} WHERE source_channel = 'JOB_SITES' AND is_active = 1 AND discovered_at < ${q(monthAgo)} ${guarded};`);
// storage: the text of jobs closed for more than 30 days is dropped (title, company and links stay), unless someone applied or decided
out.push(`UPDATE jobs SET description = NULL WHERE source_channel IN ('ATS_DATASET', 'JOB_SITES') AND is_active = 0 AND expired_at < ${q(monthAgo)} AND description IS NOT NULL ${guarded};`);
// Plan B3: a new posting that is a stored active job in another city (same employer, title and text) was not inserted; its city is added to the
// stored job's location. Only while the location is still what was read, the job is active, and no one applied to it or decided on it.
// Tenth-man review (phase 4): the dataset and the job-site results are matched against D1 separately, so both can add a city to the same row with the
// same `old`; their cities are combined here (one UPDATE per row) instead of the second UPDATE missing. The merged row's scores lose the rules marker
// (same guards), so the next re-score judges it at its new places.
const placeKey = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const placesOf = (loc) => String(loc || '').replace(/\s*\([^)]*\)\s*$/, '').split(';').map((x) => x.trim()).filter((x) => x && !/^\+\d+ more$/.test(x));
function addPlace(current, add) {   // same rule as engine/multi_place.py merge_places(): at most three places, a '+N more' and a '(Country)' kept
  const cur = String(current || '');
  const suffix = /;/.test(cur) ? (cur.match(/\s*(\([^)]*\))\s*$/) || [])[1] || '' : '';
  const base = suffix ? cur.slice(0, cur.lastIndexOf(suffix)).trim() : cur;
  const parts = base.split(';').map((x) => x.trim()).filter(Boolean);
  const places = parts.filter((x) => !/^\+\d+ more$/.test(x)), more = parts.filter((x) => /^\+\d+ more$/.test(x));
  if (!add || places.some((p) => placeKey(p) === placeKey(add)) || places.length >= 3) return current;
  return [...places, add, ...more].join('; ') + (suffix ? ' ' + suffix : '');
}
const mergeById = new Map();
for (const file of many('--in')) for (const m of JSON.parse(fs.readFileSync(file, 'utf8')).merge || []) {
  if (!m || !m.id || typeof m.new !== 'string' || !m.new.trim()) continue;
  const had = mergeById.get(m.id);
  if (!had) { mergeById.set(m.id, { id: m.id, old: m.old || '', new: m.new }); continue; }
  if ((m.old || '') !== had.old) continue;   // read at another time: left for the next run
  const before = new Set(placesOf(m.old).map(placeKey));
  for (const p of placesOf(m.new)) if (!before.has(placeKey(p))) had.new = addPlace(had.new, p);
}
for (const m of mergeById.values()) {
  const loc = cap(m.new, 300);
  out.push(`UPDATE jobs SET location_restrictions = ${q(loc)} WHERE id = ${q(m.id)} AND is_active = 1 AND COALESCE(location_restrictions, '') = ${q(m.old)} ${guarded};`);
  out.push(`UPDATE candidate_job_scores SET score_breakdown = json_remove(score_breakdown, ${q('$.' + RULES_MARKER)}) WHERE job_id = ${q(m.id)} AND json_valid(score_breakdown)
    AND EXISTS (SELECT 1 FROM jobs WHERE id = ${q(m.id)} AND location_restrictions = ${q(loc)})
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_job_scores.candidate_id AND a.job_id = candidate_job_scores.job_id)
    AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = candidate_job_scores.candidate_id AND x.job_id = candidate_job_scores.job_id AND x.manual_override_status IS NOT NULL);`);
}
report.same_job_other_city = mergeById.size;
report.closed = toClose.length; report.reopened = reopen.length; report.missing_marked = missingMark.length; report.missing_cleared = missingClear.length;

// ---- long-open listings: a note on undecided rows for jobs first seen more than 60 days ago (reposts are noted at insert time)
{
  const old = new Date(Date.now() - 60 * 86400000).toISOString();
  out.push(`UPDATE candidate_qualifications SET qualification_reason = qualification_reason || ' Listed for 60+ days (may be stale or evergreen).'
    WHERE manual_override_status IS NULL AND qualification_status IN ('NEEDS_REVIEW','HOLD') AND qualification_reason NOT LIKE '%Listed for 60+ days%'
    AND job_id IN (SELECT id FROM jobs WHERE is_active = 1 AND discovered_at < ${q(old)} AND source_channel IN ('ATS_DATASET', 'JOB_SITES'))
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_qualifications.candidate_id AND a.job_id = candidate_qualifications.job_id);`);
}

// ---- one-time re-score of earlier preliminary rows with the current rules (owner-approved 2026-11-06, rules of 2026-11-07) ----
// Score always; status and eligibility only when the current rules make the row ineligible (for example a role that is not
// remote for a remote-only candidate). Rows someone applied to or decided on, and READY/STRETCH rows, are never touched.
// Workable jobs were all stored as remote until 2026-11-12 (the feed helper defaulted to remote). A genuinely remote one has a location written
// "Remote (...)"; any other is not remote. The stored rows are corrected below; a row being re-scored in this same run is judged correctly here.
const storedRemote = (row) => /^REMOTE/i.test(row.workplace_type || '') && !(row.source_adapter === 'workable' && !/^remote\b/i.test(row.location || ''));
out.push(`UPDATE jobs SET workplace_type = 'UNKNOWN' WHERE source_adapter = 'workable' AND workplace_type = 'REMOTE_RESTRICTED' AND location_restrictions NOT LIKE 'Remote%';`);

// A legacy row: undecided, score 0, never scored by the current screen (see legacy_rows in engine/dataset_discovery.py). It gets what a new row gets: the
// screen's status, lane and score. Guards, repeated in every statement: no override, still NEEDS_REVIEW, no application, and still unscored.
// A stored eligibility other than UNKNOWN was verified by an earlier review and is kept; only an UNKNOWN one is replaced.
// From which buckets a first-import row may be re-screened: undecided ones, and first-import Ready / Stretch rows (set by the old engine, not by a person:
// a person's decision carries a manual override and is excluded by every guard).
const OFFICE_REASON = 'Hybrid or set office days';   // the start of the screen's reason for plan S8 (worker/discovery.ts)
const LEGACY_FROM = `'NEEDS_REVIEW','READY','READY_HIGH','STRETCH_READY'`;
function rescreenLegacy(row, r) {
  const c = q(row.candidate_id), j = q(row.job_id);
  if (row.provenance === 'PUBLIC_FEED_UNVERIFIED') {   // same treatment as a job-board posting in discovery
    r.eligibility = 'UNKNOWN'; r.reason = `Reported by a public job board (${row.source_adapter || 'unknown'}); employer availability and eligibility are unverified.`;
    r.status = r.status === 'HOLD' ? 'HOLD' : 'NEEDS_REVIEW';
  }
  const roleMatched = r.lane === 'STRONGEST_FIT';
  const fallback = roleMatched ? 'NEEDS_REVIEW' : 'HOLD';   // when the stored eligibility is kept, the screen's own INELIGIBLE does not apply
  const noApp = (t) => `NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${t}.candidate_id AND a.job_id = ${t}.job_id)`;
  const bd = JSON.stringify({ rule_version: RULE_VERSION, preliminary: true, ranking_v2: true, skills_v1: true, [RULES_MARKER]: true, target_exact: !!r.target_exact, assessed_from: 'legacy_rescreen',
    matched_skills: r.skills, missing_skills: [], note: 'Conservative discovery screen; full qualification review pending.', rescored_at: now });
  // 1. the score, only while the row is still undecided and unscored
  out.push(`INSERT INTO candidate_job_scores(candidate_id, job_id, overall_score, skill_score, role_score, strategy_lane, score_breakdown, calculated_at)
    SELECT ${c}, ${j}, ${q(r.score)}, ${q(Math.min(100, r.skills.length * 20))}, ${roleMatched ? 70 : 0}, ${q(r.lane)}, ${q(bd)}, ${q(now)}
    WHERE EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = ${c} AND x.job_id = ${j} AND x.manual_override_status IS NULL AND x.qualification_status IN (${LEGACY_FROM}))
      AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${c} AND a.job_id = ${j})
    ON CONFLICT(candidate_id, job_id) DO UPDATE SET overall_score = excluded.overall_score, skill_score = excluded.skill_score, role_score = excluded.role_score,
      strategy_lane = excluded.strategy_lane, score_breakdown = excluded.score_breakdown, calculated_at = excluded.calculated_at
    WHERE candidate_job_scores.score_breakdown IS NULL OR candidate_job_scores.score_breakdown NOT LIKE '%preliminary%';`);
  // 2. the qualification, only if statement 1 really wrote this row's score just now
  const wrote = `EXISTS (SELECT 1 FROM candidate_job_scores s WHERE s.candidate_id = candidate_qualifications.candidate_id AND s.job_id = candidate_qualifications.job_id
      AND s.calculated_at = ${q(now)} AND s.score_breakdown LIKE '%legacy_rescreen%')`;
  const guard = `candidate_id = ${c} AND job_id = ${j} AND manual_override_status IS NULL AND qualification_status IN (${LEGACY_FROM}) AND ${noApp('candidate_qualifications')} AND ${wrote}`;
  if (r.status !== 'NEEDS_REVIEW' || fallback !== 'NEEDS_REVIEW') out.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
    SELECT candidate_id, job_id, qualification_status, CASE WHEN eligibility_status = 'UNKNOWN' THEN ${q(r.status)} ELSE ${q(r.status === 'INELIGIBLE' ? fallback : r.status)} END,
      'First-import row screened with the current rules', 'discovery' FROM candidate_qualifications
    WHERE ${guard} AND CASE WHEN eligibility_status = 'UNKNOWN' THEN ${q(r.status)} ELSE ${q(r.status === 'INELIGIBLE' ? fallback : r.status)} END <> qualification_status;`);
  out.push(`UPDATE candidate_qualifications SET
      qualification_status = CASE WHEN eligibility_status = 'UNKNOWN' THEN ${q(r.status)} ELSE ${q(r.status === 'INELIGIBLE' ? fallback : r.status)} END,
      strategy_lane = ${q(r.lane)}, qualification_reason = ${q(r.qualification_reason)}, last_reverified_at = ${q(now)},
      eligibility_reason = CASE WHEN eligibility_status = 'UNKNOWN' THEN ${q(r.reason)} ELSE eligibility_reason END,
      eligibility_status = CASE WHEN eligibility_status = 'UNKNOWN' THEN ${q(r.eligibility)} ELSE eligibility_status END
    WHERE ${guard};`);
  report.rescreened_legacy = (report.rescreened_legacy || 0) + 1;
}

const rescoreFile = opt('--rescore');
if (rescoreFile && fs.existsSync(rescoreFile)) {
  report.rescored_ineligible = 0;
  for (const row of JSON.parse(fs.readFileSync(rescoreFile, 'utf8'))) {
    const cand = byId.get(row.candidate_id);
    if (!cand || !hasSkills(cand)) continue;   // nothing to re-score with yet
    const posting = { id: row.job_id, title: row.title || '', company: row.company || '', url: '', location: row.location || '', description: plain(row.description), remote: storedRemote(row),
      salary: { min: row.salary_min, max: row.salary_max, currency: row.salary_currency, period: row.salary_period } };
    const r = evaluate(cand, posting, ctxFor.get(row.candidate_id));
    if (row.legacy) { rescreenLegacy(row, r); continue; }
    let bd = {}; try { bd = JSON.parse(row.score_breakdown || '{}') || {}; } catch {}
    // The re-scored base plus the current taste (stored as taste_adj, so the taste pass below never adds it twice).
    const t = r.status === 'INELIGIBLE' ? { adj: 0, sentence: '' } : taste(row.candidate_id, row.title, row.company);
    const tasteAdj = t.adj;
    r.score = Math.max(0, Math.min(100, r.score + tasteAdj));
    r.qualification_reason = withTasteSentence(r.qualification_reason, t.sentence);
    const tagged = JSON.stringify({ ...bd, skills_v1: true, [RULES_MARKER]: true, target_exact: !!r.target_exact, matched_skills: r.skills, rescored_at: now, taste_adj: tasteAdj });
    const undecided = (t) => `AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${t}.candidate_id AND a.job_id = ${t}.job_id)`;
    out.push(`UPDATE candidate_job_scores SET overall_score = ${q(r.score)}, skill_score = ${q(Math.min(100, r.skills.length * 20))}, score_breakdown = ${q(tagged)}, calculated_at = ${q(now)}
      WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND score_breakdown NOT LIKE ${MARKED} ${undecided('candidate_job_scores')}
      AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = candidate_job_scores.candidate_id AND x.job_id = candidate_job_scores.job_id AND (x.manual_override_status IS NOT NULL OR (x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD') AND COALESCE(x.qualification_reason, '') NOT LIKE 'Shortlisted automatically.%'
        AND NOT (x.qualification_status = 'INELIGIBLE' AND COALESCE(x.eligibility_reason, '') LIKE ${q(OFFICE_REASON + '%')}))));`);
    // Tenth-man review (phase 2): a row the office-days rule (S8) made ineligible comes back when the current rules no longer find office days, so a
    // wrong reading is not permanent (engine/dataset_discovery.py re-exports these rows at each rules-marker bump). Same guards as everywhere.
    if (r.status !== 'INELIGIBLE') {
      const revive = `candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND qualification_status = 'INELIGIBLE' AND manual_override_status IS NULL
        AND COALESCE(eligibility_reason, '') LIKE ${q(OFFICE_REASON + '%')} ${undecided('candidate_qualifications')}`;
      out.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
        SELECT candidate_id, job_id, 'INELIGIBLE', ${q(r.status)}, 'Office-days reading no longer applies under the current rules', 'discovery' FROM candidate_qualifications WHERE ${revive};`);
      out.push(`UPDATE candidate_qualifications SET qualification_status = ${q(r.status)}, eligibility_status = ${q(r.eligibility)}, eligibility_reason = ${q(r.reason)}, last_reverified_at = ${q(now)} WHERE ${revive};`);
    }
    // Plan S3: a row held as outside the role family comes back to "to review" when the current rules call its title a role match (the role rules
    // widen, S2). Before the reason below is replaced, while the stored reason still says why it was held. Never a decided or applied row, never an
    // ineligible one. Rows are exported best old score first, so the whole held queue is re-checked over a few runs.
    if (r.lane === 'STRONGEST_FIT' && r.status !== 'INELIGIBLE') {
      const back = `candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND qualification_status = 'HOLD' AND manual_override_status IS NULL
        AND COALESCE(eligibility_status, 'UNKNOWN') <> 'INELIGIBLE' AND qualification_reason LIKE 'Outside candidate target role family%' ${undecided('candidate_qualifications')}`;
      out.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
        SELECT candidate_id, job_id, 'HOLD', 'NEEDS_REVIEW', 'Back in the target role family under the current rules', 'discovery' FROM candidate_qualifications WHERE ${back};`);
      out.push(`UPDATE candidate_qualifications SET qualification_status = 'NEEDS_REVIEW', last_reverified_at = ${q(now)} WHERE ${back};`);
      report.held_role_rechecked = (report.held_role_rechecked || 0) + 1;
    }
    out.push(`UPDATE candidate_qualifications SET qualification_reason = ${q(r.qualification_reason)} WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)}
      AND manual_override_status IS NULL AND qualification_status IN ('NEEDS_REVIEW','HOLD') AND COALESCE(qualification_reason, '') NOT LIKE 'You marked%' ${undecided('candidate_qualifications')};`);
    // Eligibility only ever moves UNKNOWN -> ELIGIBLE here, when the current rules find affirmative evidence (e.g. Sana's on-site India roles,
    // owner decision 2026-11-12). Job-board reports stay UNKNOWN (their employer is unverified); a stored ELIGIBLE or INELIGIBLE is not touched.
    if (r.eligibility === 'ELIGIBLE' && row.provenance !== 'PUBLIC_FEED_UNVERIFIED') {
      out.push(`UPDATE candidate_qualifications SET eligibility_status = 'ELIGIBLE', eligibility_reason = ${q(r.reason)}, last_reverified_at = ${q(now)}
        WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND eligibility_status = 'UNKNOWN' AND COALESCE(eligibility_reason, '') NOT LIKE 'Reported by %'
        AND manual_override_status IS NULL AND qualification_status IN ('NEEDS_REVIEW','HOLD') ${undecided('candidate_qualifications')};`);
    }
    // Plan S8: the current rules may also take eligibility away (an office job whose "work from home" perk read as remote; hybrid or office days for a
    // remote-only person). Only where the screen wrote what is stored: no override, a reason that is not a person's ("Manual override...", "You marked..."),
    // no application, and the row undecided or on the automatic shortlist (the shortlist step then demotes it in the same run).
    const screenOwned = `candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND manual_override_status IS NULL
        AND COALESCE(eligibility_reason, '') NOT LIKE 'Manual override%' AND COALESCE(eligibility_reason, '') NOT LIKE 'You marked%' AND COALESCE(qualification_reason, '') NOT LIKE 'You marked%'
        AND (qualification_status IN ('NEEDS_REVIEW','HOLD') OR (qualification_status IN ('READY','STRETCH_READY') AND qualification_reason LIKE 'Shortlisted automatically.%')) ${undecided('candidate_qualifications')}`;
    if (r.status === 'INELIGIBLE') {
      out.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
        SELECT candidate_id, job_id, qualification_status, 'INELIGIBLE', ${q('Ineligible under the current rules: ' + r.reason)}, 'discovery' FROM candidate_qualifications WHERE ${screenOwned};`);
      out.push(`UPDATE candidate_qualifications SET qualification_status = 'INELIGIBLE', eligibility_status = 'INELIGIBLE', eligibility_reason = ${q(r.reason)}, last_reverified_at = ${q(now)},
          qualification_reason = CASE WHEN qualification_reason LIKE 'Shortlisted automatically.%' THEN substr(qualification_reason, 28) ELSE qualification_reason END
        WHERE ${screenOwned};`);
      report.rescored_ineligible++;
    } else if (r.eligibility === 'UNKNOWN' && row.provenance !== 'PUBLIC_FEED_UNVERIFIED' && bd.assessed_from !== 'legacy_rescreen') {
      // a first-import row's stored eligibility was verified by an earlier review and is kept (see rescreenLegacy)
      out.push(`UPDATE candidate_qualifications SET eligibility_status = 'UNKNOWN', eligibility_reason = ${q(r.reason)}, last_reverified_at = ${q(now)}
        WHERE ${screenOwned} AND eligibility_status = 'ELIGIBLE';`);
      report.rescored_eligibility_unknown = (report.rescored_eligibility_unknown || 0) + 1;
    }
    report.rescored++;
  }
}

// Consistency: a row whose own stored reason says it is outside the role family belongs in HOLD. A new row gets that from the screen; a re-scored row only had its
// score and reason updated, so it stayed in "to review" with score 0 (field-service roles after Sana's rule was tightened). Same guards as everywhere:
// no override, still NEEDS_REVIEW, no application. History first, while the row still matches.
{
  const ids = [...byId.keys()].map(q).join(',');
  const where = `candidate_id IN (${ids}) AND qualification_status = 'NEEDS_REVIEW' AND manual_override_status IS NULL
    AND qualification_reason LIKE 'Outside candidate target role family%'
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_qualifications.candidate_id AND a.job_id = candidate_qualifications.job_id)`;
  if (ids) {
    out.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
      SELECT candidate_id, job_id, 'NEEDS_REVIEW', 'HOLD', 'Outside the target role family under the current rules', 'discovery' FROM candidate_qualifications WHERE ${where};`);
    out.push(`UPDATE candidate_qualifications SET qualification_status = 'HOLD', last_reverified_at = ${q(now)} WHERE ${where};`);
  }
}

// ---- Low matches leave To review (owner review 2026-11-12) -------------------------------------------------------------------------------
// The automatic shortlist itself (Ready / Stretch) is chosen by scripts/shortlist_select.mjs from the exported pool after the still-open check
// (plan phase 3, A2). What stays here: about 1,000 rows per person in To review was too many to read, so a row the current rules score at or below
// LOW_MATCH (avoid-list, under-level and unworkable-abroad caps) moves to Hold with a mark, and comes back when it rises. Never touched: an override,
// an application. --no-shortlist: the two-hourly watchlist run skips this step (it reads every undecided row; once a day keeps D1 reads low).
// --shortlist-out <file>: this step goes to its own file (the daily run applies it with the shortlist).
function shortlistSql() {
  const sl = [];
  const ids = [...byId.keys()].map(q).join(',');
  if (ids) {
    const LOW = 45, HOLD_MARK = 'Held automatically (low match). ';
    const undecidedQ = `q.manual_override_status IS NULL AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)`;
    const scored = (cmp) => `EXISTS (SELECT 1 FROM candidate_job_scores s WHERE s.candidate_id = q.candidate_id AND s.job_id = q.job_id AND s.score_breakdown LIKE ${MARKED} AND s.overall_score ${cmp})`;
    const low = `(candidate_id, job_id) IN (SELECT q.candidate_id, q.job_id FROM candidate_qualifications q WHERE q.candidate_id IN (${ids}) AND q.qualification_status = 'NEEDS_REVIEW' AND ${undecidedQ} AND ${scored('<= ' + LOW)})`;
    const back = `(candidate_id, job_id) IN (SELECT q.candidate_id, q.job_id FROM candidate_qualifications q WHERE q.candidate_id IN (${ids}) AND q.qualification_status = 'HOLD' AND q.qualification_reason LIKE ${q(HOLD_MARK + '%')} AND ${undecidedQ} AND ${scored('> ' + LOW)})`;
    sl.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
      SELECT candidate_id, job_id, 'NEEDS_REVIEW', 'HOLD', 'Low match under the current rules', 'discovery' FROM candidate_qualifications WHERE ${low};`);
    sl.push(`UPDATE candidate_qualifications SET qualification_status = 'HOLD', qualification_reason = ${q(HOLD_MARK)} || COALESCE(qualification_reason, ''), last_reverified_at = ${q(now)} WHERE ${low};`);
    sl.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
      SELECT candidate_id, job_id, 'HOLD', 'NEEDS_REVIEW', 'Match improved under the current rules', 'discovery' FROM candidate_qualifications WHERE ${back};`);
    sl.push(`UPDATE candidate_qualifications SET qualification_status = 'NEEDS_REVIEW', qualification_reason = substr(qualification_reason, ${HOLD_MARK.length + 1}), last_reverified_at = ${q(now)} WHERE ${back};`);
  }
  return sl;
}
const shortlistOn = !args.includes('--no-shortlist');
const sl = opt('--shortlist-out') ? [] : out;   // see --shortlist-out below
if (shortlistOn) sl.push(...shortlistSql());

// ---- Taste pass (owner plan 2026-11-12: "learns from their choices"; rules of plan U3) ---------------------------------------------
// The learned adjustment (scripts/taste_rules.mjs: Not for me, Good match and applications, by employer and role family) is re-applied every
// run to the rows a person looks at: it is stored in the score breakdown as taste_adj, so a changed taste replaces the old adjustment instead
// of adding to it, and the "Ranked up / down" sentence in the reason is replaced, never appended twice. At most 5 points either way.
const tasteFile = opt('--taste-targets');
if (tasteFile && fs.existsSync(tasteFile)) {
  report.taste_adjusted = 0;
  for (const row of JSON.parse(fs.readFileSync(tasteFile, 'utf8'))) {
    let bd = {}; try { bd = JSON.parse(row.score_breakdown || '{}') || {}; } catch {}
    const old = Number(bd.taste_adj) || 0;
    const t = taste(row.candidate_id, row.title, row.company);
    const adj = t.adj;
    const reason = row.reason == null ? null : withTasteSentence(row.reason, t.sentence);
    if (reason != null && reason !== row.reason && !String(row.reason).startsWith('You marked')) {
      out.push(`UPDATE candidate_qualifications SET qualification_reason = ${q(reason)} WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)}
      AND qualification_reason = ${q(row.reason)} AND manual_override_status IS NULL
      AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_qualifications.candidate_id AND a.job_id = candidate_qualifications.job_id);`);
    }
    if (adj === old) continue;
    out.push(`UPDATE candidate_job_scores SET overall_score = MAX(0, MIN(100, overall_score - ${old} + ${adj})), score_breakdown = json_set(COALESCE(score_breakdown, '{}'), '$.taste_adj', ${adj})
      WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND COALESCE(json_extract(score_breakdown, '$.taste_adj'), 0) = ${old} AND json_valid(COALESCE(score_breakdown, '{}'))
      AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_job_scores.candidate_id AND a.job_id = candidate_job_scores.job_id)
      AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = candidate_job_scores.candidate_id AND x.job_id = candidate_job_scores.job_id AND x.manual_override_status IS NOT NULL);`);
    report.taste_adjusted++;
  }
}

fs.writeFileSync(opt('--out'), out.join('\n') + '\n');
const slFile = (lines) => (lines.length ? lines.join('\n') + '\nUPDATE cache_state SET generation = generation + 1 WHERE id = 1;\n' : '');
if (opt('--shortlist-out')) fs.writeFileSync(opt('--shortlist-out'), slFile(sl));
fs.writeFileSync(opt('--out').replace(/\.sql$/, '') + '.report.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));

