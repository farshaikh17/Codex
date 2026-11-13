// Plan B2 (phase 4): a posting listed as "N Locations" (or with no location) whose text names only places outside India and the Gulf is abroad for
// Sana's visa-route cap; one whose text names an Indian or Gulf place, or no place at all, is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, abroadByDescription, VISA_UNLIKELY_CAP } from '../worker/discovery.ts';

const sana = { id: 'sana_ansari', primary_skills: JSON.stringify(['Reliability', 'Preventive Maintenance', 'Root Cause Analysis']), total_years_experience: 9, qualification_threshold: 60 };
const post = (location, description) => ({ id: 'x', title: 'Maintenance Engineer', url: 'https://example.com/x', location, description, remote: false });
const TX = 'Join our team at the Baytown, Texas and Houston refinery sites. Reliability, preventive maintenance and root cause analysis for rotating equipment.';

test('the rule itself', () => {
  assert.equal(abroadByDescription('3 Locations', TX), true);
  assert.equal(abroadByDescription('', 'Maintenance at our plants in Germany and the Netherlands.'), true);
  assert.equal(abroadByDescription('1 Location', 'Sites in Rotterdam.'), true);
  assert.equal(abroadByDescription('16 Locations', 'Primary job location options include: Archbold OH, Troy OH, Centralia IL, Waterloo IA.'), true, 'US sites written without commas');
  assert.equal(abroadByDescription('2 Locations', 'Plants at Hosur TN and Chennai.'), false, 'TN with an Indian place is Tamil Nadu');
  assert.equal(abroadByDescription('2 Locations', 'Report to the Plant Head. Power BI and SAP PM skills. Work with the PA team.'), false, 'no state code read in ordinary words');
  assert.equal(abroadByDescription('3 Locations', 'Plants in Pune, India and Houston, Texas.'), false, 'an Indian place too');
  assert.equal(abroadByDescription('2 Locations', 'Sites in Jubail and Houston.'), false, 'a Gulf place too');
  assert.equal(abroadByDescription('4 Locations', 'Reliability and maintenance of rotating equipment.'), false, 'no place named');
  assert.equal(abroadByDescription('Houston, Texas', TX), false, 'a real location is judged by itself (foreignLocation)');
  assert.equal(abroadByDescription('3 Locations', 'Open to candidates anywhere except the US. Rotating equipment.'), false, 'an excluded place is not a place');
});

test('Sana: an "N Locations" posting written about Texas sites is capped like any on-site role abroad with no visa route', () => {
  const abroad = evaluate(sana, post('3 Locations', TX));
  assert.ok(abroad.score <= VISA_UNLIKELY_CAP, `score ${abroad.score}`);
  assert.match(abroad.qualification_reason, /no visa route/);
  const sponsored = evaluate(sana, post('3 Locations', TX + ' Visa sponsorship available.'));
  assert.ok(sponsored.score > VISA_UNLIKELY_CAP, 'a stated visa route lifts the cap');
  const india = evaluate(sana, post('3 Locations', 'Plants at Jamnagar and Dahej. Reliability, preventive maintenance and root cause analysis.'));
  assert.ok(india.score > VISA_UNLIKELY_CAP && !/no visa route/.test(india.qualification_reason));
  const listed = evaluate(sana, post('Baytown; Houston; +1 more (United States)', TX));
  assert.ok(listed.score <= VISA_UNLIKELY_CAP, 'the stored places (Workday detail) are read like any location');
});
