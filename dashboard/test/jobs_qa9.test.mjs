// Jobs QA 9 (21 Nov, after the profile_v23 rebuild): both live lists (65 jobs) were re-judged by two reviewers; 14 should not have been shown and
// 17 more belonged on Worth a try, not Best matches. Each general rule has positive cases in paraphrased wording and the near misses it must leave
// alone. Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, farhanCrmDevelopment, farhanFinanceProductImplementation, farhanMarketingPlatformRequired, farhanClientPlacement, farhanEngineeringField,
  farhanStretchOnly, sanaOtherProfession, sanaOtherProfessionQa9, sanaTechnicianQualification, yearsFarAbove, sanaStretchOnly, sanaStretchOnlyQa9,
  languageHardRequired, AVOID_TITLE_CAP, UNDER_LEVEL_CAP, RULES_MARKER } from '../worker/discovery.ts';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, total_years_experience: 9,
  primary_skills: JSON.stringify(['HubSpot', 'Workflow Automation', 'CRM Configuration', 'Zapier', 'Process Design', 'API Integrations', 'Product Implementation']),
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Automation Specialist', 'Revenue Operations Specialist', 'CRM Operations Specialist']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, total_years_experience: 9.2,
  primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis', 'Breakdown Maintenance', 'Maintenance Planning', 'Industrial Utilities']),
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)', 'Plant Engineer']) };
const evF = (title, description, o = {}) => evaluate(farhan, { id: 'x', title, company: o.company || 'Acme', url: 'https://e.com/x', location: o.location ?? 'Remote - India', description, remote: true, source: 'greenhouse' });
const evS = (title, description, o = {}) => evaluate(sana, { id: 'x', title, company: o.company || 'Acme Industries', url: 'https://e.com/x', location: o.location ?? 'Pune, Maharashtra, India', description, remote: false, source: 'successfactors' });
const pad = (s) => s + ' We offer a competitive package, medical cover and annual leave in line with local law. Applicants should send a CV in English.';
const PLANT = 'Plan preventive and breakdown maintenance of the boilers, compressors and pumps in our continuous-process plant, lead root cause analysis and run the utilities and spares.';

test('marker: the rules changed, so every stored row is re-scored once (profile_v25, bumped again by later rule changes)', () => {
  const v = /^profile_v(\d+)$/.exec(RULES_MARKER);
  assert.ok(v && Number(v[1]) >= 25, RULES_MARKER);
});

// ---- Farhan ----------------------------------------------------------------------------------------------------------------------------------------
const CRM_DEV = pad('Lead the architecture of our Dynamics 365 CRM. Build and maintain CI/CD pipelines in Azure DevOps for every release, and write custom components with the PowerApps Component Framework (PCF). 10+ years in CRM technology.');
test('Farhan: a CRM consultant title asking CI/CD, DevOps or PCF custom code is developer work, another field', () => {
  assert.equal(farhanCrmDevelopment('CRM Technical Consultant', CRM_DEV), true);
  assert.equal(farhanCrmDevelopment('Salesforce Specialist', pad('Ship plug-ins and custom code through our continuous integration pipeline.')), true);
  assert.match(farhanEngineeringField('CRM Technical Consultant', CRM_DEV), /CRM development/);
  const e = evF('CRM Technical Consultant', CRM_DEV);
  assert.ok(e.score <= AVOID_TITLE_CAP, `${e.score}`);
  assert.match(e.qualification_reason, /CRM development/);
});
test('Farhan near misses: CRM configuration, one passing DevOps word, or an operations title keep their score', () => {
  assert.equal(farhanCrmDevelopment('CRM Consultant', pad('Configure pipelines, workflows and dashboards in HubSpot; work with our DevOps team on data syncs.')), false);
  assert.equal(farhanCrmDevelopment('Marketing Automation & CRM Operations Manager', CRM_DEV), false, 'not a consultant / specialist / architect / developer title');
  assert.equal(farhanCrmDevelopment('Implementation Consultant', CRM_DEV), false, 'no CRM platform in the title');
});

const KYRIBA = pad('Drive treasury system implementations for our Treasury practice: requirements, configuration, testing and training. 3+ years in professional services; 1+ years of Kyriba or TMS implementation experience.');
test('Farhan: implementing a specialist finance or ERP product whose experience is asked is another field', () => {
  assert.equal(farhanFinanceProductImplementation('Kyriba Implementation Senior Analyst', KYRIBA), true);
  assert.equal(farhanFinanceProductImplementation('Implementation Consultant', pad('Finance transformation team. 4+ years of NetSuite implementation for accounting teams.')), true);
  assert.equal(farhanFinanceProductImplementation('Functional Consultant', pad('Payroll rollouts; Workday HCM implementation experience required.')), true);
  const e = evF('Kyriba Implementation Senior Analyst', KYRIBA);
  assert.ok(e.score <= AVOID_TITLE_CAP, `${e.score}`);
  assert.match(e.qualification_reason, /finance or ERP product implementation/);
});
test('Farhan near misses: his CRM platforms, a welcomed ERP integration, or a manager title outside the rule', () => {
  assert.equal(farhanFinanceProductImplementation('Implementation Specialist', pad('3+ years of HubSpot implementation experience for SaaS clients.')), false);
  assert.equal(farhanFinanceProductImplementation('Implementation Manager', pad('Run onboarding projects for customers. Experience integrating with NetSuite is a plus.')), false);
  assert.equal(farhanFinanceProductImplementation('Technical Delivery Manager', KYRIBA), false, 'title is not an implementation / consultant / analyst seat');
});

const PARDOT = pad('Own our top-of-funnel systems. Education and experience: 4+ years in marketing operations. Pardot administration: Salesforce connector, Engagement Studio, form handlers. Write your own SQL reports.');
test('Farhan: a required marketing-automation platform he has not used (Pardot, Marketo, Eloqua) is a stretch, kept off Best matches', () => {
  assert.equal(farhanMarketingPlatformRequired(PARDOT), 'Pardot');
  assert.equal(farhanMarketingPlatformRequired(pad('You bring 3+ years of hands-on Marketo campaign builds.')), 'Marketo');
  assert.equal(farhanMarketingPlatformRequired(pad('Eloqua certification is required.')), 'Eloqua');
  const e = evF('Marketing Automation Manager - Canada, Spain, India', PARDOT);
  assert.equal(e.eligibility, 'ELIGIBLE');
  assert.ok(e.score < farhan.qualification_threshold && e.score >= farhan.qualification_threshold - 10, `${e.score}`);
  assert.match(e.qualification_reason, /requires Pardot/);
});
test('Farhan near misses: a platform only welcomed, or offered beside HubSpot, is not required', () => {
  assert.equal(farhanMarketingPlatformRequired(pad('Experience with Marketo is a plus.')), null);
  assert.equal(farhanMarketingPlatformRequired(pad('3+ years with Marketo or HubSpot workflows.')), null);
  assert.equal(farhanMarketingPlatformRequired(pad('Build HubSpot workflows and lead scoring; no Pardot administration is needed.')), null);
});

const AGENCY = pad('We are hiring a marketing consultant for our client, a growth brand. Manage project timelines in Google Sheets, work on the creative side of marketing projects and coordinate the creative teams with production.');
test('Farhan: an agency placement with its client, framed as a contract or creative-marketing coordination, is a stretch', () => {
  assert.equal(farhanClientPlacement(AGENCY), true);
  assert.equal(farhanClientPlacement(pad('We are recruiting an operations lead on behalf of our client. This is a contract role for 12 months.')), true);
  assert.match(farhanStretchOnly('Project Manager/Business Operations Manager', AGENCY), /agency placement/);
  const e = evF('REMOTE (INDIA): Project Manager/Business Operations Manager', AGENCY);
  assert.ok(e.score < farhan.qualification_threshold, `${e.score}`);
});
test('Farhan near misses: an employer serving its own clients, or a placement with neither framing', () => {
  assert.equal(farhanClientPlacement(pad('We help our clients automate onboarding. Join our creative teams and our creative marketing studio.')), false);
  assert.equal(farhanClientPlacement(pad('We are hiring an implementation manager for our client, a SaaS company. Full-time, permanent.')), false);
});

// ---- Sana: other professions -----------------------------------------------------------------------------------------------------------------------
test('Sana: a civil-only discipline title is another profession; a title listing every discipline is not', () => {
  assert.equal(sanaOtherProfessionQa9('Maintenance Engineer-Civil', PLANT), 'civil engineering');
  const e = evS('Maintenance Engineer-Civil', pad(PLANT));
  assert.ok(e.score <= AVOID_TITLE_CAP, `${e.score}`);
  assert.equal(sanaOtherProfessionQa9('Site Construction/Commissioning Managers (Civil | Mechanical | Electrical | C&I) - Thermal Power', PLANT), null);
});

const INSTR = pad('Allot work to operators. Well experienced in maintenance, troubleshooting and calibration of field instruments. Maintenance schedules for DCS, PLC and field instrument loops. Spares for the instrumentation asset; coordinate instrumentation vendors.');
test('Sana: field-instrument work under a general plant title is C&I; an instrument commissioning title and an electrical post are not', () => {
  assert.equal(sanaOtherProfessionQa9('EXECUTIVE N - PLANT ENGINEERING', INSTR), 'control and instrumentation');
  assert.equal(sanaOtherProfessionQa9('Instrument Engineer (Pre Commissioning Field)', INSTR), null);
  assert.equal(sanaOtherProfessionQa9('Plant Engineering Executive - Electrical', INSTR), null);
  assert.equal(sanaOtherProfessionQa9('Plant Engineer', pad(PLANT + ' Calibrate the instruments on the boilers.')), null, 'one or two instrument words');
});

test('Sana: tool-room jig and fixture design, and a product architect title, are other professions', () => {
  const TOOL = pad('Design and build the tool room: design and modify production jigs, fixtures, gauges and tooling. Maintain the presses.');
  assert.equal(sanaOtherProfessionQa9('Senior Maintenance Engineer', TOOL), 'tool-room and jig design');
  assert.equal(sanaOtherProfessionQa9('Senior Maintenance Engineer', pad(PLANT + ' Keep the light fixtures in the tool room working.')), null, 'no design work');
  assert.equal(sanaOtherProfessionQa9('Senior Engineer II, Product Architect - Smart Energy', PLANT), 'design, product or consultancy');
  assert.equal(sanaOtherProfessionQa9('Reliability Engineer', PLANT), null);
});

const DESIGN = pad('Design mechanical piping and equipment for power generation facilities. Develop P&IDs for steam cycles. Prepare sizing calculations. Required: 7+ years of experience in mechanical design; Professional Engineering registration; Caesar II or AutoPipe.');
test('Sana: consultancy design for power generation (piping, P&IDs, PE registration, design software) is design work', () => {
  assert.equal(sanaOtherProfessionQa9('Senior Engineer - Mechanical - Power Generation', DESIGN), 'design, product or consultancy');
  assert.equal(sanaOtherProfessionQa9('Lead Mechanical Engineer - Turbine Generator', pad('Provide engineering services for turbine-generator units. Review calculation notes. Minimum of 10 years of experience in mechanical design for turbine-generator groups; finite element analysis is an asset.')), 'design, product or consultancy');
  assert.match(sanaOtherProfession('Senior Engineer - Mechanical - Power Generation', DESIGN), /design/);
  const e = evS('Senior Engineer - Mechanical - Power Generation', DESIGN, { location: 'Noida, Uttar Pradesh, India' });
  assert.ok(e.score <= AVOID_TITLE_CAP, `${e.score}`);
});
test('Sana near misses: a maintenance title that reads P&IDs, and plant work with one design word', () => {
  assert.equal(sanaOtherProfessionQa9('Maintenance Engineer', DESIGN), null, 'her own title');
  assert.equal(sanaOtherProfessionQa9('Plant Engineer', pad(PLANT + ' Read P&IDs during shutdowns.')), null);
});

test('Sana: laundry and hospital facilities, an owner\'s engineer for battery storage, and EAM software consulting are other professions', () => {
  assert.equal(sanaOtherProfessionQa9('Maintenance Manager', pad('Lead the maintenance team of our healthcare linen plant. Experience in large laundry management is required.')), 'laundry and hospital facilities');
  assert.equal(sanaOtherProfessionQa9('Facilities Maintenance Manager', pad('Keep our hospital facilities and their chillers running.')), 'laundry and hospital facilities');
  assert.equal(sanaOtherProfessionQa9('Battery Energy Storage System', pad('Act as Owner\'s Engineer on utility-scale projects; 8 years of BESS design, integration and commissioning.')), 'owner\'s-engineer consultancy');
  assert.equal(sanaOtherProfessionQa9('Utilities EAM and Field Service Consultant', pad('Support enterprise asset management platforms such as IBM Maximo and SAP PM/EAM for utility clients: functional design, testing, go-live support.')), 'asset-management software consulting');
});
test('Sana near misses: a food plant, an owner\'s engineer interface on a CCGT site, a reliability consultant using Maximo', () => {
  assert.equal(sanaOtherProfessionQa9('Maintenance Manager', pad(PLANT + ' Our bakery plant runs three shifts.')), null);
  assert.equal(sanaOtherProfessionQa9('Site Engineering Manager - Power Plants - CCGT', pad('Interface with the client, the Owner\'s Engineer team and the EPC contractor on the CCGT power plant.')), null);
  assert.equal(sanaOtherProfessionQa9('Reliability Consultant', pad(PLANT + ' Record work orders in Maximo.')), null);
});

// ---- Sana and Farhan: language, level --------------------------------------------------------------------------------------------------------------
test('both: a required native language other than English is read ("Native Spanish"); native English is not', () => {
  assert.equal(languageHardRequired('Reliability Engineer', 'Native Spanish and intermediate to advanced English proficiency; occasional travel.'), 'Spanish');
  assert.equal(languageHardRequired('Reliability Engineer', 'Native-level Portuguese is needed for this site.'), 'Portuguese');
  assert.equal(languageHardRequired('Reliability Engineer', 'Native English speaker, or fluent English.'), null);
  assert.equal(languageHardRequired('Reliability Engineer', 'Native Spanish speakers welcome; English is our working language.'), null);
});

test('both: experience asked 20+ years, or 8+ beyond the person\'s, is far above them; company history and diploma routes are not the ask', () => {
  assert.equal(yearsFarAbove('A bachelor\'s degree in any engineering with a minimum twenty (20+) years [15 years for UAE Nationals] experience in Oil & Gas.', 9.2), 20);
  assert.equal(yearsFarAbove('Minimum 18 years of experience in power plants.', 9.2), 18);
  assert.equal(yearsFarAbove('Founded by space scientists and alumni with over 20 years of experience in designing launch vehicles.', 9.2), 0);
  assert.equal(yearsFarAbove('B.E. in Mechanical with 15+ years\' experience; Diploma in Mechanical Engineering with 20+ years\' experience.', 9.2), 0);
  assert.equal(yearsFarAbove('11+ years of experience in power plant maintenance.', 9.2), 0, 'a slight stretch stays');
  const e = evS('Commissioning Manager', pad(PLANT + ' Minimum twenty (20+) years of experience in commissioning.'));
  assert.ok(e.score <= UNDER_LEVEL_CAP, `${e.score}`);
  assert.match(e.qualification_reason, /Asks 20\+ years, far above/);
});

const ITI = pad('Operate and maintain the chiller plants; permit to work; preventive maintenance. Requirements: Diploma in Electrical/Mechanical Engineering or relevant ITI holders with minimum 3 years of chiller plant experience. The role may be based at any site.');
test('Sana: a diploma / ITI post is a technician\'s grade; a post that also asks an engineering degree is not', () => {
  assert.equal(sanaTechnicianQualification(ITI), true);
  const e = evS('Operations & Maintenance Specialist', ITI, { location: 'Bangalore' });
  assert.ok(e.score <= UNDER_LEVEL_CAP, `${e.score}`);
  assert.match(e.qualification_reason, /diploma or ITI/);
  assert.equal(sanaTechnicianQualification(pad('B.E. Electrical; ITI electricians report to you; diploma holders in the team.')), false);
  assert.equal(sanaTechnicianQualification(pad('Bachelor\'s degree in Electrical Engineering; supervise ITI technicians and diploma staff.')), false);
});

// ---- Sana: kept but not in Best matches ------------------------------------------------------------------------------------------------------------
test('Sana: a mechanical-only degree, years in a specialist sub-domain, ARCS, advisory commissioning, an FMCG executive grade are stretches', () => {
  assert.equal(sanaStretchOnlyQa9('Senior Maintenance Engineer', 'Qualification: Diploma / B.E. in Mechanical Engineering. 10 to 12 years.', 'Acme'), 'a mechanical-only degree requirement');
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', 'Bachelor\'s degree in Mechanical Engineering required.', 'Acme'), 'a mechanical-only degree requirement');
  assert.match(sanaStretchOnlyQa9('Solar Asset Manager', '10 to 15 years in power. At least 5 years in a Solar Asset Management or Solar O&M leadership role.', 'Acme'), /specialist sub-domain/);
  assert.match(sanaStretchOnlyQa9('Field Service Engineer', '5 Years of experience in HVDC/HVAC systems and substations.', 'Acme'), /specialist sub-domain/);
  assert.match(sanaStretchOnlyQa9('Senior Energy Engineer', '10-14 years in industrial energy management, renewable energy, or electricity procurement.', 'Acme'), /specialist sub-domain/);
  assert.match(sanaStretchOnlyQa9('Maintenance Engineer', 'Minimum of 4+ years of hands-on furnace maintenance experience.', 'Acme'), /specialist sub-domain/);
  assert.match(sanaStretchOnlyQa9('ARCS Engineer- Solar PV', 'Minimum 7 years in electrical maintenance.', 'Acme'), /robotic-cleaning/);
  assert.match(sanaStretchOnlyQa9('Manager | Commissioning manager', '10+ years in commissioning of thermal power plants.', 'Deloitte Shared Services India LLP'), /advisory or consulting/);
  assert.match(sanaStretchOnlyQa9('SENIOR EXECUTIVE - PLANT ENGINEERING', PLANT, 'Asian Paints Ltd'), /consumer-goods or paints/);
  assert.match(sanaStretchOnlyQa9('O&M Mechanical Engineer', 'Operate and maintain the gas-engine power plant.', 'TAQA Arabia', ''), /employer abroad/);
  assert.match(sanaStretchOnly('Maintenance Engineer', 'Understanding of CNC machines and PLCs. PLC Program and troubleshooting. Hands-on MES.', 'Acme', 9.2), /discrete manufacturing/);
  const e = evS('Senior Maintenance Engineer - Plant Maintenance', pad(PLANT + ' Qualification: Diploma / B.E. in Mechanical Engineering.'));
  assert.equal(e.eligibility, 'ELIGIBLE');
  assert.ok(e.score < sana.qualification_threshold && e.score >= sana.qualification_threshold - 10, `${e.score}`);
  assert.match(e.qualification_reason, /mechanical-only degree/);
});
test('Sana near misses: degrees beside electrical, general years, an operator\'s commissioning post, a cement executive, an Indian place', () => {
  assert.equal(sanaStretchOnlyQa9('Reliability Engineer', 'Bachelor\'s degree in electrical, Mechanical, Instrumentation or Chemical engineering.', 'Acme'), null);
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', 'B.E. in Mechanical or Electrical Engineering.', 'Acme'), null);
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', 'Degree in Mechanical Engineering, Industrial Engineering, or a related field.', 'Acme'), null);
  assert.equal(sanaStretchOnlyQa9('Solar Asset Manager', '10 to 15 years of experience in renewable energy, power generation, or utility operations.', 'Acme'), null);
  assert.equal(sanaStretchOnlyQa9('Commissioning Manager', '10+ years in commissioning of thermal power plants.', 'Adani Power'), null);
  assert.equal(sanaStretchOnlyQa9('Senior Executive - Electrical Maintenance', PLANT, 'UltraTech Cement'), null);
  assert.equal(sanaStretchOnlyQa9('O&M Mechanical Engineer', 'Operate and maintain the gas-engine power plant near Pune, India.', 'TAQA Arabia', ''), null);
  assert.equal(sanaStretchOnlyQa9('O&M Mechanical Engineer', 'Operate and maintain the gas-engine power plant.', 'TAQA Arabia', 'Cairo, Egypt'), null, 'a stated place is read by the place rules');
  assert.equal(sanaStretchOnly('Maintenance Engineer', 'Maintain the CNC workshop of the plant.', 'Acme', 9.2), null);
});

// ---- Review of PR #245: near misses for each rule, and the remote operations-centre cap ----------------------------------------------------------
test('review 1: a company blurb\'s years are not the ask; the applicant\'s are', () => {
  assert.equal(yearsFarAbove('We are a power company with 25+ years of experience in thermal generation. You have 8+ years of plant maintenance.', 9.2), 0);
  assert.equal(yearsFarAbove('Our group has 30 years of experience building plants. Minimum 8 years in maintenance.', 9.2), 0);
  assert.equal(yearsFarAbove('Requirements: • 20+ years of experience in plant operations.', 9.2), 20);
  assert.equal(yearsFarAbove('Candidates should have 22 years of experience in power plants.', 9.2), 22);
});
test('review 2: hospital facilities as a perk or township amenity are not hospital work', () => {
  assert.equal(sanaOtherProfessionQa9('Maintenance Manager', pad(PLANT + ' The plant township offers housing, a school and hospital facilities for families.')), null);
  assert.equal(sanaOtherProfessionQa9('Facilities Maintenance Manager', pad(PLANT + ' Benefits include medical and hospital facilities for employees.')), null);
  assert.equal(sanaOtherProfessionQa9('Facilities Maintenance Manager', pad('Maintain the hospital facilities and their chillers for our healthcare group.')), 'laundry and hospital facilities');
});
test('review 3: a designated tool room is not tool-room design', () => {
  assert.equal(sanaOtherProfessionQa9('Senior Maintenance Engineer', pad(PLANT + ' Store jigs and fixtures in the designated tool room.')), null);
  assert.equal(sanaOtherProfessionQa9('Senior Maintenance Engineer', pad('Run the tool room: designing jigs and fixtures for the press line.')), 'tool-room and jig design');
});
test('review 4: "HubSpot or Marketo" is a choice, not a required platform', () => {
  assert.equal(farhanMarketingPlatformRequired(pad('3+ years with HubSpot or Marketo workflows.')), null);
  assert.equal(farhanMarketingPlatformRequired(pad('Experience administering HubSpot or administering Pardot.')), null);
});
test('review 5: a welcomed finance product, or a transportation TMS, is not a finance implementation', () => {
  assert.equal(farhanFinanceProductImplementation('Implementation Specialist', pad('Onboard finance teams to our SaaS. NetSuite implementation experience is a plus.')), false);
  assert.equal(farhanFinanceProductImplementation('Implementation Analyst', pad('Accounting customers. 2+ years of NetSuite is preferred.')), false);
  assert.equal(farhanFinanceProductImplementation('Implementation Consultant', pad('Roll out our transportation management system for shippers; 3+ years of TMS implementation experience with carriers and freight.')), false);
  assert.equal(farhanFinanceProductImplementation('Implementation Consultant', pad('Treasury practice. 2+ years of TMS implementation experience.')), true);
});
test('review 6: a CRM operations / automation title with custom code actions and a DevOps partner is his own work', () => {
  assert.equal(farhanCrmDevelopment('HubSpot CRM Operations Specialist', pad('Build workflows with custom code actions and partner with DevOps on data syncs.')), false);
  assert.equal(farhanCrmDevelopment('Salesforce Automation Specialist', CRM_DEV), false);
  assert.equal(farhanCrmDevelopment('CRM Consultant', pad('Write custom code for the CRM and partner with DevOps.')), false, 'two weak kinds, no CI/CD or PCF');
});
test('review 7: a graduate engineer who supervises ITI fitters is not a technician post', () => {
  assert.equal(sanaTechnicianQualification(pad('Graduate in Electrical Engineering with 8 years; supervise ITI fitters and diploma technicians.')), false);
  assert.equal(sanaTechnicianQualification(pad('b.tech electrical; lead a team of ITI and diploma staff.')), false);
  assert.equal(sanaTechnicianQualification(pad('Lead ITI fitters and diploma technicians on shifts.')), false, 'the team\'s qualification, not the applicant\'s');
  assert.equal(sanaTechnicianQualification(pad('Qualification: ITI or Diploma in Electrical with 5 years.')), true);
});
test('review 8: mechanical aptitude is not a mechanical degree', () => {
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', 'Degree holders with strong mechanical aptitude and plant experience.', 'Acme'), null);
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', 'B.E. / Mechanical Engineering.', 'Acme'), 'a mechanical-only degree requirement');
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', 'BE Mechanical Engineer with 7 years.', 'Acme'), 'a mechanical-only degree requirement');
});
test('review 9: boiler-furnace maintenance at a power plant is her work, not a furnace niche', () => {
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', '8+ years in boiler and furnace maintenance at a thermal power plant.', 'Acme'), null);
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', '5+ years of experience with furnaces in our plant.', 'Acme'), null, 'a bare furnace word');
  assert.match(sanaStretchOnlyQa9('Maintenance Engineer', '5+ years of experience maintaining induction furnaces.', 'Acme'), /specialist sub-domain/);
});
test('review 10: onboarding for our clients on a contract is not an agency placement', () => {
  assert.equal(farhanClientPlacement(pad('We are hiring a specialist to run onboarding for our clients. This is a contract role.')), false);
  assert.equal(farhanClientPlacement(pad('We are hiring a RevOps lead for our clients across EMEA; long-term contract.')), false);
  assert.equal(farhanClientPlacement(pad('You will be placed with our client, a fintech, on a contract basis.')), true);
  assert.equal(farhanClientPlacement(pad('We are hiring an operations manager for our client, a SaaS company. Contract role.')), true);
});
test('Sana: remote operations-centre (ROC) monitoring of plants is Worth a try at most; plant monitoring on site is not', () => {
  const ROC = pad('Monitor plant operations through the ROC, dashboards and historian systems; track plant KPIs and give remote technical support to the plant teams. Root cause analysis of upsets.');
  assert.match(sanaStretchOnlyQa9('Associate Manager Operations & Maintenance - Onsite Operations', ROC, 'Linde'), /remote operations-centre/);
  const e = evS('Associate Manager Operations & Maintenance', ROC);
  assert.equal(e.eligibility, 'ELIGIBLE');
  assert.ok(e.score < sana.qualification_threshold, `${e.score}`);
  assert.equal(sanaStretchOnlyQa9('Maintenance Engineer', pad(PLANT + ' Monitor plant performance on the DCS during shifts.'), 'Acme'), null);
});
