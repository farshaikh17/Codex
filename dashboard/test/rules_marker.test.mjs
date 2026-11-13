// R9: the rules marker is written in exactly one place (RULES_MARKER in worker/discovery.ts); every other piece of code imports or reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_MARKER } from '../worker/discovery.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.wrangler', '.git', 'test', 'tests', '__pycache__', 'docs', 'legacy', 'fixtures', 'public', 'migration', 'experiments', 'bench']);
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.tmp')) yield* files(path.join(dir, e.name)); }
    else if (/\.(ts|tsx|mjs|js|py|yml)$/.test(e.name) && !/^test.*\.py$|\.test\.mjs$/.test(e.name)) yield path.join(dir, e.name);
  }
}

test('the marker has the expected shape', () => {
  assert.match(RULES_MARKER, /^profile_v\d+$/);
});

test('the string profile_v<N> appears in the code only where RULES_MARKER is defined', () => {
  const roots = ['dashboard/worker', 'dashboard/scripts', 'dashboard/frontend/src', 'engine', '.github/workflows'].map((r) => path.join(repo, r));
  const hits = [];
  for (const root of roots) for (const f of files(root)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (/profile_v\d/.test(line)) hits.push(`${path.relative(repo, f)}:${i + 1}`); });
  }
  for (const f of fs.readdirSync(repo)) if (/\.py$/.test(f) && !/^test/.test(f) && /profile_v\d/.test(fs.readFileSync(path.join(repo, f), 'utf8'))) hits.push(f);
  const def = fs.readFileSync(path.join(repo, 'dashboard/worker/discovery.ts'), 'utf8').split('\n').findIndex((l) => /^export const RULES_MARKER = 'profile_v\d+';$/.test(l));
  assert.ok(def >= 0, 'the definition line');
  assert.deepEqual(hits, [`dashboard/worker/discovery.ts:${def + 1}`]);
});

test('worker/discovery.ts is not the Worker entry module (exporting a value from the entry stops the Worker starting)', () => {
  const toml = fs.readFileSync(path.join(repo, 'dashboard/wrangler.toml'), 'utf8');
  assert.match(toml, /^main = "worker\/index\.ts"$/m);
});
