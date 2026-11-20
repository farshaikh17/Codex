// Equivalence of the profile packs with the old evaluate() for the two built-in people (dashboard/docs/MULTI_CANDIDATE.md section 5), on any
// set of stored rows: the hand-judged set, or an export of a person's rows. Rules only; reads no database.
//
//   node --import ./test/register.mjs scripts/quality/equivalence.mjs --rows <rows.json> --candidates <candidates.json> [--out <mismatches.json>]
// rows: [{cid | candidate_id, title, company, location, description, workplace_type | remote, source_adapter | source, url, salary_min, salary_max,
//         salary_currency, salary_period, qreason?}], or {rows: [...]}. candidates: candidates.json as the daily run writes it.
// Prints {rows, compared, mismatches, by_field}; exits 1 when anything differs.
import fs from 'node:fs';
import { evaluate, companyKey, remoteFlagTrusted } from '../../worker/discovery.ts';
import { plain } from '../prescore.mjs';
import { resolveProfile } from '../../worker/profiles/resolve.ts';
import { evaluateWithProfile } from '../../worker/profiles/evaluate.ts';
import { LEGACY_CONFIGS } from '../../worker/profiles/legacy.ts';

const FIELDS = ['status', 'lane', 'eligibility', 'reason', 'score', 'target_fit', 'target_exact', 'qualification_reason'];
/** The stored-row posting, as dataset_apply.mjs's re-score builds it. */
export function storedPosting(r) {
  const description = plain(r.description);
  const remote = r.remote !== undefined ? !!r.remote : /^REMOTE/i.test(r.workplace_type || '') && !((r.source_adapter || r.source) === 'workable' && !/^remote\b/i.test(r.location || ''))
    && remoteFlagTrusted(r.source_adapter || r.source, description, r.location);
  return { id: r.job_id || r.id, title: r.title || '', company: r.company || '', url: r.url || '', source: r.source_adapter || r.source || '', location: r.location || '', description, remote,
    salary: r.salary || { min: r.salary_min, max: r.salary_max, currency: r.salary_currency, period: r.salary_period } };
}
/** Employer lists as the stored reasons name them (the run reads them from public lists at run time). */
export function contextFromReasons(rows) {
  const gh = new Set(), yc = new Map(), uk = new Set();
  for (const r of rows) { const k = companyKey(r.company); if (!k) continue; const q = r.qreason || '';
    if (/hiring worldwide/.test(q)) gh.add(k); const m = /Y Combinator company \(([^)]*)\)/.exec(q); if (m) yc.set(k, m[1]); if (/UK Skilled Worker sponsor/.test(q)) uk.add(k); }
  return { globalHirers: gh, rejected: new Map(), yc, ukSponsors: uk };
}
export function compare(rows, cands) {
  const ctx = contextFromReasons(rows), mism = [], by = {};
  let compared = 0;
  const shaped = new Map(cands.map((c) => [c.id, { ...c, primary_skills: typeof c.primary_skills === 'string' ? c.primary_skills : JSON.stringify(c.primary_skills || []), target_roles: typeof c.target_roles === 'string' ? c.target_roles : JSON.stringify(c.target_roles || []) }]));
  const profs = new Map([...shaped].filter(([id]) => LEGACY_CONFIGS['legacy:' + id]).map(([id, c]) => [id, resolveProfile(c, LEGACY_CONFIGS['legacy:' + id])]));
  for (const r of rows) {
    const cid = r.cid || r.candidate_id, cand = shaped.get(cid), prof = profs.get(cid);
    if (!cand || !prof) continue;
    const p = storedPosting(r), a = evaluate(cand, p, ctx), b = evaluateWithProfile(prof, p, ctx);
    compared++;
    const diff = FIELDS.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f])).concat(JSON.stringify(a.skills) !== JSON.stringify(b.skills) ? ['skills'] : []);
    for (const f of diff) by[f] = (by[f] || 0) + 1;
    if (diff.length) mism.push({ cid, job_id: p.id, title: p.title, diff: Object.fromEntries(diff.map((f) => [f, { old: f === 'skills' ? a.skills : a[f], new: f === 'skills' ? b.skills : b[f] }])) });
  }
  return { rows: rows.length, compared, mismatches: mism.length, by_field: by, list: mism };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  let rows = JSON.parse(fs.readFileSync(opt('--rows'), 'utf8')); if (!Array.isArray(rows)) rows = rows.rows || [];
  const res = compare(rows, JSON.parse(fs.readFileSync(opt('--candidates'), 'utf8')));
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(res.list, null, 1));
  console.log(JSON.stringify({ rows: res.rows, compared: res.compared, mismatches: res.mismatches, by_field: res.by_field }));
  if (res.mismatches) { for (const m of res.list.slice(0, 5)) console.error(JSON.stringify(m).slice(0, 600)); process.exit(1); }
}
