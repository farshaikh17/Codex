// The static shell is public (anyone can fetch /assets/*.js). It must hold no secrets and no candidate profile data;
// all of that is served only through the authenticated API. Run after `npm run build:frontend`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const bundle = () => { assert.ok(fs.existsSync(dist), 'frontend/dist is missing: build the frontend first'); return files(dist).filter((f) => /\.(js|css|html|map|json|txt|svg)$/.test(f)).map((f) => [path.relative(dist, f), fs.readFileSync(f, 'utf8')]); };

test('public assets contain no candidate profile data', () => {
  const forbidden = [/RRVUNL/i, /Mianro/i, /Chhabra/i, /Rajasthan/i, /Glow ?Up/i, /Rippling/i, /\bKota\b/, /\bBMS\b/, /B\.Tech/i,
    /1,?20,?000/, /₹\s?25/, /14\.4\s?L/i, /Bengaluru|Hyderabad|Chennai|Mumbai|\bPune\b/, /notice period of/i];
  for (const [name, text] of bundle()) for (const rx of forbidden) assert.ok(!rx.test(text), `${name} contains ${rx}`);
});

test('public assets contain no secrets or key-shaped values', () => {
  const secretShapes = [/ADMIN_API_KEY\s*[:=]\s*['"][^'"]{6,}/, /(unit-test-key|e2e-local-test-key|test-admin-secret)/, /ghp_[A-Za-z0-9]{20,}/, /github_pat_/,
    /sk-[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE/, /CLOUDFLARE_API_TOKEN\s*[:=]/, /Bearer\s+[A-Za-z0-9._-]{24,}/];
  for (const [name, text] of bundle()) for (const rx of secretShapes) assert.ok(!rx.test(text), `${name} matches ${rx}`);
});

test('the shell does not embed the production database or account identifiers', () => {
  for (const [name, text] of bundle()) assert.ok(!/819f9296-661a-46bc-8d44-135dca005e42|c7e866f95a4275de2719647dd2bc4f34/.test(text), `${name} embeds a Cloudflare identifier`);
});

test('public assets name no AI tool, model or assistant (code QA F2, 13 Nov)', () => {
  const names = [/antigravity/i, /\bgpt-?\d/i, /gpt-4o/i, /chatgpt/i, /\bopenai\b/i, /\bclaude\b/i, /anthropic/i, /\bsonnet\b/i, /\bgemini\b/i, /\bcopilot\b/i, /\bllama\b/i, /\bmistral\b/i];
  for (const [name, text] of bundle()) for (const rx of names) assert.ok(!rx.test(text), `${name} contains ${rx}`);
});
