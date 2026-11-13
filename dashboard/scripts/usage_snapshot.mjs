// Plan H1: the account's D1 rows read and written so far today (Cloudflare analytics; reads nothing from D1), as one JSON line:
//   {"day":"2026-11-13","rows_read":841669,"rows_written":19552,"at":"2026-11-13T21:26:20Z"}
// The daily and watchlist runs take one at their start and one at their end; scripts/run_log.mjs stores the difference in the run row
// (d1_rows), so the cost of each kind of run is a recorded number. Never fails and never prints the token: without credentials or an
// answer it prints {}.   env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
import { todaysUsage } from './budget_guard.mjs';

const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
let out = {};
try {
  const day = new Date().toISOString().slice(0, 10);
  const usage = token && account ? await todaysUsage(token, account) : null;
  if (usage && new Date().toISOString().slice(0, 10) === day) out = { day, ...usage, at: new Date().toISOString().slice(0, 19) + 'Z' };
} catch { out = {}; }
process.stdout.write(JSON.stringify(out) + '\n');
