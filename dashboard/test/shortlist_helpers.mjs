// Test helpers for the automatic shortlist (plan phase 3): the real pool export (engine/dataset_discovery.py shortlist_pool(), run by Python on a
// copy of the test database) followed by the real selector (scripts/shortlist_select.mjs). Nothing here talks to Cloudflare.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectShortlist, selectionSql } from '../scripts/shortlist_select.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY = `import json, sqlite3, sys
from engine import dataset_discovery as dd
db = sqlite3.connect(sys.argv[1]); db.row_factory = sqlite3.Row
dd.d1 = lambda sql, local=None: [dict(r) for r in db.execute(sql).fetchall()]
print(json.dumps({'rows': dd.shortlist_pool()}))`;

/** The pool export, run on a copy of the node:sqlite database. */
export function exportPool(sqlite) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-'));
  const file = path.join(dir, 'db.sqlite');
  sqlite.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  try { return JSON.parse(execFileSync('python3', ['-c', PY, file], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Export, select and apply the selection's SQL to the same database. */
export function selectInto(sqlite, opts = {}) {
  const pool = exportPool(sqlite);
  const res = selectShortlist(pool.rows, opts);
  const sql = selectionSql(res.changes);
  if (sql) sqlite.exec(sql);
  return { ...res, sql, pool };
}
