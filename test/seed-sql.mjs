// Prints deterministic SQL for a disposable LOCAL D1 database (wrangler d1 execute --local): synthetic jobs, two
// candidates, scores, decisions, applications and sources. Usage: node test/seed-sql.mjs [--duplicate-applications]
const dup = process.argv.includes('--duplicate-applications');
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const out = [];
const ins = (t, row) => out.push(`INSERT INTO ${t}(${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`);
ins('candidates', { id: 'farhan_shaikh', full_name: 'Test Farhan', current_location: 'Kota, India', citizenship: 'India', primary_timezone: 'Asia/Kolkata', total_years_experience: 4, qualification_threshold: 70 });
ins('candidates', { id: 'sana_ansari', full_name: 'Test Sana', current_location: 'Kota, India', citizenship: 'India', education: 'B.Tech in Electrical Engineering', primary_timezone: 'Asia/Kolkata', total_years_experience: 9.2, qualification_threshold: 60 });
const sources = ['lever:acme', 'greenhouse:beta', 'ashby:gamma', null, null];
const statuses = ['NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'READY', 'STRETCH_READY', 'INELIGIBLE', 'HOLD'];
const elig = ['UNKNOWN', 'UNKNOWN', 'ELIGIBLE', 'INELIGIBLE'];
for (let i = 0; i < 300; i++) {
  const id = 'job_' + String(i).padStart(3, '0'); const src = sources[i % sources.length];
  ins('jobs', { id, title: 'Role ' + i, company: 'Company ' + (i % 25), source_adapter: src ? src.split(':')[0] : 'feed', source_id: src, is_active: i % 17 === 0 ? 0 : 1, salary_published: i % 4 === 0 ? 1 : 0, discovered_at: '2026-11-01T00:00:00Z' });
  for (const [c, off] of [['farhan_shaikh', 0], ['sana_ansari', 3]]) {
    ins('candidate_qualifications', { candidate_id: c, job_id: id, qualification_status: statuses[(i + off) % statuses.length], eligibility_status: elig[(i + off) % elig.length], strategy_lane: 'UNASSIGNED' });
    ins('candidate_job_scores', { candidate_id: c, job_id: id, overall_score: (i * 7 + off * 13) % 100 });
  }
}
for (let i = 0; i < 12; i++) ins('applications', { id: 'app-' + i, candidate_id: 'farhan_shaikh', job_id: 'job_' + String(i * 5).padStart(3, '0'), status: ['APPLIED', 'REJECTED', 'SAVED', 'INTERVIEWING'][i % 4] });
if (dup) for (let i = 0; i < 6; i++) ins('applications', { id: 'dup-' + i, candidate_id: 'farhan_shaikh', job_id: 'job_000', status: ['REJECTED', 'INTERVIEWING'][i % 2] });
ins('cloud_sources', { id: 'lever:acme', kind: 'lever', slug: 'acme', name: 'Acme', last_status: 'SUCCESS', last_attempt_at: '2026-11-04T10:00:00Z', last_success_at: '2026-11-04T10:00:00Z' });
ins('cloud_sources', { id: 'greenhouse:beta', kind: 'greenhouse', slug: 'beta', name: 'Beta', last_status: 'ERROR', last_error: 'HTTP 500', failures: 3, last_attempt_at: '2026-11-04T11:00:00Z' });
console.log(out.join('\n'));
