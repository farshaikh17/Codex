// Which scorer a person gets (dashboard/docs/MULTI_CANDIDATE.md section 5). The old evaluate() stays the default: the profile packs score a
// person only when the candidate row carries a valid profile config (candidate_profile_configs.config, read as `profile_config`) whose engine
// is "profile"; the two built-in ids need that explicitly. PROFILE_ENGINE=off in a script's environment turns the new path off everywhere.
import { evaluate, placeBand, familyOf, EXTRA_FAMILIES, setProfileScorer, type Posting, type EvalContext } from '../discovery.ts';
import { parseProfileConfig, type ProfileConfig } from './schema.ts';
import { resolveProfile, type Profile } from './resolve.ts';
import { evaluateWithProfile } from './evaluate.ts';
import { FIELD_PACKS } from './field_packs.ts';
import { LEGACY_IDS } from './legacy.ts';
import { postingSignals } from './signals.ts';
import { indianPlace, gulfPlace, remoteFromStored, locationClass } from '../discovery.ts';
import { COUNTRY_NAMES, placeRegex } from './countries.ts';

const off = () => { try { return (globalThis as any).process?.env?.PROFILE_ENGINE === 'off'; } catch { return false; } };
const memo = new WeakMap<object, Profile | null>();
const byId = new Map<string, Profile>();

/** The person's config when it is valid and asks for the profile engine; null otherwise (the old path). */
export function engineConfig(cand: any): ProfileConfig | null {
  if (!cand || off() || cand.profile_config == null || cand.profile_config === '') return null;
  const r = parseProfileConfig(cand.profile_config);
  if (!r.ok) return null;
  const engine = r.config.engine ?? (LEGACY_IDS.has(String(cand.id)) ? 'legacy' : 'profile');
  return engine === 'profile' ? r.config : null;
}
/** The resolved profile of a candidate row on the profile engine (memoised per row object), or null. */
export function profileOf(cand: any): Profile | null {
  if (!cand || typeof cand !== 'object') return null;
  if (memo.has(cand)) return memo.get(cand)!;
  const cfg = engineConfig(cand), prof = cfg ? resolveProfile(cand, cfg) : null;
  memo.set(cand, prof);
  if (prof) { byId.set(prof.id, prof); const fam = familiesOf(prof); if (fam.length) EXTRA_FAMILIES.set(prof.id, fam); }
  return prof;
}
/** Registers every profile-engine person in a candidates list (families for familyOf(): shortlist variety and taste). Returns their ids. */
export function registerCandidates(cands: any[]): string[] { return (cands || []).map(profileOf).filter(Boolean).map((p) => p!.id); }
export const registeredProfile = (id: string) => byId.get(id) || null;

/** The scorer every caller uses: the profile packs for a person on the profile engine, otherwise the old evaluate(). */
export function scoreCandidate(cand: any, p: Posting, ctx: EvalContext = {}) {
  const prof = profileOf(cand);
  return prof ? evaluateWithProfile(prof, p, ctx, postingSignals(p)) : evaluate(cand, p, ctx);
}
function familiesOf(prof: Profile): [string, RegExp][] {
  const out: [string, RegExp][] = [];
  for (const k of prof.packs) for (const e of FIELD_PACKS[k]?.families(prof) || []) if (!out.some(([x]) => x === e[0])) out.push(e);
  return out;
}
export function familyFor(cid: string, title: string) { return familyOf(cid, title); }

/** Place band for the shortlist (plan A6). The old placeBand() for everyone not on the profile engine; for a profile person: remote_global
 *  (worldwide, for a remote-only person), remote (open to the home country), home_onsite, gulf, abroad_with_route or other. */
export function bandFor(cid: string, location: string | null | undefined, workplace: string | null | undefined, remote: boolean | null | undefined, description: string | null | undefined) {
  const prof = byId.get(cid);
  if (!prof || prof.home === 'IN') return placeBand(prof ? (prof.remoteOnly ? 'farhan_shaikh' : 'sana_ansari') : cid, location, workplace, remote, description);
  const loc = location || '', text = description || '';
  const words = prof.homes.flatMap((c) => COUNTRY_NAMES[c]?.words || []).concat(...prof.place.map((p: any) => p.place_words || []));
  const re = placeRegex(words), atHome = !!re && re.test(loc);
  if (gulfPlace(loc) && !atHome) return 'gulf';
  if (!!remote || remoteFromStored(workplace, loc)) {
    const lc = locationClass(text, loc);
    if (lc === 'worldwide' || /\b(?:anywhere|worldwide|global)\b/i.test(loc)) return prof.remoteOnly ? 'remote_global' : 'remote';
    if (atHome || (!loc.replace(/\bremote\b/i, '').trim() && lc === 'unknown')) return 'remote';
    return 'other';
  }
  if (atHome) return 'home_onsite';
  if (loc.trim() && /visa sponsorship|sponsorship (?:is )?available|relocation (?:assistance|support|package|provided)/i.test(text)) return 'abroad_with_route';
  return 'other';
}

/** Shortlist settings for one person: tier size, band minimums, and whether an unconfirmed Worth-a-try row needs a home or worldwide place. */
export function shortlistSettings(cid: string): { threshold?: number; tierSize?: number; bandMinimums?: Record<string, Record<string, number>>; homePlaceOk?: (location: string) => boolean } {
  const prof = byId.get(cid);
  if (!prof) return {};
  const words = prof.homes.flatMap((c) => COUNTRY_NAMES[c]?.words || []);
  const re = placeRegex(words);
  return { threshold: prof.threshold, tierSize: prof.tierSize, bandMinimums: prof.bandMinimums,
    homePlaceOk: prof.stretchNeedsHomePlace ? (loc) => (prof.home === 'IN' ? indianPlace(loc) : !!re && re.test(loc || '')) || /\b(?:anywhere|worldwide|global)\b/i.test(loc || '') : undefined };
}

// The Worker's own discovery paths (persist, backfillClient) score through this too (worker/index.ts imports this module).
setProfileScorer(scoreCandidate);
