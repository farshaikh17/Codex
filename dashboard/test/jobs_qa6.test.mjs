// Jobs QA 6 (20 Nov, owner feedback): a virtual-assistant placement, or a hands-on support or assistant post for one small business, is a gig
// below Farhan's level (a GoHighLevel 'Automation & Customer Support (Gym Business)' post from a firm that places virtual assistants, reporting to
// the gym owner, reached Best matches on its tool words). Positive cases in paraphrased wording and the near misses that keep their score.
// Invented postings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, farhanAssistantGig, AVOID_TITLE_CAP, RULES_MARKER } from '../worker/discovery.ts';

const farhan = { id: 'farhan_shaikh', qualification_threshold: 70, total_years_experience: 9,
  primary_skills: JSON.stringify(['GoHighLevel', 'Workflow Automation', 'CRM Configuration', 'Zapier', 'Process Design']),
  target_roles: JSON.stringify(['Technical Operations Lead', 'Implementation Manager', 'Automation Specialist', 'Revenue Operations Specialist']) };
const sana = { id: 'sana_ansari', qualification_threshold: 60, primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis']), total_years_experience: 9,
  target_roles: JSON.stringify(['Reliability Engineer', 'Maintenance Engineer (Power Plant)']) };
const WORK = 'Build GoHighLevel workflow automation, configure the CRM pipelines and connect tools with Zapier. Design the process and document it. '.repeat(3)
  + 'This is a fully remote role open to candidates based in India. ';
const FLOOR = farhan.qualification_threshold - 10;   // Worth a try
const ev = (title, description, company = 'Acme', cand = farhan) =>
  evaluate(cand, { id: 'x', title, company, url: 'https://e.com/x', location: 'Remote - India', description, remote: true });

const GIGS = [
  // the owner's example, reworded: a VA firm hiring for a client gym, first-line support to the owner and front desk
  ['GHL Automation Specialist & Customer Support (Fitness Studio)', 'BrightDesk Assist',
    'BrightDesk matches skilled virtual assistants with growing small businesses. We are recruiting for our client, a US fitness studio. '
    + WORK + 'You will be first-line support for the studio owner and the front-desk team. Reports to: Studio Owner. 2+ years of GoHighLevel experience.'],
  // a VA firm by name, an assistant title
  ['CRM Automation Virtual Assistant', 'Prime Virtual Assistants LLC', WORK + 'Experience: 1+ years of hands-on CRM experience.'],
  // a VA firm by its own words and a hands-on post asking 3 years, no assistant word in the title
  ['Automation Specialist', 'Northwind Remote', 'We place remote assistants with coaches and consultants across the US. ' + WORK + '3+ years of automation experience.'],
  // a recruiter 'on behalf of our client' for a support post
  ['Automation Specialist', 'Talentbridge', 'We are hiring on behalf of our client, a dental practice in Texas. ' + WORK + 'Provide first line technical support to the practice manager and front desk staff.'],
  // no agency: hands-on support for the owner of one small business
  ['Automation Specialist (Salon)', 'Glow Salon', WORK + 'You will report directly to the salon owner and act as the front desk\'s go-to support for the booking system.'],
  // an assistant title asking at most 3 years
  ['Automation Assistant', 'Acme', WORK + '2 years of experience with workflow tools.'],
  // 'senior' does not lift an assistant post
  ['Senior Virtual Assistant - CRM & Automation', 'Acme', WORK + 'Support the business owner with admin and inbox work. 3 years of experience.'],
];

const KEEP = [
  // HighLevel's own employee roles (India remote)
  ['Sr. Revenue Operations Analyst', 'GoHighLevel', 'HighLevel is an all-in-one platform for agencies and small businesses. ' + WORK + 'Support the agency owners who run on our platform. 5+ years of experience.'],
  ['Sr. Project Manager', 'GoHighLevel', 'HighLevel serves gym, salon and clinic owners through 60,000 agencies. ' + WORK + '6+ years of project management experience.'],
  // a senior implementation post through a staffing agency
  ['Senior Implementation Manager', 'Apex Staffing', 'We are hiring on behalf of our client, a SaaS company. ' + WORK + 'Provide first-line support to customers during go-live. 8+ years of experience.'],
  // a SaaS product for gym owners (the customers own gyms, the job does not assist one)
  ['Automation Specialist', 'GymFlow', 'GymFlow helps gym owners grow memberships. ' + WORK + '4+ years of experience.'],
  // first-line support named, but for a software company's customers, not one small business, and no placement firm
  ['Implementation Specialist', 'Acme', WORK + 'Provide first-line support to customers during onboarding. 5+ years of experience.'],
  // a recruiter's posting with no assistant or support framing: the agency penalty only
  ['CRM Automation Specialist', 'Talentbridge', 'On behalf of our client, a fintech scale-up. ' + WORK + '3+ years of experience.'],
  // an assistant manager is a manager grade, not an assistant post
  ['Assistant Manager - CRM Automation', 'Acme', WORK + '3 years of experience.'],
  // a tools vendor whose customers are virtual assistants
  ['Automation Specialist', 'Acme', 'We provide tools to virtual assistants and agencies. ' + WORK + '5+ years of experience.'],
];

test('marker: the rules changed, so every stored row is re-scored once (profile_v21)', () => {
  assert.equal(RULES_MARKER, 'profile_v21');
});

test('Farhan: a virtual-assistant placement or hands-on support post for one small business is capped below Worth a try', () => {
  for (const [title, company, description] of GIGS) {
    assert.ok(farhanAssistantGig(title, description, company), `read: ${title} | ${company}`);
    const r = ev(title, description, company);
    assert.ok(r.score <= AVOID_TITLE_CAP && r.score < FLOOR, `${title} | ${company}: ${r.score}`);
    assert.match(r.qualification_reason, /below the candidate's level \(score capped\)/, title);
  }
  // without the placement and small-business framing the same work would reach Worth a try
  const base = ev('Automation Specialist', WORK);
  assert.ok(base.score >= FLOOR, `baseline: ${base.score}`);
});

test('Farhan: senior employee roles, a staffing agency\'s senior implementation post and product companies are not read as assistant gigs', () => {
  for (const [title, company, description] of KEEP) {
    assert.equal(farhanAssistantGig(title, description, company), null, `${title} | ${company}`);
    const r = ev(title, description, company);
    assert.doesNotMatch(r.qualification_reason, /below the candidate's level \(score capped\)/, title);
    assert.ok(r.score > AVOID_TITLE_CAP, `${title} | ${company}: ${r.score}`);
  }
});

test('Sana is not read by the rule', () => {
  const [title, company, description] = GIGS[0];
  const r = ev(title, description, company, sana);
  assert.doesNotMatch(r.qualification_reason, /below the candidate's level \(score capped\)/);
});
