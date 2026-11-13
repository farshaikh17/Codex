// Writes one small record per discovery / watchlist run into discovery_state (key "run:<ISO time>"), so "how many new jobs arrived, how many rows were
// re-scored, which sources delivered" is a recorded fact the dashboard can show, not something read out of Actions logs.
// Counts only: no job text, no names. Usage (the workflow runs it): node scripts/run_log.mjs --work ../work --event <github event> --kind discovery|watchlist > ../work/runlog.sql
// A run the budget guard skipped: node scripts/run_log.mjs --skipped budget --kind discovery --event schedule  (writes {kind, event, skipped: "budget"})
import fs from 'node:fs';
import path from 'node:path';

const read = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** Pure: reports (parsed JSON or null) -> the record stored for the run. */
export function buildRunRecord({ apply, sources, boards, liveness }, { kind = 'discovery', event = 'unknown' } = {}) {
  const src = {};
  for (const [name, r] of Object.entries(sources || {})) {
    if (r && typeof r === 'object') src[name] = { read: num(r.read), kept: num(r.kept), ...(r.full_text ? { full_text: num(r.full_text) } : {}), ...(r.error ? { error: true } : {}) };
  }
  for (const [name, r] of Object.entries(boards || {})) {
    if (r && typeof r === 'object' && !src[name]) src[name] = { read: num(r.read), kept: num(r.kept), ...(r.error ? { error: true } : {}) };
  }
  return {
    kind, event,
    new_jobs: num(apply?.new_jobs), rescored: num(apply?.rescored), closed: num(apply?.closed), reopened: num(apply?.reopened),
    skipped_ineligible: num(apply?.skipped_ineligible), capped: num(apply?.capped),
    alive: num(liveness?.alive), dead: num(liveness?.dead), unknown: num(liveness?.unknown),
    sources: src,
  };
}

/** Pure: the record of a scheduled run the budget guard skipped, so a day without an update is a recorded fact, not an absence. */
export function skippedRecord(reason, { kind = 'discovery', event = 'unknown' } = {}) {
  return { kind, event, skipped: String(reason || 'budget').slice(0, 40) };
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
/** Pure: record -> one idempotent SQL statement (the key is the run time, so a re-run of the same minute replaces its own row). */
export function runLogSql(record, now = new Date()) {
  const key = 'run:' + now.toISOString().slice(0, 19) + 'Z';
  return `INSERT OR REPLACE INTO discovery_state(key, value, updated_at) VALUES (${q(key)}, ${q(JSON.stringify(record))}, ${q(now.toISOString().slice(0, 19).replace('T', ' '))});\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const dir = opt('--work', '../work');
  const rec = opt('--skipped') ? skippedRecord(opt('--skipped'), { kind: opt('--kind', 'discovery'), event: opt('--event', 'unknown') }) : buildRunRecord({ apply: read(dir, 'apply.report.json'), sources: read(dir, 'more_sources_report.json'), boards: read(dir, 'boards_report.json'), liveness: read(dir, 'liveness_report.json') },
    { kind: opt('--kind', 'discovery'), event: opt('--event', 'unknown') });
  process.stdout.write(runLogSql(rec));
}
