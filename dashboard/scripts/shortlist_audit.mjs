// The shortlist audit (plan phase 3, A8; the second half of plan R8): after the shortlist step, checks the hard rules on what is STORED, and fails
// its step when one is broken. It reports counts, rule names, person ids, job ids and employer keys (no job text, no personal details).
//
//   node scripts/shortlist_audit.mjs --print-sql --since '2026-11-13 15:00:00'   -> the one read query (the workflow runs it with wrangler --json)
//   node scripts/shortlist_audit.mjs --rows ../work/audit_rows.json --candidates ../work/candidates.json [--report ../work/shortlist.report.json] [--relaxed]
//
// Broken hard rules:
//   - more than 2 rows of one employer in a tier (5 for an employer named in the person's skills), unless today's selector reported that tier's pool
//     as no larger than the tier or the employer rule as relaxed (then no other employer could take the place: the rule is soft by design); not
//     checked at all on a day the selector did not run (no report: the lists are yesterday's selection, made with yesterday's pool);
//   - more than 3 rows from reposting sites in a tier;
//   - an automatic row not verified open in the last 4 days (one hour of grace for the minutes between the selection and the audit; skipped with
//     --relaxed, the day the still-open check verified too few rows), or closed;
//     A Stretch row that is a Gulf posting from a job board refusing the check, found in the last 2 days, passes (the selector's 'listed' rule;
//     never on Ready);
//   - the same employer and title twice on a person's two tiers (twinKey(), the selector's own key; 16 Nov: one remote job posted once per
//     country filled Ready ten times); checked when the selector ran today, like the employer caps;
//   - an employer shown by its hiring-system tenant id (until B1 names it; shortlistTenant(), the selector's own test: the stored name read through the names table);
//   - a row with a manual override, or an application older than the change, that the daily run changed (a 'discovery' history row since the run
//     started; an application made after that change is the person's own later choice). An automatic row
//     a person later saved or applied to keeps its mark; that alone is a person's choice, not a broken rule, and is counted, not failed.
import fs from 'node:fs';
import { MARK, REPOSTER_CAP, EMPLOYER_TIER_CAP, EMPLOYER_SKILL_CAP, VERIFIED_DAYS, employerKey, isReposter, skillEmployer, skillsOf, shortlistTenant, twinGroups, when } from './shortlist_select.mjs';
import { companyKey, listedOnlyGulf, LISTED_DAYS } from '../worker/discovery.ts';

const GRACE_MS = 3600000;
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const APPLIED = (t) => `EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${t}.candidate_id AND a.job_id = ${t}.job_id)`;

/** The audit's one read: every automatic row, plus every row with a decision or an application that the daily run wrote history for since `since`.
 *  "candidate_id IN (candidates)" changes nothing (every row has a candidate) but lets the (candidate, status) index serve the first part: it
 *  read every screening row of everyone before (about 38,000 rows read at production size). */
export function auditSql(since) {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(String(since || ''))) throw new Error('--since must be "YYYY-MM-DD HH:MM:SS" (UTC)');
  return `SELECT 'row' AS kind, q.candidate_id, q.job_id, q.qualification_status AS status, j.company, j.source_adapter AS source,
  CASE WHEN j.original_posting_url LIKE 'https://%' THEN j.original_posting_url ELSE j.source_url END AS url, j.last_verified_at, j.is_active AS active,
  CASE WHEN q.manual_override_status IS NOT NULL OR ${APPLIED('q')} THEN 1 ELSE 0 END AS decided,
  j.location_restrictions AS location, j.discovered_at, j.title, j.workplace_type AS workplace
FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id
WHERE q.candidate_id IN (SELECT id FROM candidates) AND q.qualification_status IN ('READY','STRETCH_READY') AND COALESCE(q.qualification_reason, '') LIKE ${q(MARK + '%')}
UNION ALL
SELECT DISTINCT 'touched', h.candidate_id, h.job_id, h.new_status, NULL, NULL, NULL, h.changed_at, NULL, 1, NULL, NULL, NULL, NULL
FROM qualification_history h JOIN candidate_qualifications q ON q.candidate_id = h.candidate_id AND q.job_id = h.job_id
WHERE h.actor = 'discovery' AND h.changed_at >= ${q(String(since).replace('T', ' '))} AND (q.manual_override_status IS NOT NULL
  OR EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id AND a.created_at <= h.changed_at))`;
}

/** Pure: the audit rows (and today's selector report) -> broken hard rules. */
export function audit(rows, { candidates = [], report = null, relaxed = false, now = Date.now() } = {}) {
  const problems = [], info = { rows: 0, decided_marked: 0, employer_caps_checked: !!report };
  const byTier = new Map();
  for (const r of rows || []) {
    if (r.kind === 'touched') { problems.push(`a decided or applied row was changed by the daily run (${r.candidate_id} ${r.job_id})`); continue; }
    if (r.kind !== 'row') continue;
    info.rows++;
    if (Number(r.decided)) { info.decided_marked++; continue; }   // a person's choice since: not the screen's row any more
    const k = `${r.candidate_id}|${r.status}`;
    byTier.set(k, [...(byTier.get(k) || []), r]);
    if (!Number(r.active)) problems.push(`a closed posting is on the shortlist (${r.candidate_id} ${r.job_id})`);
    else if (!relaxed && !(now - when(r.last_verified_at) <= VERIFIED_DAYS * 86400000 + GRACE_MS)
      && !(r.status === 'STRETCH_READY' && listedOnlyGulf(r.url, r.location) && now - when(r.discovered_at) <= LISTED_DAYS * 86400000 + GRACE_MS)) problems.push(`a row not verified open in ${VERIFIED_DAYS} days (${r.candidate_id} ${r.job_id})`);
    if (shortlistTenant(r)) problems.push(`a tenant-id employer is on the shortlist (${r.candidate_id} ${r.job_id})`);
  }
  if (report) {   // twins: across both tiers of one person (the selector's hard rule), only on a day the selector ran
    const byCand = new Map();
    for (const list of byTier.values()) for (const r of list) byCand.set(r.candidate_id, [...(byCand.get(r.candidate_id) || []), r]);
    for (const [cid, list] of byCand) for (const g of twinGroups(list).values())
      problems.push(`${g.length} rows of one employer and title (${employerKey(g[0]).slice(0, 40)}) on ${cid}'s shortlist (${g.map((r) => r.job_id).slice(0, 5).join(' ')})`);
  }
  for (const [k, list] of byTier) {
    const [cid, tier] = k.split('|');
    const skillKeys = new Set(skillsOf(candidates, cid).map(companyKey).filter(Boolean));
    const rep = report?.[cid]?.[tier];
    const soft = !report || !!rep?.pool_smaller_than_tier || (rep?.relaxed || []).includes('employer_per_tier');   // no report: the selector did not run today
    const reposters = list.filter(isReposter).length;
    if (reposters > REPOSTER_CAP) problems.push(`${reposters} reposter rows in ${cid} ${tier} (cap ${REPOSTER_CAP})`);
    const per = new Map();
    for (const r of list) if (!isReposter(r)) per.set(employerKey(r), [...(per.get(employerKey(r)) || []), r]);
    for (const [emp, g] of per) {
      const cap = skillEmployer(g[0], skillKeys) ? EMPLOYER_SKILL_CAP : EMPLOYER_TIER_CAP;
      if (g.length > cap && !soft) problems.push(`${g.length} rows of one employer (${emp.slice(0, 40)}) in ${cid} ${tier} (cap ${cap})`);
    }
  }
  return { ok: problems.length === 0, problems, info };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const read = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  if (args.includes('--print-sql')) { process.stdout.write(auditSql(opt('--since')) + '\n'); process.exit(0); }
  const raw = read(opt('--rows'));
  const rows = Array.isArray(raw) ? (Array.isArray(raw[0]?.results) ? raw.flatMap((x) => x.results || []) : raw) : null;
  if (!rows) { console.log('::error title=Shortlist audit::the audit query returned nothing readable'); process.exit(1); }
  const res = audit(rows, { candidates: read(opt('--candidates')) || [], report: read(opt('--report')), relaxed: args.includes('--relaxed') });
  const line = res.ok ? `Shortlist audit: ok (${res.info.rows} automatic rows; ${res.info.decided_marked} since saved, applied or decided by a person${res.info.employer_caps_checked ? '' : '; employer caps not checked: the selector did not run today'})`
    : `Shortlist audit: FAILED - ${res.problems.length} broken hard rule(s)`;
  console.log(line);
  for (const p of res.problems.slice(0, 30)) console.log(`::error title=Shortlist audit::${p}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${line}**\n${res.problems.slice(0, 30).map((p) => `- ${p}`).join('\n')}\n`);
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(res, null, 1));
  process.exit(res.ok ? 0 : 1);
}
