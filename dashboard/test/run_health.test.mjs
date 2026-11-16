// R8: the daily run's health decision (scripts/run_health.mjs). A run that did nothing must not go green.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decideHealth, timeWarnings } from '../scripts/run_health.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOOD = {
  targets: [{ id: 'a' }, { id: 'b' }], liveness: { targets: 2, alive: 1, dead: 0, unknown: 1 },
  sources: { workday: { read: 800, kept: 20 }, eures: { error: 'down', read: 0, kept: 0 } }, boards: { remoteok: { read: 90, kept: 2 } },
  apply: { new_jobs: 40, rows: 55, rescored: 300 }, dataset: { snapshot: '2026-11-13T14:00:00Z', stale: false, new: 40 },
};

test('a normal day is healthy', () => {
  assert.deepEqual(decideHealth(GOOD), { healthy: true, reasons: [] });
});

test('the still-open check had targets but verified 0 (including when it never wrote a report)', () => {
  assert.match(decideHealth({ ...GOOD, liveness: { alive: 0, dead: 0, unknown: 2 } }).reasons.join(), /2 targets but verified 0/);
  assert.match(decideHealth({ ...GOOD, liveness: null }).reasons.join(), /verified 0/);
  assert.equal(decideHealth({ ...GOOD, targets: [], liveness: { alive: 0 } }).healthy, true, 'no targets: nothing to verify');
});

test('every source failed; sources skipped for time do not count; a missing pair of reports is a failure', () => {
  const allBad = { ...GOOD, sources: { a: { error: 'x' }, b: { error: 'y' }, c: { skipped: 'time budget' } }, boards: { r: { error: 'z' } } };
  assert.match(decideHealth(allBad).reasons.join(), /every source failed \(3\)/);
  assert.equal(decideHealth({ ...GOOD, sources: { a: { error: 'x' } }, boards: { r: { read: 3, kept: 0 } } }).healthy, true, 'one answering source is enough');
  assert.match(decideHealth({ ...GOOD, sources: null, boards: null }).reasons.join(), /no source report/);
  assert.equal(decideHealth({ ...GOOD, sources: null }).healthy, true, 'the boards answered');
});

test('0 rows written fails only when the dataset was fresh', () => {
  const none = { ...GOOD, apply: { new_jobs: 0, rows: 0, rescored: 0 } };
  assert.match(decideHealth(none).reasons.join(), /0 rows written/);
  assert.ok(!decideHealth({ ...none, dataset: { dataset: 'download_failed' } }).reasons.some((r) => /0 rows/.test(r)), 'a failed download is reported as such, not as 0 rows');
  assert.ok(!decideHealth({ ...none, stale: true }).reasons.some((r) => /0 rows/.test(r)), 'a stale dataset is reported as stale');
  assert.equal(decideHealth({ ...none, apply: { new_jobs: 0, rows: 0, rescored: 12 } }).healthy, true, 're-scored rows count as written');
});

test('a stale dataset is unhealthy (moved here from the R3 step)', () => {
  assert.match(decideHealth({ ...GOOD, stale: true }).reasons.join(), /over 48 hours/);
  assert.match(decideHealth({ ...GOOD, dataset: { ...GOOD.dataset, stale: true } }).reasons.join(), /over 48 hours/);
});

test('the CLI reads the work folder and writes the outputs the health job reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-'));
  fs.writeFileSync(path.join(dir, 'liveness_targets.json'), JSON.stringify(GOOD.targets));
  fs.writeFileSync(path.join(dir, 'liveness_report.json'), JSON.stringify({ alive: 0 }));
  fs.writeFileSync(path.join(dir, 'boards_report.json'), JSON.stringify(GOOD.boards));
  const out = path.join(dir, 'gh_output');
  execFileSync(process.execPath, ['scripts/run_health.mjs', '--work', dir], { cwd: path.join(here, '..'), env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '' } });
  const o = fs.readFileSync(out, 'utf8');
  assert.match(o, /^healthy=false$/m); assert.match(o, /^reasons=still-open check had 2 targets but verified 0$/m);
});

test('discovery.yml: the health job fails the run after everything ran, without failing the discover job the guards count', () => {
  const wf = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'discovery.yml'), 'utf8');
  assert.match(wf, /healthy: \$\{\{ steps\.health\.outputs\.healthy \}\}/);
  const job = wf.slice(wf.indexOf('\n  health:'));
  assert.match(job, /needs: discover/);
  assert.match(job, /needs\.discover\.result == 'success'/);
  assert.match(job, /needs\.discover\.outputs\.healthy/);
  assert.doesNotMatch(wf, /Dataset freshness/, 'the stale-dataset check lives in the health decision now');
});

test('tenth-man fixes: a failed download or an unreadable manifest makes the run red (the guards still count the day, so it does not loop)', () => {
  assert.match(decideHealth({ ...GOOD, dataset: { dataset: 'download_failed', new: 0 } }).reasons.join(), /download failed/);
  assert.match(decideHealth({ ...GOOD, dataset: { ...GOOD.dataset, snapshot_age_hours: null } }).reasons.join(), /manifest could not be read/);
  assert.equal(decideHealth({ ...GOOD, dataset: { ...GOOD.dataset, snapshot_age_hours: 5 } }).healthy, true);
  assert.equal(decideHealth(GOOD).healthy, true, 'an older report without the field is not flagged');
});

test('tenth-man fixes: the guards read every completed run, so a red health job does not restart the whole run on every trigger', () => {
  const guard = fs.readFileSync(path.join(here, '..', 'scripts', 'recent_run_guard.mjs'), 'utf8');
  assert.match(guard, /runs\?status=completed&per_page=20/);
  const dog = fs.readFileSync(path.join(here, '..', 'scripts', 'discovery_watchdog.mjs'), 'utf8');
  assert.match(dog, /if \(r\.status === 'completed'\) \{/);
  const wf = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'discovery.yml'), 'utf8');
  assert.match(wf, /a < max\(10, t \/\/ 5\)/, 'too few verified rows also use the relaxed demotion');
  assert.match(wf, /run_log\.mjs --work \.\.\/work --kind discovery --event "\$\{\{ github\.event_name \}\}" --status "\$\{\{ job\.status \}\}"/);
});

test('a source skipped or stopped for time is a warning, never a failure (QA 3 F2)', () => {
  const sources = { watch_boards: { skipped: 'time budget', read: 0, kept: 0 }, workday: { stopped: 'time cap', cap_seconds: 300, read: 90, kept: 4 }, jibe: { read: 10, kept: 1 } };
  assert.deepEqual(timeWarnings(sources, { remoteok: { skipped: 'time budget' } }),
    ['watch_boards was skipped for time', 'workday was stopped at its time cap (300 s, read 90)', 'remoteok was skipped for time']);
  assert.deepEqual(timeWarnings(null, undefined, { a: { read: 1 } }), []);
  assert.equal(decideHealth({ ...GOOD, sources }).healthy, true);
});
