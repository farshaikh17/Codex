// Multi-candidate base (docs/MULTI_CANDIDATE.md section 5): the two built-in people's profile configs reproduce evaluate() exactly. A generated
// corpus of titles x places x descriptions x remote flags, drawn from the cases the rules' own tests use (synthetic text; no real posting or
// person). The hand-judged set is checked with scripts/quality/equivalence.mjs (not in the repository).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, companyKey } from '../worker/discovery.ts';
import { resolveProfile } from '../worker/profiles/resolve.ts';
import { evaluateWithProfile } from '../worker/profiles/evaluate.ts';
import { LEGACY_CONFIGS } from '../worker/profiles/legacy.ts';
import { scoreCandidate } from '../worker/profiles/dispatch.ts';
import { compare } from '../scripts/quality/equivalence.mjs';
import { storedConfig } from '../scripts/profile_config.mjs';
import { profileOf } from '../worker/profiles/dispatch.ts';

// Candidate shapes like the stored rows (test values, not the real profiles).
export const FARHAN = { id: 'farhan_shaikh', total_years_experience: 9, qualification_threshold: 70,
  primary_skills: JSON.stringify(['CRM Configuration', 'Workflow Automation', 'GoHighLevel', 'Zapier', 'API Integrations', 'Process Design', 'Team Leadership']),
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Automation Specialist', 'Technical Delivery Manager', 'Revenue Operations Specialist']) };
export const SANA = { id: 'sana_ansari', total_years_experience: 9.2, qualification_threshold: 60,
  primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis', 'Boiler', 'Turbine', 'Energy Audit', 'Water Treatment']),
  target_roles: JSON.stringify(['Maintenance Engineer (Power Plant)', 'Reliability Engineer', 'Energy Efficiency Engineer', 'Decarbonization Engineer', 'Plant Engineer', 'Asset Performance Specialist']) };

const TITLES = ['Deputy Manager - Mechanical', 'Manager - Instrumentation Sales', 'Field Service Engineer', 'Senior Testing & Commissioning Engineer, Medium Voltage', 'Electrical Maintenance Engineer - Port', 'Operating Engineer', 'Maintenance Supervisor', 'Data Analyst', 'Plant Manager', 'HVDC Field Service Engineer', 'Implementation Manager', 'Senior Implementation Manager', 'Revenue Operations Manager', 'Sales & Marketing Operations Manager', 'CRM Automation Specialist',
  'GoHighLevel Specialist — Automation & Customer Support (Gym Business)', 'Virtual Assistant (CRM)', 'Workday Implementation Lead', 'Director of Implementation',
  'Head of Revenue Operations', 'Chief of Staff', 'Software Engineer', 'Junior Solutions Consultant', 'Operations Engineer', 'AI Automation Engineer',
  'Solutions Engineer (Remote)', 'Technical Delivery Manager - Canada, Spain, India', 'Commercial Operations Specialist', 'Part-time CRM Consultant',
  'Implementation Specialist - Dutch Speaking', 'Maintenance Engineer (Power Plant)', 'Reliability Engineer', 'Senior Reliability Engineer', 'Site Reliability Engineer',
  'Electrical Engineer', 'Electrical Maintenance Engineer', 'O&M Engineer – Thermal Power', 'Primary Design Engineer - Electrical', 'Power System Study Senior Expert',
  'Maintenance Technician', 'Chargeman Electrical', 'Energy Efficiency Engineer', 'Decarbonization Consultant', 'Technical Consultant', 'Plant Head',
  'Shift In-charge (Boiler)', 'Procurement Engineer - Power', 'Mechanic Maintenance Engineer', 'Electrical Technician (Saudi Nationals)', 'General Manager - Plant',
  'Energy Manager', 'Commissioning Engineer', 'Hardware Test and Reliability Engineer', 'Store Manager'];
const PLACES = ['Cuddalore, TN, IN', 'Little India, Singapore', 'Bengaluru Office', 'Pessione', 'Remote - India', 'Bengaluru, India', 'Remote', 'Remote (Worldwide)', 'Anywhere in the World', 'Remote - APAC', 'Remote - US', 'United States',
  'Austin, Texas', 'London, United Kingdom', 'Remote (Germany)', 'Berlin, Germany', 'Dubai, UAE', 'Riyadh, SA', 'Doha, Qatar', 'Jamnagar, Gujarat', 'Lafayette, IN',
  'Pithampur, IN', '3 Locations', '', 'Hybrid - Pune, India', 'Remote - EMEA', 'Kabirwala, PK, 58150', 'Remote - Colorado', 'Bap, IN, 342301', 'Mumbai',
  'Remote, excluding the US', 'Singapore', 'Noble Voyager', 'Remote/Traveling (For Corporate Use Only)'];
const BASE_F = 'We are hiring an implementation lead to configure our CRM, onboard customers and build workflow automation with Zapier, n8n and webhooks. You will own go-live, write SOPs and drive process improvement. 5+ years of experience in SaaS implementation. Integrate APIs and automate reporting.';
const BASE_S = 'You will run preventive maintenance, breakdowns and shutdowns of boilers and turbines at a 660 MW power plant, lead root cause analysis (RCA), condition monitoring and energy audits. 8+ years of experience in power plant maintenance. Commissioning of rotating equipment, DCS and SCADA, permit to work.';
const DESCS = [
  BASE_F, BASE_S, '', 'Short text.',
  BASE_F + ' This is a fully remote role; we hire remotely from India and APAC.',
  BASE_F + ' Candidates must be based in the US. Benefits include 401(k) and E-Verify.',
  BASE_F + ' This role is hybrid, 3 days a week in our London office.',
  BASE_F + ' We can only consider candidates based in Germany, Spain or the UK who hold the right to work.',
  BASE_F + ' Must be able to work US Eastern time zone hours. Posted on behalf of our client by a recruitment agency.',
  BASE_F + ' Salary: $30,000 - $40,000 per year. Fluent German is required. 15+ years of experience.',
  BASE_S + ' Visa sponsorship available. Relocation assistance provided.',
  BASE_S + ' We are unable to provide visa sponsorship. Saudization: preference will be given to Saudi nationals.',
  BASE_S + ' Detailed design, FEED, design packages and AutoCAD drawings; tender documents; 3D models in E3D.',
  BASE_S + ' Location: Remote – United States. Work from anywhere in the world.',
  BASE_S + ' This is a part-time position, 20 hours per week. Secret clearance required.',
  'Our client, a US-based gym business, is hiring through our agency that places virtual assistants. First-line support to the gym owner and staff. 2+ years of experience with GoHighLevel automation.',
  'Linux servers, server health checks, production environments, system logs, CPU and disk utilisation, network connectivity, on-call rotation. RAG pipelines, vector stores, embeddings.',
  // jobs QA 7 cases (internal only, US remote text, office place text, programming, early career, stretch-only, other professions, form labels)
  BASE_F + ' We seek applications from interested employees for this role. Internal candidates only.',
  BASE_F + ' LOCATION Remote position within the United States. The US base salary range is $120,000. 401(k).',
  BASE_F + ' Location: Bangalore, Hybrid. We offer a blended approach to office working. Work Location: Pune',
  BASE_F + ' You are an exceptional developer with 5+ years of back-end development and strong programming skills in Python.',
  BASE_F + ' Recent graduate or early-career candidates welcome. 2+ years. High email and phone volume, cold outreach.',
  BASE_F + ' Analyst role: SQL and Tableau dashboards for business intelligence. Workato certification required. Apex and SOQL.',
  BASE_S + ' Relocation: VISA Sponsorship: Travel Requirements: Salary 50.000 to 60.000 € under a CCNL contract.',
  BASE_S + ' Implementation of our AI-powered industrial analytics platform with Power BI, Tableau, Python and SQL dashboards.',
  BASE_S + ' Maintenance of CNC machines, servo drives, robots and PLC programming, welding lines. Experience Minimum: 5 Maximum: 8.',
  BASE_F + ' Must be based in the EU. EU work authorization required.',
  BASE_S + ' Relocation assistance provided for the move to our Houston site.',
  'Commissioning and testing of medium voltage switchgear, transformers and protection relays at power plants and substations; pre-commissioning, loop checks, energisation and punch lists. O&M handover. HITACHI ENERGY INDIA LIMITED. 6+ years of experience.',
  'Electrical maintenance of port equipment and terminal cranes: preventive and breakdown maintenance, fault diagnosis, spare parts, CMMS, downtime and MTBF at the terminal and utility substations. 7+ years of experience.',
  BASE_S + ' We are not able to sponsor visas for this role, now or in the future.',
  BASE_S + ' Supervisor post, 3+ years of experience in maintenance. Container terminal RTG and STS cranes. Power electronics, IGBTs.',
];
const SALARIES = [undefined, { min: 1000000, max: 1500000, currency: 'INR', period: 'year' }, { min: 120000, max: 160000, currency: 'USD', period: 'year' }];
export const ctx = { globalHirers: new Set([companyKey('Remote First Co')]), rejected: new Map([[companyKey('Old Employer'), '2026-10-01']]), yc: new Map([[companyKey('YC Startup'), 'W25']]), ukSponsors: new Set([companyKey('Grid Power UK')]) };
const COMPANIES = ['Hitachi Energy', 'WorkNigeria', 'JLL', 'Acme', 'Remote First Co', 'YC Startup', 'Grid Power UK', 'Old Employer', 'Talent Recruitment Solutions', 'Ajaia'];

export function* corpus() {
  let k = 0;
  for (const title of TITLES) for (const location of PLACES) for (const remote of [false, true]) {
    const description = DESCS[k % DESCS.length], company = COMPANIES[k % COMPANIES.length], salary = SALARIES[k % SALARIES.length];
    k++;
    yield { id: 'g' + k, title, company, url: 'https://boards.greenhouse.io/x/jobs/' + k, source: ['greenhouse', 'greenhouse', 'workday', 'weworkremotely', 'builtin'][k % 5], location, description, remote, salary, repost: k % 13 === 0, board: k % 11 === 0 };
  }
  for (const title of TITLES) for (const description of DESCS) yield { id: 'd' + (k++), title, company: 'Acme', url: '', source: 'lever', location: 'Remote', description, remote: true };
}
const FIELDS = ['status', 'lane', 'eligibility', 'reason', 'score', 'skills', 'target_fit', 'target_exact', 'qualification_reason'];

for (const cand of [FARHAN, SANA]) {
  test(`profile packs reproduce evaluate() for ${cand.id} on the generated corpus`, () => {
    const prof = resolveProfile(cand, LEGACY_CONFIGS['legacy:' + cand.id]);
    let n = 0, bad = [];
    for (const p of corpus()) {
      const a = evaluate(cand, p, ctx), b = evaluateWithProfile(prof, p, ctx);
      n++;
      for (const f of FIELDS) if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) bad.push({ id: p.id, title: p.title, location: p.location, f, old: a[f], new: b[f] });
    }
    assert.ok(n > 3000, 'corpus size');
    assert.deepEqual(bad.slice(0, 5), [], `${bad.length} differences`);
  });
}

test('the old path stays the default: no config, an engine "legacy" config, or the kill switch -> evaluate() itself', () => {
  const p = { id: 'x', title: 'Implementation Manager', company: 'Acme', url: '', location: 'Remote - India', description: BASE_F, remote: true };
  const want = evaluate(FARHAN, p, {});
  assert.deepEqual(scoreCandidate({ ...FARHAN }, p, {}), want);
  // a built-in id with a config that does not say engine "profile" stays on the old path
  assert.deepEqual(scoreCandidate({ ...FARHAN, profile_config: JSON.stringify({ schema: 1, extends: 'legacy:farhan_shaikh' }) }, p, {}), want);
  // an invalid config is ignored
  assert.deepEqual(scoreCandidate({ ...FARHAN, profile_config: '{not json' }, p, {}), want);
  // a config not written by scripts/profile_config.mjs (not resolved) is not used, even with engine "profile"
  const raw = { ...FARHAN, profile_config: JSON.stringify({ schema: 1, extends: 'legacy:farhan_shaikh', engine: 'profile' }) };
  assert.equal(profileOf(raw), null);
  // a built-in id on the profile engine without its own base is refused (fix 8); profile_config.mjs adds the base itself
  assert.equal(profileOf({ ...FARHAN, profile_config: JSON.stringify({ schema: 1, resolved: true, engine: 'profile', field: { packs: ['keyword'], role_families: ['implementation'] } }) }), null);
  const st = storedConfig('farhan_shaikh', { schema: 1, engine: 'profile' });
  assert.equal(st.ok, true); assert.equal(st.config.extends, 'legacy:farhan_shaikh'); assert.equal(st.config.resolved, true);
  assert.equal(storedConfig('farhan_shaikh', { schema: 1, extends: 'legacy:sana_ansari', engine: 'profile' }).ok, false);
  // flipped through the stored (resolved) config: the packs, with the same result
  const flipped = { ...FARHAN, profile_config: JSON.stringify(st.config) };
  assert.ok(profileOf(flipped)); assert.deepEqual(scoreCandidate(flipped, p, {}), want);
  process.env.PROFILE_ENGINE = 'off';
  try { assert.deepEqual(scoreCandidate({ id: 'newbie', profile_config: JSON.stringify({ schema: 1, resolved: true, field: { title: { must: ['implementation'] } } }) }, p, {}), evaluate({ id: 'newbie' }, p, {})); }
  finally { delete process.env.PROFILE_ENGINE; }
});

test('the equivalence script reads stored rows (the hand-judged set format) and finds no difference', () => {
  const rows = [...corpus()].slice(0, 400).map((p, i) => ({ cid: i % 2 ? 'farhan_shaikh' : 'sana_ansari', job_id: p.id, title: p.title, company: p.company, location: p.location,
    description: p.description, workplace_type: p.remote ? 'REMOTE' : 'ONSITE', source_adapter: p.source, qreason: '' }));
  const cands = [FARHAN, SANA].map((c) => ({ ...c, primary_skills: JSON.parse(c.primary_skills), target_roles: JSON.parse(c.target_roles) }));
  const res = compare(rows, cands);
  assert.equal(res.compared, 400);
  assert.equal(res.mismatches, 0, JSON.stringify(res.list.slice(0, 2)));
});

test('the stored (resolved) configs of the built-in people reproduce evaluate() too (what a flip would store)', () => {
  for (const cand of [FARHAN, SANA]) {
    const st = storedConfig(cand.id, { schema: 1, engine: 'profile' });
    assert.equal(st.ok, true, st.errors?.join('; '));
    const row = { ...cand, profile_config: JSON.stringify(st.config) };
    let bad = 0, n = 0;
    for (const p of corpus()) { n++; if (JSON.stringify(scoreCandidate(row, p, ctx)) !== JSON.stringify(evaluate(cand, p, ctx))) bad++; }
    assert.equal(bad, 0, `${cand.id}: ${bad} of ${n} differ through the stored config`);
  }
});
