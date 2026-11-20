// Judged-set regression harness (dashboard/docs/MULTI_CANDIDATE.md section 7.1): any person's hand-judged sample becomes a permanent test.
// Every row is scored with the person's current scorer (their profile packs, or the old evaluate()), treated as verified open, and checked
// against the shortlist rules: "listed" = Best matches or Worth a try would take it (fitsReady / fitsStretchRule). Rules only; no database.
//
//   node --import ./test/register.mjs scripts/quality/judged_harness.mjs --judged judged/<id>.json --candidates candidates.json [--expect expect.json] [--assert] [--out report.json]
// --expect: a previous report; with --assert the run fails when a row whose expectation it met before no longer meets it (a regression).
import fs from 'node:fs';
import { scoreCandidate, registerCandidates, shortlistSettings } from '../../worker/profiles/dispatch.ts';
import { fitsReady, fitsStretchRule } from '../shortlist_select.mjs';

const expectOf = (r) => r.expect || (r.verdict === 'RIGHT' ? 'listed' : r.verdict === 'WRONG' ? 'not_listed' : 'any');
/** Validates the judged-set file; returns the list of problems (empty when it is usable). */
export function checkJudged(j) {
  const errs = [];
  if (!j || j.schema !== 1) errs.push('schema must be 1');
  if (!j?.candidate_id) errs.push('candidate_id is required');
  if (!Array.isArray(j?.rows) || !j.rows.length) errs.push('rows must be a non-empty list');
  for (const [i, r] of (j?.rows || []).entries()) {
    if (!r.id || !r.title) errs.push(`rows[${i}]: id and title are required`);
    if (!['RIGHT', 'WRONG', 'UNSURE'].includes(r.verdict)) errs.push(`rows[${i}]: verdict is RIGHT, WRONG or UNSURE`);
    if (r.expect && !['listed', 'not_listed', 'any'].includes(r.expect)) errs.push(`rows[${i}]: expect is listed, not_listed or any`);
  }
  return errs;
}
/** Scores a judged set. Returns {candidate_id, rows: [{id, verdict, expect, score, eligibility, listed, ok}], summary}. */
export function runJudged(judged, candidates, ctx = {}) {
  registerCandidates(candidates);
  const cand = candidates.find((c) => c.id === judged.candidate_id);
  if (!cand) throw new Error(`candidate ${judged.candidate_id} is not in the candidates file`);
  const set = shortlistSettings(cand.id);
  const out = [];
  for (const r of judged.rows) {
    const p = { id: r.id, title: r.title, company: r.company || '', url: r.url || '', source: r.source || '', location: r.location || '', description: r.description || '', remote: !!r.remote,
      salary: r.salary || {}, board: !!r.board };
    const e = scoreCandidate(cand, p, ctx);
    const row = { candidate_id: cand.id, job_id: r.id, active: 1, marked: 1, score: e.score, skill_score: Math.min(100, e.skills.length * 20), target_exact: e.target_exact ? 1 : 0,
      description: r.description || '', eligibility: e.status === 'INELIGIBLE' ? 'INELIGIBLE' : e.eligibility, threshold: set.threshold ?? (Number(cand.qualification_threshold) || (cand.id === 'farhan_shaikh' ? 70 : 60)), location: r.location || '' };
    if (set.homePlaceOk) row.place_ok = set.homePlaceOk(r.location || '');
    const tier = fitsReady(row) ? 'ready' : fitsStretchRule(row) ? 'stretch' : null, listed = !!tier, expect = expectOf(r);
    out.push({ id: r.id, title: r.title, verdict: r.verdict, expect, score: e.score, eligibility: row.eligibility, tier, listed, ok: expect === 'any' || (expect === 'listed') === listed, why: e.qualification_reason });
  }
  const summary = { rows: out.length, ok: out.filter((x) => x.ok).length, right_listed: out.filter((x) => x.verdict === 'RIGHT' && x.listed).length, right: out.filter((x) => x.verdict === 'RIGHT').length,
    wrong_listed: out.filter((x) => x.verdict === 'WRONG' && x.listed).length, wrong: out.filter((x) => x.verdict === 'WRONG').length };
  return { candidate_id: cand.id, rows: out, summary };
}
/** Rows that met their expectation in `before` and no longer do. */
export function regressions(before, after) {
  const was = new Map((before?.rows || []).map((r) => [r.id, r.ok]));
  return after.rows.filter((r) => was.get(r.id) === true && !r.ok);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const judged = JSON.parse(fs.readFileSync(opt('--judged'), 'utf8'));
  const errs = checkJudged(judged); if (errs.length) { console.error(errs.join('\n')); process.exit(2); }
  const res = runJudged(judged, JSON.parse(fs.readFileSync(opt('--candidates'), 'utf8')));
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(res, null, 1));
  const before = opt('--expect') && fs.existsSync(opt('--expect')) ? JSON.parse(fs.readFileSync(opt('--expect'), 'utf8')) : null;
  const reg = before ? regressions(before, res) : [];
  console.log(JSON.stringify({ ...res.summary, regressions: reg.length }));
  for (const r of reg.slice(0, 20)) console.error(`regression: ${r.id} ${r.title} (${r.verdict}, expect ${r.expect}, now ${r.tier || 'not listed'} at ${r.score})`);
  if (args.includes('--assert') && reg.length) process.exit(1);
}
