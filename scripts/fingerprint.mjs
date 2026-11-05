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
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, mode, ...persist, '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`query failed for ${name}`); process.exit(1); }
  const text = r.stdout.slice(r.stdout.indexOf('['));
  const rows = JSON.parse(text)[0].results || [];
  out[name] = { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}
console.log(JSON.stringify(out, null, 1));
