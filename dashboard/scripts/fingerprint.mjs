// Field-level fingerprint of the human-owned records, read-only. Prints row counts and a SHA-256 over every field of:
// applications, application_history, manual qualification overrides, and the qualification/score rows.
// Run before and after a release and compare: any edit, deletion or reordering of a field changes the hash.
//   node scripts/fingerprint.mjs --remote            (needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)
//   node scripts/fingerprint.mjs --local [--persist-to DIR]
//   add --rows FILE to also write a hash per row of the protected tables (ids only), so scripts/protected_compare.mjs can say which
//   rows changed and whether the open tracker made the change. The queries and the hashing are in protected_compare.mjs.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FINGERPRINT_QUERIES, fingerprintTables } from './protected_compare.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--remote') ? '--remote' : '--local';
const persist = args.includes('--persist-to') ? ['--persist-to', args[args.indexOf('--persist-to') + 1]] : [];
const rowsOut = args.includes('--rows') ? args[args.indexOf('--rows') + 1] : null;
const DB = 'career-job-engine';
const rowsByName = {};
for (const [name, sql] of Object.entries(FINGERPRINT_QUERIES)) {
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
  rowsByName[name] = JSON.parse(text)[0].results || [];
}
const { summary, perRow } = fingerprintTables(rowsByName);
if (rowsOut) fs.writeFileSync(rowsOut, JSON.stringify(perRow));
console.log(JSON.stringify(summary, null, 1));
