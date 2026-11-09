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
