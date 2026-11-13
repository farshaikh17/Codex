// Plain words for the job seeker's page (plan U9 and the rename table in section 12). No network, nothing stored.
import { Job, ApplicationStatus } from '../types';

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

/** The first place named ("Pune, India"), or "Remote", short. */
export function placeText(job: Pick<Job, 'location_restrictions' | 'workplace_type'>): string {
  const loc = String(job.location_restrictions || '').split(/[;|]/)[0].trim();
  const remote = String(job.workplace_type || '').toUpperCase().startsWith('REMOTE');
  if (!loc) return remote ? 'Remote' : 'Place not stated';
  return loc.length > 40 ? loc.slice(0, 39) + '…' : loc;
}

/** The time a job reached this person's list: found, or put on the list (whichever is later). */
export const listedAt = (job: Job) => Math.max(Date.parse(job.discovered_at || '') || 0, Date.parse(job.qualified_at || '') || 0);

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
export function sourceText(adapter?: string | null, provenance?: string | null): string {
  if (provenance === 'PUBLIC_FEED_UNVERIFIED') return 'From a job board (the employer is not confirmed)';
  const boards = ['indeed', 'linkedin', 'naukri', 'glassdoor', 'bayt', 'adzuna', 'remoteok', 'weworkremotely', 'himalayas', 'workingnomads', 'hnhiring', 'hnjobs', 'jobicy', 'remotive', 'arbeitnow', 'getro'];
  return boards.includes(String(adapter || '')) ? 'From a job board' : "From the employer's own site";
}
