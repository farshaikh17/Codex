// Watchdog for the daily discovery run (owner priority 2026-11-12: "a working product every day"). GitHub dropped every scheduled
// discovery trigger on 12 Nov while the other scheduled workflows ran, so its own workflow (discovery-watchdog.yml, every two hours, no
// concurrency group) asks, each time it runs:
// "has the daily run done its real work in the last DUE_HOURS?" If not, and no discovery run is queued, running or was started in the
// last RECENT_HOURS (a run that failed fast is not retried in a loop), it starts one (workflow_dispatch with this run's GITHUB_TOKEN).
//   env: GITHUB_TOKEN, GITHUB_REPOSITORY, DUE_HOURS (default 24), RECENT_HOURS (default 3), DRY_RUN
import fs from 'node:fs';

/** Pure decision. runs = newest first: [{ id, status, conclusion, created_at, discover }] where discover is the 'discover' job's conclusion. */
// budgetSkip: the run's 'skipped' job succeeded, i.e. the budget guard postponed a due run (D1 reads over the start limit).
// QA 16 Nov: a run the budget guard skipped in the evening blocked retries for RECENT_HOURS and the 24-hour rule, so the day was lost. D1's
// read count resets at 00:00 UTC: on a new UTC day, when a run was budget-skipped on an earlier day, no run has started yet today and the last
// real run is older than resetDueHours, the watchdog starts one at once (the run's own budget guard still checks today's reads).
export function decideWatchdog(runs, { now = Date.now(), dueHours = 24, recentHours = 3, resetDueHours = 20 } = {}) {
  const age = (r) => (now - Date.parse(r.created_at)) / 3600000;
  const active = runs.find((r) => r.status === 'queued' || r.status === 'in_progress' || r.status === 'waiting' || r.status === 'requested');
  if (active) return { dispatch: false, reason: `a discovery run is already ${active.status} (run ${active.id})` };
  const lastGood = runs.find((r) => r.discover === 'success');
  const day = (t) => new Date(t).toISOString().slice(0, 10), today = day(now);
  const skippedBefore = runs.find((r) => r.budgetSkip && day(Date.parse(r.created_at)) < today);
  const startedToday = runs.some((r) => day(Date.parse(r.created_at)) === today);
  if (skippedBefore && !startedToday && (!lastGood || age(lastGood) >= resetDueHours))
    return { dispatch: true, reason: `the budget guard postponed run ${skippedBefore.id} before the 00:00 UTC read reset; last real run ${lastGood ? age(lastGood).toFixed(1) + ' h ago' : 'not found'}` };
  if (lastGood && age(lastGood) < dueHours) return { dispatch: false, reason: `the daily run did its work ${age(lastGood).toFixed(1)} h ago (run ${lastGood.id})` };
  const recent = runs.find((r) => age(r) < recentHours);
  if (recent) return { dispatch: false, reason: `a discovery run started ${age(recent).toFixed(1)} h ago (run ${recent.id}, ${recent.conclusion || recent.status}); not retrying yet` };
  return { dispatch: true, reason: lastGood ? `last real run was ${age(lastGood).toFixed(1)} h ago - overdue` : 'no successful run found - overdue' };
}

async function gh(path, token, init = {}) {
  const res = await fetch('https://api.github.com' + path, { ...init, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
  const dueHours = Number(process.env.DUE_HOURS || 24), recentHours = Number(process.env.RECENT_HOURS || 3);
  let d;
  try {
    const list = await gh(`/repos/${repo}/actions/workflows/discovery.yml/runs?per_page=15`, token);
    const runs = [];
    for (const r of list.workflow_runs || []) {
      let discover = null, budgetSkip = false;
      if (r.status === 'completed') {   // a run whose health job went red still did the day's work when its 'discover' job succeeded
        const jobs = await gh(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=50`, token);   // max discovery: a run has about 16 jobs (8 parallel collector parts), and the discover job must be on the page
        discover = (jobs.jobs.find((j) => j.name === 'discover') || {}).conclusion || null;
        budgetSkip = (jobs.jobs.find((j) => j.name === 'skipped') || {}).conclusion === 'success';   // runs only when the budget guard postponed it
      }
      runs.push({ id: r.id, status: r.status, conclusion: r.conclusion, created_at: r.created_at, discover, budgetSkip });
    }
    d = decideWatchdog(runs, { dueHours, recentHours });
    if (d.dispatch && !process.env.DRY_RUN) await gh(`/repos/${repo}/actions/workflows/discovery.yml/dispatches`, token, { method: 'POST', body: JSON.stringify({ ref: 'main' }), headers: { 'content-type': 'application/json' } });
  } catch (e) {
    d = { dispatch: false, reason: `could not check (${String(e.message).slice(0, 100)}); the next trigger tries again` };
  }
  const line = `Discovery watchdog: ${d.dispatch ? (process.env.DRY_RUN ? 'WOULD START the daily run' : 'STARTED the daily run') : 'nothing to do'} - ${d.reason}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${line}**\n`);
}
