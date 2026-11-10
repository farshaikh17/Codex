import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../worker/discovery.ts';

const job = description => ({id:'x', title:'Reliability Engineer', company:'Acme', url:'https://example.com/job', location:'New York, US', remote:false, description});
const candidates = [
  {id:'sana_ansari', primary_skills:'[]'},
  {id:'custom', primary_skills:'[]', search_profile:JSON.stringify({role_keywords:['reliability'], avoid_keywords:[], location_mode:'HOME_OR_RELOCATE', home_country:'India', foreign_penalty:false})}
];
test('relocation assistance does not override an explicit sponsorship denial', () => {
  for (const candidate of candidates) {
    const result = evaluate(candidate, job('Relocation assistance is available. Candidates must be legally authorized to work without current or future sponsorship.'));
    assert.equal(result.eligibility, 'UNKNOWN', candidate.id);
    assert.match(result.reason, /no visa sponsorship/i);
  }
});
test('a genuine sponsorship offer remains eligible', () => {
  for (const candidate of candidates) assert.equal(evaluate(candidate, job('Visa sponsorship available.')).eligibility, 'ELIGIBLE');
});
test('worldwide remote is independent of a sponsorship denial', () => {
  const result = evaluate(candidates[0], {...job('Remote worldwide. We cannot provide visa sponsorship.'), remote:true});
  assert.equal(result.eligibility, 'ELIGIBLE');
  assert.match(result.reason, /worldwide/i);
});
