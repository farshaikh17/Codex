// "Delete merged branches" (owner request 2026-11-12: "only keep useful branches"). Run by hand from the Actions tab.
// A branch is deleted only when its work is already in main:
//   (a) its last commit is contained in main (compare main...branch is 'identical' or 'behind'), or
//   (b) a pull request from it was MERGED and the branch has no commit after that merge (squash merges leave no ancestry).
// Never deleted: main, the kept branches below, any branch with an OPEN pull request, and anything else (listed as "kept, not merged").
// The summary lists each deleted branch with its last commit, so it can be restored (pull request page "Restore branch", or a new
// branch at that commit).
//   env: GITHUB_TOKEN, GITHUB_REPOSITORY, MODE = delete | preview
import fs from 'node:fs';

export const KEEP = new Set(['main', 'improvements', 'build/crawl4ai']);

/** Pure decision for one branch. b = { name, sha, compare: 'identical'|'behind'|'ahead'|'diverged'|null, openPr: bool, mergedPrShas: [sha] } */
export function decideBranch(b) {
  if (KEEP.has(b.name)) return { del: false, why: 'kept on purpose' };
  if (b.openPr) return { del: false, why: 'has an open pull request' };
  if (b.compare === 'identical' || b.compare === 'behind') return { del: true, why: 'all its commits are in main' };
  if ((b.mergedPrShas || []).includes(b.sha)) return { del: true, why: 'its pull request was merged and nothing was added after' };
  return { del: false, why: 'not merged: has work that is not in main' };
}

async function gh(path, token, init = {}) {
  const res = await fetch('https://api.github.com' + path, { ...init, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}
async function all(path, token) {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const rows = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
  const mode = process.env.MODE === 'preview' ? 'preview' : 'delete';
  const branches = await all(`/repos/${repo}/branches`, token);
  const pulls = await all(`/repos/${repo}/pulls?state=all`, token);
  const open = new Set(pulls.filter((p) => p.state === 'open' && p.head?.repo?.full_name === repo).map((p) => p.head.ref));
  const mergedShas = new Map();
  for (const p of pulls) if (p.merged_at && p.head?.repo?.full_name === repo) { const a = mergedShas.get(p.head.ref) || []; a.push(p.head.sha); mergedShas.set(p.head.ref, a); }
  const deleted = [], kept = [], failed = [];
  for (const br of branches) {
    let compare = null;
    if (!KEEP.has(br.name) && !open.has(br.name)) {
      try { compare = (await gh(`/repos/${repo}/compare/main...${encodeURIComponent(br.name)}`, token)).status; } catch { compare = null; }
    }
    const d = decideBranch({ name: br.name, sha: br.commit.sha, compare, openPr: open.has(br.name), mergedPrShas: mergedShas.get(br.name) });
    if (!d.del) { kept.push(`${br.name} - ${d.why}`); continue; }
    if (mode === 'delete') {
      try { await gh(`/repos/${repo}/git/refs/heads/${br.name.split('/').map(encodeURIComponent).join('/')}`, token, { method: 'DELETE' }); }
      catch (e) { failed.push(`${br.name} - ${e.message}`); continue; }
    }
    deleted.push(`${br.name} (last commit ${br.commit.sha.slice(0, 12)}) - ${d.why}`);
  }
  const verb = mode === 'delete' ? 'Deleted' : 'Would delete';
  const text = [`## ${verb} ${deleted.length} branch(es)`, ...deleted.map((x) => `- ${x}`), '', `## Kept ${kept.length}`, ...kept.map((x) => `- ${x}`),
    ...(failed.length ? ['', `## Could not delete ${failed.length}`, ...failed.map((x) => `- ${x}`)] : [])].join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  if (failed.length) process.exitCode = 1;
}
