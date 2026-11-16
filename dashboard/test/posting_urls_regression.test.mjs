import test from 'node:test';
import assert from 'node:assert/strict';
import { safeApplicationUrl } from '../scripts/posting_urls.mjs';

test('invalid imported application links fall back to the source posting', () => {
  const source = 'https://example.com/jobs/123';
  for (const bad of ['nan', 'None', '', null, 'http://example.com/apply', 'javascript:alert(1)', 'https://user:pass@example.com', 'x'.repeat(2001)]) {
    assert.equal(safeApplicationUrl(bad, source), source);
  }
});
test('valid application links are preferred, and missing links remain unknown', () => {
  assert.equal(safeApplicationUrl('https://example.com/apply', 'https://example.com/job'), 'https://example.com/apply');
  assert.equal(safeApplicationUrl('nan', 'not a URL'), null);
});

// QA 3 F1: an Oracle dataset address opens the Fusion home page; the career site's posting page opens the job.
import { postingUrl } from '../worker/posting_url.ts';

test('an Oracle dataset address becomes the candidate site posting page', () => {
  assert.equal(postingUrl('https://egup.fa.us2.oraclecloud.com/?keyword=&mode=jobs&lang=en&site_number=CX#20279489'),
    'https://egup.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/20279489');
  assert.equal(postingUrl('https://hdga.fa.em3.oraclecloud.com/?keyword=&mode=jobs&lang=en&site_number=Lucyelectric#26296'),
    'https://hdga.fa.em3.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Lucyelectric/job/26296');
  assert.equal(postingUrl('https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1#2439911'),
    'https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/2439911');
  assert.equal(postingUrl('https://EIPN.fa.us2.oraclecloud.com?site_number=CX_1&lang=en#3003063'),
    'https://eipn.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/3003063');
});

test('a posting page, a site home and non-Oracle links are unchanged', () => {
  for (const same of [
    'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345',
    'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1',
    'https://egup.fa.us2.oraclecloud.com/?site_number=CX',              // no job id: nothing to point at
    'https://egup.fa.us2.oraclecloud.com/#123',                          // no site
    'https://egup.fa.us2.oraclecloud.com/?site_number=CX#12 3',          // not an id
    'https://egup.fa.us2.oraclecloud.com/?site_number=C%2FX#123',        // not a site name
    'http://egup.fa.us2.oraclecloud.com/?site_number=CX#123',            // not https
    'https://evil.example/?site_number=CX#123',
    'https://oraclecloud.com.evil.example/?site_number=CX#123',
    'https://boards.greenhouse.io/acme/jobs/1?site_number=CX#1',
    'https://example.com/jobs/123', 'not a url', '',
  ]) assert.equal(postingUrl(same), same, same);
  assert.equal(postingUrl(null), null);
  assert.equal(postingUrl(undefined), undefined);
});

test('the import keeps the fixed link as the application link', () => {
  const ds = 'https://egup.fa.us2.oraclecloud.com/?keyword=&mode=jobs&lang=en&site_number=CX#20279489';
  assert.equal(safeApplicationUrl(ds, ds), 'https://egup.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/20279489');
  assert.equal(safeApplicationUrl('nan', ds), 'https://egup.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/20279489');
  assert.equal(safeApplicationUrl('https://example.com/apply', ds), 'https://example.com/apply');
});
