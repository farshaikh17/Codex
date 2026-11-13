// Plan U3 (phase 5): learning from a person's own marks, gently. Replaces the word-level taste model in the score (engine/signals.py still trains
// it for its report; the score now uses only these rules):
//   * one "Not for me" on a job of the same employer AND the same role family: -2; two or more: -5;
//   * "Good match" or an application at the same employer: +3; in the same role family: +2;
//   * the total stays within -5..+5; reposting sites and titles in no role family ('unclassified') are never adjusted.
// The reason sentence ("Ranked up: ..." / "Ranked down: ...") replaces any earlier one; it is never appended twice.
import { familyOf, companyKey } from '../worker/discovery.ts';
import { isReposter } from './shortlist_select.mjs';

export const TASTE_LIMIT = 5;
const POSITIVE = new Set(['GOOD_MATCH', 'APPLIED', 'SUBMITTED', 'INTERVIEWING', 'OFFER']);
const NEGATIVE = new Set(['NOT_FOR_ME']);
// Every sentence an older or current taste pass may have appended, so it is replaced, never repeated.
const TASTE_SENTENCE = / ?(?:Like roles you (?:saved|dismissed) before\.|Ranked (?:up|down): like jobs you marked [^.]*\.)/g;

/** Per candidate: what they marked, reduced to employer key and role family. rows: [{candidate_id, title, company, label}] */
export function buildMarks(rows) {
  const by = {};
  for (const r of rows || []) {
    const label = String(r?.label || '').toUpperCase();
    const pos = POSITIVE.has(label), neg = NEGATIVE.has(label);
    if (!pos && !neg) continue;
    if (isReposter(r)) continue;
    const m = (by[r.candidate_id] ||= { downs: [], ups: [] });
    (pos ? m.ups : m.downs).push({ employer: companyKey(r.company), family: familyOf(r.candidate_id, r.title || '') });
  }
  return by;
}

/** { adj, sentence } for one job; adj 0 and sentence '' when nothing applies. */
export function tasteAdjust(marks, candidateId, title, company) {
  const m = marks?.[candidateId];
  if (!m) return { adj: 0, sentence: '' };
  if (isReposter({ company })) return { adj: 0, sentence: '' };
  const family = familyOf(candidateId, title || '');
  if (family === 'unclassified') return { adj: 0, sentence: '' };
  const employer = companyKey(company);
  const downs = employer ? m.downs.filter((d) => d.employer === employer && d.family === family).length : 0;
  let adj = downs >= 2 ? -5 : downs === 1 ? -2 : 0;
  const upEmployer = !!employer && m.ups.some((u) => u.employer === employer);
  const upFamily = m.ups.some((u) => u.family === family && u.family !== 'unclassified');
  if (upEmployer) adj += 3;
  if (upFamily) adj += 2;
  adj = Math.max(-TASTE_LIMIT, Math.min(TASTE_LIMIT, adj));
  if (!adj) return { adj: 0, sentence: '' };
  const sentence = adj > 0
    ? `Ranked up: like jobs you marked Good match or applied to${upEmployer ? ' at this employer' : ''}.`
    : 'Ranked down: like jobs you marked Not for me at this employer.';
  return { adj, sentence };
}

/** The reason with any earlier taste sentence removed and the new one (if any) appended once. */
export function withTasteSentence(reason, sentence) {
  const base = String(reason || '').replace(TASTE_SENTENCE, '').trimEnd();
  return sentence ? (base ? `${base} ${sentence}` : sentence) : base;
}
