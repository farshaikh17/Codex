// Prints SQL for a DISPOSABLE local D1 (migrations already applied): the data the listing browser regression uses. Identities and classes are
// fixed here so the browser test can assert WHICH jobs are on screen.   node test/e2e/listing-seed.mjs | wrangler d1 execute ... --file -
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const out = [];
const ins = (t, row) => out.push(`INSERT INTO ${t}(${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`);
ins('candidates', { id: 'farhan_shaikh', full_name: 'Test Farhan', current_location: 'India', citizenship: 'India', primary_timezone: 'Asia/Kolkata', total_years_experience: 4, qualification_threshold: 70 });
ins('candidates', { id: 'sana_ansari', full_name: 'Test Sana', current_location: 'India', citizenship: 'India', primary_timezone: 'Asia/Kolkata', total_years_experience: 9, qualification_threshold: 60 });
const seen = new Set();
const add = (cand, id, title, o = {}) => {
  const { status = 'NEEDS_REVIEW', elig = 'ELIGIBLE', score = 50, pub = 0, active = 1, app = null, lane = 'STRONGEST_FIT', at = '2026-11-01T00:00:00Z' } = o;
  if (!seen.has(id)) { seen.add(id); ins('jobs', { id, title, company: 'Co ' + id, source_adapter: 'lever', source_url: 'https://jobs.lever.co/x/' + id, is_active: active, salary_published: pub, discovered_at: at, location_restrictions: 'Remote, India' }); }
  ins('candidate_qualifications', { candidate_id: cand, job_id: id, qualification_status: status, eligibility_status: elig, strategy_lane: lane, eligibility_reason: 'Posting explicitly supports fully remote work from India.' });
  ins('candidate_job_scores', { candidate_id: cand, job_id: id, overall_score: score });
  if (app) ins('applications', { id: `app-${cand}-${id}`, candidate_id: cand, job_id: id, status: app, notes: 'PRIVATE-NOTE-9c1' });
};
const F = 'farhan_shaikh', S = 'sana_ansari';
// ---- Farhan: India Remote set (see test/listing.test.mjs for the same classes) + 17 fillers so the default list has two pages
add(F, 'ir1', 'Implementation Manager', { status: 'READY', score: 90, pub: 1 });
add(F, 'ir2', 'Solutions Engineer', { status: 'READY', score: 85 });
add(F, 'ir3', 'CRM Systems Analyst', { status: 'STRETCH_READY', score: 80, pub: 1 });
add(F, 'ir4', 'Workflow Automation Lead', { status: 'STRETCH_READY', score: 75, app: 'APPLIED' });
add(F, 'ir5', 'Technical Operations Manager', { score: 70, pub: 1 });
add(F, 'ir6', 'Revenue Operations Analyst', { score: 65, app: 'SAVED' });
add(F, 'ir7', 'Staff Software Engineer', { status: 'INELIGIBLE', score: 40 });
add(F, 'ir8', 'Technical Account Manager', { status: 'HOLD', score: 35, pub: 1 });
add(F, 'ir9', 'Gardener', { status: 'READY_HIGH', score: 30 });
add(F, 'ir10', 'AI Operations Engineer', { status: 'READY', score: 20, pub: 1 });
add(F, 'ir13', 'Implementation Specialist', { status: 'READY', score: 15, pub: 1, app: 'REJECTED' });
add(F, 'ir11', 'Implementation Lead (closed)', { status: 'READY', score: 99, active: 0 });
add(F, 'ir12', 'Implementation Director (location unknown)', { status: 'READY', score: 98, elig: 'UNKNOWN' });
for (let i = 0; i < 17; i++) add(F, 'fx' + String(i).padStart(2, '0'), 'Operations Associate ' + i, { score: 14 });
// ---- Sana: India Remote set
add(S, 's1', 'Reliability Engineer', { status: 'READY', score: 88, pub: 1 });
add(S, 's2', 'Power Systems Engineer', { status: 'STRETCH_READY', score: 77 });
add(S, 's3', 'Plant Maintenance Lead', { score: 66, app: 'APPLIED' });
add(S, 's4', 'Solar Developer', { score: 55, elig: 'UNKNOWN' });
add(S, 'ir1', 'Implementation Manager', { status: 'HOLD', score: 5 });
// ---- Sana: READY dashboard. 130 higher-scoring NEEDS_REVIEW jobs, then READY/STRETCH jobs that score below nearly all of them
for (let i = 0; i < 130; i++) add(S, 'hi' + String(i).padStart(3, '0'), 'Analyst Review ' + i, { elig: i % 2 ? 'INELIGIBLE' : 'UNKNOWN', score: 95 - Math.floor(i / 10), at: `2026-11-02T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` });
add(S, 'rd1', 'Implementation Lead', { status: 'READY', score: 41, elig: 'UNKNOWN' });
add(S, 'rd2', 'Solutions Consultant', { status: 'READY', score: 33, elig: 'UNKNOWN' });
add(S, 'rd3', 'Automation Specialist', { status: 'READY', score: 12, elig: 'UNKNOWN' });
add(S, 'rd4', 'CRM Delivery Lead', { status: 'READY', score: 9, app: 'APPLIED', elig: 'UNKNOWN' });
add(S, 'rd5', 'Onboarding Lead', { status: 'READY', score: 8, app: 'SAVED', elig: 'UNKNOWN' });
add(S, 'rdc', 'Delivery Program Manager', { status: 'READY', score: 0, elig: 'UNKNOWN' });      // READY with no stored score: the card must say so
add(S, 'st1', 'Technical Operations Lead', { status: 'STRETCH_READY', score: 44, elig: 'UNKNOWN' });
add(S, 'st2', 'Delivery Manager', { status: 'STRETCH_READY', score: 7, elig: 'UNKNOWN' });
add(S, 'dis1', 'Dismissed Role', { status: 'INELIGIBLE', score: 99, elig: 'UNKNOWN' });
console.log(out.join('\n'));
