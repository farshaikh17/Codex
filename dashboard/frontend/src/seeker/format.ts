// Plain words for the job seeker's page (plan U9 and the rename table in section 12). No network, nothing stored.
import type { Job, ApplicationStatus } from '../types';
import { isReposterName } from '../../../shared/reposters';

export type Person = 'farhan' | 'sana';
export const PEOPLE: Person[] = ['farhan', 'sana'];
export const CANDIDATE: Record<Person, string> = { farhan: 'farhan_shaikh', sana: 'sana_ansari' };
export const NAME: Record<Person, string> = { farhan: 'Farhan', sana: 'Sana' };

const IST = 'Asia/Kolkata';
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST });   // YYYY-MM-DD in India time

/** "Thu 13 Nov" in India time. */
export function todayLabel(now: Date = new Date()): string {
  return now.toLocaleDateString('en-GB', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}
/** "today", "yesterday", "3 days ago" within a week, else "1 Nov" (India time). */
export function foundWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const days = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(new Date(t)))) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short' });
}
/** "Found 1 Nov" / "Found 3 days ago". */
export const foundText = (iso: string | null | undefined) => { const w = foundWhen(iso); return w ? `Found ${w}` : ''; };
/** "21:47" in India time. */
export const timeIST = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false });
/** "Updated 21:47" when the last update was today (India time), else "Updated 15 Nov, 20:16", so an old page never reads as fresh. */
export function updatedText(iso: string | null | undefined, now: Date = new Date()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'Updated';
  const d = new Date(t);
  if (dayKey(d) === dayKey(now)) return `Updated ${timeIST(iso as string)}`;
  return `Updated ${d.toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short' })}, ${timeIST(iso as string)}`;
}

/** The first place named ("Pune, India"), or "Remote", short. A remote job whose place does not say so reads "Remote · Delhi" (site QA 21 Nov:
 *  the Remote filter showed cards reading only "Delhi" or "Warszawa (Poland)"). */
export function placeText(job: Pick<Job, 'location_restrictions' | 'workplace_type'>): string {
  const loc = String(job.location_restrictions || '').split(/[;|]/)[0].trim();
  const remote = String(job.workplace_type || '').toUpperCase().startsWith('REMOTE');
  if (!loc) return remote ? 'Remote' : 'Place not stated';
  const short = loc.length > 40 ? loc.slice(0, 39) + '…' : loc;
  return remote && !/remote|anywhere|work from home|wfh/i.test(loc) ? `Remote · ${short}` : short;
}

// Site QA 21 Nov: some hiring systems give their account name as the employer ("nestleHRprdRMK", "MahindraCareerSite", "HatchD1"). The page
// shows the employer's name instead; the stored name is never changed (it is what twins, caps and the operator screens read). Only known account
// names and clear hiring-system suffixes are changed: a name written in lower case on purpose (deliveroo, adidas) is kept as it is.
const EMPLOYER_NAMES: Record<string, string> = {
  nestle: 'Nestlé', hatchd1: 'Hatch', 'us kraft heinz': 'Kraft Heinz', regentcollegelondon: 'Regent College London',
  marrinadecisions: 'Marrina Decisions', myamazonguy: 'My Amazon Guy', fireworkhq: 'Firework', soterahealth: 'Sotera Health',
};
/** The employer's name for display: a known account name mapped to the employer, else the hiring-system suffixes "CareerSite" / "Career Site" /
 *  "HRprd…" taken off; any other name exactly as stored. No lookbehind in these patterns: the build targets Safari 14. Display only. */
export function employerName(raw: string | null | undefined): string {
  const c = String(raw || '').trim();
  const lookup = (x: string) => EMPLOYER_NAMES[x.toLowerCase().replace(/\s+/g, ' ')];
  if (!c) return '';
  if (lookup(c)) return lookup(c);
  const stripped = c
    .replace(/([a-z])HR?prd[A-Za-z0-9]*$/, '$1')             // "nestleHRprdRMK" (SAP SuccessFactors production tenant)
    .replace(/\s*career\s*sites?$/i, '')                    // "Adani Career Site", "MahindraCareerSite"
    .trim();
  return !stripped || stripped === c ? c : lookup(stripped) || stripped;
}

/** When the job was found. "New" uses only this, so it agrees with the "Found <date>" on the card (a re-check of an old job is not new). */
export const listedAt = (job: Job) => Date.parse(job.discovered_at || '') || 0;

/** Stages in plain words ("Where are you with this job?"). */
export const STAGES: [ApplicationStatus, string][] = [
  ['SAVED', 'Saved'], ['REVIEWING', 'Preparing'], ['APPLIED', 'I applied'], ['SCREENING', 'First call'], ['INTERVIEWING', 'Interviews'],
  ['OFFER', 'Got an offer'], ['REJECTED', "Didn't work out"], ['WITHDRAWN', 'I withdrew'],
];
export const stageWord = (s?: string | null) => STAGES.find(([k]) => k === s)?.[1] || (s === 'SUBMITTED' ? 'I applied' : s === 'ARCHIVED' ? 'Finished' : '');
export const SAVED_GROUP = ['SAVED', 'REVIEWING'];
export const WAITING_GROUP = ['APPLIED', 'SUBMITTED', 'SCREENING', 'INTERVIEWING', 'OFFER'];
export const FINISHED_GROUP = ['REJECTED', 'WITHDRAWN', 'ARCHIVED'];

/** What the posting says about working from India, in plain words. */
export function indiaWords(classification?: string | null): string {
  if (classification === 'ELIGIBLE') return 'Posting says India is OK';
  if (classification === 'INELIGIBLE') return 'Posting says not India';
  return "Doesn't say if India is OK";
}

/** Where the posting was found, in plain words. */
export function sourceText(adapter?: string | null, provenance?: string | null, company?: string | null): string {
  if (isReposterName(company)) return 'From a reposting site, not the employer';   // Jobgether etc. arrive through an employer-style hiring system
  if (provenance === 'PUBLIC_FEED_UNVERIFIED') return 'From a job board (the employer is not confirmed)';
  const boards = ['indeed', 'linkedin', 'naukri', 'glassdoor', 'bayt', 'adzuna', 'remoteok', 'weworkremotely', 'himalayas', 'workingnomads', 'hnhiring', 'hnjobs', 'jobicy', 'remotive', 'arbeitnow', 'getro', 'fourdayweek', 'realworkfromanywhere'];
  return boards.includes(String(adapter || '')) ? 'From a job board' : "From the employer's own site";
}
