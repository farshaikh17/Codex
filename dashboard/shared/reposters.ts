// Reposting sites and virtual-assistant staffing firms (Jobgether, Turing, 20four7VA, ...): they republish or place other employers' jobs.
// One list for the shortlist (scripts/shortlist_select.mjs) and the seeker page (frontend/src/seeker/format.ts). engine/reposters.py
// REPOSTER_NAMES holds the same names for the collectors; tests/test_reposters_shared.py checks the two lists agree.
// Whole-name keys (lower case, letters and digits only): 'Turing Labs' is an employer, 'Turing' / 'Turing.com' the reposting site.
export const REPOSTER_NAMES: ReadonlySet<string> = new Set([
  '20four7va', 'braintrust', 'braintrustnetwork', 'crossover', 'crossoverforwork', 'jobgether', 'jobgethercom', 'myoutdesk', 'pavago',
  'peopleworth', 'remotestaff', 'turing', 'turingcom', 'twentyfour7va', 'usebraintrust', 'virtualstaffingph', 'wingassistant',
]);

export const reposterKey = (company?: string | null): string =>
  String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/(?:inc|llc|ltd)$/, '');

/** True when the company is a reposting site or staffing firm, not the employer. */
export const isReposterName = (company?: string | null): boolean => REPOSTER_NAMES.has(reposterKey(company));
