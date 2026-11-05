// Disposable local harness: the real Worker (worker/index.ts) on an in-memory SQLite database that has the
// real migrations applied. Nothing here talks to Cloudflare or to production data.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN_KEY = 'unit-test-key-not-a-secret';

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...a) { this.params = a; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(r.changes) } }; }
}

export function createDb() {
  const sqlite = new DatabaseSync(':memory:');
  const dir = path.join(root, 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  const d1 = {
    prepare: (sql) => new Stmt(sqlite, sql),
    async batch(stmts) { const out = []; sqlite.exec('BEGIN'); try { for (const s of stmts) out.push(await s.run()); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; } return out; },
    async exec(sql) { sqlite.exec(sql); return { count: 1 }; },
  };
  return { sqlite, d1 };
}

export async function loadWorker() {
  const mod = await import(pathToFileURL(path.join(root, 'worker', 'index.ts')).href);
  return mod.default;
}

export function makeEnv(d1, extra = {}) {
  // Most tests change rows directly between calls, so the response cache is off unless a test turns it on.
  return { DB: d1, ENVIRONMENT: 'test', ADMIN_API_KEY: ADMIN_KEY, RESPONSE_CACHE: 'off', ...extra };
}

export async function call(worker, env, method, urlPath, { body, key = ADMIN_KEY } = {}) {
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://test.invalid' + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
