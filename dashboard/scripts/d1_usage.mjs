// Read-only: the ACCOUNT's own usage figures for this database, per UTC day, from Cloudflare's analytics API. This is the number the free
// tier is enforced on, and it includes every client (Worker, cron, collector sync, authentication, visitors, QA). The application's read meter
// (table read_meter) only counts rows read by the Worker's public/operator cache misses, so the two will differ.
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in the environment; prints figures only, never the token.
import fs from 'node:fs';
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) { console.log('d1_usage: credentials not in the environment'); process.exit(0); }
const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const db = (toml.match(/database_id\s*=\s*"([0-9a-f-]+)"/) || [])[1];
const days = Number(process.argv[2] || 3);
const to = new Date(), from = new Date(Date.now() - (days - 1) * 86400000);
const d = (x) => x.toISOString().slice(0, 10);
const query = `query($a:String!,$db:string,$from:Date!,$to:Date!){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:20,filter:{databaseId:$db,date_geq:$from,date_leq:$to},orderBy:[date_ASC]){dimensions{date} sum{readQueries writeQueries rowsRead rowsWritten}}}}}`;
const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ query: query.replace('$db:string', '$db:string'), variables: { a: account, db, from: d(from), to: d(to) } }) });
const body = await res.json().catch(() => ({}));
if (!res.ok || body.errors) { console.log('d1_usage: analytics API refused or changed:', res.status, JSON.stringify(body.errors || body).replace(token, '***').slice(0, 400)); process.exit(0); }
const rows = body?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups || [];
console.log('Account usage per UTC day (Cloudflare analytics; free limits: 5,000,000 rows read, 100,000 rows written):');
for (const r of rows) console.log(JSON.stringify({ day: r.dimensions.date, rows_read: r.sum.rowsRead, rows_written: r.sum.rowsWritten, read_queries: r.sum.readQueries, write_queries: r.sum.writeQueries }));
if (!rows.length) console.log('(no rows returned)');
