// Tidy-up of old screening rows (D1 read diet, part 3). The daily run, the lists and the counts walk every screening row of a person
// (candidate_qualifications, candidate_job_scores) and the history, so rows of jobs nobody will see again still cost reads every day.
// This deletes those rows for jobs closed, or hidden by the rules for everyone, more than --days ago. The job row itself stays, so the
// importer recognises the posting exactly as before, and no foreign-key check has to scan the tables that reference jobs (deleting 1,000
// job rows read about 64 million rows on a production-size local copy: those tables have no job_id index).
//
// Two steps, so the choice (the only part that reads much) is made once:
//   node scripts/tidy_jobs.mjs --print-batch-sql [--max-jobs 500] [--days 45] [--now ISO]   -> one read query (the workflow runs it with --json)
//   node scripts/tidy_jobs.mjs --ids work/tidy_ids.json [--now ISO] > work/tidy.sql         -> the deletes for the jobs it chose
//
// A job's rows are deleted only when ALL of these hold:
//  * it came from the daily pipeline (source_channel ATS_DATASET or JOB_SITES), and
//  * it is GONE: it closed (is_active = 0) between --days and --days + WINDOW_DAYS ago; or HIDDEN: still listed, first seen between --days and
//    --days + HIDDEN_WINDOW_DAYS ago, not verified open since --days ago, and every screening row says INELIGIBLE (not the office-days reading,
//    which a rules change may revive). Each job is considered on the few days it crosses the line, so the choice reads only those rows (a
//    job missed then simply keeps its rows: nothing depends on the tidy-up), and
//  * nobody ever acted on it: no application (any status), no application history, no follow-up, no Good match / Not for me, no manual
//    override, no Ready / Stretch / Applied row, no history entry written by a person (checked again when the rows are deleted).
// Deleted: its screening and score rows (never one with an override) and the history the pipeline itself wrote about it.
// Never touched: jobs, applications, application_history, manual overrides, candidates, follow-ups, ratings, a person's history entries.
// Bounded (--max-jobs) and idempotent. Writes: about 20 rows per job (two screening rows and two score rows with their index entries, a few
// history rows): 500 jobs is about 10,000 of the 100,000 rows written a day allows.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TIDY_CHANNELS = ['ATS_DATASET', 'JOB_SITES'];
export const WINDOW_DAYS = 7, HIDDEN_WINDOW_DAYS = 2;
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** Conditions on job j that make it untouchable (someone acted on it). Each probe goes through an index: per candidate where the table is keyed
 *  by candidate first (CROSS JOIN keeps candidates outermost; otherwise the planner scanned the whole history table for every job). */
export const UNREFERENCED = `NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM candidates c CROSS JOIN application_history h WHERE h.candidate_id = c.id AND h.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM candidates c CROSS JOIN application_followups u WHERE u.candidate_id = c.id AND u.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM candidates c CROSS JOIN job_feedback f WHERE f.candidate_id = c.id AND f.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = j.id
                    AND (x.manual_override_status IS NOT NULL OR x.qualification_status IN ('READY','READY_HIGH','STRETCH_READY','APPLIED')))
    AND NOT EXISTS (SELECT 1 FROM candidates c CROSS JOIN qualification_history h WHERE h.candidate_id = c.id AND h.job_id = j.id AND COALESCE(h.actor, '') <> 'discovery')`;

const iso = (now, days) => new Date(Date.parse(now) - days * 86400000).toISOString();
function check({ now, maxJobs, days }) {
  if (!Number.isInteger(maxJobs) || maxJobs < 0 || maxJobs > 2000) throw new Error('--max-jobs must be a whole number from 0 to 2000');
  if (!Number.isInteger(days) || days < 30) throw new Error('--days must be a whole number of at least 30');
  if (Number.isNaN(Date.parse(now))) throw new Error('--now must be an ISO date and time');
}

/** The one read query: the jobs whose rows this run deletes (column id). */
export function batchSql({ now = new Date().toISOString(), maxJobs = 500, days = 45 } = {}) {
  check({ now, maxJobs, days });
  const cut = iso(now, days), channels = TIDY_CHANNELS.map(q).join(',');
  const goneMax = Math.ceil(maxJobs * 0.8), hiddenMax = maxJobs - goneMax;
  const any = `EXISTS (SELECT 1 FROM candidate_qualifications y WHERE y.job_id = j.id)`;   // something left to delete
  // closed jobs by when they closed (the partial index idx_jobs_closed_at, migration 0026: named, as the planner otherwise walks every closed
  // job through idx_jobs_is_active); open ones by when they were first seen
  const gone = `SELECT j.id FROM jobs j INDEXED BY idx_jobs_closed_at WHERE j.is_active = 0 AND j.expired_at >= ${q(iso(now, days + WINDOW_DAYS))} AND j.expired_at < ${q(cut)}
      AND j.source_channel IN (${channels}) AND ${any} AND ${UNREFERENCED} LIMIT ${goneMax}`;
  const hidden = `SELECT j.id FROM jobs j WHERE j.source_channel IN (${channels}) AND j.is_active = 1
      AND j.discovered_at >= ${q(iso(now, days + HIDDEN_WINDOW_DAYS))} AND j.discovered_at < ${q(cut)} AND COALESCE(j.last_verified_at, '') < ${q(cut)} AND ${any}
      AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = j.id
                      AND (x.qualification_status <> 'INELIGIBLE' OR COALESCE(x.eligibility_reason, '') LIKE 'Hybrid or set office days%'))
      AND ${UNREFERENCED} LIMIT ${hiddenMax}`;
  return `SELECT id FROM (${gone}) UNION ALL SELECT id FROM (${hidden})`;
}

/** The deletes for the chosen ids. Every statement checks again that nobody acted on the job since it was chosen. */
export function tidySql(ids) {
  const list = [...new Set((ids || []).filter((x) => typeof x === 'string' && x.length < 600))].slice(0, 2000);
  if (!list.length) return '';
  const chosen = `(SELECT j.id FROM jobs j WHERE j.id IN (SELECT value FROM json_each(${q(JSON.stringify(list))})) AND ${UNREFERENCED})`;
  return [
    // (candidate, job) pairs: the score and history tables are keyed by candidate first, so a job id alone would scan them.
    `DELETE FROM candidate_job_scores WHERE (candidate_id, job_id) IN (SELECT c.id, b.id FROM ${chosen} b CROSS JOIN candidates c);`,
    `DELETE FROM qualification_history WHERE id IN (SELECT h.id FROM ${chosen} b CROSS JOIN candidates c CROSS JOIN qualification_history h
  WHERE h.candidate_id = c.id AND h.job_id = b.id AND COALESCE(h.actor, '') = 'discovery');`,
    `DELETE FROM candidate_qualifications WHERE job_id IN ${chosen} AND manual_override_status IS NULL;`,
  ].join('\n') + '\n';
}

/** ids from `wrangler d1 execute --json` output (or a plain JSON array of ids). */
export function idsFromWrangler(text) {
  const data = JSON.parse(String(text).slice(Math.max(0, String(text).indexOf('['))));
  const rows = Array.isArray(data) && data[0] && Array.isArray(data[0].results) ? data[0].results : data;
  return (Array.isArray(rows) ? rows : []).map((r) => (typeof r === 'string' ? r : r?.id)).filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const now = opt('--now', new Date().toISOString());
  if (args.includes('--print-batch-sql')) process.stdout.write(batchSql({ now, maxJobs: Number(opt('--max-jobs', 500)), days: Number(opt('--days', 45)) }) + '\n');
  else if (opt('--ids')) process.stdout.write(tidySql(idsFromWrangler(fs.readFileSync(opt('--ids'), 'utf8'))));
  else { console.error('usage: tidy_jobs.mjs --print-batch-sql [--max-jobs N] [--days N] | --ids FILE'); process.exit(2); }
}
