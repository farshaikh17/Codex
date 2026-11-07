// Turns discovery matches into SQL for D1, scoring every (job, candidate) pair with the Worker's own evaluate() so stored rows
// and the live screen can never disagree. Also closes jobs that left the dataset, and re-scores earlier preliminary rows with
// the candidates' now-stored skills (owner-approved 2026-11-06).
//
//   node --import ./test/register.mjs scripts/dataset_apply.mjs --candidates work/candidates.json \
//        --in work/matches.json [--in work/jobsite_matches.json] [--rescore work/rescore.json] [--global-hirers work/global_hirers.json] --out work/apply.sql [--max-new 1500]
//
// Guarantees: nothing is ever marked READY or STRETCH; no row with a human override or an application is written; an existing
// job or qualification is never overwritten by an insert; closures skip jobs someone applied to or decided on.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { evaluate, RULE_VERSION, companyKey } from '../worker/discovery.ts';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const many = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const MAX_NEW = Math.max(0, Math.floor(Number(opt('--max-new', 800)) || 800));
const MAX_CLOSE = Number(opt('--max-close', 2000));
const MIN_SCORE = Number(opt('--min-score', 30));
const now = new Date().toISOString();

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
const ctxFor = new Map(candidates.map((c) => {
  let rows = []; try { rows = JSON.parse(c.rejected_companies || '[]') || []; } catch {}
  const rejected = new Map();
  for (const r of Array.isArray(rows) ? rows : []) { const k = companyKey(r?.company); if (k && !rejected.has(k)) rejected.set(k, r?.on ? String(r.on).slice(0, 10) : null); }
  return [c.id, { globalHirers, rejected, yc }];
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
    const remote = j.is_remote === true || /\bremote\b/i.test(j.location || '');
    const onsite = j.is_remote === false;
    const posting = { id: j.id, title: j.title, company: j.company || '', url: j.url, location: j.location || '', description, remote, salary: { min: j.salary_min, max: j.salary_max, currency: j.salary_currency, period: j.salary_period } };
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
      if (r.status === 'INELIGIBLE') { report.skipped_ineligible++; continue; }
      if (r.score < MIN_SCORE) { report.skipped_low++; continue; }
      rows.push({ cid, r });
    }
    if (rows.length) planned.push({ j, board, description, remote, onsite, rows, best: Math.max(...rows.map((x) => x.r.score)) });
  }
}
planned.sort((a, b) => b.best - a.best || String(b.j.posted_at || '').localeCompare(String(a.j.posted_at || '')));
// One role posted in 3 or more places by the same employer (an aggregator's copy per country, or one requisition per city) is kept
// once: the best-scored copy, which is the first after the sort. Two copies (two real plants, say) are both kept.
{
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const groups = new Map();
  for (const x of planned) { const k = norm(x.j.company) + '|' + norm(x.j.title); groups.set(k, (groups.get(k) || 0) + 1); }
  const kept = new Set();
  const before = planned.length;
  const out2 = [];
  for (const x of planned) {
    const k = norm(x.j.company) + '|' + norm(x.j.title);
    if (groups.get(k) >= 3) { if (kept.has(k)) continue; kept.add(k); }
    out2.push(x);
  }
  planned.length = 0; planned.push(...out2);
  report.collapsed_copies = before - planned.length;
}
report.capped = Math.max(0, planned.length - MAX_NEW);
for (const { j, board, description, remote, onsite, rows } of planned.slice(0, MAX_NEW)) {
  const sha = crypto.createHash('sha256').update(JSON.stringify([j.title, j.location, description])).digest('hex');
  const salary = num(j.salary_min) !== null || num(j.salary_max) !== null;
  out.push(`INSERT OR IGNORE INTO jobs(id,title,company,source_adapter,source_url,original_posting_url,employment_type,workplace_type,location_restrictions,description,required_skills,salary_published,salary_currency,salary_min,salary_max,salary_period,salary_raw_text,discovered_at,last_verified_at,is_active,content_sha256,source_id,source_channel,provenance) VALUES (${[
    j.id, cap(j.title, 300), cap(j.company, 200), adapter(j.ats_type), cap(j.url, 2000), cap(j.apply_url && String(j.apply_url).length <= 2000 ? j.apply_url : j.url, 2000), cap(j.employment_type || 'FULL_TIME', 40),
    remote ? 'REMOTE_RESTRICTED' : onsite && !board ? 'ONSITE' : 'UNKNOWN', cap(j.location || '', 300), description, '[]', salary ? 1 : 0,
    cap(j.salary_currency, 10), num(j.salary_min), num(j.salary_max), cap(j.salary_period, 20), cap(j.salary_summary, 300), now, board ? null : now, 1, sha,
    `${board ? 'jobsites' : 'dataset'}:${adapter(j.ats_type)}`, board ? 'JOB_SITES' : 'ATS_DATASET', board ? 'PUBLIC_FEED_UNVERIFIED' : 'ATS_DATASET'].map(q).join(',')});`);
  report.new_jobs++;
  for (const { cid, r } of rows) {
    const guard = `WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ${q(j.id)}) AND NOT EXISTS (SELECT 1 FROM applications WHERE candidate_id = ${q(cid)} AND job_id = ${q(j.id)})`;
    out.push(`INSERT OR IGNORE INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,eligibility_reason,qualification_reason,last_reverified_at) SELECT ${[cid, j.id, r.status, r.lane, r.eligibility, r.reason, r.qualification_reason, now].map(q).join(',')} ${guard};`);
    out.push(`INSERT OR IGNORE INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,role_score,strategy_lane,score_breakdown,calculated_at) SELECT ${[cid, j.id, r.score, Math.min(100, r.skills.length * 20), r.lane === 'STRONGEST_FIT' ? 70 : 0, r.lane,
      JSON.stringify({ rule_version: RULE_VERSION, preliminary: true, ranking_v2: true, profile_v3: true, skills_v1: hasSkills(byId.get(cid)), assessed_from: board ? 'job_sites' : 'ats_dataset', matched_skills: r.skills, missing_skills: [], note: 'Conservative discovery screen; full qualification review pending.' }), now].map(q).join(',')} ${guard};`);
    report.rows++; report.by_status[r.status] = (report.by_status[r.status] || 0) + 1;
  }
}

// ---- stored copies of one role (3 or more places, same employer): keep the best-scored one active --------------------
out.push(`UPDATE jobs SET is_active = 0, expired_at = ${q(now)} WHERE id IN (
  SELECT id FROM (SELECT j.id, COUNT(*) OVER (PARTITION BY lower(j.company), lower(j.title)) AS n,
    ROW_NUMBER() OVER (PARTITION BY lower(j.company), lower(j.title) ORDER BY (SELECT MAX(s.overall_score) FROM candidate_job_scores s WHERE s.job_id = j.id) DESC, j.discovered_at) AS rk
    FROM jobs j WHERE j.is_active = 1 AND j.source_channel IN ('ATS_DATASET', 'JOB_SITES')) WHERE n >= 3 AND rk > 1)
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND (x.manual_override_status IS NOT NULL OR x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD')));`);

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
report.closed = toClose.length; report.reopened = reopen.length; report.missing_marked = missingMark.length; report.missing_cleared = missingClear.length;

// ---- one-time re-score of earlier preliminary rows with the current rules (owner-approved 2026-11-06, rules of 2026-11-07) ----
// Score always; status and eligibility only when the current rules make the row ineligible (for example a role that is not
// remote for a remote-only candidate). Rows someone applied to or decided on, and READY/STRETCH rows, are never touched.
const rescoreFile = opt('--rescore');
if (rescoreFile && fs.existsSync(rescoreFile)) {
  report.rescored_ineligible = 0;
  for (const row of JSON.parse(fs.readFileSync(rescoreFile, 'utf8'))) {
    const cand = byId.get(row.candidate_id);
    if (!cand || !hasSkills(cand)) continue;   // nothing to re-score with yet
    const posting = { id: row.job_id, title: row.title || '', company: row.company || '', url: '', location: row.location || '', description: plain(row.description), remote: /^REMOTE/i.test(row.workplace_type || ''),
      salary: { min: row.salary_min, max: row.salary_max, currency: row.salary_currency, period: row.salary_period } };
    const r = evaluate(cand, posting, ctxFor.get(row.candidate_id));
    let bd = {}; try { bd = JSON.parse(row.score_breakdown || '{}') || {}; } catch {}
    const tagged = JSON.stringify({ ...bd, skills_v1: true, profile_v3: true, matched_skills: r.skills, rescored_at: now });
    const undecided = (t) => `AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${t}.candidate_id AND a.job_id = ${t}.job_id)`;
    out.push(`UPDATE candidate_job_scores SET overall_score = ${q(r.score)}, skill_score = ${q(Math.min(100, r.skills.length * 20))}, score_breakdown = ${q(tagged)}, calculated_at = ${q(now)}
      WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND score_breakdown NOT LIKE '%"profile_v3":true%' ${undecided('candidate_job_scores')}
      AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = candidate_job_scores.candidate_id AND x.job_id = candidate_job_scores.job_id AND (x.manual_override_status IS NOT NULL OR x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD')));`);
    out.push(`UPDATE candidate_qualifications SET qualification_reason = ${q(r.qualification_reason)} WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)}
      AND manual_override_status IS NULL AND qualification_status IN ('NEEDS_REVIEW','HOLD') ${undecided('candidate_qualifications')};`);
    if (r.status === 'INELIGIBLE') {
      out.push(`UPDATE candidate_qualifications SET qualification_status = 'INELIGIBLE', eligibility_status = 'INELIGIBLE', eligibility_reason = ${q(r.reason)}, last_reverified_at = ${q(now)}
        WHERE candidate_id = ${q(row.candidate_id)} AND job_id = ${q(row.job_id)} AND manual_override_status IS NULL AND qualification_status IN ('NEEDS_REVIEW','HOLD') ${undecided('candidate_qualifications')};`);
      report.rescored_ineligible++;
    }
    report.rescored++;
  }
}

fs.writeFileSync(opt('--out'), out.join('\n') + '\n');
fs.writeFileSync(opt('--out').replace(/\.sql$/, '') + '.report.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
