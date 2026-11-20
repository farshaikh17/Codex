// The role family catalogue (shared/role_families.json): plain title words, search terms and duty phrases per family, compiled once.
import catalog from '../../shared/role_families.json' with { type: 'json' };

export type Family = { key: string; label: string; title: string[]; search: string[]; duties: string[] };
export const FAMILY_CATALOG: Record<string, Family> = Object.fromEntries(
  Object.entries((catalog as any).families as Record<string, any>).map(([key, f]) => [key, { key, label: String(f.label || key), title: f.title || [], search: f.search || [], duties: f.duties || [] }]));

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-phrase, case-insensitive match of any of the plain phrases (the client profiles' phraseRegex rule); null for an empty list. */
export function phrases(words: string[]): RegExp | null {
  const parts = (words || []).map((w) => String(w || '').trim()).filter((w) => w.length >= 2).map((w) => esc(w).replace(/\s+/g, '[\\s-]+'));
  return parts.length ? new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})(?![a-z0-9])`, 'i') : null;
}
const cache = new Map<string, RegExp | null>();
/** phrases(), memoised by the list (a profile's lists are compiled once per process). */
export function phraseRe(words: string[]): RegExp | null {
  const k = (words || []).join('\u0001');
  if (!cache.has(k)) { if (cache.size > 500) cache.clear(); cache.set(k, phrases(words)); }
  return cache.get(k)!;
}
export const familyTitles = (keys: string[]) => (keys || []).flatMap((k) => FAMILY_CATALOG[k]?.title || []);
export const familySearch = (keys: string[]) => (keys || []).flatMap((k) => FAMILY_CATALOG[k]?.search || []);
export const familyDuties = (keys: string[]) => (keys || []).flatMap((k) => FAMILY_CATALOG[k]?.duties || []);
/** [key, title regex] entries for familyOf() (shortlist variety and taste), in the config's order. */
export function familyEntries(keys: string[]): [string, RegExp][] {
  return (keys || []).filter((k) => FAMILY_CATALOG[k]).map((k) => [k, phraseRe(FAMILY_CATALOG[k].title)!] as [string, RegExp]).filter(([, re]) => !!re);
}
