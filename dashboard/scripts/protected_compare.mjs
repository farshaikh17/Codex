// Compares the protected-record fingerprints taken before and after a release (scripts/fingerprint.mjs) and decides whether the release
// changed something it must not. Used by .github/workflows/dashboard-release.yml (mode release, step "Fingerprint protected records after").
//
// Why not a plain hash comparison: with the open tracker on (wrangler.toml OPEN_TRACKER = "on"), Farhan or Sana can save, apply or move a
// job without a key while the release runs (10 to 15 minutes). That changes applications / application_history / the override rows, and
// a whole-table hash then failed a release whose deploy was fine. Every such keyless write is tagged in history_client (migration 0022)
// with the job it changed, so here a changed row is accepted only when:
//   * the open tracker is on, and
//   * the row's table is applications, application_history or manual_overrides (never candidates: the tracker cannot change them), and
//   * applications / manual_overrides: a keyless tracker write for the same candidate and job is tagged in the release window;
//     application_history: the row was ADDED and its own id is tagged (the tracker never edits or deletes a history row).
// Any other change (an operator edit, a migration, a script, an untagged write) still fails the release. Every changed row is printed
// with its ids and whether it was tagged; no notes or other field values are printed.
//
//   node scripts/protected_compare.mjs --before before.json --after after.json --before-rows before_rows.json --after-rows after_rows.json \
//        --open-tracker on|off [--since 'YYYY-MM-DD HH:MM:SS' (--remote | --local [--persist-to DIR]) | --tagged tagged.json] [--summary FILE]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PROTECTED = ['applications', 'application_history', 'manual_overrides', 'candidates'];
export const INFORMATIONAL = ['qualifications', 'scores'];
const TRACKER_TABLES = new Set(['applications', 'application_history', 'manual_overrides']);
const KEY = {
  applications: (r) => String(r.id),
  application_history: (r) => String(r.id),
  manual_overrides: (r) => `${r.candidate_id}|${r.job_id}`,
  candidates: (r) => String(r.id),
};
export const SINCE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// What scripts/fingerprint.mjs reads (moved here unchanged, so the tests hash exactly what the release hashes).
export const FINGERPRINT_QUERIES = {
  applications: 'SELECT * FROM applications ORDER BY id',
  application_history: 'SELECT * FROM application_history ORDER BY id',
  manual_overrides: "SELECT candidate_id, job_id, qualification_status, manual_override_status, manual_override_reason, qualified_at FROM candidate_qualifications WHERE manual_override_status IS NOT NULL ORDER BY candidate_id, job_id",
  qualifications: 'SELECT candidate_id, job_id, qualification_status, strategy_lane, eligibility_status, manual_override_status, manual_override_reason FROM candidate_qualifications ORDER BY candidate_id, job_id',
  scores: 'SELECT candidate_id, job_id, overall_score FROM candidate_job_scores ORDER BY candidate_id, job_id',
  candidates: 'SELECT * FROM candidates ORDER BY id',
};
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** { summary: { table: { rows, sha256 } } (the fingerprint.mjs output, same keys and order), perRow: { protected table: rowHashes } }. */
export function fingerprintTables(rowsByName) {
  const summary = {}, perRow = {};
  for (const name of Object.keys(FINGERPRINT_QUERIES)) {
    let rows = rowsByName[name] || [];
    if (name === 'candidates') {
      // The skill / role lists and updated_at are changed on purpose by owner-approved profile migrations (e.g. 0017) and by edits in
      // Settings; they are fingerprinted separately and informationally. Everything else on the candidate row (thresholds, pay floor,
      // preferences, identity) stays in the compared hash.
      const LISTS = ['primary_skills', 'secondary_skills', 'target_roles', 'updated_at'];
      summary.candidate_profile_lists = { rows: rows.length, sha256: sha(rows.map((r) => Object.fromEntries(LISTS.map((k) => [k, r[k]])))) };
      rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !LISTS.includes(k))));
    }
    summary[name] = { rows: rows.length, sha256: sha(rows) };
    if (PROTECTED.includes(name)) perRow[name] = rowHashes(name, rows);
  }
  return { summary, perRow };
}

/** Per-row hashes of one protected table: { key: { candidate_id, job_id, sha256 } }. Rows are the same objects fingerprint.mjs hashes. */
export function rowHashes(table, rows) {
  const out = {};
  for (const r of rows) {
    const candidate_id = table === 'candidates' ? r.id : r.candidate_id;
    out[KEY[table](r)] = { candidate_id: candidate_id ?? null, job_id: r.job_id ?? null, sha256: sha(r) };
  }
  return out;
}

/** The keyless tracker writes tagged since a time (history_client.created_at is SQLite datetime('now'), UTC). */
export function taggedSql(since) {
  if (!SINCE_RE.test(since)) throw new Error(`--since must look like 'YYYY-MM-DD HH:MM:SS' (UTC), got ${JSON.stringify(since)}`);
  return `SELECT hc.history_table, hc.history_id, h.candidate_id, h.job_id FROM history_client hc JOIN application_history h ON h.id = hc.history_id
    WHERE hc.history_table = 'application_history' AND hc.created_at >= '${since}'
    UNION ALL SELECT hc.history_table, hc.history_id, q.candidate_id, q.job_id FROM history_client hc JOIN qualification_history q ON q.id = hc.history_id
    WHERE hc.history_table = 'qualification_history' AND hc.created_at >= '${since}'`;
}

/** Pure decision, for tests. Returns { ok, lines (markdown table), changes: [{ table, key, kind, candidate_id, job_id, tagged }] }. */
export function compareProtected({ before, after, beforeRows = null, afterRows = null, tagged = [], openTracker = false }) {
  const pairs = new Set(tagged.map((t) => `${t.candidate_id}|${t.job_id}`));
  const historyIds = new Set(tagged.filter((t) => t.history_table === 'application_history').map((t) => String(t.history_id)));
  const lines = ['| table | rows before | rows after | identical |', '|---|---|---|---|'];
  const changes = [];
  let bad = 0;
  for (const t of PROTECTED) {
    const same = before[t]?.sha256 === after[t]?.sha256;
    let verdict = same ? 'yes' : '**NO**';
    if (!same) {
      const b = beforeRows?.[t], a = afterRows?.[t];
      if (!b || !a) { bad++; verdict = '**NO** (no row detail to check)'; changes.push({ table: t, key: '(row detail missing)', kind: 'changed', candidate_id: null, job_id: null, tagged: false }); }
      else {
        let untagged = 0, total = 0;
        for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
          if (b[key]?.sha256 === a[key]?.sha256) continue;
          const kind = !b[key] ? 'added' : !a[key] ? 'removed' : 'changed';
          const row = a[key] || b[key];
          const ok = openTracker && TRACKER_TABLES.has(t) && (t === 'application_history'
            ? kind === 'added' && historyIds.has(key)
            : pairs.has(`${row.candidate_id}|${row.job_id}`));
          total++; if (!ok) untagged++;
          changes.push({ table: t, key, kind, candidate_id: row.candidate_id, job_id: row.job_id, tagged: ok });
        }
        if (total === 0) { bad++; changes.push({ table: t, key: '(order or shape)', kind: 'changed', candidate_id: null, job_id: null, tagged: false }); verdict = '**NO** (hash differs, rows identical)'; }
        else if (untagged) { bad++; verdict = `**NO** (${untagged} of ${total} changed rows not from the open tracker)`; }
        else verdict = `changed by the open tracker only (${total} rows, all tagged)`;
      }
    }
    lines.push(`| ${t} | ${before[t]?.rows ?? '?'} | ${after[t]?.rows ?? '?'} | ${verdict} |`);
  }
  for (const t of INFORMATIONAL) {
    if (!before[t] || !after[t]) continue;
    lines.push(`| ${t} (informational: the collector may legitimately write) | ${before[t].rows} | ${after[t].rows} | ${before[t].sha256 === after[t].sha256 ? 'yes' : 'changed'} |`);
  }
  return { ok: bad === 0, lines, changes };
}

export function changeLines(changes, max = 60) {
  if (!changes.length) return [];
  const out = ['| table | row | change | candidate | job | keyless tracker write in the window |', '|---|---|---|---|---|---|'];
  for (const c of changes.slice(0, max)) out.push(`| ${c.table} | ${String(c.key).replace(/\|/g, '\\|')} | ${c.kind} | ${c.candidate_id ?? ''} | ${c.job_id ?? ''} | ${c.tagged ? 'yes' : '**no**'} |`);
  if (changes.length > max) out.push(`| ... | ${changes.length - max} more | | | | |`);
  return out;
}

function readTagged(since, mode, persist) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'career-job-engine', mode, ...persist, '--json', '--command', taggedSql(since)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    // No tags readable (table missing, API error): every change counts as untagged, so the comparison stays strict.
    console.error(`could not read history_client: ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`);
    return [];
  }
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0].results || [];
}

function main(argv) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const json = (p) => (p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
  const before = json(arg('--before')), after = json(arg('--after'));
  if (!before || !after) { console.error('usage: --before before.json --after after.json (see the header of this file)'); return 2; }
  const openTracker = String(arg('--open-tracker') || '').toLowerCase() === 'on';
  let tagged = [];
  if (arg('--tagged')) tagged = json(arg('--tagged')) || [];
  else if (openTracker && arg('--since')) {
    const mode = argv.includes('--remote') ? '--remote' : '--local';
    const persist = arg('--persist-to') ? ['--persist-to', arg('--persist-to')] : [];
    tagged = readTagged(arg('--since'), mode, persist);
  }
  const res = compareProtected({ before, after, beforeRows: json(arg('--before-rows')), afterRows: json(arg('--after-rows')), tagged, openTracker });
  const detail = changeLines(res.changes);
  const text = [`open tracker: ${openTracker ? 'on' : 'off'}; keyless tracker writes tagged in the release window: ${tagged.length}`, '', ...res.lines,
    ...(detail.length ? ['', 'Changed rows (ids only):', '', ...detail] : [])].join('\n');
  console.log(text);
  if (arg('--summary')) fs.appendFileSync(arg('--summary'), '\n### Protected records, field-level\n' + text + '\n');
  if (!res.ok) { console.error('Protected records changed during the release (changes not made by the open tracker; see the table above)'); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
