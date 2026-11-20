// A candidate row + its profile config -> the resolved profile every pack reads (dashboard/docs/MULTI_CANDIDATE.md sections 3 and 5).
import { monthlyInr } from '../discovery.ts';
import { type ProfileConfig, type PlacePolicy, type Level, LEVELS, mergedConfig } from './schema.ts';

const list = (s: any): string[] => { try { const v = Array.isArray(s) ? s : JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const DEFAULT_PLACE: PlacePolicy[] = [{ policy: 'onsite_in', countries: ['IN'], place_words: [] }, { policy: 'abroad_with_visa', gulf_relocation_counts: true, uk_sponsor_route: false, cap_unworkable: true }];

export type Profile = ReturnType<typeof resolveProfile>;
export function resolveProfile(cand: any, raw: ProfileConfig) {
  const cfg = mergedConfig(raw);
  const f: any = cfg.field || {};
  const field = { packs: (f.packs?.length ? f.packs : ['keyword']) as string[], role_families: f.role_families || [], excluded_families: f.excluded_families || [],
    title: { must: f.title?.must || [], should: f.title?.should || [], avoid: f.title?.avoid || [] },
    skills: { required: f.skills?.required || [], positive: f.skills?.positive || [] }, target_roles: f.target_roles || [], duties: f.duties || [] };
  const ownSkills = list(cand?.primary_skills), ownTargets = list(cand?.target_roles);
  const skills = [...ownSkills, ...field.skills.positive.filter((s: string) => !ownSkills.some((o) => o.toLowerCase() === s.toLowerCase()))];
  const targetList = [...ownTargets, ...field.target_roles.filter((t: string) => !ownTargets.includes(t))];
  const place = (cfg.place?.length ? cfg.place : DEFAULT_PLACE) as PlacePolicy[];
  const first: any = place[0];
  const home = String(first.country || first.countries?.[0] || 'IN');
  const homes = [...new Set(place.flatMap((p: any) => (p.country ? [p.country] : p.countries || [])))] as string[];
  const toInr = (m: any) => (m ? monthlyInr({ min: m.amount, max: m.amount, currency: m.currency, period: m.period })?.hi || 0 : 0);
  const floor = cfg.salary?.floor ? toInr(cfg.salary.floor) : Number(cand?.cash_floor_inr_monthly) || cfg.salary?.default_floor_inr_monthly || 0;
  const preferred = cfg.salary?.preferred ? toInr(cfg.salary.preferred) : cfg.salary?.preferred_inr_monthly || 0;
  const remoteOnly = place.some((p) => p.policy === 'remote_from_country' && p.remote_only !== false);
  const types = cfg.employment_types?.length ? cfg.employment_types : ['FULL_TIME', 'CONTRACT'];
  return {
    id: String(cand?.id || ''), cand, cfg, field, packs: field.packs,
    // the raw value the old rules read (they call list() on it); the same list when the config adds nothing
    targets: field.target_roles.length ? targetList : (cand?.target_roles ?? []), targetList, skills, skillCount: skills.length,
    years: cfg.level?.years ?? (Number(cand?.total_years_experience) || 0),
    levelMin: (cfg.level?.min ?? null) as Level | null, levelMax: (cfg.level?.max ?? 'director') as Level,
    place, home, homes, remoteOnly, floor, preferred,
    threshold: cfg.thresholds?.qualify ?? (Number(cand?.qualification_threshold) || cfg.thresholds?.default || 60),
    tierSize: cfg.thresholds?.tier_size ?? 25,
    allowGig: types.includes('PART_TIME') || types.includes('FREELANCE'), vaRule: !!cfg.type?.no_va_placements,
    spoken: (cfg.language?.spoken?.length ? cfg.language.spoken : ['English']).map((x) => x.toLowerCase()),
    bandMinimums: cfg.shortlist?.band_minimums || {}, stretchNeedsHomePlace: cfg.shortlist?.stretch_needs_home_place ?? remoteOnly,
    apacOk: place.some((p: any) => p.policy === 'remote_from_country' && p.apac_ok),
    required: field.skills.required as string[],
  };
}
export const levelRank = (l: Level | null) => (l ? LEVELS.indexOf(l) : -1);
