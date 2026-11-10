import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('a zero new-job limit produces no new jobs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-zero-'));
  try {
    const candidates = join(dir, 'candidates.json'), input = join(dir, 'matches.json'), out = join(dir, 'apply.sql');
    writeFileSync(candidates, JSON.stringify([{id:'farhan_shaikh', primary_skills:'[]'}]));
    writeFileSync(input, JSON.stringify({jobs:[{id:'one',title:'Implementation Manager',company:'Example',url:'https://example.com/job',location:'Remote - India',is_remote:true,description:'Fully remote role in India',candidates:['farhan_shaikh']}]}));
    execFileSync(process.execPath, ['scripts/dataset_apply.mjs','--candidates',candidates,'--in',input,'--out',out,'--max-new','0'], {cwd:new URL('..', import.meta.url)});
    const report = JSON.parse(readFileSync(join(dir, 'apply.report.json'), 'utf8'));
    assert.equal(report.new_jobs, 0);
    assert.equal(report.capped, 1);
    assert.doesNotMatch(readFileSync(out, 'utf8'), /INSERT OR IGNORE INTO jobs/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
