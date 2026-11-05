/**
 * Regression Test: authedFetch Contract Verification
 * 
 * Portably loads and executes the actual frontend/src/api.ts from the deliverable source tree.
 * Supports both standalone execution (clean extracted ZIP) and repo execution without hardcoded absolute paths.
 * 
 * Asserts:
 * 1. Exactly ONE network fetch call occurs per invocation (no recursive self-call).
 * 2. Correct Authorization: Bearer <token> header is attached when token is in sessionStorage.
 * 3. Custom headers supplied by caller are preserved.
 * 4. 401 and 403 HTTP responses trigger window 'operator-auth-required' event.
 * 5. 200 OK responses pass through without triggering event.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Locate frontend/src/api.ts across extraction topologies:
// 1. Clean ZIP extraction: __dirname/../source_tree/frontend/src/api.ts
// 2. Repo root execution: __dirname/frontend/src/api.ts or __dirname/../frontend/src/api.ts
const candidatePaths = [
  path.resolve(__dirname, '../source_tree/frontend/src/api.ts'),
  path.resolve(__dirname, 'source_tree/frontend/src/api.ts'),
  path.resolve(__dirname, '../frontend/src/api.ts'),
  path.resolve(__dirname, 'frontend/src/api.ts')
];

let apiTsPath = candidatePaths.find(p => fs.existsSync(p));
if (!apiTsPath) {
  console.error('FATAL: Could not locate frontend/src/api.ts in candidate paths:', candidatePaths);
  process.exit(1);
}

console.log(`[INFO] Found authentic api.ts at: ${apiTsPath}`);

// Mock browser environment (window, sessionStorage, Headers, CustomEvent)
class MockHeaders {
  constructor(init) {
    this.map = {};
    if (init) {
      if (init instanceof MockHeaders) {
        Object.assign(this.map, init.map);
      } else if (typeof init === 'object') {
        for (const [k, v] of Object.entries(init)) {
          this.map[k.toLowerCase()] = v;
        }
      }
    }
  }
  get(key) {
    return this.map[key.toLowerCase()] || null;
  }
  set(key, val) {
    this.map[key.toLowerCase()] = val;
  }
  has(key) {
    return key.toLowerCase() in this.map;
  }
  entries() {
    return Object.entries(this.map);
  }
}

global.Headers = MockHeaders;

const mockSessionStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

const dispatchedEvents = [];
const mockWindow = {
  sessionStorage: mockSessionStorage,
  dispatchEvent(event) {
    dispatchedEvents.push(event);
  }
};

global.window = mockWindow;
global.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

let fetchCallCount = 0;
let lastFetchInput = null;
let lastFetchInit = null;
let mockFetchStatus = 200;

global.fetch = async (input, init) => {
  fetchCallCount++;
  lastFetchInput = input;
  lastFetchInit = init;
  return {
    status: mockFetchStatus,
    ok: mockFetchStatus >= 200 && mockFetchStatus < 300,
    headers: new MockHeaders({ 'content-type': 'application/json' }),
    json: async () => ({ status: 'mock-response' })
  };
};

// Compile and load authedFetch from api.ts portably
let authedFetch = null;

// Strategy A: If esbuild is available in the environment, use it to compile api.ts
try {
  const esbuild = require('esbuild');
  const result = esbuild.buildSync({
    entryPoints: [apiTsPath],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node'
  });
  const outputCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const runner = new Function('module', 'exports', 'require', 'window', 'Headers', 'CustomEvent', 'fetch', outputCode);
  runner(mod, mod.exports, require, mockWindow, MockHeaders, global.CustomEvent, global.fetch);
  authedFetch = mod.exports.authedFetch;
} catch (e) {
  // Strategy B: Zero-dependency portable TypeScript extractor for clean extraction environments
  const tsContent = fs.readFileSync(apiTsPath, 'utf8');
  const mSession = tsContent.match(/export function getSessionAuthKey[\s\S]*?^}/m) ||
                   tsContent.match(/function getSessionAuthKey[\s\S]*?^}/m);
  const mAuthed = tsContent.match(/export async function authedFetch[\s\S]*?^}/m) ||
                  tsContent.match(/async function authedFetch[\s\S]*?^}/m);

  if (!mSession || !mAuthed) {
    throw new Error('Could not find getSessionAuthKey or authedFetch in api.ts');
  }

  const jsCode = (mSession[0] + '\n' + mAuthed[0])
    .replace(/^export\s+/gm, '')
    .replace(/:\s*string\s*\|\s*null/g, '')
    .replace(/\(input: RequestInfo \| URL, init\?: RequestInit\): Promise<Response>/g, '(input, init)');

  const factory = new Function('Headers', 'CustomEvent', 'window', 'fetch', jsCode + '\nreturn { getSessionAuthKey, authedFetch };');
  const loaded = factory(MockHeaders, global.CustomEvent, mockWindow, global.fetch);
  authedFetch = loaded.authedFetch;
}

if (typeof authedFetch !== 'function') {
  console.error('FATAL: authedFetch could not be instantiated from api.ts');
  process.exit(1);
}

async function runRegressionSuite() {
  console.log('=== Regression Test: authedFetch Implementation Verification ===\n');

  // Test 1: Exactly ONE network fetch call occurs (no recursion)
  fetchCallCount = 0;
  mockFetchStatus = 200;
  mockSessionStorage.removeItem('admin_session_key');
  const res1 = await authedFetch('/api/jobs');
  assert.strictEqual(fetchCallCount, 1, 'FATAL: fetchCallCount should be exactly 1 (no recursive call)!');
  assert.strictEqual(res1.status, 200);
  console.log('  [PASS] 1. Single network call confirmed on actual application api.ts (no recursion, fetchCallCount = 1).');

  // Test 2: Correct Authorization: Bearer <token> header attached when present
  fetchCallCount = 0;
  mockSessionStorage.setItem('admin_session_key', 'valid-operator-secret-123');
  await authedFetch('/api/jobs');
  assert.strictEqual(fetchCallCount, 1);
  const authHeader = lastFetchInit.headers.get('Authorization');
  assert.strictEqual(authHeader, 'Bearer valid-operator-secret-123', 'FATAL: Authorization header missing or incorrect!');
  console.log('  [PASS] 2. Authorization Bearer header correctly attached from sessionStorage.');

  // Test 3: Existing headers and options preserved
  fetchCallCount = 0;
  await authedFetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Custom-Client': 'qa-test' }
  });
  assert.strictEqual(fetchCallCount, 1);
  assert.strictEqual(lastFetchInit.method, 'POST');
  assert.strictEqual(lastFetchInit.headers.get('Content-Type'), 'application/json');
  assert.strictEqual(lastFetchInit.headers.get('X-Custom-Client'), 'qa-test');
  assert.strictEqual(lastFetchInit.headers.get('Authorization'), 'Bearer valid-operator-secret-123');
  console.log('  [PASS] 3. Caller headers and HTTP options preserved.');

  // Test 4: 401 Unauthorized triggers 'operator-auth-required' event
  dispatchedEvents.length = 0;
  mockFetchStatus = 401;
  const res401 = await authedFetch('/api/private/data');
  assert.strictEqual(res401.status, 401);
  assert.strictEqual(dispatchedEvents.length, 1, 'Expected 1 event dispatched for 401');
  assert.strictEqual(dispatchedEvents[0].type, 'operator-auth-required');
  assert.strictEqual(dispatchedEvents[0].detail.status, 401);
  assert.strictEqual(dispatchedEvents[0].detail.url, '/api/private/data');
  console.log('  [PASS] 4. HTTP 401 response dispatches operator-auth-required window event.');

  // Test 5: 403 Forbidden triggers 'operator-auth-required' event
  dispatchedEvents.length = 0;
  mockFetchStatus = 403;
  const res403 = await authedFetch('/api/private/admin');
  assert.strictEqual(res403.status, 403);
  assert.strictEqual(dispatchedEvents.length, 1, 'Expected 1 event dispatched for 403');
  assert.strictEqual(dispatchedEvents[0].type, 'operator-auth-required');
  assert.strictEqual(dispatchedEvents[0].detail.status, 403);
  console.log('  [PASS] 5. HTTP 403 response dispatches operator-auth-required window event.');

  // Test 6: 200 OK does NOT dispatch 'operator-auth-required' event
  dispatchedEvents.length = 0;
  mockFetchStatus = 200;
  await authedFetch('/api/jobs');
  assert.strictEqual(dispatchedEvents.length, 0, 'No event should be dispatched for 200 OK');
  console.log('  [PASS] 6. HTTP 200 response does not trigger operator-auth-required event.');

  // Test 7: a write with no operator key never leaves the browser; it asks for the unlock window instead
  fetchCallCount = 0; dispatchedEvents.length = 0; mockSessionStorage.removeItem('admin_session_key'); mockFetchStatus = 200;
  await assert.rejects(() => authedFetch('/api/applications', { method: 'POST', body: '{}' }), /Operator sign-in is required/);
  assert.strictEqual(fetchCallCount, 0, 'FATAL: an anonymous write must not be sent');
  assert.strictEqual(dispatchedEvents.length, 1);
  assert.strictEqual(dispatchedEvents[0].detail.write, true);
  console.log('  [PASS] 7. Anonymous writes are blocked in the browser and request the operator sign-in.');

  // Test 8: public reads send no Authorization header and a refused read does not request the unlock window
  fetchCallCount = 0; dispatchedEvents.length = 0; mockFetchStatus = 401;
  await authedFetch('/api/jobs?candidate_id=farhan_shaikh');
  assert.strictEqual(lastFetchInit.headers.has('Authorization'), false, 'a visitor sends no key');
  assert.strictEqual(dispatchedEvents[0].detail.write, false, 'a refused READ must not open the unlock window');
  assert.strictEqual(dispatchedEvents[0].detail.hadKey, false);
  console.log('  [PASS] 8. Public reads carry no key; a refused read does not ask for the unlock window.');

  console.log('\n>>> All authedFetch regression assertions PASSED on actual application api.ts! <<<\n');
}

runRegressionSuite().catch(err => {
  console.error('FATAL Test Failure:', err);
  process.exit(1);
});
