// Profile config, schema 1 (dashboard/docs/MULTI_CANDIDATE.md section 3): data, not code. A person = this config + the rule packs it names.
// Every pattern is a plain phrase (never a regular expression), every list and string is bounded, and an invalid config is refused with a
// reason (the person then stays on the old path). No personal data is needed here: skills, target roles, years and the threshold still come
// from the candidate row unless the config adds to them.
import { LEGACY_CONFIGS } from './legacy.ts';
import { COUNTRY_NAMES } from './countries.ts';
import { FAMILY_CATALOG } from './families.ts';

export const MAX_CONFIG_BYTES = 16384;
export const FIELD_PACK_KEYS = ['revops_automation', 'plant_maintenance', 'keyword'] as const;
export const LEVELS = ['entry', 'junior', 'mid', 'senior', 'lead', 'manager', 'director', 'executive'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'CONTRACT', 'PART_TIME', 'FREELANCE'] as const;
export const JOBSPY_SITES = ['indeed', 'linkedin', 'glassdoor', 'google', 'bayt'] as const;
export type Level = typeof LEVELS[number];

export type PlacePolicy =
  | { policy: 'remote_from_country'; country: string; remote_only?: boolean; worldwide_ok?: boolean; apac_ok?: boolean; skip_employers?: string[];
      global_hirer_bonus?: boolean; timezone_penalty?: boolean; foreign_penalty?: boolean; unconfirmed_penalty?: boolean; place_words?: string[];
      /** built-in pack only: Farhan's employer-skip expression (legacy.ts) */ legacy_skip?: boolean }
  | { policy: 'onsite_in'; countries: string[]; place_words?: string[] }
  | { policy: 'abroad_with_visa'; gulf_relocation_counts?: boolean; uk_sponsor_route?: boolean; cap_unworkable?: boolean };
export type Money = { amount: number; currency: string; period: string };
export type ProfileConfig = {
  schema: 1;
  /** written by scripts/profile_config.mjs: the stored config is already merged (extends) and validated; both scorer and discovery read only such configs */
  resolved?: boolean;
  extends?: string;
  engine?: 'profile' | 'legacy';
  display_name?: string;
  field?: { packs?: string[]; role_families?: string[]; excluded_families?: string[]; title?: { must?: string[]; should?: string[]; avoid?: string[] };
    skills?: { required?: string[]; positive?: string[] }; target_roles?: string[]; duties?: string[] };
  level?: { years?: number; min?: Level; max?: Level };
  place?: PlacePolicy[];
  employment_types?: string[];
  type?: { no_va_placements?: boolean };
  language?: { spoken?: string[] };
  salary?: { floor?: Money; preferred?: Money; /** built-in only: used when the candidate row has no cash floor */ default_floor_inr_monthly?: number; preferred_inr_monthly?: number };
  thresholds?: { qualify?: number; default?: number; tier_size?: number };
  shortlist?: { band_minimums?: Record<string, Record<string, number>>; stretch_needs_home_place?: boolean };
  discovery?: { search_terms?: string[]; countries?: string[]; employer_boards?: { kind: string; slug: string }[]; jobspy_sites?: string[]; max_rows?: number; max_selected?: number };
};

const PHRASE_MAX = 60, LIST_MAX = 40;
function phrases(v: any, what: string, errors: string[], max = LIST_MAX): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) { errors.push(`${what} must be a list of plain phrases`); return []; }
  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? '').trim().replace(/\s+/g, ' ');
    if (s.length < 2 || s.length > PHRASE_MAX) { errors.push(`${what}: "${s.slice(0, 20)}" must be 2 to ${PHRASE_MAX} characters`); continue; }
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > max) errors.push(`${what}: at most ${max} entries`);
  return out.slice(0, max);
}
const code = (c: any) => String(c || '').trim().toUpperCase();
const isCode = (c: string) => /^[A-Z]{2}$/.test(c);
function money(v: any, what: string, errors: string[]): Money | undefined {
  if (v === undefined) return undefined;
  const amount = Number(v?.amount), currency = String(v?.currency || '').toUpperCase(), period = String(v?.period || '').toLowerCase();
  if (!(amount > 0) || !/^[A-Z]{3}$/.test(currency) || !/^(?:year|month|week|day|hour)$/.test(period)) { errors.push(`${what} needs {amount > 0, currency (ISO), period (year/month/week/day/hour)}`); return undefined; }
  return { amount, currency, period };
}
const int = (v: any, lo: number, hi: number) => (v === undefined ? undefined : Math.max(lo, Math.min(hi, Math.round(Number(v)) || lo)));

/** Validates and normalises a config (object or JSON text). Never throws. */
export function parseProfileConfig(raw: unknown): { ok: true; config: ProfileConfig } | { ok: false; errors: string[] } {
  let c: any = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_CONFIG_BYTES) return { ok: false, errors: [`config is over ${MAX_CONFIG_BYTES} bytes`] };
    try { c = JSON.parse(raw); } catch { return { ok: false, errors: ['config is not valid JSON'] }; }
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, errors: ['config must be a JSON object'] };
  if (JSON.stringify(c).length > MAX_CONFIG_BYTES) return { ok: false, errors: [`config is over ${MAX_CONFIG_BYTES} bytes`] };
  const errors: string[] = [];
  if (c.schema !== 1) errors.push('schema must be 1');
  if (c.extends !== undefined && !LEGACY_CONFIGS[String(c.extends)]) errors.push(`extends must be one of ${Object.keys(LEGACY_CONFIGS).join(', ')}`);
  if (c.engine !== undefined && c.engine !== 'profile' && c.engine !== 'legacy') errors.push('engine must be "profile" or "legacy"');
  const out: ProfileConfig = { schema: 1 };
  if (c.extends) out.extends = String(c.extends);
  if (c.resolved === true) out.resolved = true;
  if (c.engine) out.engine = c.engine;
  if (c.display_name !== undefined) out.display_name = String(c.display_name).slice(0, 80);
  const f = c.field || {};
  const packs = phrases(f.packs, 'field.packs', errors, 3);
  for (const p of packs) if (!(FIELD_PACK_KEYS as readonly string[]).includes(p)) errors.push(`field.packs: unknown pack "${p}" (${FIELD_PACK_KEYS.join(', ')})`);
  out.field = { packs, role_families: phrases(f.role_families, 'field.role_families', errors, 10), excluded_families: phrases(f.excluded_families, 'field.excluded_families', errors, 10),
    title: { must: phrases(f.title?.must, 'field.title.must', errors), should: phrases(f.title?.should, 'field.title.should', errors), avoid: phrases(f.title?.avoid, 'field.title.avoid', errors) },
    skills: { required: phrases(f.skills?.required, 'field.skills.required', errors, 20), positive: phrases(f.skills?.positive, 'field.skills.positive', errors) },
    target_roles: phrases(f.target_roles, 'field.target_roles', errors, 20), duties: phrases(f.duties, 'field.duties', errors, 30) };
  if (c.level !== undefined) {
    const l = c.level || {}, lv: any = {};
    if (l.years !== undefined) { const y = Number(l.years); if (!(y >= 0 && y <= 50)) errors.push('level.years must be 0 to 50'); else lv.years = y; }
    for (const k of ['min', 'max']) if (l[k] !== undefined) { if (!(LEVELS as readonly string[]).includes(l[k])) errors.push(`level.${k} must be one of ${LEVELS.join(', ')}`); else lv[k] = l[k]; }
    if (lv.min && lv.max && LEVELS.indexOf(lv.min) > LEVELS.indexOf(lv.max)) errors.push('level.min is above level.max');
    out.level = lv;
  }
  if (c.place !== undefined) {
    if (!Array.isArray(c.place) || !c.place.length || c.place.length > 4) errors.push('place must be a list of 1 to 4 policies');
    else out.place = c.place.map((p: any, i: number) => {
      const w = `place[${i}]`;
      if (p?.policy === 'remote_from_country') {
        const country = code(p.country); if (!isCode(country)) errors.push(`${w}.country must be an ISO code`);
        return { policy: p.policy, country, remote_only: p.remote_only !== false, worldwide_ok: p.worldwide_ok !== false, apac_ok: !!p.apac_ok,
          skip_employers: phrases(p.skip_employers, `${w}.skip_employers`, errors, 20), global_hirer_bonus: !!p.global_hirer_bonus, timezone_penalty: p.timezone_penalty !== false,
          foreign_penalty: p.foreign_penalty !== false, unconfirmed_penalty: p.unconfirmed_penalty !== false, place_words: phrases(p.place_words, `${w}.place_words`, errors, 30),
          ...(p.legacy_skip === true ? { legacy_skip: true } : {}) };
      }
      if (p?.policy === 'onsite_in') {
        const countries = (Array.isArray(p.countries) ? p.countries : []).map(code);
        if (!countries.length || countries.length > 10 || !countries.every(isCode)) errors.push(`${w}.countries must be 1 to 10 ISO codes`);
        return { policy: p.policy, countries, place_words: phrases(p.place_words, `${w}.place_words`, errors, 30) };
      }
      if (p?.policy === 'abroad_with_visa') return { policy: p.policy, gulf_relocation_counts: p.gulf_relocation_counts !== false, uk_sponsor_route: !!p.uk_sponsor_route, cap_unworkable: p.cap_unworkable !== false };
      errors.push(`${w}.policy must be remote_from_country, onsite_in or abroad_with_visa`);
      return null;
    }).filter(Boolean);
  }
  if (c.employment_types !== undefined) {
    const t = (Array.isArray(c.employment_types) ? c.employment_types : []).map((x: any) => String(x).toUpperCase());
    if (!t.length || !t.every((x: string) => (EMPLOYMENT_TYPES as readonly string[]).includes(x))) errors.push(`employment_types must list ${EMPLOYMENT_TYPES.join(', ')}`);
    out.employment_types = t;
  }
  if (c.type !== undefined) out.type = { no_va_placements: !!c.type?.no_va_placements };
  if (c.language !== undefined) out.language = { spoken: phrases(c.language?.spoken, 'language.spoken', errors, 10).map((x) => x.replace(/\b\w/g, (ch) => ch.toUpperCase())) };
  if (c.salary !== undefined) {
    const inr = (v: any, what: string) => { if (v === undefined) return undefined; const n = Number(v); if (!(n > 0 && n < 1e8)) { errors.push(`${what} must be a positive number`); return undefined; } return n; };
    out.salary = { floor: money(c.salary?.floor, 'salary.floor', errors), preferred: money(c.salary?.preferred, 'salary.preferred', errors),
      default_floor_inr_monthly: inr(c.salary?.default_floor_inr_monthly, 'salary.default_floor_inr_monthly'), preferred_inr_monthly: inr(c.salary?.preferred_inr_monthly, 'salary.preferred_inr_monthly') };
  }
  if (c.thresholds !== undefined) {
    const q = c.thresholds?.qualify;
    if (q !== undefined && !(Number(q) >= 40 && Number(q) <= 95)) errors.push('thresholds.qualify must be 40 to 95');
    const dflt = c.thresholds?.default;
    if (dflt !== undefined && !(Number(dflt) >= 40 && Number(dflt) <= 95)) errors.push('thresholds.default must be 40 to 95');
    out.thresholds = { qualify: q === undefined ? undefined : Number(q), default: dflt === undefined ? undefined : Number(dflt), tier_size: int(c.thresholds?.tier_size, 5, 50) };
  }
  if (c.shortlist !== undefined) {
    const bm: Record<string, Record<string, number>> = {};
    for (const [tier, bands] of Object.entries(c.shortlist?.band_minimums || {})) {
      if (tier !== 'READY' && tier !== 'STRETCH_READY') { errors.push('shortlist.band_minimums: tiers are READY and STRETCH_READY'); continue; }
      bm[tier] = {}; for (const [b, n] of Object.entries(bands as any)) bm[tier][String(b).slice(0, 30)] = int(n, 0, 10)!;
    }
    out.shortlist = { band_minimums: bm, ...(typeof c.shortlist?.stretch_needs_home_place === 'boolean' ? { stretch_needs_home_place: c.shortlist.stretch_needs_home_place } : {}) };
  }
  if (c.discovery !== undefined) {
    const d = c.discovery || {};
    const countries = (Array.isArray(d.countries) ? d.countries : []).map(code).filter(isCode).slice(0, 10);
    const boards = (Array.isArray(d.employer_boards) ? d.employer_boards : []).slice(0, 10).map((b: any) => ({ kind: String(b?.kind || '').toLowerCase(), slug: String(b?.slug || '').trim() }))
      .filter((b: any) => { const ok = /^(?:greenhouse|lever|ashby|workable|jazzhr)$/.test(b.kind) && /^[A-Za-z0-9_.-]{2,80}$/.test(b.slug); if (!ok) errors.push('discovery.employer_boards: {kind: greenhouse/lever/ashby/workable/jazzhr, slug}'); return ok; });
    const sites = phrases(d.jobspy_sites, 'discovery.jobspy_sites', errors, 5).map((s) => s.toLowerCase());
    for (const s of sites) if (!(JOBSPY_SITES as readonly string[]).includes(s)) errors.push(`discovery.jobspy_sites: unknown site "${s}"`);
    out.discovery = { search_terms: phrases(d.search_terms, 'discovery.search_terms', errors, 12), countries, employer_boards: boards, jobspy_sites: sites,
      max_rows: int(d.max_rows, 100, 50000), max_selected: int(d.max_selected, 10, 1500) };
  }
  for (const k of [...(out.field.role_families || []), ...(out.field.excluded_families || [])]) if (!FAMILY_CATALOG[k]) errors.push(`field: unknown role family "${k}" (shared/role_families.json)`);
  // a person must have a role rule: a field pack of the built-in fields, role families, title.must or target roles (the dataset prefilter needs it)
  const packsUsed = out.field.packs?.length ? out.field.packs : (out.extends ? ['(extends)'] : ['keyword']);
  if (packsUsed.every((k) => k === 'keyword') && !out.field.role_families?.length && !out.field.title?.must?.length && !out.field.target_roles?.length)
    errors.push('the keyword pack needs role_families, field.title.must or field.target_roles (the role rule of the person)');
  for (const p of out.place || []) for (const cc of (p as any).countries || [(p as any).country]) if (cc && !COUNTRY_NAMES[cc] && !((p as any).place_words || []).length) errors.push(`place: ${cc} has no built-in names; give place_words`);
  return errors.length ? { ok: false, errors } : { ok: true, config: out };
}

/** The effective config: a built-in base (extends) with the person's own fields on top. Field lists add up; the sections level, type, language,
 *  salary, thresholds, shortlist and discovery merge key by key (a key the person sets wins); place and employment_types replace as a whole.
 *  Idempotent: merging an already merged config changes nothing (lists are de-duplicated). */
export function mergedConfig(cfg: ProfileConfig): ProfileConfig {
  const base = cfg.extends ? LEGACY_CONFIGS[cfg.extends] : null;
  if (!base) return cfg;
  const defined = (o: any) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null));
  const out: any = { ...base };
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'field' || v === undefined) continue;
    if (['level', 'type', 'language', 'salary', 'thresholds', 'shortlist', 'discovery'].includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const own = defined(v); if (k === 'language' && !(own as any).spoken?.length) delete (own as any).spoken;
      if (k === 'shortlist' && !Object.keys((own as any).band_minimums || {}).length) delete (own as any).band_minimums;
      out[k] = { ...(base as any)[k], ...own };
    } else if (Array.isArray(v) ? v.length : true) out[k] = v;
  }
  const bf: any = base.field || {}, cf: any = cfg.field || {};
  const cat = (a: any, b: any) => [...(a || []), ...(b || []).filter((x: string) => !(a || []).includes(x))];
  out.field = { ...bf, packs: cf.packs?.length ? cf.packs : bf.packs, role_families: cat(bf.role_families, cf.role_families), excluded_families: cat(bf.excluded_families, cf.excluded_families),
    title: { must: cat(bf.title?.must, cf.title?.must), should: cat(bf.title?.should, cf.title?.should), avoid: cat(bf.title?.avoid, cf.title?.avoid) },
    skills: { required: cat(bf.skills?.required, cf.skills?.required), positive: cat(bf.skills?.positive, cf.skills?.positive) },
    target_roles: cat(bf.target_roles, cf.target_roles), duties: cat(bf.duties, cf.duties) };
  out.engine = cfg.engine ?? base.engine;
  return out;
}
