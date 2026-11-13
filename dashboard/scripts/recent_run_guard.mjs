// "Did this workflow already do its real work recently?" GitHub schedules are best-effort: a run can start hours late or never.
// So a workflow is triggered more often than needed, and each trigger asks this first; a run that already happened within
// MIN_GAP_HOURS makes the new trigger a quick no-op, while a dropped trigger is caught up by the next one.
// "Real work" means the named job finished with success: a run whose job was skipped (budget guard) does not count. Every COMPLETED run is
// read, not only successful ones: a run whose later "health" job went red (discovery.yml) still did its real work and must not be re-run
// on every trigger (tenth-man review of phase 1).
//   env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, WORKFLOW_FILE, REAL_JOB, MIN_GAP_HOURS, EVENT
//   writes skip=true|false to $GITHUB_OUTPUT. Unknown (API refused) -> a scheduled trigger skips, a manual run goes ahead.
import fs from 'node:fs';

/** Pure decision. runs = newest first: [{ id, run_started_at, jobs: [{ name, conclusion }] }] (the current run excluded). */
export function decide(runs, { now = Date.now(), minGapHours, realJob, event }) {
  if (event === 'workflow_dispatch') return { skip: false, reason: 'manual run: always allowed' };
  for (const r of runs) {
    const done = (r.jobs || []).some((j) => j.name === realJob && j.conclusion === 'success');
    if (!done) continue;
    const ageH = (now - Date.parse(r.run_started_at)) / 3600000;
    if (ageH < minGapHours) return { skip: true, reason: `the real work ran ${ageH.toFixed(1)} h ago (run ${r.id}); next due after ${minGapHours} h` };
    return { skip: false, reason: `last real run was ${ageH.toFixed(1)} h ago (run ${r.id}) - due` };
  }
  return { skip: false, reason: 'no earlier real run found - go' };
}

async function gh(path, token) {
  const res = await fetch('https://api.github.com' + path, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId, WORKFLOW_FILE: wf, REAL_JOB: realJob, EVENT: event = 'schedule' } = process.env;
  const minGapHours = Number(process.env.MIN_GAP_HOURS || 20);
  let d;
  try {
    const list = await gh(`/repos/${repo}/actions/workflows/${wf}/runs?status=completed&per_page=20`, token);
    const runs = [];
    for (const r of (list.workflow_runs || []).filter((x) => String(x.id) !== String(runId))) {
      const jobs = await gh(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=10`, token);
      runs.push({ id: r.id, run_started_at: r.run_started_at, jobs: jobs.jobs.map((j) => ({ name: j.name, conclusion: j.conclusion })) });
      if (runs.length >= 12) break;   // far enough back that a real run is not hidden behind a row of guard-skipped ones
    }
    d = decide(runs, { minGapHours, realJob, event });
  } catch (e) {
    // A scheduled trigger that cannot tell whether the work already ran does not run it (the next trigger tries again); a person's manual run still goes ahead.
    d = event === 'schedule' ? { skip: true, reason: `could not read earlier runs (${String(e.message).slice(0, 80)}); skipping this scheduled trigger` }
      : { skip: false, reason: `could not read earlier runs (${String(e.message).slice(0, 80)}); manual run goes ahead` };
  }
  console.log(`Recent-run guard: ${d.skip ? 'SKIP' : 'go'} - ${d.reason}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${d.skip}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Recent-run guard:** ${d.skip ? 'skipped (already ran)' : 'ok'} - ${d.reason}\n`);
}
