// PLACE policies (dashboard/docs/MULTI_CANDIDATE.md section 4.2), combinable: remote_from_country, onsite_in, abroad_with_visa. With the home
// country India they are the Worker's own readings (evaluate() in worker/discovery.ts, branch for branch); another country is read from its
// names and ISO code (countries.ts) and the config's place_words.
import {
  usOnlyLocation, locationClass, foreignLocation, foreignPlaceInPosting, remoteCountryByText, rightToWorkAbroad, indianPlace, abroadByDescription,
  COUNT_LOCATION, trailingCountryCode, bareForeignCode, gulfPlace, textLocation, titlePlaces, SANA_INDIA_ONSITE_REASON, RULE_PARTS,
  usRemoteByText, AGGREGATOR_SOURCE, officePlace, officeByPlaceText, sanaAbroadUnread,
} from '../discovery.ts';
import type { Signals } from './signals.ts';
import { FULLY_REMOTE } from './signals.ts';
import type { Profile } from './resolve.ts';
import type { PlacePolicy } from './schema.ts';
import { COUNTRY_NAMES, EU_CODES, GULF_CODES, countryName, placeRegex } from './countries.ts';

/** The places of the old "X only" list as ISO codes ('EU' for the EU / Europe), compared with the person's home country. */
export const BLOCK_ISO: Record<string, string> = { us: 'US', usa: 'US', 'u.s.': 'US', 'united states': 'US', uk: 'GB', 'united kingdom': 'GB', canada: 'CA', europe: 'EU', eu: 'EU', germany: 'DE', australia: 'AU' };
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Readings of the posting against one home country (not India). */
function home(s: Signals, code: string, extra: string[] = []) {
  const re = placeRegex([...(COUNTRY_NAMES[code]?.words || []), ...extra]);
  // 'US' / 'USA' in capitals only (the word 'us' in a sentence is not the country)
  const named = (x: string) => (!!re && re.test(x || '')) || (code === 'US' && /(?:^|[^A-Za-z0-9.])(?:US|USA)(?![A-Za-z0-9.])/.test(x || ''));
  const loc = s.p.location || '';
  const codeAt = (trailingCountryCode(loc) === code) || (bareForeignCode(loc) && loc.trim().slice(0, 2).toUpperCase() === code);
  const inHome = named(loc) || codeAt;
  const foreignFor = (x: string) => !!String(x || '').trim() && !named(x) && (foreignLocation(x) || indianPlace(x) || gulfPlace(x));
  const textHome = named(s.desc);
  const words = (COUNTRY_NAMES[code]?.words || []).concat(extra).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const explicitRemote = (inHome && (s.remote || FULLY_REMOTE.test(s.desc))) || (!!words && new RegExp(`\\b(remote (?:in|from|within|[-–]) (?:${words})|(?:${words})[- ]remote)\\b`, 'i').test(s.text))
    || (named(textLocation(s.desc)) && /\b(?:remote|work from home|wfh)\b/i.test(textLocation(s.desc))) || (s.remote && titlePlaces(s.p.title).some(named));
  // the old "X only" list, minus the home country itself
  let blocked = false; const g = new RegExp(/\b(us|usa|u\.s\.|united states|uk|united kingdom|canada|europe|eu|germany|australia)\s+(?:residents?\s+)?only\b|must (?:reside|be based|be located) in (?:the )?(us|usa|united states|uk|europe)/.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = g.exec(s.text))) { const iso = BLOCK_ISO[(m[1] || m[2] || '').toLowerCase()] || ''; const mine = iso === code || (iso === 'EU' && (EU_CODES.has(code) || code === 'GB' || code === 'CH')); if (!mine) { blocked = true; break; } }
  if (!blocked && !!words && new RegExp(`not hiring (?:in|from) (?:${words})|excluding (?:${words})|except (?:${words})`, 'i').test(s.text)) blocked = true;
  const reach = new RegExp(`\\b(?:worldwide|anywhere|global(?:ly)?|international(?:ly)?|any country${words ? '|' + words : ''})\\b`, 'i');
  return { named, inHome, foreignFor, textHome, explicitRemote, blocked, reach, name: countryName(code) };
}

export type Eligibility = { eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN'; reason: string };
type Verdict = { v: 'ELIGIBLE' | 'INELIGIBLE' | null; reason?: string; hard?: boolean };

function remoteFromCountry(s: Signals, p: Extract<PlacePolicy, { policy: 'remote_from_country' }>, globalRemote: boolean): Verdict {
  const t = s.p, loc = t.location || '', d = s.desc;
  // a place restriction (another country only, US / EU only, right to work elsewhere) rules the job out for anyone; "not remote" and office days
  // only for a remote-only person (with remote_only false an on-site policy may still take the job)
  const ineligible = (reason: string): Verdict => ({ v: p.remote_only === false && /^(?:Not a remote role|Hybrid or set office days)/.test(reason) ? null : 'INELIGIBLE', reason, hard: true });
  const skip = p.legacy_skip ? RULE_PARTS.FARHAN_SKIP_EMPLOYER : (p.skip_employers || []).length ? new RegExp(`^\\s*(?:${p.skip_employers!.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null;
  if (p.country === 'IN') {
    const explicit = s.explicitIndiaRemote;
    const remoteSignal = s.remote || explicit || globalRemote || /\b(fully remote|100% remote|remote[- ]first|remote position|remote role|work from anywhere)\b/i.test(d);
    if (s.blocked) return ineligible('Posting explicitly restricts work location outside India.');
    if (skip && skip.test(t.company || '')) return ineligible('Employer the candidate asked to skip.');
    if (usRemoteByText(t.description) && !s.lineIndiaRemote && !s.titleIndiaRemote && !(indianPlace(t.location) && !AGGREGATOR_SOURCE.test(String(t.source || '').trim()))) return ineligible('Remote within another country only (the posting\'s text says so), not from India.');
    if (!remoteSignal || officePlace(t.location)) return ineligible('Not a remote role (candidate rule: remote only).');
    if (s.officeDays || officeByPlaceText(t.description)) return ineligible('Hybrid or set office days (candidate rule: remote only).');
    if (!explicit && !globalRemote && usOnlyLocation(t.location)) return ineligible('Remote within the United States only.');
    if (!explicit && !globalRemote && s.locClass === 'eu_only') return ineligible('Must be based in the EU or EEA (the posting says so).');
    if (!explicit && !globalRemote && s.foreign && !RULE_PARTS.OPEN_PLACE_WORDS.test(loc) && !RULE_PARTS.INDIA_HIRING_TEXT.test(d) && !['worldwide', 'india_ok'].includes(s.locClass)) return ineligible('Remote within another country or region only, not from India.');
    if (!explicit && s.globalRemoteWords && !s.worldLocation && !(p.apac_ok && s.asiaLocation) && s.foreign && !RULE_PARTS.OPEN_PLACE_WORDS.test(loc) && !RULE_PARTS.INDIA_HIRING_TEXT.test(d)) return { v: null, reason: 'The text says work from anywhere, but this copy\'s place names only another country, so remote from India is not confirmed.', hard: true };
    if (!explicit && !globalRemote && !s.foreign && foreignPlaceInPosting(t.title, t.description) && !RULE_PARTS.INDIA_HIRING_TEXT.test(d)) return ineligible('Remote within another country only (the title or the posting\'s Location line names it), not from India.');
    if (!explicit && !globalRemote && !s.foreign && remoteCountryByText(t.description)) return ineligible('Remote within another country only (the posting\'s text says so), not from India.');
    if (!explicit && !globalRemote && !RULE_PARTS.INDIA_HIRING_TEXT.test(d) && rightToWorkAbroad(t.description)) return ineligible('Open only to people based in or allowed to work in another country (the posting says so), not from India.');
    if (explicit && !/\b(hybrid|on[- ]site)\b/i.test(loc) && !/\b(not remote|no remote)\b/i.test(d)) return { v: 'ELIGIBLE', reason: 'Posting explicitly supports fully remote work from India.' };
    if (globalRemote && p.worldwide_ok !== false) return { v: 'ELIGIBLE', reason: 'Posting explicitly advertises worldwide remote work.' };
    return { v: null };
  }
  const h = home(s, p.country, p.place_words);
  const explicit = h.explicitRemote, name = h.name;
  const remoteSignal = s.remote || explicit || globalRemote || /\b(fully remote|100% remote|remote[- ]first|remote position|remote role|work from anywhere)\b/i.test(d);
  const open = (x: string) => /\b(?:worldwide|anywhere|global)\b/i.test(x) || h.named(x);
  if (h.blocked) return ineligible(`Posting explicitly restricts work location outside ${name}.`);
  if (skip && skip.test(t.company || '')) return ineligible('Employer the candidate asked to skip.');
  if (p.country !== 'US' && usRemoteByText(t.description) && !h.textHome) return ineligible(`Remote within another country only (the posting's text says so), not from ${name}.`);
  if (!remoteSignal || officePlace(t.location)) return ineligible('Not a remote role (candidate rule: remote only).');
  if (s.officeDays || officeByPlaceText(t.description)) return ineligible('Hybrid or set office days (candidate rule: remote only).');
  if (!explicit && !globalRemote && p.country !== 'US' && usOnlyLocation(t.location)) return ineligible('Remote within the United States only.');
  if (!explicit && !globalRemote && !EU_CODES.has(p.country) && s.locClass === 'eu_only') return ineligible('Must be based in the EU or EEA (the posting says so).');
  if (!explicit && !globalRemote && h.foreignFor(loc) && !open(loc) && !h.textHome && !['worldwide'].includes(s.locClass)) return ineligible(`Remote within another country or region only, not from ${name}.`);
  const textPlaces = [textLocation(t.description), ...titlePlaces(t.title)].filter(Boolean);
  if (!explicit && !globalRemote && !h.foreignFor(loc) && textPlaces.some((x) => !open(x) && h.foreignFor(x)) && !h.textHome) return ineligible(`Remote within another country only (the title or the posting's Location line names it), not from ${name}.`);
  if (!explicit && !globalRemote && p.country !== 'US' && !h.textHome && remoteCountryByText(t.description)) return ineligible(`Remote within another country only (the posting's text says so), not from ${name}.`);
  if (!explicit && !globalRemote && !h.textHome && rightToWorkAbroad(t.description, { gulfOk: GULF_CODES.has(p.country) })) return ineligible(`Open only to people based in or allowed to work in another country (the posting says so), not from ${name}.`);
  if (explicit && !/\b(hybrid|on[- ]site)\b/i.test(loc) && !/\b(not remote|no remote)\b/i.test(d)) return { v: 'ELIGIBLE', reason: `Posting explicitly supports fully remote work from ${name.replace(/^the /, '')}.` };
  if (globalRemote && p.worldwide_ok !== false) return { v: 'ELIGIBLE', reason: 'Posting explicitly advertises worldwide remote work.' };
  return { v: null };
}

function onsiteIn(s: Signals, p: Extract<PlacePolicy, { policy: 'onsite_in' }>): Verdict {
  for (const c of p.countries) {
    if (c === 'IN') { if (s.india) return s.remote ? { v: 'ELIGIBLE', reason: 'Remote role in India.' } : { v: 'ELIGIBLE', reason: SANA_INDIA_ONSITE_REASON }; continue; }
    const h = home(s, c, p.place_words);
    if (h.inHome) return s.remote ? { v: 'ELIGIBLE', reason: `Remote role in ${h.name.replace(/^the /, 'the ')}.` } : { v: 'ELIGIBLE', reason: `${cap1('on-site or hybrid')} in ${h.name}: workable for the candidate.` };
  }
  return { v: null };
}

function abroadWithVisa(s: Signals, p: Extract<PlacePolicy, { policy: 'abroad_with_visa' }>, prof: Profile, globalRemote: boolean, reason: string): Verdict & { reason: string } {
  const blocked = prof.home === 'IN' ? s.blocked : home(s, prof.home).blocked;
  const from = prof.home === 'IN' ? 'India' : countryName(prof.home).replace(/^the /, 'the ');
  if (!blocked && (((s.visaRoute || (s.sponsorship && s.gulf && p.gulf_relocation_counts !== false)) && !s.noVisaRoute) || globalRemote))
    return { v: 'ELIGIBLE', reason: (s.visaRoute || s.sponsorship) && !s.noVisaRoute ? 'Posting affirmatively mentions sponsorship/relocation; eligibility still requires review.' : 'Posting explicitly advertises worldwide remote work.' };
  if (!blocked && s.sponsorship && !s.noVisaRoute) return { v: null, reason: `Offers relocation, but no visa route from ${from} is stated. ` + reason };
  return { v: null, reason };
}

/** Eligibility from the person's place policies combined: the first eligible verdict wins, then a remote-only policy's ineligibility, else unknown. */
export function placeEligibility(s: Signals, prof: Profile, globalRemote: boolean): Eligibility {
  let reason = 'No affirmative candidate-specific location evidence.', hard: Verdict | null = null;
  for (const pol of prof.place) {
    let v: Verdict;
    if (pol.policy === 'remote_from_country') v = remoteFromCountry(s, pol, globalRemote);
    else if (pol.policy === 'onsite_in') v = onsiteIn(s, pol);
    else { const r = abroadWithVisa(s, pol, prof, globalRemote, reason); reason = r.reason; v = { v: r.v, reason: r.v ? r.reason : undefined }; }
    if (v.v === 'ELIGIBLE') return { eligibility: 'ELIGIBLE', reason: v.reason! };
    if (v.hard && !hard) hard = v;
  }
  if (hard?.v === 'INELIGIBLE') return { eligibility: 'INELIGIBLE', reason: hard.reason! };
  if (hard?.reason) reason = hard.reason;
  return { eligibility: 'UNKNOWN', reason };
}

/** The place-policy score changes (bonuses, penalties and caps), in the order evaluate() applies them. */
export function placeAdjust(s: Signals, prof: Profile, ctx: any, o: { role: boolean; eligibility: string; globalRemote: boolean }) {
  const t = s.p, loc = t.location || '';
  const rfc = prof.place.filter((p) => p.policy === 'remote_from_country') as Extract<PlacePolicy, { policy: 'remote_from_country' }>[];
  const avw = prof.place.find((p) => p.policy === 'abroad_with_visa') as Extract<PlacePolicy, { policy: 'abroad_with_visa' }> | undefined;
  const homeIn = prof.home === 'IN';
  const h = homeIn ? null : home(s, prof.home, (prof.place[0] as any).place_words);
  const foreignHome = homeIn ? s.foreign : h!.foreignFor(loc);
  const atHome = homeIn ? s.india : (h!.inHome || prof.homes.some((c) => c !== prof.home && home(s, c).inHome));
  const explicitHome = homeIn ? s.explicitIndiaRemote : h!.explicitRemote;
  const globalHirer = rfc.some((p) => p.global_hirer_bonus) && o.eligibility !== 'INELIGIBLE' && !!s.key && !!ctx.globalHirers?.has(s.key);
  const tzRestricted = rfc.some((p) => p.timezone_penalty) && o.eligibility !== 'INELIGIBLE' && s.locClass === 'timezone';
  const ukSponsor = !!avw?.uk_sponsor_route && !!s.key && !!ctx.ukSponsors?.has(s.key) && /\b(uk|united kingdom|england|scotland|wales|london|manchester|birmingham|leeds|glasgow|edinburgh)\b/i.test(loc);
  const route = s.visaRoute && !s.noVisaRoute, gulfOk = !!avw && avw.gulf_relocation_counts !== false && s.gulf;
  let visaUnlikely = false, unworkable = false, rtwElsewhere = false;
  if (avw && avw.cap_unworkable !== false) {
    if (homeIn) {
      visaUnlikely = !route && !ukSponsor && (s.foreign || s.indiana || abroadByDescription(t.location, t.description) || (!!s.lang && !s.india && !indianPlace(t.location))) && !s.gulf && (!s.remote || (!s.explicitIndiaRemote && !o.globalRemote));
      const unreadPlace = !!String(loc).trim() && !s.india && !indianPlace(t.location) && !s.gulf && !s.foreign && !COUNT_LOCATION.test(loc);
      unworkable = !visaUnlikely && !route && !ukSponsor && !s.gulf && !s.india
        && ((s.remote && !s.explicitIndiaRemote && !o.globalRemote && !RULE_PARTS.SANA_REMOTE_REACH.test(s.text)) || (!s.remote && unreadPlace && (usOnlyLocation(t.location) || abroadByDescription('', t.description) || sanaAbroadUnread(t.location, t.description, t.company, t.source)))
          || (!s.remote && !String(loc).trim() && sanaAbroadUnread('', t.description, t.company, t.source)));
      rtwElsewhere = !s.india && !indianPlace(t.location) && !s.gulf && !s.explicitIndiaRemote && !((s.visaRoute || s.sponsorship) && !s.noVisaRoute) && rightToWorkAbroad(t.description, { gulfOk: true });
    } else {
      visaUnlikely = !route && !(ukSponsor && prof.home !== 'GB') && (foreignHome || (!!s.lang && !atHome && !prof.spoken.includes(s.lang.toLowerCase()))) && !gulfOk && !atHome && (!s.remote || (!explicitHome && !o.globalRemote));
      unworkable = !visaUnlikely && !route && !gulfOk && !atHome && s.remote && !explicitHome && !o.globalRemote && !h!.reach.test(s.text);
      rtwElsewhere = !atHome && !explicitHome && !((s.visaRoute || s.sponsorship) && !s.noVisaRoute) && !h!.textHome && rightToWorkAbroad(t.description, { gulfOk: !!gulfOk });
    }
  }
  const unconfirmed = rfc.some((p) => p.unconfirmed_penalty) && o.role && o.eligibility === 'UNKNOWN' && !foreignHome && !(homeIn ? RULE_PARTS.HIRING_REACH.test(s.text) : h!.reach.test(s.text));
  const foreignOnly = rfc.some((p) => p.foreign_penalty) && o.eligibility !== 'ELIGIBLE' && !globalHirer && foreignHome;
  const from = homeIn ? 'India' : countryName(prof.home).replace(/^the /, 'the ');
  return { globalHirer, tzRestricted, ukSponsor, visaUnlikely, unworkable, rtwElsewhere, unconfirmed, foreignOnly, from, homeName: homeIn ? 'India' : countryName(prof.home) };
}
