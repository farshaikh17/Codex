// What a posting says, read once and shared by every person scored on it (dashboard/docs/MULTI_CANDIDATE.md section 4). These readings are
// the person-independent part of evaluate() in worker/discovery.ts, with the same expressions; the inline ones are copied here and
// test/profiles_equivalence.test.mjs fails when the two drift apart.
import {
  type Posting, indianaPlace, sanaIndiaCity, onsiteByText, textLocation, indianPlace, titlePlaces, gulfPlace, foreignLocation, usOnlyLocation,
  languageRequired, languageHardRequired, gigEngagement, locationClass, agencyPosting, companyKey, mixedTitle, internalOnly, RULE_PARTS,
} from '../discovery.ts';

export type Signals = ReturnType<typeof postingSignals>;
const SPONSOR = /visa sponsorship|sponsorship available|relocation assistance|relocation provided|international applicants welcome/;
const VISA_HEDGED = /\bvisa sponsorship (?:will|may|can|could|might) be (?:discussed|considered|reviewed|evaluated|assessed)\b|\bsponsorship (?:is |will be |may be )?(?:considered |assessed |reviewed )?(?:on a )?case[- ]by[- ]case\b/i;
const NO_VISA_WORDS = /\b(?:not|never|cannot|unable to)\b[^.!?]{0,60}\b(?:applicants?|candidates?|individuals?|anyone)\b[^.!?]{0,40}?\b(?:who|that)\s+(?:will\s+)?(?:now or in the future\s+)?(?:requires?|needs?)\s+(?:(?:visa|immigration|employment)\s+)?sponsorship|\b(?:unable|not able|cannot|can't|will not|won't|do not|does not|don't|doesn't|not)\b[^.!?]{0,40}\b(?:provide|offer|sponsor|support)\b[^.!?]{0,30}\b(?:visa|work (?:permit|authori[sz]ation)|sponsorship)|\bwithout (?:the )?(?:need for |requiring )?(?:current or future |future or current )?(?:visa )?sponsorship|\bno (?:visa )?sponsorship (?:is |will be )?(?:available|offered|provided)|\bsponsorship\b(?:\s*\([^)]{0,80}\))?\s+(?:is|will)\s+not\s+(?:be\s+)?(?:available|offered|provided)/i;
export const BLOCKED_RE = /\b(us|usa|u\.s\.|united states|uk|united kingdom|canada|europe|eu|germany|australia)\s+(?:residents?\s+)?only\b|must (?:reside|be based|be located) in (?:the )?(?:us|usa|united states|uk|europe)|not hiring (?:in|from) india|excluding india|except india/i;
export const FULLY_REMOTE = /\b(fully remote|100% remote|remote position|remote role)\b/i;

export function postingSignals(p: Posting) {
  const text = `${p.title} ${p.location} ${p.description}`, lower = text.toLowerCase();
  const negated = (pattern: RegExp) => { const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'); let m: RegExpExecArray | null; while ((m = g.exec(lower))) { const before = lower.slice(Math.max(0, m.index - 55), m.index), after = lower.slice(m.index + m[0].length, m.index + m[0].length + 45); if (/\b(no|not|without|unavailable|unable|never|cannot|can't|won't|isn't|aren't|doesn't|don't|no longer)\b[^.!?]*$/.test(before) || /^\s+(?:(?:is |are |will be )?(?:not|no longer|never|unavailable|unsupported)|isn't|aren't|won't be|will not be)\b/.test(after)) return true; } return false; };
  const indiana = indianaPlace(p.location, p.description, p.source, p.url), india = sanaIndiaCity(p.location) && !indiana;
  const onsiteText = onsiteByText(p.description);
  const remote = (p.remote && !onsiteText) || /\b(remote|work from home|telecommut)/i.test(p.location);
  const locLine = textLocation(p.description), lineIndiaRemote = indianPlace(locLine) && /\b(?:remote|work from home|wfh)\b/i.test(locLine);
  const titleIndiaRemote = remote && titlePlaces(p.title).some((x) => indianPlace(x));
  const explicitIndiaRemote = lineIndiaRemote || titleIndiaRemote || india && (remote || FULLY_REMOTE.test(p.description)) || /\b(remote (?:in|from|within|[-–]) india|india[- ]remote|hiring (?:remote workers|remotely) (?:in|from) india)\b/i.test(text);
  const blocked = BLOCKED_RE.test(text);
  const offerText = text.replace(RULE_PARTS.EMPTY_FORM_FIELD, ' ');   // jobs QA 7: an empty application-form label offers nothing
  const security = /\b(?:active |must (?:have|hold) )?(?:secret|top secret) clearance|ts\/sci|\bitar\b|\b(?:us|uk) citizen(?:ship)? (?:only|required)\b/i.test(text);
  const sponsorship = new RegExp(`\\b(${SPONSOR.source})\\b`, 'i').test(offerText) && !/\brelocation(?: assistance)?(?: provided| available| offered| eligible)?\s*[:\-–]\s*no\b/i.test(offerText) && !negated(SPONSOR);
  const visaRoute = /\b(visa sponsorship|sponsorship available|sponsor (?:your |a |the )?(?:work )?visa|work permit (?:support|sponsorship|provided)|international applicants welcome|employment visa (?:is |will be )?provided)\b/i.test(offerText) && !negated(/visa sponsorship|sponsorship available|sponsor (?:your |a |the )?(?:work )?visa|work permit|international applicants welcome|employment visa/) && !VISA_HEDGED.test(offerText);
  const gulf = gulfPlace(p.location);
  const nationalsOnly = RULE_PARTS.NATIONALS_TITLE.test(p.title || '') || RULE_PARTS.NATIONALS_TEXT.test(p.description || '');
  const noVisaRoute = NO_VISA_WORDS.test(text) || /\b(?:visa\s+)?sponsorship(?:\s+(?:available|offered|provided))?\s*[:\-–]\s*no\b/i.test(text);
  const globalRemoteWords = /\bworldwide\W{0,6}remote|\bremote\W{0,6}worldwide|remote.?global|work from anywhere in the world/i.test(text);
  const locOnly = p.location || '', placeFree = !foreignLocation(locOnly) && !usOnlyLocation(locOnly) && !indianPlace(locOnly);
  const worldLocation = placeFree && (remote || /\b(?:anywhere|worldwide)\b/i.test(locOnly)) && /\b(?:anywhere|worldwide|global|fully remote)\b/i.test(locOnly);
  const asiaLocation = remote && placeFree && /\b(?:apac|asia)\b/i.test(locOnly) && !/\b(?:south[- ]?east|east|central|west(?:ern)?) asia\b/i.test(locOnly);
  const officeDays = onsiteText || (() => { const re = /\b(?:this|the)\s+(?:role|position|job)\s+is\s+hybrid\b|\bhybrid\s+(?:role|position|job)\b|\(hybrid\)|\b\d\s*(?:-\s*\d\s*)?days?\s+(?:a|per)\s+week\s+in\s+(?:the|our)\s+(?:\w+\s+)?office/gi; const d = String(p.description || '').toLowerCase(); let m: RegExpExecArray | null; while ((m = re.exec(d))) { const before = d.slice(Math.max(0, m.index - 40), m.index); if (!/\b(?:no|not|never|isn't|without)\b[^.!?]*$/.test(before)) return true; } return false; })();
  const desc = String(p.description || '');
  return {
    p, text, lower, desc, descLen: desc.length, internal: internalOnly(p.description), lineIndiaRemote, titleIndiaRemote, indiana, india, onsiteText, remote, explicitIndiaRemote, blocked, security, sponsorship, visaRoute, gulf,
    nationalsOnly, noVisaRoute, globalRemoteWords, worldLocation, asiaLocation, officeDays,
    foreign: foreignLocation(p.location), usOnly: usOnlyLocation(p.location), locClass: locationClass(p.description || '', p.location || ''),
    lang: languageRequired(p.title || '', p.description || ''), langHard: languageHardRequired(p.title, p.description), gig: gigEngagement(p.title, p.description),
    agency: agencyPosting(p.company || '', p.description || ''), key: companyKey(p.company), mixed: mixedTitle(p.title), reposted: !!(p as any).repost,
    nationalsPreferred: RULE_PARTS.NATIONALS_PREFERENCE.test(text),
  };
}
