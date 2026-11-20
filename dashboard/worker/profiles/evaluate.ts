// evaluateWithProfile(): the screen for a person described by a profile config (dashboard/docs/MULTI_CANDIDATE.md section 4). The same
// steps, in the same order, with the same numbers as evaluate() in worker/discovery.ts; every person-specific branch there is a pack or a
// parameter here. Returns exactly evaluate()'s shape.
import {
  type Posting, type EvalContext, skillFound, yearsRequired, yearsCeiling, underLevel, platformGap, exactWithQualifier, dutyAdjust, spreadBonus, farhanAssistantGig,
  RULE_PARTS, EXPERIENCE_OVER_PENALTY, EXPERIENCE_MATCH_BONUS, PLAIN_CEILING, SCORE_CEILING, TARGET_EXACT_BONUS, TARGET_WORD_BONUS, SENIORITY_BONUS,
  PAY_BELOW_FLOOR_PENALTY, PAY_PREFERRED_BONUS, GLOBAL_HIRER_BONUS, YC_BONUS, TIMEZONE_PENALTY, AGENCY_PENALTY, LANGUAGE_PENALTY, MIXED_TITLE_PENALTY,
  VISA_UNLIKELY_CAP, NATIONALS_PREFERENCE_CAP, ELECTRICAL_ONLY_PENALTY, DESIGN_ONLY_PENALTY, DESIGN_ONLY_HEADROOM, AVOID_TITLE_CAP, PLATFORM_GAP_CAP,
  sanaElectricalMaintenance, UNDER_LEVEL_CAP, FAR_ABOVE_GAP, LANGUAGE_HARD_GAP, INDIA_UNCONFIRMED_PENALTY, FOREIGN_LOCATION_PENALTY, monthlyInr,
} from '../discovery.ts';
import { postingSignals, type Signals } from './signals.ts';
import { FIELD_PACKS } from './field_packs.ts';
import { placeEligibility, placeAdjust } from './place.ts';
import { GULF_CODES } from './countries.ts';
import { phraseRe } from './families.ts';
import { levelRank, type Profile } from './resolve.ts';

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lakhMonth = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}/month`;
const ABOVE_MANAGER = /\b(?:manager|head|director|principal|vp|svp|evp|vice[- ]president|chief(?! of staff))\b/i;
export const REQUIRED_SKILL_GAP = 11;   // no required skill named: below the Worth-a-try floor (threshold - 10)

export function evaluateWithProfile(prof: Profile, p: Posting, ctx: EvalContext = {}, sig?: Signals) {
  const s = sig || postingSignals(p);
  const { text, lower } = s;
  const candidate = prof.cand;
  const globalRemote = s.globalRemoteWords || s.worldLocation || (prof.apacOk && s.asiaLocation);
  let eligibility = 'UNKNOWN', reason = 'No affirmative candidate-specific location evidence.';
  const homeGulf = GULF_CODES.has(prof.home);
  if (s.internal) { eligibility = 'INELIGIBLE'; reason = 'Internal posting: open only to the employer\'s own staff.'; }
  else if (s.security) { eligibility = 'INELIGIBLE'; reason = 'Explicit citizenship, security clearance or licensing restriction requires exclusion.'; }
  else if (s.nationalsOnly && !homeGulf) { eligibility = 'INELIGIBLE'; reason = 'Reserved for nationals of the employer\'s country.'; }
  else ({ eligibility, reason } = placeEligibility(s, prof, globalRemote));
  if (s.noVisaRoute && eligibility === 'UNKNOWN') reason = 'Posting says it offers no visa sponsorship, so nothing here shows the candidate may work at this location. ' + reason;
  // field: the first pack whose role rule matches decides the field rules; avoid lists add up
  const packs = prof.packs.map((k) => FIELD_PACKS[k]).filter(Boolean);
  const pack = packs.find((f) => f.role(p.title || '', prof, s)) || packs[0];
  const role = !!pack && packs.some((f) => f.role(p.title || '', prof, s));
  const skills = prof.skills.filter((x) => skillFound(x, lower) || !!RULE_PARTS.SKILL_ALIAS[String(x).toLowerCase()]?.test(lower));
  skills.push(...pack.extraSkills(s, prof, skills, role));
  let score = role ? Math.min(90, 40 + skills.length * 8 + (eligibility === 'ELIGIBLE' ? 10 : 0)) : Math.min(35, skills.length * 5);
  const have = prof.years, need = yearsRequired(p.description || '');
  const minR = levelRank(prof.levelMin), maxR = levelRank(prof.levelMax);
  const juniorByBand = minR >= levelRank('mid') ? (RULE_PARTS.JUNIOR_TITLE.test(p.title || '') || (() => { const top = yearsCeiling(p.description || ''); return have > 0 && top > 0 && top <= have / 2; })())
    : minR >= 0 && minR <= levelRank('junior') ? (minR === levelRank('junior') && /\b(?:trainee|intern|internship|apprentice|apprenticeship)\b/i.test(p.title || '')) : underLevel(p.title || '', p.description || '', have);
  const tooJunior = role && (juniorByBand || (have >= 5 && pack.belowLevelTitle(p.title || '')));
  const overReach = role && have > 0 && need > have + 2, meets = role && !tooJunior && have > 0 && need > 0 && need <= have;
  if (overReach) score = Math.max(0, score - EXPERIENCE_OVER_PENALTY); else if (meets) score = Math.min(PLAIN_CEILING, score + EXPERIENCE_MATCH_BONUS);
  const fit = role ? pack.fit(p.title || '', prof) : null;
  if (fit) score = Math.min(PLAIN_CEILING, score + (fit === 'exact' ? TARGET_EXACT_BONUS : TARGET_WORD_BONUS));
  const atLevel = role && !tooJunior && have >= 7 && RULE_PARTS.SENIOR_TITLE.test(p.title || '');
  if (atLevel) score = Math.min(PLAIN_CEILING, score + SENIORITY_BONUS);
  const platform = role ? platformGap(p.title || '', prof.skills) : null;
  const floor = prof.floor, preferred = prof.preferred;
  const pay = floor > 0 ? monthlyInr(p.salary) : null, belowFloor = !!pay && pay.hi < floor, preferredPay = !!pay && !belowFloor && preferred > 0 && pay.hi >= preferred;
  if (belowFloor) score = Math.max(0, score - PAY_BELOW_FLOOR_PENALTY); else if (preferredPay) score = Math.min(PLAIN_CEILING, score + PAY_PREFERRED_BONUS);
  const pa = placeAdjust(s, prof, ctx, { role, eligibility, globalRemote });
  const key = s.key, globalHirer = pa.globalHirer;
  if (globalHirer && role) score = Math.min(PLAIN_CEILING, score + GLOBAL_HIRER_BONUS);
  const rejectedOn = key && ctx.rejected?.has(key) ? (ctx.rejected.get(key) || 'date not recorded') : null;
  const ycBatch = pack.ycBonus && role && eligibility !== 'INELIGIBLE' && key && ctx.yc?.has(key) ? (ctx.yc.get(key) || 'batch not listed') : null;
  if (ycBatch) score = Math.min(PLAIN_CEILING, score + YC_BONUS);
  const locClass = s.locClass, tzRestricted = pa.tzRestricted;
  if (tzRestricted) score = Math.max(0, score - TIMEZONE_PENALTY);
  const agency = s.agency;
  if (agency && role) score = Math.max(0, score - AGENCY_PENALTY);
  const lang = s.lang && !prof.spoken.includes(s.lang.toLowerCase()) ? s.lang : null;
  if (lang && role) score = Math.max(0, score - LANGUAGE_PENALTY);
  const descLen = s.descLen, duties = role ? pack.duties(p.description, prof) : null, dutyAdj = dutyAdjust(duties, descLen, fit === 'exact');
  if (dutyAdj > 0) score = Math.min(PLAIN_CEILING, score + dutyAdj); else if (dutyAdj < 0) score = Math.max(0, score + dutyAdj);
  const spread = spreadBonus(duties, descLen);
  const mixed = role && fit !== 'exact' ? s.mixed : null;
  if (mixed) score = Math.max(0, score - MIXED_TITLE_PENALTY);
  if (spread) score = Math.min(SCORE_CEILING, score + spread);
  const ukSponsor = pa.ukSponsor, reposted = s.reposted;
  const avoided = packs.some((f) => f.avoided(s, prof));
  const foreignOnly = pa.foreignOnly;
  const plant = pack.plant && role;
  const corePlant = plant && !(RULE_PARTS.DESIGN_TITLE.test(p.title || '') && !RULE_PARTS.HANDS_ON_TITLE.test(p.title || '')) && /\b(?:thermal|captive|coal[- ]fired|super ?critical)\s+power\b|\bpower (?:plant|station)s?\b|\bturbines?\b|\bboilers?\b|\bcoal handling\b|\bBTG\b/i.test((p.title || '') + ' ' + String(p.description || '').slice(0, 2000));
  if (corePlant) score = Math.min(SCORE_CEILING, score + 8);
  const visaUnlikely = pa.visaUnlikely;
  if (visaUnlikely) score = Math.min(score, VISA_UNLIKELY_CAP);
  const nationalsPreferred = !homeGulf && s.nationalsPreferred;
  if (nationalsPreferred) score = Math.min(score, NATIONALS_PREFERENCE_CAP);
  const electricalOnly = plant && RULE_PARTS.ELECTRICAL_TITLE.test(p.title || '') && !RULE_PARTS.NON_ELECTRICAL_FIT.test(p.title || '') && !sanaElectricalMaintenance(p.title, p.description);
  if (electricalOnly) score = Math.max(0, score - ELECTRICAL_ONLY_PENALTY);
  const designOnly = plant && RULE_PARTS.DESIGN_TITLE.test(p.title || '') && !RULE_PARTS.HANDS_ON_TITLE.test(p.title || '');
  if (designOnly) score = Math.max(0, score - DESIGN_ONLY_PENALTY);
  if (avoided) score = Math.min(score, AVOID_TITLE_CAP);
  if (platform) score = Math.min(score, PLATFORM_GAP_CAP);
  if (tooJunior) score = Math.min(score, UNDER_LEVEL_CAP);
  const threshold = prof.threshold;
  const execTitle = maxR >= levelRank('executive') ? null : RULE_PARTS.EXEC_TITLE.exec(p.title || ''), execTarget = !!execTitle && prof.targetList.some((t) => new RegExp(`\\b${escRe(execTitle[0])}\\b`, 'i').test(String(t)));
  const aboveBand = maxR < levelRank('manager') && ABOVE_MANAGER.test(p.title || '') && !prof.targetList.some((t) => ABOVE_MANAGER.test(String(t)));
  const tooSenior = role && (overReach || (!!execTitle && !execTarget) || aboveBand);
  if (tooSenior) score = Math.min(score, threshold - 1);
  const farAbove = maxR === levelRank('manager') && role && RULE_PARTS.FARHAN_FAR_ABOVE.test(p.title || '') && !prof.targetList.some((t) => RULE_PARTS.FARHAN_FAR_ABOVE.test(String(t)));
  if (farAbove) score = Math.min(score, threshold - FAR_ABOVE_GAP);
  const offField = role ? pack.offField(s) : null;
  if (offField) score = Math.min(score, AVOID_TITLE_CAP);
  const gig = !prof.allowGig && role && s.gig;
  if (gig) score = Math.min(score, AVOID_TITLE_CAP);
  const assistantGig = prof.vaRule && role ? farhanAssistantGig(p.title, p.description, p.company) : null;
  if (assistantGig) score = Math.min(score, AVOID_TITLE_CAP);
  const engField = role ? pack.engField(s) : null;
  if (engField) score = Math.min(score, AVOID_TITLE_CAP);
  const lowPost = role ? pack.belowLevelPost(s, need) : null;
  if (lowPost) score = Math.min(score, UNDER_LEVEL_CAP);
  const stretchA = role && !engField && !lowPost ? (pack.key === 'revops_automation' ? pack.stretchOnly(s, have) : null) : null;
  const otherProfession = role ? pack.otherProfession(s) : null;
  if (otherProfession) score = Math.min(score, AVOID_TITLE_CAP);
  const supervisorLow = role && pack.supervisorLow(s, have, need);
  if (supervisorLow) score = Math.min(score, UNDER_LEVEL_CAP);
  const stretchB = role && !otherProfession && !supervisorLow && pack.key !== 'revops_automation' ? pack.stretchOnly(s, have) : null;
  const stretchOnly = stretchA || stretchB;
  const stretchCapped = !!stretchOnly && eligibility === 'ELIGIBLE' && !(p as any).board;
  if (stretchCapped) score = Math.min(score, threshold - 1);
  const langHard = role && s.langHard && !prof.spoken.includes(s.langHard.toLowerCase()) ? s.langHard : null;
  if (langHard) score = Math.min(score, threshold - LANGUAGE_HARD_GAP);
  const placeUnworkable = pa.unworkable;
  if (placeUnworkable) score = Math.min(score, VISA_UNLIKELY_CAP);
  const rightToWorkElsewhere = pa.rtwElsewhere;
  if (rightToWorkElsewhere) score = Math.min(score, VISA_UNLIKELY_CAP);
  const unconfirmed = pa.unconfirmed;
  if (unconfirmed) score = Math.max(0, score - INDIA_UNCONFIRMED_PENALTY);
  if (designOnly) score = Math.min(score, threshold + DESIGN_ONLY_HEADROOM);
  if (foreignOnly) score = Math.max(0, score - FOREIGN_LOCATION_PENALTY);
  // profile-only: required skills (a new person's config; the built-in packs have none)
  const requiredRe = prof.required.length ? phraseRe(prof.required) : null;
  const requiredMissing = role && !!requiredRe && !requiredRe.test(lower) && !prof.required.some((r) => skillFound(r, lower));
  if (requiredMissing) score = Math.min(score, threshold - REQUIRED_SKILL_GAP);
  const homeName = pa.homeName, from = pa.from;
  // pay in the floor's own currency and period when the config gives a floor in another currency (a rupee floor keeps the old rupee-a-month text)
  const fl = prof.cfg.salary?.floor && prof.cfg.salary.floor.currency !== 'INR' ? prof.cfg.salary.floor : null;
  const inFloor = (inrMonth: number) => `${Math.round((inrMonth / floor) * fl!.amount).toLocaleString('en-GB')} ${fl!.currency} a ${fl!.period}`;
  const floorText = fl ? `${fl.amount.toLocaleString('en-GB')} ${fl.currency} a ${fl.period}` : lakhMonth(floor);
  const payText = (inrMonth: number) => (fl ? inFloor(inrMonth) : lakhMonth(inrMonth));
  return {
    status: eligibility === 'INELIGIBLE' ? 'INELIGIBLE' : role ? 'NEEDS_REVIEW' : 'HOLD', lane: role ? 'STRONGEST_FIT' : 'UNASSIGNED', eligibility, reason, score, skills, target_fit: fit,
    target_exact: fit === 'exact' && exactWithQualifier(p.title || '', prof.targets),
    qualification_reason: (role ? 'Cloud discovery match. Full requirements, pay and experience require review before READY.' : 'Outside candidate target role family; retained for review.') + (fit === 'exact' ? ' Title is one of the candidate\'s target roles.' : fit === 'word' ? ' Title is close to one of the candidate\'s target roles.' : '') + (atLevel ? ' Pitched at the candidate\'s level.' : '') + (avoided ? ' Title is on the candidate\'s avoid list (score capped).' : '') + (tooJunior ? ' Pitched well below the candidate\'s experience (score capped).' : '') + (platform ? ` Built around ${platform}, which the profile does not list (score capped).` : '') + (foreignOnly ? ` Only stated location is outside ${homeName} (score reduced).` : '') + (visaUnlikely ? ` On-site abroad with no visa route from ${from} stated (score capped).` : '') + (nationalsPreferred ? ' Gives preference to the country\'s nationals (score capped).' : '') + (overReach ? ` Asks for ${need}+ years (score reduced).` : meets ? ` Meets the stated ${need}+ years.` : '')
      + (tooSenior ? ' Pitched above the candidate\'s level (score capped below the shortlist).' : '')
      + (farAbove ? ' Principal, director, VP or head-of title, far above the candidate\'s level (kept off the shortlist).' : '')
      + (offField ? ` Reads as ${offField} work, not the candidate's field (score capped).` : '')
      + (gig ? ' Part-time, freelance or contractor engagement (score capped).' : '')
      + (assistantGig ? ` Reads as ${assistantGig}, below the candidate's level (score capped).` : '')
      + (engField ? ` Reads as ${engField} work, not the candidate's field (score capped).` : '')
      + (otherProfession ? ` Reads as ${otherProfession} work, not the candidate's field (score capped).` : '')
      + (lowPost ? ` Reads as ${lowPost}, below the candidate's level (score capped).` : '')
      + (supervisorLow ? ' Supervisor post asking at most 4 years, below the candidate\'s level (score capped).' : '')
      + (stretchCapped ? ` Reads as ${stretchOnly}: a stretch, kept off Best matches (score capped below the threshold).` : '')
      + (langHard ? ` Requires ${langHard} (kept off the shortlist).` : '')
      + (placeUnworkable ? ` Remote or abroad with nothing showing it is open to someone in ${homeName} (score capped).` : '')
      + (rightToWorkElsewhere ? ' Open only to people based in or allowed to work in another country, with no visa route (score capped).' : '')
      + (unconfirmed ? ` Remote, but nothing in the posting says it hires from ${homeName} (score reduced).` : '')
      + (requiredMissing ? ' Names none of the required skills (kept off the shortlist).' : '')
      + (belowFloor ? ` Published pay (up to ${payText(pay!.hi)}) is below the ${floorText} floor (score reduced).` : preferredPay ? ` Published pay reaches the preferred level (up to ${payText(pay!.hi)}).` : '')
      + (globalHirer ? ` Employer is listed publicly as hiring worldwide; confirm ${homeName} is included.` : '')
      + (rejectedOn ? ` Rejected by this employer before (${rejectedOn}).` : '')
      + (ycBatch ? ` Y Combinator company (${ycBatch}), currently hiring.` : '')
      + (tzRestricted ? ' Remote, but on another region\'s working hours (score reduced).' : '')
      + (agency ? ' Posted by a staffing agency or recruiter (score reduced).' : '')
      + (lang ? ` Requires ${lang} (score reduced).` : '')
      + (ukSponsor ? ' Employer holds a UK Skilled Worker sponsor licence.' : '')
      + (electricalOnly ? ' Electrical-only title, ranked below mechanical, reliability and energy roles (score reduced).' : '')
      + (designOnly ? ' Design or study role, ranked below maintenance, O&M and reliability roles (score reduced).' : '')
      + (dutyAdj > 0 ? ` Names ${duties} of the duties of your work (score raised).` : dutyAdj < 0 ? ' Names none of the duties of your work (score reduced).' : '')
      + (mixed ? ` Title mixes two functions (${mixed[0]} and ${mixed[1]}; score reduced).` : '')
      + (reposted ? ' Reposted: an earlier listing of this role closed.' : '')
      + (locClass === 'worldwide' ? ' Posting says: work from anywhere.' : locClass === 'india_ok' ? ' Posting names India as a remote location.' : '')
      + (role && skills.length ? ` Easy-yes check: ${skills.length} of ${prof.skillCount} CV skills named (${skills.slice(0, 4).join(', ')}${skills.length > 4 ? ', …' : ''})${meets ? `, meets the ${need}+ years asked` : ''}.` : ''),
  };
}
