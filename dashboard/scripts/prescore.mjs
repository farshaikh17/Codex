// Wide intake: pre-scores dataset rows on the GitHub runner (free compute, no database reads) with the Worker's own evaluate() and placeBand(),
// so engine/dataset_discovery.py imports the rows that can fit a person, best fit first, instead of the newest rows of a few fixed quotas.
// The posting is built exactly as scripts/dataset_apply.mjs builds it (posting() below is shared with that script), so the pre-score is the score
// the import will store, before the taste adjustment (at most 5 points) and the employer lists that are read later in the run.
//
//   node --import ./test/register.mjs scripts/prescore.mjs --candidates work/candidates.json --in work/prescore_in.jsonl --out work/prescore_out.jsonl
// Input: one JSON object per line {k, cid, title, company, ats_type, location, description, is_remote, salary_min, salary_max, salary_currency, salary_period}.
// Output: one line per input line {k, cid, score, status, eligibility, band}. A candidate that is not in candidates.json gets status 'UNKNOWN_CANDIDATE'.
import fs from 'node:fs';
import readline from 'node:readline';
import { evaluate, placeBand, companyKey, onsiteByText, remoteFlagTrusted } from '../worker/discovery.ts';

export const plain = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** The posting evaluate() sees for one dataset or job-site row (the same object scripts/dataset_apply.mjs scores). */
export function posting(j) {
  const description = plain(j.description).slice(0, 6000);
  // Jobs QA 13 Nov: the source's remote flag is wrong for some postings whose own text places the job in an office ('The position is based in
  // Bengaluru', '#LI-Onsite', 'two days a week from our London office'); the text wins (evaluate() reads it the same way).
  // Jobs QA 2 (14 Nov): an Oracle, Workday or SuccessFactors flag alone is not trusted (Mashreq Bengaluru, on site, flagged remote): the text or
  // the place must say remote too.
  const flagged = j.is_remote === true && remoteFlagTrusted(j.ats_type, description, j.location);
  const textOnsite = flagged && onsiteByText(description);
  const remote = (flagged && !textOnsite) || /\bremote\b/i.test(j.location || '');
  const onsite = j.is_remote === false || (textOnsite && !remote);
  return { id: j.id, title: j.title, company: j.company || '', url: j.url, location: j.location || '', description, remote, onsite, repost: !!j.repost,
    salary: { min: j.salary_min, max: j.salary_max, currency: j.salary_currency, period: j.salary_period } };
}

/** Per-candidate context known before the import: employers that rejected the person before. (The worldwide-hirer, YC and UK-sponsor lists
 *  are read later in the run; they move a score by at most 5 points.) */
export function contextFor(c) {
  let rows = []; try { rows = JSON.parse(c.rejected_companies || '[]') || []; } catch {}
  const rejected = new Map();
  for (const r of Array.isArray(rows) ? rows : []) { const k = companyKey(r?.company); if (k && !rejected.has(k)) rejected.set(k, r?.on ? String(r.on).slice(0, 10) : null); }
  return { globalHirers: new Set(), rejected, yc: new Map(), ukSponsors: new Set() };
}

export function prescore(cand, ctx, row) {
  const p = posting(row);
  const r = evaluate(cand, p, ctx);
  return { score: r.score, status: r.status, eligibility: r.eligibility, band: placeBand(cand.id, p.location, null, p.remote, p.description) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const candidates = JSON.parse(fs.readFileSync(opt('--candidates'), 'utf8'));
  const byId = new Map(candidates.map((c) => [c.id, { cand: c, ctx: contextFor(c) }]));
  const out = fs.createWriteStream(opt('--out'));
  const lines = readline.createInterface({ input: fs.createReadStream(opt('--in')), crlfDelay: Infinity });
  let n = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const c = byId.get(row.cid);
    const res = c ? prescore(c.cand, c.ctx, row) : { score: 0, status: 'UNKNOWN_CANDIDATE', eligibility: 'UNKNOWN', band: 'other' };
    if (!out.write(JSON.stringify({ k: row.k, cid: row.cid, ...res }) + '\n')) await new Promise((r) => out.once('drain', r));
    n++;
  }
  await new Promise((r) => out.end(r));
  console.error(`prescore: ${n} rows`);
}
