// Onboarding audit (dashboard/docs/MULTI_CANDIDATE.md section 7): for one person, samples their Best matches and Worth a try rows and flags
// rule-level risk patterns per row, into a JSON and a Markdown report. Rules only (no model); reads no database (give it the shortlist pool
// file the daily run exports, or any rows file of the same shape).
//
//   node --import ./test/register.mjs scripts/quality/onboarding_audit.mjs --rows work/shortlist_pool.json --candidates work/candidates.json \
//        --candidate <id> [--sample 40] [--out report.json] [--md report.md]
// rows: [{candidate_id, job_id, status, title, company, location, workplace, source, url, description, score, eligibility}] or {rows: [...]}.
import fs from 'node:fs';
import { foreignLocation, indianPlace, gulfPlace, locationClass, yearsRequired, RULE_PARTS, languageHardRequired, AGGREGATOR_SOURCE } from '../../worker/discovery.ts';
import { registerCandidates, profileOf, scoreCandidate } from '../../worker/profiles/dispatch.ts';
import { isReposter } from '../shortlist_select.mjs';

export const THIN_TEXT = 300;
const TIERS = ['READY', 'STRETCH_READY'];
/** The risk flags of one row for one person. */
export function rowRisks(r, cand, prof = profileOf(cand)) {
  const flags = [];
  const loc = String(r.location || ''), d = String(r.description || ''), title = String(r.title || '');
  const remote = /^REMOTE/i.test(r.workplace || '') || /\bremote\b/i.test(loc);
  const named = !!loc.replace(/\b(?:remote|hybrid|on[- ]?site)\b/gi, '').replace(/[\s,;()/-]+/g, '').length;
  if (!named && locationClass(d, loc) === 'unknown') flags.push('place_unknown');
  // an aggregator's place tag that the posting's own text contradicts (a worldwide or India tag over a text that keeps the job elsewhere, or the reverse)
  if (AGGREGATOR_SOURCE.test(String(r.source || '')) && ((/\b(?:anywhere|worldwide|global)\b/i.test(loc) && ['us_only', 'eu_only'].includes(locationClass(d, ''))) || (indianPlace(loc) && foreignLocation(String(d.match(/\blocation\s*:\s*([^.\n]{2,60})/i)?.[1] || '')))))
    flags.push('aggregator_place_contradicts_text');
  if (d.trim().length < THIN_TEXT) flags.push('thin_text');
  if (isReposter(r)) flags.push('reposter');
  const years = prof?.years ?? (Number(cand?.total_years_experience) || 0), need = yearsRequired(d);
  if ((need && years && need > years + 2) || RULE_PARTS.JUNIOR_TITLE.test(title) || RULE_PARTS.EXEC_TITLE.test(title)) flags.push('level_out_of_band');
  const e = scoreCandidate(cand, { id: r.job_id, title, company: r.company || '', url: r.url || '', source: r.source || '', location: loc, description: d, remote }, {});
  if (e.skills.length <= 1 && !e.target_fit) flags.push('field_match_weak');
  const lang = languageHardRequired(title, d);
  if (lang && !(prof?.spoken || ['english']).includes(lang.toLowerCase())) flags.push('language_outside_spoken');
  if (gulfPlace(loc) && !prof?.place.some((p) => p.policy === 'abroad_with_visa' || (p.policy === 'onsite_in' && p.countries.some((c) => ['AE', 'SA', 'QA', 'OM', 'KW', 'BH'].includes(c))))) flags.push('gulf_place_without_policy');
  return { flags, rescore: e.score, eligibility: e.eligibility };
}
/** The report for one person: the sampled rows of both tiers with their flags, and counts per flag. */
export function onboardingAudit(rows, cands, cid, sample = 40) {
  registerCandidates(cands);
  const cand = cands.find((c) => c.id === cid);
  if (!cand) throw new Error(`candidate ${cid} is not in the candidates file`);
  const mine = rows.filter((r) => r.candidate_id === cid && TIERS.includes(r.status));
  const picked = TIERS.flatMap((t) => mine.filter((r) => r.status === t).sort((a, b) => Number(b.score) - Number(a.score)).slice(0, Math.ceil(sample / 2)));
  const out = picked.map((r) => ({ job_id: r.job_id, tier: r.status, title: r.title, company: r.company, location: r.location, score: r.score, ...rowRisks(r, cand) }));
  const counts = {};
  for (const r of out) for (const f of r.flags) counts[f] = (counts[f] || 0) + 1;
  return { candidate_id: cid, engine: profileOf(cand) ? 'profile' : 'legacy', sampled: out.length, flagged: out.filter((r) => r.flags.length).length, counts, rows: out };
}
export function auditMarkdown(rep) {
  const lines = [`# Onboarding audit: ${rep.candidate_id} (${rep.engine} scorer)`, '', `${rep.sampled} rows sampled, ${rep.flagged} with at least one risk flag.`, '',
    '| Flag | Rows |', '|---|---:|', ...Object.entries(rep.counts).sort((a, b) => b[1] - a[1]).map(([f, n]) => `| ${f} | ${n} |`), '',
    '| Tier | Score | Title | Employer | Place | Flags |', '|---|---:|---|---|---|---|'];
  const cell = (x) => String(x ?? '').replace(/\|/g, '/').slice(0, 60);
  for (const r of rep.rows) lines.push(`| ${r.tier === 'READY' ? 'Best' : 'Worth a try'} | ${r.score} | ${cell(r.title)} | ${cell(r.company)} | ${cell(r.location)} | ${r.flags.join(', ') || '-'} |`);
  return lines.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  let rows = JSON.parse(fs.readFileSync(opt('--rows'), 'utf8')); if (!Array.isArray(rows)) rows = rows.rows || [];
  const rep = onboardingAudit(rows, JSON.parse(fs.readFileSync(opt('--candidates'), 'utf8')), opt('--candidate'), Number(opt('--sample') || 40));
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(rep, null, 1));
  if (opt('--md')) fs.writeFileSync(opt('--md'), auditMarkdown(rep));
  console.log(JSON.stringify({ candidate_id: rep.candidate_id, engine: rep.engine, sampled: rep.sampled, flagged: rep.flagged, counts: rep.counts }));
}
