// The shortlist audit (plan A8): hard rules checked on stored data, with the query run on a database with the real migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { selectInto } from './shortlist_helpers.mjs';
import { audit, auditSql } from '../scripts/shortlist_audit.mjs';
import { MARK } from '../scripts/shortlist_select.mjs';
import { RULES_MARKER } from '../worker/discovery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = 'sana_ansari';
const sqlNow = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function world() {
  const { sqlite: db } = createDb();
  db.prepare(`INSERT INTO candidates(id,full_name,qualification_threshold,primary_skills) VALUES (?,?,60,?)`).run(C, 'S', JSON.stringify(['Electrical Maintenance', 'Reliability']));
  const V = JSON.stringify({ preliminary: true, [RULES_MARKER]: true }), now = new Date().toISOString();
  let n = 0;
  const add = (o = {}) => {
    const id = o.id || 'j' + (++n);
    db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,discovered_at,last_verified_at,location_restrictions,workplace_type) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, o.title || 'Maintenance Engineer ' + id, o.company || 'Co ' + id, o.source || 'lever', o.url || 'https://x.example/' + id, o.active ?? 1, now, o.verified ?? now, 'Pune, India', 'ONSITE');
    db.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?,?)`)
      .run(C, id, o.status || 'NEEDS_REVIEW', 'ELIGIBLE', o.reason ?? 'Cloud discovery match.', o.override || null);
    db.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,score_breakdown) VALUES (?,?,?,40,?)`).run(C, id, o.score ?? 80, V);
    if (o.app) db.prepare(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,'APPLIED')`).run('ap' + id, C, id);
    return id;
  };
  const rows = (since = sqlNow(Date.now() - 3600000)) => db.prepare(auditSql(since)).all().map((r) => ({ ...r }));
  return { db, add, rows };
}
const auto = (o) => ({ status: 'READY', reason: MARK + 'Cloud discovery match.', ...o });

test('a shortlist chosen by the selector passes the audit', () => {
  const w = world();
  for (let i = 0; i < 40; i++) w.add({ company: i < 10 ? 'BigCo' : 'Co ' + i, score: 90 - (i % 7) });
  w.add({ company: 'Fa Espx Saasfaprod1', source: 'oracle', score: 99 });
  const sel = selectInto(w.db);
  const res = audit(w.rows(), { report: sel.report });
  assert.deepEqual(res.problems, []);
  assert.equal(res.info.rows, 40, 'every usable row is on a tier; the tenant-id employer is not');
});

test('each broken hard rule is found on stored data', () => {
  const w = world();
  for (let i = 0; i < 3; i++) w.add(auto({ company: 'BigCo' }));                                         // 3 of one employer in Ready
  for (let i = 0; i < 4; i++) w.add(auto({ company: 'Jobgether' }));                                     // 4 reposter rows
  w.add(auto({ id: 'stale', verified: new Date(Date.now() - 6 * 86400000).toISOString() }));            // not verified in 4 days
  w.add(auto({ id: 'closed', active: 0 }));
  w.add(auto({ id: 'tenant', company: 'Hdga', source: 'oracle', url: 'https://hdga.fa.em3.oraclecloud.com/x' }));
  const res = audit(w.rows());
  const text = res.problems.join('\n');
  assert.match(text, /3 rows of one employer \(big\) in sana_ansari READY \(cap 2\)/);
  assert.match(text, /4 reposter rows in sana_ansari READY/);
  assert.match(text, /not verified open in 4 days \(sana_ansari stale\)/);
  assert.match(text, /closed posting is on the shortlist \(sana_ansari closed\)/);
  assert.match(text, /tenant-id employer .*tenant/);
  assert.equal(res.ok, false);
  // the day the still-open check verified too few rows: the 4-day rule is not checked
  assert.doesNotMatch(audit(w.rows(), { relaxed: true }).problems.join('\n'), /not verified/);
  // the employer cap is soft: when today's selector says no other employer could take the place, it is not a failure
  const rep = { [C]: { READY: { pool_smaller_than_tier: true, relaxed: [] } } };
  assert.doesNotMatch(audit(w.rows(), { report: rep }).problems.join('\n'), /of one employer/);
  // the skills exception: an employer named in the person's skills may have 5
  const w2 = world();
  for (let i = 0; i < 4; i++) w2.add(auto({ company: 'Reliability' }));
  assert.ok(audit(w2.rows(), { candidates: [{ id: C, primary_skills: JSON.stringify(['Reliability']) }] }).ok);
});

test('a decided or applied row the daily run changed fails the audit; a marked row a person later saved does not', () => {
  const w = world();
  const saved = w.add(auto({ app: true }));   // shortlisted, then the person applied: their choice, counted not failed
  const res = audit(w.rows());
  assert.equal(res.ok, true); assert.equal(res.info.decided_marked, 1);
  // a history row by the daily run on an applied row (as if a guard had failed)
  w.db.prepare(`INSERT INTO qualification_history(candidate_id, job_id, previous_status, new_status, reason, actor) VALUES (?,?,'NEEDS_REVIEW','READY','x','discovery')`).run(C, saved);
  assert.match(audit(w.rows()).problems.join('\n'), /decided or applied row was changed by the daily run/);
  assert.equal(audit(w.rows(sqlNow(Date.now() + 3600000))).ok, true, 'only history written since the run started counts');
});

test('CLI: prints the query, reads wrangler --json output, exits 1 on a broken rule', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
  const cli = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/shortlist_audit.mjs', ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  assert.match(cli('--print-sql', '--since', '2026-11-13 15:00:00').out, /^SELECT 'row' AS kind/);
  assert.notEqual(cli('--print-sql', '--since', "x'; DROP TABLE jobs;--").code, 0, 'a malformed time is refused');
  const w = world();
  for (let i = 0; i < 3; i++) w.add(auto({ company: 'BigCo' }));
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{ results: w.rows(), success: true }]));
  const bad = cli('--rows', path.join(dir, 'rows.json'));
  assert.equal(bad.code, 1); assert.match(bad.out, /FAILED/);
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{ results: [], success: true }]));
  assert.equal(cli('--rows', path.join(dir, 'rows.json')).code, 0);
  assert.equal(cli('--rows', path.join(dir, 'missing.json')).code, 1, 'no readable result is a failure, not a pass');
});

test('discovery.yml: pool before the still-open check, selection after it, then the audit; a failed audit turns the run red through the health job', () => {
  const wf = fs.readFileSync(path.join(root, '..', '.github', 'workflows', 'discovery.yml'), 'utf8');
  const at = (s) => { const i = wf.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('--shortlist-pool work/shortlist_pool.json') < at('liveness.py --export work/liveness_targets.json --pool work/shortlist_pool.json'));
  assert.ok(at('liveness.py --sql') < at('scripts/shortlist_select.mjs $SEL') && at('scripts/shortlist_select.mjs $SEL') < at('scripts/shortlist_audit.mjs $A'));
  assert.match(wf, /audit: \$\{\{ steps\.audit\.outcome \}\}/);
  assert.match(wf, /AUDIT: \$\{\{ needs\.discover\.outputs\.audit \}\}/);
  assert.match(wf, /if \[ "\$HEALTHY" = "true" \] && \[ "\$AUDIT" = "success" \]; then echo "Run health: ok"; exit 0; fi/);
});
