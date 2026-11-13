// Undo one network's open-tracker changes (plan U1). The open tracker lets anyone with the link save, apply, hide or move Farhan's and Sana's jobs
// without a key. Each history row such a keyless request writes is tagged with a hash of its network (history_client, migration 0022), together
// with what the change replaced. This script turns those rows back into reverse statements, for the owner to run through the manual workflow
// .github/workflows/undo-changes.yml (mode=preview prints them, mode=apply runs them).
//
//   node scripts/undo_since.mjs --list --since <iso> [--remote | --rows file.json]                 networks that changed something, with counts
//   node scripts/undo_since.mjs --candidate X --since <iso> --network <hash> --out undo.sql [--remote | --rows file.json]
//
// Rules:
//   * per job, the state before the network's FIRST change in the window is restored (before_json), so a run of clicks is undone as a whole;
//   * every statement applies only while the row is still as the network left it: the current status equals the network's last change, and no
//     later history row (anyone's) exists for that job. A change someone made afterwards is never overwritten; it is reported as "skipped";
//   * every undo writes its own history row (actor 'owner-undo');
//   * nothing here touches a row the network did not change.
// The script itself only reads; the SQL file it writes is applied by the workflow. Counts only in its output, no job text.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const parse = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
export const HASH_RE = /^[0-9a-f]{64}$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/;

/** Rows: [{ history_table, history_id, before_json, job_id, candidate_id, new_status, reason, application_id }] (any order).
 *  Returns { sql: [statements], jobs: n, skipped: [] } - pure, for tests. */
export function undoStatements(rows, { candidate, since }) {
  const sql = [];
  const groups = new Map();
  for (const r of rows) {
    if (r.candidate_id !== candidate) continue;
    const key = `${r.history_table}|${r.job_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const by = (a, b) => Number(a.history_id) - Number(b.history_id);
  for (const [, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort(by);
    const first = list[0], last = list[list.length - 1];
    const before = parse(first.before_json);
    const job = first.job_id, cand = q(candidate), jid = q(job);
    if (first.history_table === 'qualification_history') {
      // still as the network left it, and nobody changed it since
      const still = `candidate_id = ${cand} AND job_id = ${jid} AND qualification_status = ${q(last.new_status)}
  AND NOT EXISTS (SELECT 1 FROM qualification_history h WHERE h.candidate_id = ${cand} AND h.job_id = ${jid} AND h.id > ${Number(last.history_id)})`;
      if (!before || !before.qualification_status) continue;   // nothing known to restore to
      const sets = [`qualification_status = ${q(before.qualification_status)}`];
      if ('manual_override_status' in before) sets.push(`manual_override_status = ${q(before.manual_override_status)}`, `manual_override_reason = ${q(before.manual_override_reason ?? null)}`);
      if ('qualification_reason' in before) sets.push(`qualification_reason = ${q(before.qualification_reason)}`);
      sql.push(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor)
  SELECT candidate_id, job_id, qualification_status, ${q(before.qualification_status)}, 'Undone by the owner (changes from one network since ${String(since).replace(/'/g, '')})', 'owner-undo'
  FROM candidate_qualifications WHERE ${still};`);
      sql.push(`UPDATE candidate_qualifications SET ${sets.join(', ')} WHERE ${still.replace(/h\.id > \d+/, `h.id > ${Number(last.history_id)} AND h.actor <> 'owner-undo'`)};`);
      // a "Not for me" also stored a rating; it goes with the undo (only the one written in the window)
      if (list.some((r) => /^You marked this Not for me/.test(r.reason || ''))) sql.push(`DELETE FROM job_feedback WHERE candidate_id = ${cand} AND job_id = ${jid} AND rating = 'DOWN' AND updated_at >= ${q(String(since).replace('T', ' ').replace(/Z$/, '').slice(0, 19))};`);
    } else {
      const later = `NOT EXISTS (SELECT 1 FROM application_history h WHERE h.candidate_id = ${cand} AND h.job_id = ${jid} AND h.id > ${Number(last.history_id)})`;
      const hist = (prev, next) => `INSERT INTO application_history(candidate_id, job_id, application_id, previous_status, new_status, stage, actor, source, recorded_at)
  SELECT ${cand}, ${jid}, ${q(first.application_id)}, ${q(prev)}, ${q(next)}, ${q(next)}, 'owner-undo', 'undo_since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
      if (last.new_status === 'UNSAVED') {
        // the network removed a saved record: put it back, unless one exists again
        if (!before || !before.id) continue;
        sql.push(`${hist('UNSAVED', before.status || 'SAVED')} WHERE ${later} AND NOT EXISTS (SELECT 1 FROM applications WHERE candidate_id = ${cand} AND job_id = ${jid});`);
        sql.push(`INSERT INTO applications(id, candidate_id, job_id, status, notes, created_at, updated_at) SELECT ${q(before.id)}, ${cand}, ${jid}, ${q(before.status || 'SAVED')}, ${q(before.notes ?? null)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NOT EXISTS (SELECT 1 FROM applications WHERE candidate_id = ${cand} AND job_id = ${jid}) AND NOT EXISTS (SELECT 1 FROM application_history h WHERE h.candidate_id = ${cand} AND h.job_id = ${jid} AND h.id > ${Number(last.history_id)} AND h.actor <> 'owner-undo');`);
        continue;
      }
      const still = `candidate_id = ${cand} AND job_id = ${jid} AND status = ${q(last.new_status)}`;
      if (!before) {
        // the record did not exist before the network created it: remove it (and its follow-up date)
        sql.push(`${hist(last.new_status, 'UNSAVED')} WHERE ${later} AND EXISTS (SELECT 1 FROM applications WHERE ${still});`);
        const after = `AND NOT EXISTS (SELECT 1 FROM application_history h WHERE h.candidate_id = ${cand} AND h.job_id = ${jid} AND h.id > ${Number(last.history_id)} AND h.actor <> 'owner-undo')`;
        sql.push(`DELETE FROM application_followups WHERE candidate_id = ${cand} AND job_id = ${jid} AND EXISTS (SELECT 1 FROM applications WHERE ${still}) ${after};`);
        sql.push(`DELETE FROM applications WHERE ${still} ${after};`);
      } else {
        sql.push(`${hist(last.new_status, before.status)} WHERE ${later} AND EXISTS (SELECT 1 FROM applications WHERE ${still});`);
        sql.push(`UPDATE applications SET status = ${q(before.status)}, notes = ${q(before.notes ?? null)}, applied_at = ${q(before.applied_at ?? null)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE ${still} AND NOT EXISTS (SELECT 1 FROM application_history h WHERE h.candidate_id = ${cand} AND h.job_id = ${jid} AND h.id > ${Number(last.history_id)} AND h.actor <> 'owner-undo');`);
      }
    }
  }
  if (sql.length) sql.push('UPDATE cache_state SET generation = generation + 1 WHERE id = 1;');
  return { sql, jobs: groups.size };
}

/** SQL that reads the tagged rows of one network (or, with network null, the per-network counts). */
export function readSql({ candidate, since, network }) {
  const s = q(String(since).replace('T', ' ').replace(/Z$/, '').slice(0, 19));
  if (!network) return `SELECT hc.client_hash, COUNT(*) AS changes, MIN(hc.created_at) AS first_at, MAX(hc.created_at) AS last_at FROM history_client hc WHERE hc.created_at >= ${s} GROUP BY hc.client_hash ORDER BY changes DESC LIMIT 50`;
  const cols = (t, extra) => `SELECT hc.history_table, hc.history_id, hc.before_json, h.candidate_id, h.job_id, h.new_status, ${extra} FROM history_client hc JOIN ${t} h ON h.id = hc.history_id
  WHERE hc.history_table = '${t}' AND hc.client_hash = ${q(network)} AND hc.created_at >= ${s} AND h.candidate_id = ${q(candidate)}`;
  return `${cols('qualification_history', 'h.reason, NULL AS application_id')} UNION ALL ${cols('application_history', 'NULL AS reason, h.application_id')} ORDER BY 2`;
}

let persistTo = null;   // --persist-to <dir>: a local rehearsal database (wrangler dev --persist-to)
function d1(sql, remote) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'career-job-engine', remote ? '--remote' : '--local', ...(persistTo && !remote ? ['--persist-to', persistTo] : []), '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((p) => p.results || []);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const since = opt('--since'), candidate = opt('--candidate'), network = opt('--network'), rowsFile = opt('--rows');
  const remote = args.includes('--remote');
  persistTo = opt('--persist-to') || null;
  if (!since || !ISO_RE.test(since)) { console.error('--since must be a date or time (UTC), e.g. 2026-11-14 or 2026-11-14T08:00:00Z'); process.exit(2); }
  if (args.includes('--list')) {
    const rows = rowsFile ? JSON.parse(fs.readFileSync(rowsFile, 'utf8')) : d1(readSql({ since }), remote);
    console.log(`Networks with keyless tracker changes since ${since} (hash, changes, first, last):`);
    for (const r of rows) console.log(`${r.client_hash}  ${r.changes}  ${r.first_at}  ${r.last_at}`);
    process.exit(0);
  }
  if (!candidate || !/^[a-z0-9_]{2,64}$/.test(candidate)) { console.error('--candidate is required (e.g. sana_ansari)'); process.exit(2); }
  if (!network || !HASH_RE.test(network)) { console.error('--network must be a 64-character hash from --list'); process.exit(2); }
  const rows = rowsFile ? JSON.parse(fs.readFileSync(rowsFile, 'utf8')) : d1(readSql({ candidate, since, network }), remote);
  const { sql, jobs } = undoStatements(rows, { candidate, since });
  fs.writeFileSync(opt('--out') || 'undo.sql', sql.join('\n') + (sql.length ? '\n' : ''));
  console.log(`${rows.length} tagged change(s) on ${jobs} job record(s); ${sql.length} statement(s) written to ${opt('--out') || 'undo.sql'}. Each applies only if nobody changed that job since.`);
}
