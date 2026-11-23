// Jobs QA 10 (22 Nov, after the profile_v25 release and the wide-intake rebuild): both live lists (92 jobs) were re-judged by two reviewers; 18 of
// Farhan's and 10 of Sana's should not have been shown, and 3 + 9 more belonged on Worth a try, not Best matches. Each general rule has positive cases
// in short paraphrased or quoted wording and the near misses it must leave alone; the last tests check that every job the reviewers judged RIGHT keeps
// its place (its title, place and the quoted lines nearest to the new rules). No personal data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, languageHardRequired, farhanCrmDevelopment, farhanEngineeringField, farhanStretchOnly, farhanOtherFieldQa10, farhanSalesforceCode,
  farhanStretchOnlyQa10, remoteLockedElsewhere, sanaOtherProfession, sanaOtherProfessionQa10, sanaTechnicianGrade, sanaStretchOnly, sanaStretchOnlyQa10,
  postingUrlKey, twinText, twinEmployer, OTHER_TEAMS_REMOTE, AVOID_TITLE_CAP, UNDER_LEVEL_CAP, VISA_UNLIKELY_CAP, LANGUAGE_HARD_GAP, RULES_MARKER } from '../worker/discovery.ts';
import { keepTwins, textTwinKey, urlTwinKey, employerCopy } from '../scripts/shortlist_select.mjs';
import { employerName } from '../frontend/src/seeker/format.ts';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, total_years_experience: 9,
  primary_skills: JSON.stringify(['HubSpot', 'Workflow Automation', 'CRM Configuration', 'Zapier', 'Process Design', 'API Integrations', 'Product Implementation', 'Stakeholder Management', 'Technical Delivery']),
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Automation Specialist', 'Revenue Operations Specialist', 'CRM Operations Specialist', 'Technical Project Manager']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, total_years_experience: 9.2,
  primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis', 'Breakdown Maintenance', 'Maintenance Planning', 'Industrial Utilities']),
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)', 'Plant Engineer']) };
const evF = (title, description, o = {}) => evaluate(farhan, { id: 'x', title, company: o.company || 'Acme', url: o.url || 'https://e.com/x', location: o.location ?? 'Remote - India', description, remote: o.remote ?? true, source: o.source || 'greenhouse', board: o.board });
const evS = (title, description, o = {}) => evaluate(sana, { id: 'x', title, company: o.company || 'Acme Industries', url: o.url || 'https://e.com/x', location: o.location ?? 'Pune, Maharashtra, India', description, remote: o.remote ?? false, source: o.source || 'successfactors', board: o.board });
const OPS = 'Own the implementation of our platform for new customers: requirements gathering, CRM configuration, workflow automation with Zapier and API integrations, process design and stakeholder management through go-live. ';
const PLANT = 'Plan preventive and breakdown maintenance of the boilers, compressors and pumps in our continuous-process plant, lead root cause analysis, maintenance planning and run the industrial utilities and spares. ';
const listedF = (e) => e.status !== 'INELIGIBLE' && (e.eligibility === 'ELIGIBLE' ? e.score >= 60 : e.score >= 70);
const listedS = (e) => e.status !== 'INELIGIBLE' && (e.eligibility === 'ELIGIBLE' ? e.score >= 50 : e.score >= 60);

test('marker: the rules changed, so every stored row is re-scored once (profile_v26, bumped again by later rule changes)', () => {
  const v = /^profile_v(\d+)$/.exec(RULES_MARKER);
  assert.ok(v && Number(v[1]) >= 26, RULES_MARKER);
});

// ---- Farhan: hidden ------------------------------------------------------------------------------------------------------------------------------
test('Farhan 1: "excellent command of both French and English" is a required language he does not list', () => {
  assert.equal(languageHardRequired('Senior Project Manager', OPS + 'Excellent command of both French and English, to work with our clients.'), 'French');
  assert.equal(languageHardRequired('Senior Project Manager', OPS + 'Strong command of English and German is essential.'), 'German');
  const e = evF('Senior Project Manager', OPS + 'Excellent command of both French and English, to work with our clients.');
  assert.ok(e.score <= farhan.qualification_threshold - LANGUAGE_HARD_GAP, `${e.score}`);
  assert.equal(listedF(e), false);
});
test('Farhan 1 near misses: English alone, or another language only welcomed', () => {
  assert.equal(languageHardRequired('Senior Project Manager', OPS + 'Excellent command of English, written and spoken.'), null);
  assert.equal(languageHardRequired('Senior Project Manager', OPS + 'A good command of French is a plus.'), null);
});

test('Farhan 2: a strategy & operations title asking years in consulting or market research is another field', () => {
  assert.match(farhanOtherFieldQa10('Senior Lead - Strategy & Operations', OPS + 'Desired experience: 6 - 8 years, with a minimum of 6 years in Strategy or Management Consulting.'), /strategy consulting/);
  assert.match(farhanOtherFieldQa10('Strategy and Operations Manager', OPS + 'You bring 5+ years in market research for B2B brands.'), /strategy consulting/);
  const e = evF('Senior Lead - Strategy & Operations', OPS + 'A minimum of 6 years in Strategy or Management Consulting.', { location: 'Mumbai Remote' });
  assert.ok(e.score <= AVOID_TITLE_CAP, `${e.score}`);
});
test('Farhan 2 near misses: consulting only as an ideal background, or an operations title', () => {
  assert.equal(farhanOtherFieldQa10('GTM Strategy & Operations Lead', OPS + '4+ years of professional experience, ideally in consulting or a high-growth startup.'), null);
  assert.equal(farhanOtherFieldQa10('Technical Operations Lead', OPS + 'A minimum of 6 years in management consulting.'), null, 'not a strategy title');
});

test('Farhan 3: remote words about other teams do not make an office job remote', () => {
  const D = OPS + 'Experience working with distributed teams, as the delivery teams are fully remote. Balanced business and technical background.';
  const e = evF('Program Manager', D, { location: 'IN', remote: false, source: 'successfactors' });
  assert.equal(e.eligibility, 'INELIGIBLE', e.reason);
  const ok = evF('Program Manager', OPS + 'This is a fully remote role.', { location: 'IN', remote: false, source: 'successfactors' });
  assert.equal(ok.eligibility, 'ELIGIBLE', 'a remote statement for the role itself still counts');
  // review of #247: the employer's own remote statement is about this job too; only another team's is stripped
  for (const own of ['Our team is fully remote.', 'Our company is fully remote.', 'Our employees work remotely.', 'The team is 100% remote.'])
    assert.equal(evF('Program Manager', OPS + own + ' This is a fully remote role.', { location: 'IN', remote: false, source: 'successfactors' }).eligibility, 'ELIGIBLE', own);
  const strip = (t) => t.replace(OTHER_TEAMS_REMOTE, '#');
  assert.equal(strip('Our team is fully remote.'), 'Our team is fully remote.');
  assert.equal(strip('Our company is remote-first.'), 'Our company is remote-first.');
  assert.equal(strip('as the delivery teams are fully remote.'), 'as #.');
  assert.equal(strip('Our client teams work remotely.'), '#.');
  assert.equal(strip('The engineering team is remote.'), '#.');
  assert.equal(evF('Program Manager', OPS + 'Our team is fully remote.', { location: 'IN', remote: false, source: 'successfactors' }).eligibility, 'ELIGIBLE');
});

test('Farhan 4: a support or solutions title asking infrastructure or security engineering is another field', () => {
  const WIZ = 'Minimum qualifications: 2+ years with cloud platforms including IAM and networking (VPCs, security groups); 1+ years troubleshooting production Kubernetes clusters; reading code in Go or Terraform/HCL.';
  assert.match(farhanOtherFieldQa10('Senior Solutions Support Engineer', OPS + WIZ), /infrastructure or security/);
  const CIRT = 'Install, configure and test core incident-response platforms (e.g. RTIR, MISP, OpenCTI, Wazuh, Security Onion).';
  assert.match(farhanOtherFieldQa10('Senior CIRT Technical and Operations Consultant', OPS + CIRT), /infrastructure or security/);
  assert.ok(evF('Senior Solutions Support Engineer', OPS + WIZ).score <= AVOID_TITLE_CAP);
});
test('Farhan 4 near misses: networking knowledge for a TAM, or one cloud word', () => {
  assert.equal(farhanOtherFieldQa10('Staff, Technical Account Manager', OPS + 'Solid networking knowledge (TCP/IP, UDP, SSL/TLS); JavaScript is preferred.'), null);
  assert.equal(farhanOtherFieldQa10('Solutions Engineer', OPS + 'Familiarity with Kubernetes is a plus.'), null);
});

test('Farhan 5: a project or programme title asking years (or "Mandatory:") in another domain is another field', () => {
  assert.match(farhanOtherFieldQa10('Program Manager - Financing Initiatives', OPS + 'Mandatory: demonstrated academic or professional exposure to finance, economics or public policy.'), /finance/);
  assert.match(farhanOtherFieldQa10('Project Manager, eCOA', OPS + '4 years of project management experience within pharmaceutical, biotechnology or clinical research.'), /pharma/);
  assert.match(farhanOtherFieldQa10('Program Manager-Security Operations & Compliance', OPS + '4+ years of progressively responsible experience in information security, IT compliance or GRC.'), /information security/);
  assert.match(farhanOtherFieldQa10('Project Manager - Data', OPS + '5+ years of experience managing data-focused projects involving data warehousing, data modeling and ETL.'), /data/);
  assert.ok(evF('Project Manager, eCOA', OPS + '4 years of project management experience within pharmaceutical or clinical research.', { location: 'India Remote' }).score <= AVOID_TITLE_CAP);
});
test('Farhan 5 near misses: a domain only welcomed, the employer\'s own industry, or a title that is not a PM seat', () => {
  assert.equal(farhanOtherFieldQa10('Senior Project Manager', OPS + '8+ years of project management of SaaS implementations. Experience in fintech is a plus.'), null);
  assert.equal(farhanOtherFieldQa10('Project Manager - Software Development (Fintech)', OPS + 'We provide 100% remote working. 6+ years managing software projects.'), null);
  assert.equal(farhanOtherFieldQa10('Implementation Manager', OPS + '4+ years in information security tooling rollouts.'), null);
});

test('Farhan 6: a remote job locked to one other country beats an India entry or a worldwide tag', () => {
  const e = evF('Technical Account Manager (Mexico)', OPS + 'This is a remote position open to candidates based in Mexico.', { location: 'Remote - Bengaluru; Remote - Mexico' });
  assert.equal(e.eligibility, 'INELIGIBLE', e.reason);
  assert.equal(remoteLockedElsewhere('This is a fully remote opportunity and can be worked from any location in the United States.'), 'United States');
  const w = evF('Senior GTM Engineer', OPS + 'This is a fully remote opportunity and can be worked from any location in the United States.', { location: 'Anywhere in the World', source: 'weworkremotely', board: true });
  assert.equal(w.eligibility, 'INELIGIBLE', w.reason);
});
test('Farhan 6 (review of #247): a country list naming India anywhere is no lock, and "geo-locked" needs its place', () => {
  assert.equal(remoteLockedElsewhere('This role is open to candidates based in Mexico and India.'), null);
  assert.equal(remoteLockedElsewhere('It can be worked from any location in the US, Canada, or India.'), null);
  assert.equal(remoteLockedElsewhere('It can be worked from any location in the US, Canada, or APAC.'), null);
  assert.equal(remoteLockedElsewhere('This job is geo-locked to India.'), null);
  assert.equal(remoteLockedElsewhere('This job is geo-locked.'), null, 'no place: nothing to read');
  assert.equal(remoteLockedElsewhere('This job is geo-locked to the United States.'), 'United States');
  assert.equal(remoteLockedElsewhere('This role is open to candidates based in Mexico and Brazil.'), 'Mexico and Brazil');
  assert.equal(remoteLockedElsewhere('It can be worked from any location in the U.S. and Canada.'), 'U.S. and Canada');
  assert.equal(evF('Technical Account Manager', OPS + 'This job is geo-locked to India.').eligibility, 'ELIGIBLE');
});
test('Farhan 6 near misses: open to candidates in India, or several countries with India', () => {
  assert.equal(remoteLockedElsewhere('This is a remote position open to candidates based in India.'), null);
  assert.equal(remoteLockedElsewhere('The role is open to candidates based in Mexico or India.'), null);
  assert.equal(evF('Technical Account Manager', OPS + 'This is a remote position open to candidates based in India.').eligibility, 'ELIGIBLE');
});

test('Farhan 7: a specialist platform asked with years or a required certification is another field', () => {
  assert.match(farhanOtherFieldQa10('IT Solutions Analyst', OPS + '5+ years of hands-on ServiceNow experience. ServiceNow Certified System Administrator (CSA) Required.'), /servicenow/i);
  assert.match(farhanOtherFieldQa10('SAP SF Onboarding - Lead Consultant', OPS + 'Certifications: SAP Certification (required).'), /sap/i);
  assert.ok(evF('IT Solutions Analyst', OPS + '5+ years of hands-on ServiceNow experience.').score <= AVOID_TITLE_CAP);
});
test('Farhan 7 near misses: a certification only preferred, or his own CRM platforms', () => {
  assert.equal(farhanOtherFieldQa10('IT Solutions Analyst', OPS + 'ServiceNow certification is preferred.'), null);
  assert.equal(farhanOtherFieldQa10('CRM Operations Specialist', OPS + 'Salesforce Administrator certification required. 5+ years of HubSpot.'), null);
});

test('Farhan 8: an automation engineer asking strong coding and a mandatory developer certification is software development', () => {
  const D = OPS + 'Strong development skills in TypeScript and JavaScript. At least one mandatory Microsoft certification: PL-400 or PL-500.';
  assert.match(farhanOtherFieldQa10('Senior Automation Engineer - Power Platform & RPA', D), /software development/);
  assert.ok(evF('Senior Automation Engineer - Power Platform & RPA', D).score <= AVOID_TITLE_CAP);
});
test('Farhan 8 near misses: a certification without coding, or coding without a mandatory certification', () => {
  assert.equal(farhanOtherFieldQa10('Automation Engineer', OPS + 'PL-500 certification is required.'), null);
  assert.equal(farhanOtherFieldQa10('Automation Engineer', OPS + 'Strong development skills in TypeScript. Certifications are a plus.'), null);
});

test('Farhan 9: a recruiting delivery manager asking years in recruitment is another field', () => {
  assert.equal(farhanOtherFieldQa10('Recruitment Delivery Manager - IT Staffing', OPS + '6-12 years of experience in IT recruitment, technical staffing or delivery management.'), 'recruitment and staffing');
  assert.equal(farhanOtherFieldQa10('Technical Delivery Manager', OPS + '6+ years of experience in IT recruitment.'), null, 'not a recruiting title');
});

test('Farhan 10: hybrid wording in the posting beats an aggregator\'s remote tag', () => {
  const D = OPS + 'Flexible working hours and the possibility to combine work from office and home (hybrid ways of working).';
  assert.equal(evF('Data Project Manager', D, { location: 'HR, India', source: 'indeed', board: true }).eligibility, 'INELIGIBLE');
  assert.notEqual(evF('Data Project Manager', OPS + 'This is a fully remote role. Our company runs a hybrid working model for its office staff.').eligibility, 'INELIGIBLE', 'the company\'s own office model is not this job');
});

test('Farhan 11: hardware or chip "integration" (RTL, ASIC, SoC, timing) is another field', () => {
  const D = OPS + 'Own SoC RTL design and integration, synthesis and timing constraints, STA; 10+ years in the semiconductor industry.';
  assert.equal(farhanOtherFieldQa10('[India] SOC RTL Integration Engineer', D), 'hardware or chip design');
  assert.equal(farhanOtherFieldQa10('Integration Engineer', OPS + 'Build REST API integrations and webhooks between SaaS tools.'), null);
});

test('Farhan 12 (why Firework escaped farhanCrmDevelopment): Salesforce code asked as hands-on work is developer work, whatever the title', () => {
  const D = OPS + 'Hands-on proficiency with Salesforce configuration, Salesforce Flow, Apex, SOQL, and custom development. Develop custom functionality using Apex, SOQL and Lightning Web Components.';
  assert.equal(farhanSalesforceCode(D), true);
  assert.equal(farhanCrmDevelopment('Sales & Marketing Operations Manager', D), true, 'the operations title no longer hides it');
  assert.match(farhanEngineeringField('Sales & Marketing Operations Manager', D), /CRM development/);
  assert.ok(evF('Sales & Marketing Operations Manager', D, { location: 'India', source: 'lever' }).score <= AVOID_TITLE_CAP);
});
test('Farhan 12 near misses: Apex only welcomed, or named beside developers without custom work, stays a stretch at most', () => {
  assert.equal(farhanSalesforceCode(OPS + 'Familiarity with Apex and SOQL is a plus.'), false);
  const D = OPS + 'Partner with the developers who write Apex and SOQL triggers.';
  assert.equal(farhanSalesforceCode(D), false);
  assert.match(farhanStretchOnly('Revenue Operations Manager', D), /Salesforce developer seat/);
});

// ---- Farhan: capped (Best -> Worth a try) --------------------------------------------------------------------------------------------------------
const capF = (title, D, o = {}) => { const e = evF(title, OPS + OPS + D, o); assert.equal(e.eligibility, 'ELIGIBLE', e.reason); assert.ok(e.score < 70 && e.score >= 60, `${title}: ${e.score}`); return e; };
test('Farhan caps: ML delivery asking ML engineering, remote only depending on the project, hands-on agentic / RAG building, strategy with finance modelling', () => {
  assert.match(farhanStretchOnlyQa10('AI Delivery Manager', 'Strong understanding of AI and machine learning fundamentals, including model development, evaluation and deployment. MLOps and LLMOps practices. Familiarity with NLP and computer vision.'), /machine-learning/);
  assert.match(farhanStretchOnlyQa10('Delivery Manager', 'Flexible working arrangements, including remote work opportunities depending on project and business requirements.'), /depending on the project/);
  assert.match(farhanStretchOnlyQa10('Senior Solutions Analyst', 'Hands-on experience building agentic systems; agent frameworks like LangChain and LangGraph; RAG pipelines and knowledge graphs.'), /agentic/);
  assert.match(farhanStretchOnlyQa10('GTM Strategy & Operations, APAC Lead', 'Build the financial and operating models; own quota setting. 4+ years, ideally in consulting, investment banking or private equity.'), /finance modelling/);
  capF('AI Delivery Manager', 'Remote work opportunities depending on project and business requirements.', { location: 'India', source: 'lever' });
  capF('Senior Solutions Analyst', 'Hands-on experience building agentic systems with LangGraph, RAG pipelines and knowledge graphs.', { location: 'Remote - India', source: 'bamboohr' });
});
test('Farhan cap near misses: AI words in a customer engineer post, low-code agents, a strategy title without finance', () => {
  assert.equal(farhanStretchOnlyQa10('Customer Engineer, APAC', 'Help enterprises access large language models across providers; partner with account executives on demos.'), null);
  assert.equal(farhanStretchOnlyQa10('Automation Specialist', 'Build low-code AI agents in Zapier and n8n for our operations team.'), null);
  assert.equal(farhanStretchOnlyQa10('Strategy & Operations Manager', 'Run planning cycles and OKRs; prior consulting experience welcome.'), null);
});

// ---- Sana: hidden --------------------------------------------------------------------------------------------------------------------------------
test('Sana 1: an instrumentation title whose minimum qualification is an instrumentation degree, or that writes DCS / PLC logic, is C&I', () => {
  assert.equal(sanaOtherProfessionQa10('Instrumentation Manager', PLANT + 'Minimum qualification: B.E./B.Tech. Instrumentation & Control Engineering.'), 'control and instrumentation');
  assert.equal(sanaOtherProfessionQa10('Instrumentation Lead', PLANT + 'Preparation and modification of master SCADA/DCS logic.'), 'control and instrumentation');
  assert.ok(evS('Instrumentation Manager', PLANT + 'Minimum qualification: B.E./B.Tech. Instrumentation & Control Engineering.').score <= AVOID_TITLE_CAP);
});
test('Sana 1 near misses: an instrument commissioning title, an E&I title, or a plant title naming DCS', () => {
  assert.equal(sanaOtherProfessionQa10('Instrument Engineer (Pre Commissioning Field)', PLANT + 'B.E. Instrumentation.'), null);
  assert.equal(sanaOtherProfessionQa10('Electrical & Instrumentation Manager', PLANT + 'B.E. Instrumentation.'), null);
  assert.equal(sanaOtherProfessionQa10('Plant Engineer', PLANT + 'Operate the units from the DCS.'), null);
  // review of #247: the English word 'be' is no degree
  assert.equal(sanaOtherProfessionQa10('Instrumentation Lead', PLANT + 'You will be instrumentation-minded and coordinate with vendors.'), null);
  assert.equal(sanaOtherProfessionQa10('Instrumentation Lead', PLANT + 'Should be in instrumentation maintenance for 10 years.'), null);
});

test('Sana 2: a technician grade under an engineer title (an ITI route beside the engineer\'s, or a graduate asked 2-3 years) is below her level', () => {
  const D = PLANT + "Requirements: Graduate engineer in Electrical or Mechanical with 2-3 years' experience; OR Diploma engineer with 3-5 years' experience; OR ITI candidate with 8-10 years' experience.";
  assert.equal(sanaTechnicianGrade(D), true);
  assert.equal(sanaTechnicianGrade(PLANT + 'B.E. Electrical with 2-3 years; or a Diploma holder with 5 years.'), true);
  assert.ok(evS('Shift Engineer', D, { location: 'Thane, MH', source: 'workday' }).score <= UNDER_LEVEL_CAP);
});
test('Sana 2 near misses: a graduate asked 8+ years beside a diploma route, or ITI fitters she would lead', () => {
  assert.equal(sanaTechnicianGrade(PLANT + 'B.E. with 8+ years; or a Diploma with 12+ years.'), false);
  // review of #247: the English word 'be' is no B.E. degree
  assert.equal(sanaTechnicianGrade('Degree or diploma in mechanical engineering. You should be comfortable with 2 years of shift work.'), false);
  assert.equal(sanaTechnicianGrade('You will be working with 2 years of data; or diploma holders may apply.'), false);
  assert.equal(sanaTechnicianGrade("BE Electrical with 2-3 years' experience; OR Diploma engineer with 5 years."), true, 'BE in capitals is the degree');
  assert.equal(sanaTechnicianGrade(PLANT + 'B.E. Mechanical with 9 years. Lead a team of ITI fitters and technicians.'), false);
});

test('Sana 3: reliability at an AI or software vendor whose job is building its product is another profession', () => {
  const D = PLANT + "Responsible for supporting the development of the vendor's reliability & predictive maintenance solution, explaining equipment ontology to the AI/GenAI team.";
  assert.match(sanaOtherProfessionQa10('Reliability Head', D), /software product/);
  assert.equal(sanaOtherProfessionQa10('Reliability Engineer', PLANT + 'Use AI/ML condition-monitoring tools on our plant equipment.'), null, 'a plant using AI tools');
});

test('Sana 4: production or plant management of electronics assembly (SMT, reflow, AOI) is another profession', () => {
  const D = PLANT + 'Lead SMT plant operations: solder paste printing, SPI, pick-and-place, reflow soldering and AOI.';
  assert.equal(sanaOtherProfessionQa10('Senior Manager - SMT Plant', D), 'electronics assembly manufacturing');
  assert.equal(sanaOtherProfessionQa10('Maintenance Engineer', D), null, 'maintenance of the lines is her work');
});

test('Sana 5: "reliability" in a product-testing lab (shaker rigs, test fixtures, SOLIDWORKS) is product R&D', () => {
  const D = PLANT + 'Supervise vibration testing on shaker rigs and thermal chambers; design vibration test fixtures in SOLIDWORKS.';
  assert.equal(sanaOtherProfessionQa10('Lab Shift Incharge - Reliability', D), 'product testing and validation');
  assert.equal(sanaOtherProfessionQa10('Reliability Engineer', PLANT + 'Run vibration analysis on rotating equipment.'), null);
});

test('Sana 6: abroad with "Is Sponsorship Available? No" is never shown', () => {
  const e = evS('Mechanical Engineer', PLANT + 'Pay range $120,000 - $165,000 USD annual. Is Sponsorship Available? No', { location: 'USA, CA, Milpitas', source: 'workday' });
  assert.notEqual(e.eligibility, 'ELIGIBLE', e.reason);
  assert.ok(e.score <= VISA_UNLIKELY_CAP, `${e.score}`);
  const g = evS('Mechanical Engineer', PLANT + 'Visa sponsorship available for the right candidate.', { location: 'Houston, Texas', source: 'workday' });
  assert.equal(g.eligibility, 'ELIGIBLE', 'a stated visa route still counts');
});

test('Sana 7: investment and technical advisory consulting (financial modelling, asset valuation, lender\'s reviews) is another profession', () => {
  const D = PLANT + "Perform technical and financial consulting studies: independent engineering and lender's technical reviews, due diligence, asset valuation assessments and financial modeling for investors.";
  assert.equal(sanaOtherProfessionQa10('Senior Consultant - Power Generation Technical Advisor (Denver)', D), 'investment and technical advisory consulting');
  assert.ok(evS('Senior Consultant - Power Generation Technical Advisor (Denver)', D, { location: 'Multiple Locations', source: 'taleoenterprise' }).score <= AVOID_TITLE_CAP);
  assert.equal(sanaOtherProfessionQa10('Reliability Engineer', PLANT + 'Prepare the business case for capex (NPV) for the plant.'), null);
});

// ---- Sana: capped (Best -> Worth a try) ----------------------------------------------------------------------------------------------------------
const capS = (title, D, o = {}) => { const e = evS(title, PLANT + PLANT + D, o); assert.equal(e.eligibility, 'ELIGIBLE', e.reason); assert.ok(e.score < 60 && e.score >= 50, `${title}: ${e.score}`); return e; };
test('Sana caps: executive grades with a low bar, a junior engineer post, fabrication shops, office campuses, specialist processes, consultancies, dedicated reliability years', () => {
  assert.match(sanaStretchOnlyQa10('Team Member - Maintenance', 'Job Description: Maintenance Executive. Diploma / Bachelor\'s Degree in Electrical or Mechanical; 3-8 years of maintenance experience.'), /executive-grade/);
  assert.match(sanaStretchOnlyQa10('Senior Executive - Electrical Engineering - Terminals', 'Education: B.E. Electrical. Experience: Minimum 4 Years.'), /executive-grade/);
  assert.match(sanaStretchOnly('Executive, Engineering & Maintenance', 'Education: Bachelor of Engineering in Mechanical Engineering. 6.5 years in a GMP pharmaceutical company.', 'Acme', 9.2), /mechanical-only degree/);
  assert.match(sanaStretchOnlyQa10('Lead - Tower Unit Maintenance', 'Lead maintenance across manufacturing operations including welding, rolling, fit-up, blasting, painting and utilities.'), /heavy-fabrication/);
  assert.match(sanaStretchOnlyQa10('Facility Maintenance & Engineering - IV', 'Position: Campus Head - Engineering Services for our office campus: HT/LT, DG sets, chillers.'), /office campus/);
  assert.match(sanaStretchOnlyQa10('Mechanical Engineer', 'Hands-on exposure to ultra-low temperature refrigeration, cascade refrigeration systems operating below -100C and coating processes.'), /refrigeration or coating/);
  assert.match(sanaStretchOnlyQa10('Consultant - (Reliability & Asset Management)', 'Join our Infrastructure Advisory organization to improve asset performance for our clients.'), /consultancy/);
  assert.match(sanaStretchOnlyQa10('Reliability Expert', 'Overall 10 years of experience with 5 years in Reliability field.'), /dedicated reliability/);
  assert.match(sanaStretchOnlyQa10('Engineer - Mechanical', 'Support Senior Engineer in maintenance planning; execute tasks as assigned by Senior Engineer.'), /junior engineer/);
  capS('Senior Executive - Electrical Engineering - Terminals', 'Education: B.E. Electrical. Experience: Minimum 4 Years.', { location: 'Panipat, Haryana, India', source: 'oracle' });
  capS('Reliability Expert', 'Overall 10 years of experience with 5 years in Reliability field.', { location: 'India New Delhi', source: 'workday' });
});
test('Sana cap near misses: a deputy manager, a consultant title outside a consultancy, three reliability years, plant welding', () => {
  assert.equal(sanaStretchOnlyQa10('Deputy Manager - Utilities', 'Candidates should bring 5 to 8 years in maintenance management.'), null);
  assert.equal(sanaStretchOnlyQa10('Decarbonisation Consultant', 'Energy audits and decarbonisation plans for cement plants.'), null);
  assert.equal(sanaStretchOnlyQa10('Reliability Engineer', 'Minimum 3 years in reliability engineering in the energy sector.'), null);
  assert.equal(sanaStretchOnlyQa10('Maintenance Engineer', 'Coordinate welding and painting contractors during the boiler shutdown.'), null);
});

// ---- Both: one posting stored twice; closed and empty-place items are engine-side (engine/tests/test_jobs_qa10.py) --------------------------------
const NOW = Date.parse('2026-11-22T12:00:00Z'), FRESH = '2026-11-22T00:00:00Z';
const row = (id, o = {}) => ({ kind: 'pool', candidate_id: 'sana_ansari', job_id: id, title: 'Senior Executive - Electrical Engineering', company: 'Acme Terminals', location: 'Panipat, Haryana, India',
  workplace: 'ONSITE', source: 'oracle', provenance: 'ATS_DATASET', url: 'https://abcd.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/28315', description: PLANT.repeat(3), active: 1, score: 95,
  skill_score: 80, eligibility: 'ELIGIBLE', status: 'NEEDS_REVIEW', reason: 'Cloud discovery match.', threshold: 60, marked: 1, target_exact: 0, last_verified_at: FRESH, discovered_at: FRESH, ...o });
test('Sana 8: a job board\'s copy of the employer\'s requisition (":443", no site part) is the same posting, and the employer\'s copy is kept', () => {
  const a = 'https://abcd.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/28315', b = 'https://abcd.fa.em2.oraclecloud.com:443/hcmUI/CandidateExperience/en/job/28315';
  assert.equal(postingUrlKey(a), postingUrlKey(b));
  assert.notEqual(postingUrlKey(a), postingUrlKey(a.replace('28315', '28316')));
  const ats = row('ds:oracle:a'), board = row('js:indeed:b', { source: 'indeed', provenance: 'PUBLIC_FEED_UNVERIFIED', eligibility: 'UNKNOWN', location: 'HR, India', url: b });
  assert.equal(urlTwinKey(ats), urlTwinKey(board));
  assert.equal(employerCopy(ats), true); assert.equal(employerCopy(board), false);
  assert.deepEqual(keepTwins([board, ats], NOW).map((r) => r.job_id), ['ds:oracle:a']);
  assert.deepEqual(keepTwins([ats, board], NOW).map((r) => r.job_id), ['ds:oracle:a'], 'whatever the order');
});
test('Sana 9 (with the closed-page fact): the same text twice on one employer site under two requisition ids is one posting; another city or text is not', () => {
  const s = row('ds:sf:a', { url: 'https://jobs.example.com/job/Jubail-Electrical-Engineer/1362757155/', title: 'Electrical Engineer', location: 'Jubail, SA, 35713', company: 'Acme Energy' });
  const t = row('js:sf:b', { url: 'https://jobs.example.com/job/Jubail-Electrical-Engineer/1334210455/?feedId=null', title: 'Electrical Engineer', location: 'Jubail, SA, 35713', company: 'Acme Energy SA', provenance: 'PUBLIC_FEED_UNVERIFIED', eligibility: 'UNKNOWN' });
  assert.equal(textTwinKey(s), textTwinKey(t));
  assert.deepEqual(keepTwins([t, s], NOW).map((r) => r.job_id), ['ds:sf:a']);
  assert.notEqual(textTwinKey(s), textTwinKey({ ...t, location: 'Yanbu, SA' }), 'another city: the many-cities rule decides');
  assert.notEqual(textTwinKey(s), textTwinKey({ ...t, description: PLANT.repeat(2) + 'Different duties.' }));
  assert.match(textTwinKey({ ...s, description: 'short' }), /^id:/, 'a short text is never merged');
  // review of #247: a shared hiring-system host serves many employers; the employer is part of the key
  const lv = (id, company) => row(id, { url: `https://jobs.lever.co/${company.toLowerCase()}/${id}`, company, title: 'Implementation Manager', location: 'Remote - India' });
  assert.notEqual(textTwinKey(lv('a1', 'Acme')), textTwinKey(lv('b2', 'Globex')), 'two employers on jobs.lever.co with the same template text');
  assert.equal(keepTwins([lv('a1', 'Acme'), lv('b2', 'Globex')], NOW).length, 2);
});
test('one text reading for twins (review of #247): entities decoded, tags dropped, first 2000 characters; the same output as twin_text() in the engine', () => {
  assert.equal(twinText('<p>Plan &amp; run the plant&#39;s boilers &rsquo;&#x41;</p> CAPEX'), 'plan run the plant s boilers a capex');
  assert.equal(twinText('Plan &amp; run'), twinText('Plan & run'));
  assert.equal(twinText('x'.repeat(2000) + ' tail'), 'x'.repeat(2000), 'cut at 2000 characters before reading, as the pool stores it');
  assert.equal(twinEmployer('The Convergence Foundation'), 'convergence');
  assert.equal(twinEmployer('ENGIE Information Technologies SA'), twinEmployer('ENGIE'));
});

// ---- Display -------------------------------------------------------------------------------------------------------------------------------------
test('display: an Oracle site label as the employer ("Candidate Experience site") is read from the site, or taken off as a suffix', () => {
  assert.equal(employerName('Candidate Experience site', 'https://fa-emad-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_6001/job/5370'), 'Majesco');
  assert.equal(employerName('Acme Candidate Experience site'), 'Acme');
  assert.equal(employerName('Candidate Experience site', 'https://unknown.fa.ocs.oraclecloud.com/x'), 'Candidate Experience site', 'unknown site: as stored');
  assert.equal(employerName('Candidate Experience site'), 'Candidate Experience site');
  assert.equal(employerName('Adani Career Site'), 'Adani', 'the earlier suffixes still work');
});

// ---- Every job the reviewers judged RIGHT keeps its place ------------------------------------------------------------------------------------------
// [person, list, title, place, remote, job-board row, the posting's lines nearest to the new rules (quoted)]
const RIGHT = [
  ["farha", "Best", "Customer Success & Technical Project Manager", "Delhi, Bangalore Urban", true, false, "We also have hands-on experience building climate strategies for global clients and implementing clean-energy solutions like solar. Hands-on, proactive, and adaptable to shifting priorities in an early-stage startup."],
  ["farha", "Best", "Marketing Automation & CRM Operations Manager", "Remote", true, false, "Location: India (remote). Hands-on experience using Click Dimensions for marketing automation and lead nurturing."],
  ["farha", "Best", "Technical Delivery Manager (PL7038)", "Remote job", true, false, "Technical Delivery Manager Fully Remote within India Long Term Contract Shift Timings: 2:00 pm to 11:00 pm IST Experienced Technical Delivery Manager Translate technical concepts into clear business-level communication for executives and non-technical stakeholders. Facilitate executive-level discussions and provide concise, fact-based updates."],
  ["farha", "Best", "Senior Marketing Operations Specialist", "Remote (Bengaluru)", true, false, "Being remote means we rely less on proximity and more on trust. 3+ years in marketing or revenue operations, ideally in B2B SaaS. Strong hands-on HubSpot experience and experience independently managing operational projects."],
  ["farha", "Best", "Staff, Technical Account Manager", "India", true, false, "This remote opportunity is ideal for an experienced technical professional who enjoys solving complex problems, collaborating across teams, and building trusted customer partnerships. At least 5 years of relevant professional experience in technical account management, technical support engineering, software development, cloud technologies, or a related technical discipline. - JavaScript development experience and the ability to troubleshoot both server-side and client-side code are preferred."],
  ["farha", "Best", "Senior Marketing Operations Manager", "IN | DL, IN | Bengaluru, KA, IN | Mumbai, MH, IN | PT | PL", true, false, "The Role JoVE is seeking a detail-oriented and analytical Senior Marketing Operations Specialist with advanced, hands-on HubSpot expertise to own and improve our marketing operations . The ideal candidate has hands-on experience with HubSpot, Salesforce, and Google Analytics and can translate marketing objectives into reliable segmentation, automated journeys, and actionable reporting. 5+ years of relevant experience, including independent ownership of Marketing Operations improvements beyond campaign execution."],
  ["farha", "Best", "Implementation & Solutions Engineer", "Bangalore Urban", true, false, "Role and Responsibilities We are seeking a hands-on Solutions Engineer to be an early member of our Solutions team. What We're Looking For Our ideal candidate is hands-on with technology, someone who can handle a hectic startup schedule and enjoys interacting with customers and has a passion for making them successful."],
  ["farha", "Best", "Marketing Operations Manager (Demand Generation and RevOps)", "India", true, false, "Operating for over 20 years, we specialize in workflow and knowledge processes, as well as technical support, helpdesk and multilingual support services. This is a hands-on execution role rather than a strategy or people-management role."],
  ["farha", "Best", "Sr. Project Manager", "India, India", true, false, "Reports To: Director, GTM Project Management Office (PMO) Location: India (Remote) Shift: Monday Our people With over 2,000 team members across 10+ countries, HighLevel operates as a global, remote-first organization built for speed and ownership. Execute initiatives sponsored by leadership or the Co-Founder Office under the direction and prioritization of the Director, GTM PMO."],
  ["farha", "Wort", "Technical Project Manager", "India", true, false, "- Stakeholder management: Excellent communication, comfort presenting to senior and executive audiences, and the ability to manage scope, timelines, and difficult conversations without losing the relationship. - Preferred: An earlier technical role (engineering, solution architecture, or implementation consulting); PMP, PRINCE2, PSM, or equivalent certification;"],
  ["farha", "Wort", "RevOps Manager", "Anywhere in the World", true, true, ""],
  ["farha", "Wort", "Marketing Operations Specialist - Direct Response (GoHighLevel / ActiveCampaign)", "Remote (India)", true, true, "2+ years in a marketing operations, campaign operations, or funnel-build role, ideally in an online coaching, course, or direct-response business, or an agency that serves them. Native-level written English. You want to be excellent at operations, you take satisfaction in doing a repeatable thing properly, and you want a company you can stay with for several years."],
  ["farha", "Wort", "Project Manager - Software Development (Fintech)", "Bengaluru, IN", true, false, "We provide 100% Remote Working Option."],
  ["farha", "Wort", "Technical Account Manager", "Remote Working, India", true, false, "All About You Minimum 10+ years of experience in customer engagement, technical support, or account management role; at least 3-5 years of experience on insurance technologies is preferred. Consulting & Leadership Skills"],
  ["farha", "Wort", "Solutions Engineer - India", "Remote", true, false, "Fingerprint is a globally dispersed, 100% remote company. Location Preference: Remote Your expertise will support customers and sales executives, positioning Fingerprint as a trusted advisor throughout the sales journey."],
  ["farha", "Wort", "REMOTE (INDIA): Project Manager/Business Operations Manager", "Remote", true, false, "Project Manager/Business Operations Manager (India, Remote) Company Overview: We are hiring a marketing consultant for our client who is dedicated to delivering high-impact marketing solutions. Experience : Minimum of 5 years in project management with a strong focus on Google Sheets for project tracking and deadline management. Ensure marketing strategies align with organizational goals and executive priorities."],
  ["farha", "Wort", "Marketing Automation Manager - Canada, Spain, India ", "Remote", true, false, "Monthly remote work stipend (home internet costs, electricity). As a fully remote company, with work-life balance at its core, you'll enjoy flexible schedules Bachelor's degree in Marketing, Business, Information Systems or a related field, or equivalent practical experience."],
  ["farha", "Wort", "Senior Workato Integration Engineer", "India (Remote)", true, false, "- Support and maintain integrations between UKG Pro, Deel, Greenhouse, Degreed Learning Experience Platform, Replicon, and other business applications, partnering with Business Technology teams as needed. - Design and implement secure authentication patterns (OAuth 2.0, JWT, SAML, API keys, certificates) and manage secrets in accordance with least privilege principles. Minimum of 5 years of hands-on integration experience."],
  ["farha", "Wort", "Sr. Revenue Operations Analyst", "India, India", true, false, "Revenue Operations Analyst Department: Revenue Operations Location: India(Remote) Shift Timings: 2PM Our people With over 2,000 team members across 10+ countries, HighLevel operates as a global, remote-first organization built for speed and ownership."],
  ["farha", "Wort", "Senior Project Manager", "Remote, India, India", true, false, "The ideal candidate combines executive-level customer communication, sound commercial judgment, technical fluency, and a hands-on approach to resolving delivery challenges in a fast-paced global environment. Serve as a trusted customer-facing delivery leader, including executive steering meetings, escalations, recovery plans, and difficult scope or schedule discussions. What are we looking for? 8+ years of project/program management experience, including significant ownership of complex enterprise software, SaaS, or professional services implementations."],
  ["farha", "Wort", "Customer Engineer, APAC", "Remote (APAC)", true, false, "About OpenRouter OpenRouter is the open AI routing and infrastructure layer that enterprises use to access, manage, and optimize the best large language models across providers-without lock-in, capacity constraints, or unnecessary cost. You'll partner with account executives to conduct discovery, deliver compelling demos, architect solutions, and overcome technical objections. - Partner with AEs throughout the sales cycle from discovery through close, including responding to proposals and technical questions and presenting at customer meetings, QBRs, and executive briefings."],
  ["sana_", "Best", "Associate Manager - Operations & Maintenance", "Mundra, Gujarat, India", false, false, "Over the years, Adani Group has positioned itself to be the market leader in its logistics and energy businesses focusing on large-scale infrastructure development in India with O & M practices benchmarked to global standards. Monitor business associates performance, bill certifications, and ensure compliance with contractual obligations. Maintain compliance with legal and statutory requirements, including electrical license renewal and certifications for elevators."],
  ["sana_", "Best", "Deputy Manager - Operations & Maintenance", "Mundra, Gujarat, India", false, false, "Over the years, Adani Group has positioned itself to be the market leader in its logistics and energy businesses focusing on large-scale infrastructure development in India with O & M practices benchmarked to global standards. Monitor business associate's performance, bill certifications, and ensure compliance with contractual obligations. Business Sustainability: Maintain compliance with legal and statutory requirements, including electrical license renewal and certifications for elevators."],
  ["sana_", "Best", "Senior Manager - Plant Maintenance & Utility", "IN", false, false, ""],
  ["sana_", "Best", "Dy. Manager - Building, Utilities & Other Infra for Common Infra (Electrical)", "Nagpur, Nagpur, IN", false, false, "Coordinate with consultants, contractors, equipment suppliers and internal stakeholders for utility load planning, installation, testing and commissioning activities to ensure infrastructure readiness for Start of Production (SOP). Experience 5+ years in electrical utilities, industrial infrastructure, facilities management or plant engineering with exposure to Greenfield automotive, manufacturing or large industrial projects."],
  ["sana_", "Best", "Maintenance Engineer", "Bangalore, Karnataka, IN, 560100", false, false, "Develop, validate, and manage business cases for CAPEX projects (costs, benefits, risks, ROI/NPV) and ensure alignment with site strategy. Monitor and control CAPEX budgets, cash flow, and financial reporting; MBA or PMP certification a plus."],
  ["sana_", "Best", "RMT Facilities & Utilities", "Baramati, MH, IN", false, false, "About You: Education: Degree in Electrical Engineering . Certification of Refrigeration System Certificate in Energy Experience: 4-7 years of experience preferably in FMCG or Food Manufacturing Industry ."],
  ["sana_", "Best", "Plant Maintenance & Electricals Manager", "Pune, India", false, false, "From world-class events that last a few weeks to mining operations and remote communities who rely on us for decades. Provide technical authority in power generation and electrical engineering: Deliver strategic technical leadership across generator systems (diesel, gas, and hybrid), Battery Energy Storage Systems (BESS), and renewable integration. Manage end-to-end capital expenditure (CAPEX) budgets, drive Industry 4.0 automation initiatives, and oversee equipment selection, installation, commissioning, and validation on schedule and within budget."],
  ["sana_", "Best", "Maintenance Lead- Ponda (Goa)", "Ponda, IN", false, false, "Support CAPEX projects, equipment commissioning, maintainability reviews, and technical handovers. Experience, Skills & Education Qualification Bachelor's degree in Mechanical, Electrical, Instrumentation, Mechatronics Engineering, or a related engineering discipline. Typically 8 to 12 years of industrial maintenance experience, preferably within FMCG, food & beverage, confectionery, or a comparable manufacturing environment."],
  ["sana_", "Best", "Deputy Manager - Utilities", "Nagpur, Nagpur Plant, IN", false, false, "Additional certifications or training related to project management, quality management systems (such as ISO standards), energy management, or health and safety regulations will be highly advantageous. General Experience Candidates should bring between 5 to 8 years of solid experience in maintenance management within manufacturing or related heavy industry environments. Experience must include hands-on involvement in equipment breakdown analysis, preventive and predictive maintenance strategies, and maintenance planning for utilities encompassing mechanical and electrical systems."],
  ["sana_", "Best", "Reliability Engineer", "Bangalore, KA, IN, 560066", false, false, "ExxonMobil's LNG affiliate in India supporting the upstream business provides consultant services for other ExxonMobil upstream affiliates and conducts LNG market-development activities."],
  ["sana_", "Wort", "Plant Performance Engineer", "Abu Dhabi, United Arab Emirates", false, false, ""],
  ["sana_", "Wort", "Planning Engineer -Mechanical", "Mesaieed, Qatar", false, false, "Provide technical and planning input for contractor progress measurement and payment certification."],
  ["sana_", "Wort", "Senior Mechanical Engineer - Relating Equipment", "Abu Dhabi, United Arab Emirates", false, false, ""],
  ["sana_", "Wort", "Mechanical Engineer | KSA Technical Recruitment Campaign", "SA", false, false, "Job Specifications Minimum Education Bachelor's degree in Mechanical Engineering. Minimum Experience 8-10 years of experience in mechanical maintenance within power generation and/or water desalination plants. At least 2 years of experience in a supervisory role."],
  ["sana_", "Wort", "MAINTENANCE  MECHANICAL ENGINEER", "Dubai - SEAD Terminal (United Arab Emirates)", false, false, "Bachelor's degree in Mechanical Engineering or a related engineering discipline"],
  ["sana_", "Wort", "Deputy Manager- Plant Maintenance", "KA, India", false, true, "Hands-on & Resilient : Comfortable working close to operations, solving issues and leading through ambiguity. Apply with your CV in English throughout the system, no later than 12-05-2026 ."],
  ["sana_", "Wort", "Lead – Electrical Boiler/Turbine/Generator/Shift Engineer", "Korba, Chhattisgarh, India", false, false, "Over the years, Adani Group has positioned itself to be the market leader in its logistics and energy businesses focusing on large-scale infrastructure development in India with O & M practices benchmarked to global standards. Monitor business associates performance, bill certifications, and ensure compliance with contractual obligations. Maintain compliance with legal and statutory requirements, including electrical license renewal and certifications for elevators."],
  ["sana_", "Wort", "Commissioning & Service Engineer -BESS", "KA, India", false, true, "Required Experience, minimum: 5 years Required Experience, maximum: 10 years Skills: Service, Commissioning Engineers Minimum Qualification: Bachelor of Technology (BTech), General Diploma BESS Support remote troubleshooting with engineering teams."],
  ["sana_", "Wort", "Mechanical Maintenance Engineer / Outage Leader", "Dubai, United Arab Emirates", false, false, "Ability to provide clear instruction and train others in the performance of various tasks and jobs Excellent communication (read, write and verbal) skills in English Language"],
  ["sana_", "Wort", "O&M Mechanical Engineer", "", false, false, "Skills And Qualifications: Bachelor of Engineering degree Mechanical Engineering. +5 years of experience in power generation (Operation & Maintenance) with a focus on mechanical systems. Good command of the English language."],
  ["sana_", "Wort", "Power Plant Manager", "Yanbu, Saudi Arabia", false, false, "Liaise with external vendors, contractors and OEMs for all equipment and utility service related matters Qualifications: Education & Experience Bachelors degree in Mechanical, Electrical, or Power Engineering. Minimum 810 years of experience in power plant operations, with at least 3 years in a managerial/supervisory role. Language Skills: Proficient in English for communication, reporting, and documentation."],
  ["sana_", "Wort", "Power Plant Manager", "", false, false, "Qualifications Requirements Bachelor of Engineering degree Electrical Power 8 Years in Electrical Strong background in power generation plant and Medium & Low Voltage Electrical Distribution Network Good command of the English language."],
  ["sana_", "Wort", "Lead Electrical Boiler/Turbine/Generator", "Ottapidaram, Tamil Nadu, India; Korba, Chhattisgarh, India", false, false, "Over the years, Adani Group has positioned itself to be the market leader in its logistics and energy businesses focusing on large-scale infrastructure development in India with O & M practices benchmarked to global standards. Monitor business associates performance, bill certifications, and ensure compliance with contractual obligations. Maintain compliance with legal and statutory requirements, including electrical license renewal and certifications for elevators."],
  ["sana_", "Wort", "Electrical Engineer | KSA Technical Recruitment Campaign", "SA", false, false, "Job Specifications Minimum Education Bachelor's degree in Electrical Engineering. Minimum Experience 8-10 years of experience in electrical maintenance within power generation and/or water desalination plants. At least 2 years of experience in a supervisory role."],
  ["sana_", "Wort", "Maintenance Engineer", "Riyadh, Riyadh - SAU (Saudi Arabia)", false, false, "Here is a glimpse of what you'll do… General Task Management Perform preventive, predictive, and corrective maintenance for all machines and equipment (hands-on Train, mentor, and support junior technicians and apprentices. Spare parts management, communication with OEM and suppliers technically a hands-on People Management Supervise and guide maintenance technicians and contractors during maintenance and repair work. Minimum 3-5 years of experience in industrial or factory maintenance."],
  ["sana_", "Wort", "Shift Engineer | KSA Technical Recruitment Campaign", "Saudi Arabia", false, false, "Job Specifications Minimum Education Bachelor's degree in Engineering. Minimum Experience Minimum 8 years of relevant experience in water desalination and/or power generation plants. At least 2 years of experience in a supervisory role."],
  ["sana_", "Wort", "Reliability Engineer ( Mechanical)", "GJ, India", false, true, ""],
  ["sana_", "Wort", "AM/DM- Utilities Automation", "MH, India", false, true, "8 to 10 years of experience in Automation, Controls Engineering, Industrial Automation, Manufacturing Automation, or Process Control within a manufacturing environment. 5 .Hands-on experience in programming, commissioning, troubleshooting, maintenance, and optimization of automation and control systems. Bachelor's Degree in Electrical Engineering, Electronics Engineering, Instrumentation Engineering, Mechatronics Engineering, Production Engineering, Mechanical Engineering, or a related discipline from a recognized university."],
  ["sana_", "Wort", "Plant Maintenance Engineer", "Arakkonam", false, false, ""],
  ["sana_", "Wort", "Deputy Manager Safety & Sustainability", "Nagpur, Nagpur Plant, IN", false, false, ""],
];
// Decided after review (22 Nov): the QA 8 note keeping Koch's 'Utilities Engineer' on Worth a try is superseded. Once its empty place is filled
// from the employer's page (engine/liveness.py), the abroad-without-visa cap of the QA 6 rulings hides it, so it is not in the RIGHT-kept list.
test('Koch-style US plant job: listed while the place is empty, hidden by the abroad-without-visa cap once the place is filled', () => {
  const D = PLANT + PLANT + 'Review, update, and maintain P&ID drawings and equipment records.';
  assert.equal(listedS(evS('Utilities Engineer', D, { location: '', source: 'avature' })), true);
  const e = evS('Utilities Engineer', D, { location: 'Lincoln, Nebraska (United States)', source: 'avature' });
  assert.ok(e.score <= VISA_UNLIKELY_CAP, `${e.score}`);
  assert.equal(listedS(e), false);
});
test('RIGHT jobs: no new rule reads them, and each stays listed (Best matches stay Best)', () => {
  const bad = [];
  for (const [who, list, title, location, remote, board, lines] of RIGHT) {
    const name = `${who} ${list}: ${title}`;
    if (who === 'farha') {
      assert.equal(farhanOtherFieldQa10(title, lines), null, name); assert.equal(farhanSalesforceCode(lines), false, name);
      assert.equal(farhanStretchOnlyQa10(title, lines), null, name); assert.equal(remoteLockedElsewhere(lines), null, name);
      const e = evF(title, OPS + OPS + lines, { location, remote, board, source: board ? 'workable' : 'greenhouse' });
      if (!(list === 'Best' ? e.eligibility === 'ELIGIBLE' && e.score >= 70 : listedF(e))) bad.push(`${name}: ${e.score} ${e.eligibility} ${e.reason}`);
    } else {
      assert.equal(sanaOtherProfessionQa10(title, lines), null, name); assert.equal(sanaTechnicianGrade(lines), false, name);
      assert.equal(sanaStretchOnlyQa10(title, lines), null, name);
      const e = evS(title, PLANT + PLANT + lines, { location, remote, board });
      if (!(list === 'Best' ? e.eligibility === 'ELIGIBLE' && e.score >= 60 : listedS(e))) bad.push(`${name}: ${e.score} ${e.eligibility} ${e.reason}`);
    }
  }
  assert.deepEqual(bad, []);
});
