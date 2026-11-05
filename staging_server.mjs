import http from 'http';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { DatabaseSync } from 'node:sqlite';

const distDir = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\farhan-job-engine\\frontend\\dist';
const dbPath = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\farhan-job-engine\\disposable_browser_staging.sqlite';
const workerPath = pathToFileURL('C:\\Users\\admin\\.gemini\\antigravity\\scratch\\farhan-job-engine\\worker_standalone.ts').href;

// 1. Connect to disposable_browser_staging.sqlite
const sqliteDb = new DatabaseSync(dbPath);

// Wrap SQLite into Cloudflare D1 interface
class D1MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }
  bind(...args) {
    this.params = args;
    return this;
  }
  async first() {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params);
    return row || null;
  }
  async all() {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params);
    return { results: rows };
  }
  async run() {
    const stmt = this.db.prepare(this.sql);
    const res = stmt.run(...this.params);
    return { meta: { changes: res.changes } };
  }
}

const mockD1 = {
  prepare(sql) {
    return new D1MockStatement(sqliteDb, sql);
  },
  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      const res = await stmt.run();
      results.push(res);
    }
    return results;
  }
};

const env = {
  DB: mockD1,
  ENVIRONMENT: 'local_rc_staging',
  ADMIN_API_KEY: 'test-admin-secret-xyz'
};

const { default: worker } = await import(workerPath);

// 2. Start Unified Server handling both Static Frontend & Worker API
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3000');

  // Route API calls directly to Cloudflare Worker
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuf = Buffer.concat(chunks);
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : bodyBuf;

    const fetchHeaders = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) fetchHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    const workerReq = new Request(url.href, {
      method: req.method,
      headers: fetchHeaders,
      body
    });

    try {
      const workerResp = await worker.fetch(workerReq, env, {});
      res.writeHead(workerResp.status, Object.fromEntries(workerResp.headers.entries()));
      const respBuf = await workerResp.arrayBuffer();
      res.end(Buffer.from(respBuf));
    } catch (e) {
      console.error('Worker error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Serve static assets from frontend/dist
  let reqPath = url.pathname;
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  let fullPath = path.join(distDir, reqPath);
  if (!fs.existsSync(fullPath)) fullPath = path.join(distDir, 'index.html');

  const ext = path.extname(fullPath).slice(1);
  const mimeMap = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    svg: 'image/svg+xml'
  };
  res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(fullPath));
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Unified Local Staging Server running at http://127.0.0.1:${PORT}`);
});
