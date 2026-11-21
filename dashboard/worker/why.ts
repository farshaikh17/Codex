// Plan U6 / U9 (phase 5): the one-line "why this job is here" on every job card, in plain words, for example
//   "Maintenance · on-site Pune · 6 of your skills"
//   "Implementation · remote · 3 of your skills · location eligibility unconfirmed"
// Built only from what is stored (title, place, matched skills, status, eligibility); nothing is sent anywhere. Not used for any score.
import { familyOf, listedOnlyGulf } from './discovery';

const FAMILY_WORDS: Record<string, string> = {
  revops_crm: 'RevOps / CRM', implementation: 'Implementation', automation_ai: 'Automation', technical_delivery: 'Delivery and projects',
  business_systems: 'Business systems', solutions: 'Solutions', operations_general: 'Operations',
  maintenance: 'Maintenance', reliability_asset: 'Reliability', energy_decarb: 'Energy and decarbonisation', plant_operations: 'Plant operations',
  utilities: 'Utilities', commissioning_projects: 'Commissioning and projects', electrical: 'Electrical', field_consulting: 'Field service and consulting',
};

/** "Pune" from "Pune, Maharashtra, India; Chennai" (first place only, bounded). */
function firstPlace(location: string | null | undefined): string {
  const t = String(location || '').split(/[;|]/)[0].split(',')[0].replace(/\s+/g, ' ').trim();
  if (!t || /^(remote|anywhere|worldwide|global|n\/?a|unknown|not stated)$/i.test(t) || /^\d+ locations?$/i.test(t)) return '';
  return t.length > 28 ? t.slice(0, 27) + '…' : t;
}

export function placeWords(workplace: string | null | undefined, location: string | null | undefined): string {
  const w = String(workplace || '').toUpperCase();
  const loc = String(location || '');
  const city = firstPlace(loc);
  if (w.startsWith('REMOTE') || /\bremote\b/i.test(loc)) {
    if (/\b(anywhere|worldwide|global)\b/i.test(loc) || w === 'REMOTE_GLOBAL') return 'remote, worldwide';
    if (/\bindia\b/i.test(loc)) return 'remote, India';
    return 'remote';
  }
  if (w === 'HYBRID') return city ? `hybrid ${city}` : 'hybrid';
  if (w === 'ONSITE') return city ? `on-site ${city}` : 'on-site';
  return city || 'place not stated';
}

const DAY = 86400000;
/** Gap fix (13 Nov): an automatic Stretch row that is a Gulf job-board posting not verified open in 4 days (the board refuses the check; the shortlist
 *  took it because the board listed it in the last 2 days). */
export function notConfirmedOpen(r: { qualification_status?: string | null; qualification_reason?: string | null; location_restrictions?: string | null;
  original_posting_url?: string | null; source_url?: string | null; last_verified_at?: string | null }, now = Date.now()): boolean {
  if (r.qualification_status !== 'STRETCH_READY' || !String(r.qualification_reason || '').startsWith('Shortlisted automatically.')) return false;
  const url = String(r.original_posting_url || '').startsWith('https://') ? r.original_posting_url : r.source_url;   // the URL the still-open check and the shortlist read
  if (!listedOnlyGulf(url, r.location_restrictions)) return false;
  const t = Date.parse(String(r.last_verified_at || '').replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(r.last_verified_at || '')) ? '' : 'Z'));
  return !(now - t <= 4 * DAY);
}

export function whyLine(candidateId: string, r: { title?: string | null; workplace_type?: string | null; location_restrictions?: string | null; qualification_status?: string | null;
  eligibility_status?: string | null; overall_score?: number | null; qualification_reason?: string | null; original_posting_url?: string | null; source_url?: string | null;
  last_verified_at?: string | null }, matchedSkills: unknown, threshold: number | null): string {
  const parts: string[] = [];
  const fam = familyOf(candidateId, String(r.title || ''));
  parts.push(FAMILY_WORDS[fam] || 'A different kind of role from your usual');
  parts.push(placeWords(r.workplace_type, r.location_restrictions));
  const n = Array.isArray(matchedSkills) ? matchedSkills.length : 0;
  if (n > 0) parts.push(`${n} of your skills`);
  if (r.qualification_status === 'STRETCH_READY') {
    if (r.eligibility_status === 'INELIGIBLE') parts.push('location eligibility requirements not met');
    else if (r.eligibility_status !== 'ELIGIBLE') parts.push('location eligibility unconfirmed');
    else if (threshold != null && Number(r.overall_score || 0) < threshold) parts.push('a little below your usual match');
  }
  if (notConfirmedOpen(r)) parts.push('could not be confirmed still open (the job site blocks the check)');
  return parts.join(' · ');
}
