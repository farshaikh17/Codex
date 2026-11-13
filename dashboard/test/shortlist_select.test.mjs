// The shortlist selector (plan phase 3: scripts/shortlist_select.mjs). Pure functions on invented pool rows, plus the generated SQL run on a
// database with the real migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { selectInto, exportPool } from './shortlist_helpers.mjs';
import { selectShortlist, selectionSql, MARK } from '../scripts/shortlist_select.mjs';
import { RULES_MARKER } from '../worker/discovery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-11-13T12:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();
const C = 'farhan_shaikh';
let n = 0;
/** An invented pool row: eligible, two skills, threshold 60, verified today, found today. */
const row = (o = {}) => ({ kind: 'pool', candidate_id: C, job_id: o.job_id || `j${String(++n).padStart(3, '0')}`, _n: o.job_id ? ++n : n, title: 'Implementation Manager ' + n, company: 'Co ' + n,
  location: 'Remote - India', workplace: 'REMOTE', source: 'greenhouse', discovered_at: iso(1), last_verified_at: iso(0), active: 1, marked: 1, target_exact: 0,
  score: 70, skill_score: 40, eligibility: 'ELIGIBLE', status: 'NEEDS_REVIEW', reason: 'Cloud discovery match.', threshold: 60, description: 'x', ...o });
const auto = (tier, o = {}) => row({ kind: 'auto', status: tier, reason: MARK + 'Cloud discovery match.', ...o });
const tiers = (res) => Object.fromEntries(res.changes.map((c) => [c.job_id, c.to]));
const sel = (pool, o = {}) => selectShortlist(pool, { now: NOW, ...o });

test('tier rule: Ready needs the threshold and confirmed eligibility; Stretch takes unconfirmed at the threshold or confirmed up to 10 below', () => {
  const pool = [row({ job_id: 'r', score: 60 }), row({ job_id: 'su', score: 75, eligibility: 'UNKNOWN' }), row({ job_id: 'sb', score: 50 }),
    row({ job_id: 'low', score: 49 }), row({ job_id: 'ul', score: 59, eligibility: 'UNKNOWN' }), row({ job_id: 'one', score: 90, skill_score: 20 }),
    row({ job_id: 'exact', score: 90, skill_score: 20, target_exact: 1 }), row({ job_id: 'old', score: 90, marked: 0 }), row({ job_id: 'shut', score: 90, active: 0 })];
  assert.deepEqual(tiers(sel(pool)), { r: 'READY', su: 'STRETCH_READY', sb: 'STRETCH_READY', exact: 'READY' });
});

test('verification: only rows verified in 4 days, or found open by today\'s check; a row found closed is out; relaxed keeps incumbents only', () => {
  const pool = [row({ job_id: 'fresh' }), row({ job_id: 'stale', last_verified_at: iso(5) }), row({ job_id: 'checked', last_verified_at: iso(9) }),
    row({ job_id: 'dead' }), auto('READY', { job_id: 'inc', last_verified_at: iso(9) })];
  assert.deepEqual(tiers(sel(pool, { alive: ['checked'], dead: ['dead'] })), { fresh: 'READY', checked: 'READY', inc: 'NEEDS_REVIEW' });
  assert.deepEqual(tiers(sel(pool, { relaxed: true })), { fresh: 'READY', dead: 'READY' }, 'relaxed: the incumbent stays (no change), a stale new row still waits');
  assert.equal(sel(pool, { relaxed: true }).changes.some((c) => c.job_id === 'stale'), false);
});

test('at most 25 per tier, best first; Ready-quality overflow fills Stretch first (S10); an incumbent outranked leaves with the right reason', () => {
  const pool = [];
  for (let i = 0; i < 30; i++) pool.push(row({ job_id: 'r' + String(i).padStart(2, '0'), score: 90 - i }));
  for (let i = 0; i < 30; i++) pool.push(row({ job_id: 's' + String(i).padStart(2, '0'), score: 55 }));
  pool.push(auto('STRETCH_READY', { job_id: 'inc', score: 51 }), auto('READY', { job_id: 'fell', score: 20 }));
  const res = sel(pool);
  const t = tiers(res);
  assert.equal(Object.values(t).filter((x) => x === 'READY').length, 25);
  assert.deepEqual(['r25', 'r26', 'r27', 'r28', 'r29'].map((k) => t[k]), Array(5).fill('STRETCH_READY'));
  assert.equal(Object.keys(t).filter((k) => k.startsWith('s') && t[k] === 'STRETCH_READY').length, 20);
  const why = Object.fromEntries(res.changes.map((c) => [c.job_id, c.why]));
  assert.match(why.inc, /^Outranked/); assert.match(why.fell, /^No longer meets/);
  assert.equal(res.report[C].READY.count, 25); assert.equal(res.report[C].STRETCH_READY.count, 25);
});

test('one posting per employer and title, also against rows a person holds', () => {
  const pool = [row({ job_id: 'a', company: 'Acme Inc', title: 'Implementation Lead', score: 80 }), row({ job_id: 'b', company: 'acme', title: 'implementation lead', score: 79 }),
    row({ job_id: 'c', company: 'Beta', title: 'Implementation Lead', score: 70 }), { kind: 'held', candidate_id: C, job_id: 'h', company: 'Beta', title: 'Implementation Lead', status: 'READY' }];
  assert.deepEqual(tiers(sel(pool)), { a: 'READY' });
});

test('incumbents keep their places only through the +2', () => {
  const mk = (newScore) => {
    const pool = [];
    for (let i = 0; i < 24; i++) pool.push(row({ score: 90 }));
    pool.push(auto('READY', { job_id: 'inc', score: 70 }), row({ job_id: 'chal', score: newScore }));
    return tiers(sel(pool, { tierSize: 25 }));
  };
  assert.equal(mk(71).chal, 'STRETCH_READY', 'a new row 1 point better does not displace the incumbent (70 + 2)');
  assert.equal(mk(71).inc, undefined, 'the incumbent stays where it is');
  assert.equal(mk(73).chal, 'READY', 'a new row 3 points better does');
  assert.equal(mk(73).inc, 'STRETCH_READY');
});

test('swaps: the lowest-ranked row breaking a soft rule is replaced by the best row that fixes it, within the score floor; otherwise the rule is relaxed', () => {
  // an invented soft rule for the engine alone: at most 2 rows whose title says "Blue" per tier
  const blue = (r) => /Blue/.test(r.title);
  const rule = { name: 'blue', tiers: ['READY', 'STRETCH_READY'], count: (l) => ['READY', 'STRETCH_READY'].reduce((a, t) => a + Math.max(0, l[t].filter(blue).length - 2), 0),
    breakers: (l, t) => (l[t].filter(blue).length > 2 ? l[t].filter(blue) : []) };
  const pool = [row({ job_id: 'b1', title: 'Blue 1', score: 90 }), row({ job_id: 'b2', title: 'Blue 2', score: 89 }), row({ job_id: 'b3', title: 'Blue 3', score: 88 }),
    row({ job_id: 'b4', title: 'Blue 4', score: 87 }), row({ job_id: 'g1', title: 'Green 1', score: 80 }), row({ job_id: 'g2', title: 'Green 2', score: 70 }),
    row({ job_id: 'g3', title: 'Green 3', score: 64 }), row({ job_id: 'x', title: 'Other', score: 60, eligibility: 'UNKNOWN' })];
  const res = sel(pool, { tierSize: 3, rules: [rule] });
  const t = tiers(res);
  assert.deepEqual(['b1', 'b2', 'g1'].map((k) => t[k]), ['READY', 'READY', 'READY'], 'b3 swapped for g1 (80, within 10 of 88)');
  assert.equal(res.report[C].READY.swaps, 1);
  // Stretch takes b3, b4 (Ready overflow) and g2: two Blue rows, nothing to fix
  assert.deepEqual(['b3', 'b4', 'g2'].map((k) => t[k]), ['STRETCH_READY', 'STRETCH_READY', 'STRETCH_READY']);
  assert.deepEqual(res.report[C].STRETCH_READY.relaxed, []);
  // with a fifth Blue row Stretch is b3, b4, b5: the only fixes are g2 (70, more than 10 below b5's 86) and g3 (64, under threshold + 5): relaxed
  const r2 = sel([...pool, row({ job_id: 'b5', title: 'Blue 5', score: 86 })], { tierSize: 3, rules: [rule] });
  assert.equal(tiers(r2).b5, 'STRETCH_READY');
  assert.deepEqual(r2.report[C].STRETCH_READY.relaxed, ['blue']);
});

test('a pool no larger than the tier: only hard rules apply (no swap)', () => {
  const blue = (r) => /Blue/.test(r.title);
  const rule = { name: 'blue', tiers: ['READY'], count: (l) => Math.max(0, l.READY.filter(blue).length - 1), breakers: (l) => l.READY.filter(blue) };
  const pool = [row({ title: 'Blue 1', score: 90 }), row({ title: 'Blue 2', score: 90 }), row({ title: 'Green', score: 90 })];
  const res = sel(pool, { tierSize: 3, rules: [rule] });
  assert.equal(Object.values(tiers(res)).filter((x) => x === 'READY').length, 3);
  assert.equal(res.report[C].READY.pool_smaller_than_tier, true);
  assert.equal(res.report[C].READY.swaps, 0);
});

test('A4: one employer holding the 20 best scores keeps 2 per tier; the rest go to the best other employers within the score floor', () => {
  const pool = [];
  for (let i = 0; i < 20; i++) pool.push(row({ job_id: 'big' + String(i).padStart(2, '0'), company: 'BigCo', score: 90 - (i % 4) }));
  for (let i = 0; i < 60; i++) pool.push(row({ job_id: 'o' + String(i).padStart(2, '0'), score: 88 - (i % 6) }));
  const res = sel(pool);
  const t = tiers(res);
  const big = (tier) => Object.entries(t).filter(([k, v]) => k.startsWith('big') && v === tier).length;
  assert.equal(big('READY'), 2); assert.equal(big('STRETCH_READY'), 2);
  assert.equal(res.report[C].READY.count, 25); assert.equal(res.report[C].READY.max_employer_share, 0.08);
  assert.ok(res.report[C].READY.swaps >= 1 && res.report[C].READY.relaxed.length === 0, JSON.stringify(res.report[C].READY));
  // the employer named in the person's skills may hold 5 per tier
  const gh = [];
  for (let i = 0; i < 8; i++) gh.push(row({ job_id: 'gh' + i, company: 'GoHighLevel', score: 95 }));
  for (let i = 0; i < 40; i++) gh.push(row({ score: 85 }));
  const cands = [{ id: C, primary_skills: JSON.stringify(['CRM Configuration', 'GoHighLevel']) }];
  const t2 = tiers(sel(gh, { candidates: cands }));
  assert.equal(Object.entries(t2).filter(([k, v]) => k.startsWith('gh') && v === 'READY').length, 5);
  assert.equal(Object.entries(t2).filter(([k, v]) => k.startsWith('gh') && v === 'STRETCH_READY').length, 3, 'the rest of its rows, under its own both-tier cap');
});

test('A4: four per employer on both tiers, relaxed when nothing fits', () => {
  const pool = [];
  for (let i = 0; i < 6; i++) pool.push(row({ job_id: 'e' + i, company: 'Evergreen', score: 90 }));
  for (let i = 0; i < 46; i++) pool.push(row({ score: 85 }));
  const t = tiers(sel(pool));
  assert.equal(Object.entries(t).filter(([k, v]) => k.startsWith('e') && v !== 'NEEDS_REVIEW').length, 4);
  // nothing else qualifies within the floor: the cap is relaxed and reported, the tier still fills
  const tight = [];
  for (let i = 0; i < 6; i++) tight.push(row({ job_id: 'f' + i, company: 'Fixed', score: 90 }));
  for (let i = 0; i < 3; i++) tight.push(row({ score: 62 }));
  const r = sel(tight, { tierSize: 3 });
  assert.deepEqual(r.report[C].READY.relaxed, ['employer_per_tier']);
  assert.equal(r.report[C].READY.count, 3);
});

test('A4: reposting sites: at most 3 per tier; a repost of a direct posting in the pool is dropped, a different posting is not', () => {
  const D = 'Configure the CRM and own workflow automation for our customers. Remote within India. '.repeat(3);
  const pool = [row({ job_id: 'direct', company: 'Acme', title: 'Implementation Lead', location: 'Remote - India', description: D, score: 80 }),
    row({ job_id: 'dup', company: 'Jobgether', title: 'Implementation Lead', location: 'Remote - India', description: D + ' Apply via Jobgether.', score: 90 }),
    row({ job_id: 'notdup', company: 'Jobgether', title: 'Implementation Lead', location: 'Remote - India', description: 'Another company entirely. ' + D, score: 90 })];
  for (let i = 0; i < 5; i++) pool.push(row({ job_id: 'rp' + i, company: ['Turing', 'Crossover', 'Braintrust', 'Pavago', 'Paired'][i], score: 95 }));
  const t = tiers(sel(pool));
  assert.equal(t.dup, undefined, 'the duplicate is dropped');
  assert.ok(t.notdup, 'a different posting from the same reposter stays');
  assert.equal(Object.entries(t).filter(([k, v]) => (k.startsWith('rp') || k === 'notdup') && v === 'READY').length, 3, 'three reposter rows in Ready');
  assert.equal(Object.entries(t).filter(([k, v]) => (k.startsWith('rp') || k === 'notdup') && v === 'STRETCH_READY').length, 3, 'the rest overflow to Stretch, three there too');
});

test('A4: a tenant-id employer is not shortlisted (B1 gives it a name first); known ids and short real names from other sites are', () => {
  const pool = [row({ job_id: 't1', company: 'fa espx saasfaprod1', source: 'oracle' }), row({ job_id: 't2', company: 'hdga', source: 'workday' }),
    row({ job_id: 'k1', company: 'abb', source: 'workday' }), row({ job_id: 'k2', company: 'skip', source: 'ashby' })];
  assert.deepEqual(tiers(sel(pool)), { k1: 'READY', k2: 'READY' });
});

test('deterministic: the same pool in any order gives the same changes', () => {
  const pool = [];
  for (let i = 0; i < 60; i++) pool.push(row({ score: 55 + (i * 7) % 40, eligibility: i % 3 ? 'ELIGIBLE' : 'UNKNOWN', discovered_at: iso(i % 40) }));
  const a = sel(pool), b = sel([...pool].reverse());
  assert.deepEqual(a.changes, b.changes);
});

test('generated SQL: guards, marks, history, idempotence; a person\'s Ready row and decided rows stay byte-identical', () => {
  const { sqlite: db } = createDb();
  db.prepare(`INSERT INTO candidates(id,full_name,qualification_threshold) VALUES (?,?,60)`).run(C, 'F');
  const V = JSON.stringify({ preliminary: true, [RULES_MARKER]: true }), now = new Date().toISOString();
  const add = (id, score, o = {}) => {
    db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,discovered_at,last_verified_at) VALUES (?,?,?,?,?,?,?,?)`).run(id, 'T ' + id, 'Co ' + id, 'lever', 'https://x.example/' + id, o.active ?? 1, now, now);
    db.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?,?)`).run(C, id, o.status || 'NEEDS_REVIEW', o.elig || 'ELIGIBLE', o.reason ?? 'Cloud discovery match.', o.override || null);
    db.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,score_breakdown) VALUES (?,?,?,40,?)`).run(C, id, score, V);
    if (o.app) db.prepare(`INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,'APPLIED')`).run('ap' + id, C, id);
  };
  add('new', 80); add('up', 85, { status: 'STRETCH_READY', reason: MARK + 'x' }); add('down', 20, { status: 'READY', reason: MARK + 'y' });
  add('person', 10, { status: 'READY', reason: 'Strongest Fit verified match (61%)' }); add('ovr', 90, { override: 'NEEDS_REVIEW' });
  add('applied', 20, { status: 'READY', reason: MARK + 'z', app: true }); add('ovr_auto', 20, { status: 'READY', reason: MARK + 'w', override: 'READY' });
  const keep = () => JSON.stringify(db.prepare(`SELECT * FROM candidate_qualifications WHERE job_id IN ('person','ovr','applied','ovr_auto') ORDER BY job_id`).all());
  const before = keep();
  const r = selectInto(db);
  const st = Object.fromEntries(db.prepare(`SELECT job_id j, qualification_status s, qualification_reason r FROM candidate_qualifications`).all().map((x) => [x.j, [x.s, x.r]]));
  assert.deepEqual(st.new, ['READY', MARK + 'Cloud discovery match.']);
  assert.deepEqual(st.up, ['READY', MARK + 'x'], 'moved up: marked once');
  assert.deepEqual(st.down, ['NEEDS_REVIEW', 'y'], 'demoted: the mark is removed');
  assert.equal(keep(), before, 'decided, applied and person-set rows are byte-identical');
  const hist = db.prepare(`SELECT job_id j, previous_status p, new_status n, actor a FROM qualification_history ORDER BY job_id`).all().map((h) => `${h.j}:${h.p}>${h.n}:${h.a}`);
  assert.deepEqual(hist, ['down:READY>NEEDS_REVIEW:discovery', 'new:NEEDS_REVIEW>READY:discovery', 'up:STRETCH_READY>READY:discovery']);
  db.exec(r.sql);   // the same file twice
  assert.equal(db.prepare('SELECT COUNT(*) c FROM qualification_history').get().c, 3, 'running the file again changes nothing');
  assert.equal(selectInto(db).sql, '', 'a fresh selection on the result has nothing to change');
  // between the export and the write a person decides and a job closes: the guards win
  db.prepare(`UPDATE candidate_qualifications SET qualification_status = 'NEEDS_REVIEW', qualification_reason = 'Cloud discovery match.' WHERE job_id = 'new'`).run();
  add('closing', 95);
  const sql = selectionSql(selectShortlist(exportPool(db).rows, {}).changes);
  assert.match(sql, /'new'[\s\S]*'closing'|'closing'[\s\S]*'new'/, 'both would be shortlisted');
  db.prepare(`UPDATE candidate_qualifications SET manual_override_status = 'HOLD' WHERE job_id = 'new'`).run();
  db.prepare(`UPDATE jobs SET is_active = 0 WHERE id = 'closing'`).run();
  db.exec(sql);
  assert.equal(db.prepare(`SELECT qualification_status s FROM candidate_qualifications WHERE job_id = 'new'`).get().s, 'NEEDS_REVIEW', 'a decision made in between is not overwritten');
  assert.equal(db.prepare(`SELECT qualification_status s FROM candidate_qualifications WHERE job_id = 'closing'`).get().s, 'NEEDS_REVIEW', 'a job closed in between is not shortlisted');
});

test('CLI: one SQL file; with no pool it writes an empty file and the lists stay as they are', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-'));
  const out = path.join(dir, 'select.sql');
  const cli = (...a) => execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/shortlist_select.mjs', '--out', out, ...a], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(out, 'stale');
  assert.match(cli('--pool', path.join(dir, 'missing.json')), /No shortlist pool/);
  assert.equal(fs.readFileSync(out, 'utf8'), '');
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'pool.json'), JSON.stringify({ rows: [row({ job_id: 'p1', last_verified_at: now, discovered_at: now })] }));
  fs.writeFileSync(path.join(dir, 'live.json'), JSON.stringify({ alive: [], dead: ['p1'] }));
  cli('--pool', path.join(dir, 'pool.json'));
  assert.match(fs.readFileSync(out, 'utf8'), /'READY'[\s\S]*generation = generation \+ 1/);
  cli('--pool', path.join(dir, 'pool.json'), '--liveness', path.join(dir, 'live.json'));
  assert.equal(fs.readFileSync(out, 'utf8'), '', 'found closed by today\'s check: not shortlisted');
});
