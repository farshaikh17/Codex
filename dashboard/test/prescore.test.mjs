// Wide intake: the selection's pre-score (scripts/prescore.mjs) scores exactly what the import stores: the same posting object (shared with
// scripts/dataset_apply.mjs) and the Worker's own evaluate() and placeBand().
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { posting, prescore, contextFor } from '../scripts/prescore.mjs';
import { evaluate, placeBand } from '../worker/discovery.ts';

const sana = { id: 'sana_ansari', primary_skills: '["Reliability","Plant Engineering"]', target_roles: '["Maintenance Manager"]', total_years_experience: 9, qualification_threshold: 65, rejected_companies: '[]' };
const farhan = { id: 'farhan_shaikh', primary_skills: '["Workflow Automation","CRM Configuration"]', target_roles: '["Implementation Manager"]', total_years_experience: 9, qualification_threshold: 70, rejected_companies: '[{"company":"Rejecting Co","on":"2026-10-01"}]' };
const row = (o) => ({ id: 'ds:x:1', url: 'https://jobs.example/1', title: 'Maintenance Manager', company: 'Acme', location: 'Gurugram, HR', description: '<p>Plant reliability &amp; maintenance.</p>', is_remote: null, ...o });

test('prescore: the posting is built as the import builds it (text without markup, remote from the flag or the location)', () => {
  const p = posting(row({ is_remote: true }));
  assert.equal(p.description, 'Plant reliability & maintenance.');
  assert.equal(p.remote, true);
  assert.equal(posting(row({ location: 'Remote - India' })).remote, true);
  assert.equal(posting(row()).remote, false);
});

test('prescore: same score, status and band as evaluate() and placeBand() on that posting', () => {
  for (const [cand, r] of [[sana, row()], [sana, row({ location: 'Ruwais, AE', title: 'O&M Engineer' })], [sana, row({ location: 'Lagos, Nigeria', description: 'We offer visa sponsorship.' })],
    [farhan, row({ title: 'Implementation Manager', location: 'Remote (Worldwide)', is_remote: true })], [farhan, row({ title: 'Implementation Manager', location: 'Austin, TX' })],
    [farhan, row({ title: 'Implementation Manager', company: 'Rejecting Co', location: 'Remote - India', is_remote: true })]]) {
    const got = prescore(cand, contextFor(cand), r);
    const p = posting(r), want = evaluate(cand, p, contextFor(cand));
    assert.deepEqual([got.score, got.status, got.eligibility], [want.score, want.status, want.eligibility], `${cand.id} ${r.location}`);
    assert.equal(got.band, placeBand(cand.id, p.location, null, p.remote, p.description));
  }
  assert.equal(prescore(sana, contextFor(sana), row()).band, 'india_onsite');
  assert.equal(prescore(farhan, contextFor(farhan), row({ title: 'Implementation Manager', location: 'Austin, TX' })).status, 'INELIGIBLE', 'not remote: ruled out for Farhan');
});

test('prescore: the command line reads and writes JSON lines, one result per row, in order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prescore-'));
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify([sana]));
  fs.writeFileSync(path.join(dir, 'in.jsonl'), [row({ k: 0, cid: 'sana_ansari' }), row({ k: 1, cid: 'nobody' })].map((x) => JSON.stringify(x)).join('\n') + '\n');
  execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/prescore.mjs', '--candidates', path.join(dir, 'c.json'), '--in', path.join(dir, 'in.jsonl'), '--out', path.join(dir, 'out.jsonl')], { stdio: 'pipe' });
  const out = fs.readFileSync(path.join(dir, 'out.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((x) => [x.k, x.cid]), [[0, 'sana_ansari'], [1, 'nobody']]);
  assert.equal(out[0].band, 'india_onsite');
  assert.equal(out[1].status, 'UNKNOWN_CANDIDATE');
  fs.rmSync(dir, { recursive: true, force: true });
});
