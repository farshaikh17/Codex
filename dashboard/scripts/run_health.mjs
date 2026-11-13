// "Did today's daily run actually do its job?" (plan R8: a run must not go green while doing nothing). Reads the run's own report files
// and decides; the workflow's last job turns a "no" into a red run. Counts only; no job text.
//   node scripts/run_health.mjs --work ../work   -> prints the decision, writes healthy=true|false and reasons=... to $GITHUB_OUTPUT
// Unhealthy when any of:
//   - the still-open check had targets but verified 0 of them;
//   - every source of the boards and more-sources steps failed (a missing report means its step ended before any source finished);
//   - nothing was written (no new job, no new row, nothing re-scored) although the dataset was fresh;
//   - the dataset snapshot was stale (over 48 hours; engine/dataset_discovery.py writes dataset_stale.txt).
import fs from 'node:fs';
import path from 'node:path';

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** Pure decision. Each input is the parsed report (or null when the file is missing). */
export function decideHealth({ targets = null, liveness = null, sources = null, boards = null, apply = null, dataset = null, stale = false } = {}) {
  const reasons = [];
  const nTargets = Array.isArray(targets) ? targets.length : num(targets?.targets);
  if (nTargets > 0 && num(liveness?.alive) === 0) reasons.push(`still-open check had ${nTargets} targets but verified 0`);
  const ran = [sources, boards].flatMap((r) => (r && typeof r === 'object' ? Object.values(r) : [])).filter((r) => r && typeof r === 'object' && !r.skipped);
  if (!sources && !boards) reasons.push('no source report at all (both source steps ended before any source finished)');
  else if (ran.length && ran.every((r) => r.error)) reasons.push(`every source failed (${ran.length})`);
  const fresh = !!dataset && !stale && !dataset.stale && dataset.dataset !== 'download_failed';
  const written = num(apply?.new_jobs) + num(apply?.rows) + num(apply?.rescored) + num(apply?.rescreened_legacy);
  if (apply && fresh && written === 0) reasons.push('0 rows written although the dataset was fresh');
  if (stale || dataset?.stale) reasons.push('the dataset snapshot is over 48 hours old');
  return { healthy: reasons.length === 0, reasons };
}

const read = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--work');
  const dir = i >= 0 ? args[i + 1] : '../work';
  const d = decideHealth({ targets: read(dir, 'liveness_targets.json'), liveness: read(dir, 'liveness_report.json'), sources: read(dir, 'more_sources_report.json'),
    boards: read(dir, 'boards_report.json'), apply: read(dir, 'apply.report.json'), dataset: read(dir, 'report.json'), stale: fs.existsSync(path.join(dir, 'dataset_stale.txt')) });
  console.log(`Run health: ${d.healthy ? 'ok' : 'FAILED - ' + d.reasons.join('; ')}`);
  for (const r of d.reasons) console.log(`::error title=Daily run health::${r}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `healthy=${d.healthy}\nreasons=${d.reasons.join('; ').replace(/[\r\n]/g, ' ')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Run health:** ${d.healthy ? 'ok' : 'failed - ' + d.reasons.join('; ')}\n`);
}
