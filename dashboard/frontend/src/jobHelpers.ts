// Small deterministic helpers for the job inspection panel. No network, no AI, nothing stored.

/** Links that open ready-made people searches for an employer. The candidate contacts people themselves; nothing is sent from here. */
export function peopleSearchLinks(company: string): { label: string; hint: string; url: string }[] {
  const c = String(company || '').replace(/\s+/g, ' ').trim();
  if (!c) return [];
  const li = (kw: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`;
  return [
    { label: 'Recruiters', hint: 'recruiters and talent acquisition', url: li(`${c} recruiter`) },
    { label: 'Hiring managers', hint: 'heads and managers in the team', url: li(`${c} head of OR manager OR director`) },
    { label: 'Company on LinkedIn', hint: 'the employer page and its jobs', url: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(c)}` },
  ];
}

// Skills worth naming for the two kinds of search this engine runs (operations / CRM / automation work, and plant maintenance / reliability / energy work).
// A posting that asks for one of these and the candidate's profile does not list it is shown as a gap to think about, not as a verdict.
export const SKILL_VOCABULARY: string[] = [
  // operations, CRM, automation, implementation
  'salesforce', 'hubspot', 'zoho', 'gohighlevel', 'zapier', 'make.com', 'n8n', 'workato', 'sql', 'python', 'javascript', 'rest api', 'webhooks', 'api integration',
  'workflow automation', 'crm', 'revops', 'revenue operations', 'sales operations', 'onboarding', 'implementation', 'project management', 'stakeholder management',
  'process improvement', 'data migration', 'etl', 'reporting', 'dashboards', 'power bi', 'tableau', 'excel', 'google sheets', 'jira', 'confluence', 'airtable', 'notion',
  'customer success', 'technical documentation', 'sop', 'lean', 'six sigma', 'agile', 'scrum', 'ai automation', 'llm', 'prompt engineering', 'low-code', 'no-code',
  // plant, maintenance, reliability, energy
  'predictive maintenance', 'preventive maintenance', 'condition monitoring', 'vibration analysis', 'thermography', 'root cause analysis', 'rca', 'fmea', 'rcm',
  'cmms', 'sap pm', 'maximo', 'plc', 'scada', 'dcs', 'hvac', 'boiler', 'turbine', 'gas turbine', 'steam turbine', 'generator', 'transformer', 'switchgear', 'hvdc',
  'pumps', 'compressors', 'rotating equipment', 'heat exchanger', 'combined cycle', 'power plant', 'commissioning', 'shutdown', 'turnaround', 'outage', 'energy audit',
  'energy efficiency', 'iso 50001', 'iso 55000', 'iso 9001', 'osha', 'nebosh', 'hse', 'permit to work', 'loto', 'p&id', 'autocad', 'solar', 'wind', 'bess', 'hydrogen',
  'decarbonisation', 'decarbonization', 'sustainability', 'net zero',
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text: string, term: string) => new RegExp(`(^|[^a-z0-9])${esc(term)}([^a-z0-9]|$)`, 'i').test(text);

/** Which of the vocabulary's skills a posting names, split by whether the candidate's profile lists them. */
export function skillGaps(description: string, profileSkills: string[] | null | undefined, vocabulary: string[] = SKILL_VOCABULARY): { asked: string[]; have: string[]; missing: string[] } {
  const text = String(description || '').toLowerCase();
  if (!text.trim()) return { asked: [], have: [], missing: [] };
  const mine = (profileSkills || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  const asked = vocabulary.filter((t) => has(text, t));
  const listed = (t: string) => mine.some((s) => s === t || has(s, t) || has(t, s));
  return { asked, have: asked.filter(listed), missing: asked.filter((t) => !listed(t)) };
}

/** Today's calendar date on the viewer's own clock, as YYYY-MM-DD (not the UTC date, which is still yesterday for part of an Indian morning). */
export function localDay(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** How a follow-up date (YYYY-MM-DD) stands against today (both plain calendar dates, YYYY-MM-DD). */
export function followUpState(date: string | null | undefined, today: string): { key: 'none' | 'overdue' | 'today' | 'soon' | 'later'; label: string; days: number } {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { key: 'none', label: '', days: 0 };
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  if (days < 0) return { key: 'overdue', label: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, days };
  if (days === 0) return { key: 'today', label: 'Follow up today', days };
  if (days <= 3) return { key: 'soon', label: `In ${days} day${days === 1 ? '' : 's'}`, days };
  return { key: 'later', label: `In ${days} days`, days };
}

// The daily run's shortlist step (scripts/dataset_apply.mjs) starts the reason of each row it promoted with this mark. A person's
// decision never carries it on its own (an override always shows as an override), so the mark says who put a job on Ready / Stretch.
export const AUTO_MARK = 'Shortlisted automatically. ';
export const isAutoShortlisted = (reason?: string | null) => String(reason || '').startsWith(AUTO_MARK);
export const withoutAutoMark = (reason?: string | null) => (isAutoShortlisted(reason) ? String(reason).slice(AUTO_MARK.length) : String(reason || ''));
