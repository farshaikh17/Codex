import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBranch } from '../scripts/cleanup_branches.mjs';

test('cleanup: only branches whose work is in main are deleted; kept, open and unmerged branches stay', () => {
  const d = (b) => decideBranch({ sha: 's1', compare: null, openPr: false, mergedPrShas: [], ...b }).del;
  assert.equal(d({ name: 'main', compare: 'identical' }), false);
  assert.equal(d({ name: 'improvements', compare: 'behind' }), false);
  assert.equal(d({ name: 'build/crawl4ai', compare: 'behind' }), false);
  assert.equal(d({ name: 'feat/x', compare: 'behind' }), true, 'all its commits are in main');
  assert.equal(d({ name: 'feat/x', compare: 'identical' }), true);
  assert.equal(d({ name: 'feat/x', compare: 'diverged', mergedPrShas: ['s1'] }), true, 'squash-merged, nothing added after');
  assert.equal(d({ name: 'feat/x', compare: 'diverged', mergedPrShas: ['s0'] }), false, 'commits were added after the merge');
  assert.equal(d({ name: 'feat/x', compare: 'ahead' }), false, 'unmerged work');
  assert.equal(d({ name: 'feat/x', compare: 'behind', openPr: true }), false, 'an open pull request');
  assert.equal(d({ name: 'qa/old', compare: null }), false, 'cannot tell: kept');
});
