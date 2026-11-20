// Checks a profile config (dashboard/docs/MULTI_CANDIDATE.md section 3) and writes the SQL that stores it, for the operator to apply with
// `npx wrangler d1 execute career-job-engine --remote --file=<out>`. The stored config is the RESOLVED one: merged with its built-in base
// (extends), validated again, and marked "resolved": true. The scorer (worker/profiles/dispatch.ts) and discovery (engine/profile_plan.py)
// use only resolved configs, so both read the same config. Prints the packs and places; writes nothing to any database itself.
//
//   node --import ./test/register.mjs scripts/profile_config.mjs --candidate <id> --config <config.json> [--out config.sql]
import fs from 'node:fs';
import { parseProfileConfig, mergedConfig } from '../worker/profiles/schema.ts';
import { LEGACY_IDS } from '../worker/profiles/legacy.ts';

const q = (v) => `'${String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/'/g, "''")}'`;
/** Pure: (candidate id, config) -> the resolved config to store, or the reasons it is refused. */
export function storedConfig(candidateId, raw) {
  if (!/^[a-z][a-z0-9_]{2,39}$/.test(String(candidateId || ''))) return { ok: false, errors: ['candidate id must be lower-case letters, digits and _ (3 to 40)'] };
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return { ok: false, errors: ['config is not valid JSON'] }; } }
  // a built-in person always starts from their own legacy base (their packs reproduce the old screen); another base is refused
  if (LEGACY_IDS.has(candidateId) && obj && typeof obj === 'object') {
    if (obj.extends && obj.extends !== 'legacy:' + candidateId) return { ok: false, errors: [`${candidateId} can only extend legacy:${candidateId}`] };
    obj = { ...obj, extends: 'legacy:' + candidateId };
  }
  const r = parseProfileConfig(obj);
  if (!r.ok) return { ok: false, errors: r.errors };
  const cfg = { ...r.config };
  const merged = { ...mergedConfig(cfg), resolved: true };
  const again = parseProfileConfig(merged);   // the merged result is validated too (and normalised the way the readers will read it)
  if (!again.ok) return { ok: false, errors: again.errors.map((e) => 'after merging: ' + e) };
  return { ok: true, errors: [], config: again.config };
}
/** Pure: (candidate id, config) -> {ok, errors, sql, summary}. */
export function configSql(candidateId, raw) {
  const st = storedConfig(candidateId, raw);
  if (!st.ok) return st;
  const cfg = st.config, text = JSON.stringify(cfg);
  if (text.length > 16384) return { ok: false, errors: ['the resolved config is over 16 KB'] };
  const engine = cfg.engine ?? (LEGACY_IDS.has(candidateId) ? 'legacy' : 'profile');
  const exists = `EXISTS (SELECT 1 FROM candidates WHERE id = ${q(candidateId)})`;
  // the config's threshold is also the stored threshold, so the shortlist pool, the lists and Today use the same cut-off as the score
  const thr = cfg.thresholds?.qualify;
  const sql = `INSERT INTO candidate_profile_configs(candidate_id, config, updated_at) SELECT ${q(candidateId)}, ${q(text)}, datetime('now') WHERE ${exists}
  ON CONFLICT(candidate_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at;
${thr !== undefined ? `UPDATE candidates SET qualification_threshold = ${Number(thr)} WHERE id = ${q(candidateId)};\n` : ''}UPDATE cache_state SET generation = generation + 1 WHERE id = 1;
`;
  return { ok: true, errors: [], sql, config: cfg, summary: { candidate_id: candidateId, engine, packs: cfg.field?.packs?.length ? cfg.field.packs : ['keyword'], families: cfg.field?.role_families || [],
    place: (cfg.place || []).map((p) => p.policy + ('country' in p ? `(${p.country})` : 'countries' in p ? `(${p.countries.join(',')})` : '')), threshold: thr ?? null, bytes: text.length } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const res = configSql(opt('--candidate'), fs.readFileSync(opt('--config'), 'utf8'));
  if (!res.ok) { console.error('Config refused:\n- ' + res.errors.join('\n- ')); process.exit(2); }
  if (opt('--out')) fs.writeFileSync(opt('--out'), res.sql);
  if (opt('--resolved')) fs.writeFileSync(opt('--resolved'), JSON.stringify(res.config, null, 1));
  console.log(JSON.stringify(res.summary, null, 1));
  if (res.summary.engine !== 'profile') console.log('engine is "legacy": the person keeps the old evaluate() until the config says "engine": "profile".');
}
