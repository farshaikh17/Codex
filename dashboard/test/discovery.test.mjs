import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';
import { seed } from './fixtures.mjs';
import { evaluate, avoidedTitle, foreignLocation, AVOID_TITLE_CAP, FOREIGN_LOCATION_PENALTY } from '../worker/discovery.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const farhan = { id: 'farhan_shaikh', primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation']) };
const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability', 'Plant Engineering']) };
const post = (title, location = 'Remote', description = 'CRM Configuration and Workflow Automation role.') => ({ id: 'x', title, url: 'https://example.com/x', location, description, remote: /remote/i.test(location) });

test('ranking: avoid-list titles are capped at 40, other titles are not, and the status and eligibility rules are unchanged', () => {
  const good = evaluate(farhan, post('Implementation Manager', 'Remote - India'));
  const avoided = evaluate(farhan, post('Senior Software Engineer, Operations Platform', 'Remote - India'));
  assert.ok(good.score > AVOID_TITLE_CAP, `a fitting title keeps its score (${good.score})`);
  assert.ok(avoided.score <= AVOID_TITLE_CAP, `avoid-list title capped (${avoided.score})`);
  assert.equal(avoided.eligibility, good.eligibility, 'eligibility is computed the same way');
  assert.equal(avoided.status, good.status, 'status rules unchanged (still review, never READY)');
  assert.match(avoided.qualification_reason, /avoid list/);
  for (const t of ['Software Engineer', 'DevOps Engineer', 'Site Reliability Engineer', 'Machine Learning Engineer', 'Security Engineer', 'Finance Manager', 'Customer Support Specialist', 'Engineering Manager', 'SDET'])
    assert.ok(avoidedTitle('farhan_shaikh', t), t);
  for (const t of ['Implementation Manager', 'Technical Operations Lead', 'Solutions Implementation Specialist', 'CRM Administrator', 'Business Systems Analyst'])
    assert.ok(!avoidedTitle('farhan_shaikh', t), t);
  assert.ok(!avoidedTitle('sana_ansari', 'Software Engineer'), "the avoid list is Farhan's only");
});

test('ranking: a posting whose only stated location is outside India loses points for Farhan unless it supports remote work from India', () => {
  const india = evaluate(farhan, post('Implementation Manager', 'Remote - India'));
  const us = evaluate(farhan, post('Implementation Manager', 'Austin, TX', 'CRM Configuration and Workflow Automation.'));
  const usSame = evaluate({ ...farhan }, post('Implementation Manager', 'Remote', 'CRM Configuration and Workflow Automation.'));
  assert.equal(foreignLocation('Austin, TX'), true); assert.equal(foreignLocation('London, United Kingdom'), true);
  assert.equal(foreignLocation('Remote'), false); assert.equal(foreignLocation('Bengaluru, India'), false); assert.equal(foreignLocation(''), false);
  assert.equal(us.score, Math.max(0, usSame.score - FOREIGN_LOCATION_PENALTY), `${us.score} vs ${usSame.score}`);
  assert.equal(india.eligibility, 'ELIGIBLE'); assert.ok(india.score >= us.score);
  assert.equal(us.eligibility, 'UNKNOWN', 'eligibility rules are not changed by the penalty');
  // Sana is open to relocation: no penalty and no avoid list
  const sa = evaluate(sana, post('Reliability Engineer', 'London, United Kingdom', 'Reliability and Plant Engineering role.'));
  const sb = evaluate(sana, post('Reliability Engineer', 'Remote', 'Reliability and Plant Engineering role.'));
  assert.equal(sa.score, sb.score);
});

test('migration 0010: applies the ranking change to stored preliminary scores once, and spares overrides, applications and engine scores', () => {
  const { sqlite } = createDb(); seed(sqlite);
  const sql = fs.readFileSync(path.join(root, 'migrations', '0010_ranking_v2.sql'), 'utf8');
  const bd = JSON.stringify({ rule_version: 'cloud-conservative-review-1', preliminary: true });
  const job = (id, title, loc) => sqlite.prepare("INSERT INTO jobs(id,title,company,source_adapter,is_active,location_restrictions,discovered_at) VALUES (?,?,?,?,1,?,'2026-11-01T00:00:00Z')").run(id, title, 'Co', 'lever', loc);
  const row = (id, score, breakdown = bd, status = 'NEEDS_REVIEW', elig = 'UNKNOWN', override = null) => {
    sqlite.prepare('INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,manual_override_status) VALUES (?,?,?,?,?)').run('farhan_shaikh', id, status, elig, override);
    sqlite.prepare('INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES (?,?,?,?)').run('farhan_shaikh', id, score, breakdown); };
  job('a1', 'Senior Software Engineer', 'Remote'); row('a1', 66);                                  // avoid title -> 40
  job('a2', 'Implementation Manager', 'Austin, TX'); row('a2', 66);                                // foreign only -> 51
  job('a3', 'Implementation Manager', 'Remote - India'); row('a3', 66);                            // untouched
  job('a4', 'DevOps Engineer', 'Remote'); row('a4', 66, bd, 'NEEDS_REVIEW', 'UNKNOWN', 'READY');   // human override -> untouched
  job('a5', 'DevOps Engineer', 'Remote'); row('a5', 66, JSON.stringify({ rule_version: 'engine-v2' }));  // engine score -> untouched
  job('a6', 'DevOps Engineer', 'Remote'); row('a6', 66); sqlite.prepare("INSERT INTO applications(id,candidate_id,job_id,status) VALUES ('ax','farhan_shaikh','a6','SAVED')").run();  // has an application
  job('a7', 'Implementation Manager', 'London, UK'); row('a7', 66, bd, 'NEEDS_REVIEW', 'ELIGIBLE');   // affirmatively eligible -> no location penalty
  job('a8', 'Software Engineer', 'Remote'); row('a8', 30);                                         // already below the cap
  const score = (id) => sqlite.prepare("SELECT overall_score s FROM candidate_job_scores WHERE candidate_id='farhan_shaikh' AND job_id=?").get(id).s;
  const sanaBefore = sqlite.prepare("SELECT COUNT(*) n, SUM(overall_score) s FROM candidate_job_scores WHERE candidate_id='sana_ansari'").get();
  sqlite.exec(sql);
  assert.deepEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map(score), [40, 51, 66, 66, 66, 66, 66, 30]);
  sqlite.exec(sql);                                                                                 // run again: nothing changes
  assert.deepEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map(score), [40, 51, 66, 66, 66, 66, 66, 30]);
  assert.equal(sqlite.prepare("SELECT status FROM (SELECT qualification_status status FROM candidate_qualifications WHERE job_id='a1')").get().status, 'NEEDS_REVIEW');
  assert.deepEqual(sqlite.prepare("SELECT COUNT(*) n, SUM(overall_score) s FROM candidate_job_scores WHERE candidate_id='sana_ansari'").get(), sanaBefore, "Sana's scores are not touched");
});
