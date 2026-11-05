// One-time, idempotent correction of the PRELIMINARY scores the Worker's discovery screen stored before the owner-approved ranking change
// (2026-11-05). It uses the Worker's own functions (worker/discovery.ts), so stored rows and new evaluations cannot disagree.
//   Farhan: a title on his avoid list is capped at 40; a posting whose only stated location is outside India (and that is not affirmatively
//           eligible) loses 15 points; the cap is applied first, like evaluate().
//   Sana:   a stored "ELIGIBLE" that rested only on a city name becomes UNKNOWN (a fixed city list cannot establish a commercial airport
//           within about 2 hours); remote-in-India rows stay ELIGIBLE; role-matched rows lose the 10 points that eligibility added.
// It only LOWERS preliminary scores of rows still in NEEDS_REVIEW or HOLD with no manual override. It never reads or writes applications,
// application history or overrides, never changes a status, and never touches scores from another rule (the collector's engine).
// Rows already scored under the new rules carry "ranking_v2" in score_breakdown and are skipped, so re-running is harmless.
//   node --import ./test/register.mjs scripts/rescore_ranking_v2.mjs --remote            dry run: counts only, nothing written
//   node --import ./test/register.mjs scripts/rescore_ranking_v2.mjs --remote --apply   write (refuses above --max-writes, default 20000 rows)
//   add --local [--persist-to DIR] for a disposable local database
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate, avoidedTitle, foreignLocation, remoteFromStored, roleScore, sanaIndiaCity, AVOID_TITLE_CAP, FOREIGN_LOCATION_PENALTY, RANKING_TAG, SANA_OLD_ACCESS_REASON, SANA_UNKNOWN_ACCESS_REASON } from '../worker/discovery.ts';

const q = (v) => (v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
export const SELECT_ROWS = `SELECT s.candidate_id AS c, s.job_id AS j, s.overall_score AS score, s.strategy_lane AS lane, s.score_breakdown AS bd,
  q.eligibility_status AS es, q.eligibility_reason AS er, jb.title AS title, jb.location_restrictions AS loc, jb.workplace_type AS wt,
  CASE WHEN q.eligibility_reason LIKE 'Reported by %' THEN jb.description END AS descr
  FROM candidate_job_scores s
  JOIN candidate_qualifications q ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id
  JOIN jobs jb ON jb.id = s.job_id
  WHERE s.candidate_id IN ('farhan_shaikh','sana_ansari')
    AND s.score_breakdown LIKE '%cloud-conservative-review-%' AND s.score_breakdown NOT LIKE '%"${RANKING_TAG}"%'
    AND q.manual_override_status IS NULL AND q.qualification_status IN ('NEEDS_REVIEW','HOLD')`;

/** Pure: stored rows in, planned statements and counts out. */
export function plan(rows) {
  const out = { statements: [], counts: { examined: rows.length, farhan_avoid_cap: 0, farhan_foreign_location: 0, sana_accessibility: 0, score_rows: 0, qualification_rows: 0 } };
  const tagScore = (c, j, score) => `UPDATE candidate_job_scores SET overall_score = ${score}, score_breakdown = CASE WHEN json_valid(score_breakdown) THEN json_set(score_breakdown, '$.${RANKING_TAG}', 'corrected') ELSE score_breakdown END WHERE candidate_id = ${q(c)} AND job_id = ${q(j)} AND score_breakdown NOT LIKE '%"${RANKING_TAG}"%' AND EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = candidate_job_scores.candidate_id AND x.job_id = candidate_job_scores.job_id AND x.manual_override_status IS NULL AND x.qualification_status IN ('NEEDS_REVIEW','HOLD'));`;
  for (const r of rows) {
    let bd = null; try { bd = JSON.parse(r.bd); } catch { /* not JSON: untouched */ }
    if (!bd || bd[RANKING_TAG]) continue;
    const score = Number(r.score);
    if (r.c === 'farhan_shaikh') {
      // Job-board rows are stored with eligibility forced to UNKNOWN AFTER the Worker scored them, so the stored value cannot say whether the
      // penalty applied. The posting is stored, so the Worker's own evaluate() is re-run on it to get the eligibility the score was computed with.
      const boardRow = typeof r.er === 'string' && r.er.startsWith('Reported by ');
      let scoredElig = r.es;
      if (boardRow) scoredElig = typeof r.descr === 'string' ? evaluate({ id: r.c, primary_skills: '[]' }, { id: 'x', title: r.title || '', url: '', location: r.loc || '', description: r.descr, remote: /^REMOTE/i.test(r.wt || '') }).eligibility : 'UNKNOWN_SKIP';
      const foreign = scoredElig !== 'UNKNOWN_SKIP' && scoredElig !== 'ELIGIBLE' && foreignLocation(r.loc);
      let next = score; const avoid = avoidedTitle(r.c, r.title);
      if (avoid) next = Math.min(next, AVOID_TITLE_CAP);
      if (foreign) next = Math.max(0, next - FOREIGN_LOCATION_PENALTY);
      if (next !== score) {
        out.statements.push(tagScore(r.c, r.j, next)); out.counts.score_rows++;
        if (avoid) out.counts.farhan_avoid_cap++;
        if (foreign) out.counts.farhan_foreign_location++;
      }
    } else if (r.c === 'sana_ansari') {
      // Two stored shapes carry the old bonus: (a) ELIGIBLE with the old city-list reason; (b) job-board rows, whose eligibility the Worker forces to
      // UNKNOWN ("Reported by ...") after the score was computed with the city-based bonus. Remote-in-India is affirmative and is left alone.
      const cityOnly = !remoteFromStored(r.wt, r.loc);
      const oldReason = r.es === 'ELIGIBLE' && r.er === SANA_OLD_ACCESS_REASON && cityOnly;
      if (r.es === 'ELIGIBLE' && r.er === SANA_OLD_ACCESS_REASON && !cityOnly) {
        // Remote in India stays ELIGIBLE with the same score; only the stored reason text is brought in line with what the Worker now writes.
        out.statements.push(`UPDATE candidate_qualifications SET eligibility_reason = 'Remote role in India.' WHERE candidate_id = ${q(r.c)} AND job_id = ${q(r.j)} AND manual_override_status IS NULL AND qualification_status IN ('NEEDS_REVIEW','HOLD') AND eligibility_status = 'ELIGIBLE' AND eligibility_reason = ${q(SANA_OLD_ACCESS_REASON)};`);
        out.counts.qualification_rows++; continue;
      }
      const boardRow = r.es === 'UNKNOWN' && typeof r.er === 'string' && r.er.startsWith('Reported by ') && cityOnly && sanaIndiaCity(r.loc);
      if (!oldReason && !boardRow) continue;
      const before = out.statements.length;
      if (r.lane === 'STRONGEST_FIT') {
        const skills = Array.isArray(bd.matched_skills) ? bd.matched_skills.length : null;
        const next = skills === null ? Math.max(0, score - 10) : Math.min(score, roleScore(skills, false));   // recompute exactly like evaluate(); never raise
        if (next !== score) { out.statements.push(tagScore(r.c, r.j, next)); out.counts.score_rows++; }
      }
      if (oldReason) {
        out.statements.push(`UPDATE candidate_qualifications SET eligibility_status = 'UNKNOWN', eligibility_reason = ${q(SANA_UNKNOWN_ACCESS_REASON)} WHERE candidate_id = ${q(r.c)} AND job_id = ${q(r.j)} AND manual_override_status IS NULL AND qualification_status IN ('NEEDS_REVIEW','HOLD') AND eligibility_status = 'ELIGIBLE' AND eligibility_reason = ${q(SANA_OLD_ACCESS_REASON)};`);
        out.counts.qualification_rows++;
      }
      if (out.statements.length > before) out.counts.sana_accessibility++;
    }
  }
  out.counts.estimated_rows_written = out.counts.score_rows * 2 + out.counts.qualification_rows;   // the score index includes overall_score
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--remote') ? '--remote' : '--local';
  const persist = args.includes('--persist-to') ? ['--persist-to', args[args.indexOf('--persist-to') + 1]] : [];
  const apply = args.includes('--apply');
  const maxWrites = args.includes('--max-writes') ? Number(args[args.indexOf('--max-writes') + 1]) : 20000;
  const wr = (extra) => spawnSync('npx', ['wrangler', 'd1', 'execute', 'career-job-engine', mode, ...persist, ...extra], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const read = wr(['--json', '--command', SELECT_ROWS.replace(/\s+/g, ' ')]);
  if (read.status !== 0) { console.error('read failed:', (read.stderr || read.stdout).slice(0, 400)); process.exit(1); }
  const rows = JSON.parse(read.stdout.slice(read.stdout.indexOf('[')))[0].results || [];
  const p = plan(rows);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...p.counts }, null, 1));
  if (!apply || !p.statements.length) { console.log(apply ? 'nothing to correct' : 'dry run: nothing written'); return; }
  if (p.counts.estimated_rows_written > maxWrites) { console.error(`refusing: ${p.counts.estimated_rows_written} rows would be written, above --max-writes ${maxWrites}`); process.exit(2); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescore-'));
  const file = path.join(dir, 'rescore.sql');
  fs.writeFileSync(file, p.statements.join('\n') + '\n');
  // wrangler runs a file as one atomic batch ("if the execution fails to complete, your DB will return to its original state"), so a failure leaves
  // nothing half-applied and a re-run is safe. The cache is invalidated afterwards in every case, so no cached answer outlives a change.
  const w = wr(['--file', file]);
  const bump = wr(['--command', 'UPDATE cache_state SET generation = generation + 1 WHERE id = 1']);
  if (bump.status !== 0) console.error('cache invalidation failed (entries expire on their own):', (bump.stderr || bump.stdout).slice(0, 200));
  if (w.status !== 0) { console.error('write failed:', (w.stderr || w.stdout).slice(0, 600)); process.exit(1); }
  console.log(`applied ${p.statements.length} statements`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
