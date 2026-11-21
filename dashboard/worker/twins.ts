// The same job listed many times in "To review" (jobs QA 13 Nov: one reposted job in six countries, one employer's opening four times). The job
// seeker's To review lists and their counts show one row per employer and title (titleKey: the title without bracketed parts and trailing place or
// work-mode parts, as the shortlist compares titles), the best-scored one, with the other places as a note. Rows are only hidden from those lists;
// nothing stored changes. The shortlist (scripts/shortlist_select.mjs) uses the same titleKey.
import { companyKey, indianPlace, gulfPlace, foreignLocation } from './discovery.ts';

const MODE_SEG = /^\s*(?:remote|hybrid|on-?site|onsite|wfh|work from home|anywhere|worldwide|global|apac|emea|asia|latam)\b/i;
const placeSeg = (seg: string) => MODE_SEG.test(seg) || indianPlace(seg) || gulfPlace(seg) || foreignLocation(seg);
/** A title compared without bracketed parts and trailing place or work-mode parts ("Solutions Engineer (Remote)", "Maintenance Engineer - Jamnagar"). */
export function titleKey(title: string | null | undefined) {
  const parts = String(title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s+[-–—|]\s+|,\s*/).filter((x) => x.trim());
  while (parts.length > 1 && placeSeg(parts[parts.length - 1])) parts.pop();
  return parts.join(' ').toLowerCase().replace(/\b(?:remote|hybrid|on-?site|onsite|wfh)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Employer and title: the To review twin key. */
export function reviewKey(company: string | null | undefined, title: string | null | undefined) {
  return (companyKey(company) || String(company || '').trim().toLowerCase()) + '|' + titleKey(title);
}
export type TwinRow = { id: string; title: string | null; company: string | null; location?: string | null; score?: number | null; found?: string | null; unscreened?: number | boolean | null;
  key?: string };   // key: reviewKey(company, title) when the caller already has it (worker/snapshot.ts)
export type Twins = { hidden: string[]; groups: number; places: Map<string, { more: number; places: string[] }> };
/** Groups To review rows by reviewKey. The kept row is the best score (then the newest, then the smallest id); the others are hidden. A row the
 *  screen has not judged yet is never grouped. `places` gives, per kept row, how many were hidden and up to three of their places. */
export function collapseTwins(rows: TwinRow[]): Twins {
  const byKey = new Map<string, TwinRow[]>();
  let single = 0;
  for (const r of rows) {
    if (Number(r.unscreened)) { single++; continue; }
    const k = r.key ?? reviewKey(r.company, r.title);
    const g = byKey.get(k);
    if (g) g.push(r); else byKey.set(k, [r]);
  }
  const hidden: string[] = [], places = new Map<string, { more: number; places: string[] }>();
  for (const g of byKey.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(b.found || '').localeCompare(String(a.found || '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const [keep, ...rest] = g;
    for (const r of rest) hidden.push(r.id);
    const seen = new Set([String(keep.location || '').trim().toLowerCase()]), list: string[] = [];
    for (const r of rest) { const l = String(r.location || '').trim(); if (l && !seen.has(l.toLowerCase()) && list.length < 3) { seen.add(l.toLowerCase()); list.push(l); } }
    places.set(keep.id, { more: rest.length, places: list });
  }
  return { hidden, groups: byKey.size + single, places };
}
/** Today's sections in page order (Best matches, Worth a try, New good matches): a row is left out of a section when a twin (same reviewKey) is
 *  already shown in an earlier section (live QA 17 Nov: one employer's opening in Best matches and again under the new good matches). Sections
 *  listed in `collapse` also keep only their first row per key (the lists come best-scored first). Rows are only left out; nothing stored changes. */
export function sectionsWithoutTwins<T extends { company?: string | null; title?: string | null }>(sections: T[][], collapse: boolean[] = []): T[][] {
  const shown = new Set<string>();
  return sections.map((rows, i) => {
    const mine = new Set<string>(), kept: T[] = [];
    for (const r of rows) {
      const k = reviewKey(r.company, r.title);
      if (shown.has(k) || (collapse[i] && mine.has(k))) continue;
      mine.add(k); kept.push(r);
    }
    for (const k of mine) shown.add(k);
    return kept;
  });
}
