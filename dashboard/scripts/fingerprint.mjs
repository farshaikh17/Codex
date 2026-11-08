// Field-level fingerprint of the human-owned records, read-only. Prints row counts and a SHA-256 over every field of:
// applications, application_history, manual qualification overrides, and the qualification/score rows.
// Run before and after a release and compare: any edit, deletion or reordering of a field changes the hash.
//   node scripts/fingerprint.mjs --remote            (needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)
//   node scripts/fingerprint.mjs --local [--persist-to DIR]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const mode = args.includes('--remote') ? '--remote' : '--local';
const persist = args.includes('--persist-to') ? ['--persist-to', args[args.indexOf('--persist-to') + 1]] : [];
const DB = 'career-job-engine';
const QUERIES = {
  applications: 'SELECT * FROM applications ORDER BY id',
  application_history: 'SELECT * FROM application_history ORDER BY id',
  manual_overrides: "SELECT candidate_id, job_id, qualification_status, manual_override_status, manual_override_reason, qualified_at FROM candidate_qualifications WHERE manual_override_status IS NOT NULL ORDER BY candidate_id, job_id",
  qualifications: 'SELECT candidate_id, job_id, qualification_status, strategy_lane, eligibility_status, manual_override_status, manual_override_reason FROM candidate_qualifications ORDER BY candidate_id, job_id',
  scores: 'SELECT candidate_id, job_id, overall_score FROM candidate_job_scores ORDER BY candidate_id, job_id',
  candidates: 'SELECT * FROM candidates ORDER BY id',
};
const out = {};
for (const [name, sql] of Object.entries(QUERIES)) {
  // One transient API error (a 5xx from Cloudflare, a reset) is retried once after a pause; the real error is printed either way.
  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    r = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, mode, ...persist, '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 0) break;
    console.error(`query failed for ${name} (attempt ${attempt}): ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`);
    if (attempt === 1) spawnSync('sleep', ['8']);
  }
  if (r.status !== 0) process.exit(1);
  const text = r.stdout.slice(r.stdout.indexOf('['));
  let rows = JSON.parse(text)[0].results || [];
  if (name === 'candidates') {
    // The skill / role lists and updated_at are changed on purpose by owner-approved profile migrations (e.g. 0017) and by edits in
    // Settings; they are fingerprinted separately and informationally. Everything else on the candidate row (thresholds, pay floor,
    // preferences, identity) stays in the compared hash.
    const LISTS = ['primary_skills', 'secondary_skills', 'target_roles', 'updated_at'];
    out.candidate_profile_lists = { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows.map((r) => Object.fromEntries(LISTS.map((k) => [k, r[k]]))))).digest('hex') };
    rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !LISTS.includes(k))));
  }
  out[name] = { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}
console.log(JSON.stringify(out, null, 1));
