// Checks a profile config (dashboard/docs/MULTI_CANDIDATE.md section 3) and writes the SQL that stores it, for the operator to apply with
// `npx wrangler d1 execute career-job-engine --remote --file=<out>`. Prints the resolved packs and the discovery plan so a new person's
// searches and rules can be read before anything is stored. Writes nothing to any database itself.
//
//   node --import ./test/register.mjs scripts/profile_config.mjs --candidate <id> --config <config.json> [--out config.sql]
import fs from 'node:fs';
import { parseProfileConfig, mergedConfig } from '../worker/profiles/schema.ts';
import { LEGACY_IDS } from '../worker/profiles/legacy.ts';

const q = (v) => `'${String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/'/g, "''")}'`;
/** Pure: (candidate id, config) -> {ok, errors, sql, summary}. */
export function configSql(candidateId, raw) {
  if (!/^[a-z][a-z0-9_]{2,39}$/.test(String(candidateId || ''))) return { ok: false, errors: ['candidate id must be lower-case letters, digits and _ (3 to 40)'] };
  const r = parseProfileConfig(raw);
  if (!r.ok) return { ok: false, errors: r.errors };
  const cfg = r.config, eff = mergedConfig(cfg);
  const engine = cfg.engine ?? (LEGACY_IDS.has(candidateId) ? 'legacy' : 'profile');
  const text = JSON.stringify(cfg);
  // only for a person who exists; one row per person; the cache generation moves so lists are recomputed
  const sql = `INSERT INTO candidate_profile_configs(candidate_id, config, updated_at) SELECT ${q(candidateId)}, ${q(text)}, datetime('now') WHERE EXISTS (SELECT 1 FROM candidates WHERE id = ${q(candidateId)})
  ON CONFLICT(candidate_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at;
UPDATE cache_state SET generation = generation + 1 WHERE id = 1;
`;
  return { ok: true, errors: [], sql, summary: { candidate_id: candidateId, engine, packs: eff.field?.packs?.length ? eff.field.packs : ['keyword'], families: eff.field?.role_families || [],
    place: (eff.place || []).map((p) => p.policy + ('country' in p ? `(${p.country})` : 'countries' in p ? `(${p.countries.join(',')})` : '')), bytes: text.length } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const res = configSql(opt('--candidate'), fs.readFileSync(opt('--config'), 'utf8'));
  if (!res.ok) { console.error('Config refused:\n- ' + res.errors.join('\n- ')); process.exit(2); }
  if (opt('--out')) fs.writeFileSync(opt('--out'), res.sql);
  console.log(JSON.stringify(res.summary, null, 1));
  if (res.summary.engine !== 'profile') console.log('engine is "legacy": the person keeps the old evaluate() until the config says "engine": "profile".');
}
