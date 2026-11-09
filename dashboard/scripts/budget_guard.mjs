// Budget guard for scheduled D1 work. Reads the ACCOUNT's rows read today (Cloudflare analytics, which is what the free limit is
// enforced on and which does not itself read from D1) and says whether a job may start. Prints figures only, never the token.
//   env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, MAX_READS (job may start only below this), EVENT (github event name)
//   writes skip=true|false to $GITHUB_OUTPUT. Never fails the workflow: a skipped run is a clean, visible "skipped".
import fs from 'node:fs';

export const WRITE_LIMIT = 100000;

/** Pure decision. usage = {rows_read, rows_written} for today, or null when the figures could not be read. */
export function decide(usage, { maxReads, event }) {
  if (!usage) {
    // Figures unreadable (token lacks analytics, API changed, network). A person pressing the button decides for themselves;
    // an unattended schedule stays out of the database rather than risk the quota.
    return event === 'schedule' ? { skip: true, reason: 'usage unknown; scheduled run skipped to protect the quota' } : { skip: false, reason: 'usage unknown; manual run allowed' };
  }
  if (usage.rows_read >= maxReads) return { skip: true, reason: `rows read today ${usage.rows_read.toLocaleString('en')} >= allowed ${maxReads.toLocaleString('en')}` };
  if (usage.rows_written >= WRITE_LIMIT * 0.8) return { skip: true, reason: `rows written today ${usage.rows_written.toLocaleString('en')} is near the ${WRITE_LIMIT.toLocaleString('en')} limit` };
  return { skip: false, reason: `rows read today ${usage.rows_read.toLocaleString('en')} < allowed ${maxReads.toLocaleString('en')}` };
}

async function todaysUsage(token, account, db) {
  const day = new Date().toISOString().slice(0, 10);
  const query = `query($a:String!,$db:string,$d:Date!){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:5,filter:{databaseId:$db,date_geq:$d,date_leq:$d}){sum{rowsRead rowsWritten}}}}}`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { a: account, db, d: day } }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) return null;
  const groups = body?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if (!Array.isArray(groups)) return null;
  return groups.reduce((t, g) => ({ rows_read: t.rows_read + (g.sum?.rowsRead || 0), rows_written: t.rows_written + (g.sum?.rowsWritten || 0) }), { rows_read: 0, rows_written: 0 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const maxReads = Number(process.env.MAX_READS || 3500000), event = process.env.EVENT || 'workflow_dispatch';
  let usage = null;
  try {
    const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const db = (toml.match(/database_id\s*=\s*"([0-9a-f-]+)"/) || [])[1];
    if (token && account && db) usage = await todaysUsage(token, account, db);
  } catch { usage = null; }
  const d = decide(usage, { maxReads, event });
  console.log(`Budget guard: ${d.skip ? 'SKIP' : 'go'} - ${d.reason}`);
  if (!usage && process.env.GITHUB_ACTIONS) console.log('::warning title=Budget guard::Usage figures could not be read (check CLOUDFLARE_API_TOKEN has Account Analytics read); scheduled runs stay skipped until fixed.');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${d.skip}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Budget guard:** ${d.skip ? 'skipped this run' : 'ok'} - ${d.reason}\n`);
}
