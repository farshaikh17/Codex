"""Daily "still open?" check of the best-ranked jobs (owner decision 2026-11-07).

Three steps, so credentials never reach the step that visits third-party websites:
  --export OUT   (D1 credentials) the 75 best-scored undecided jobs per candidate, with their posting URL; with --pool (plan A1) the shortlist
                 pool's rows come first: the automatic shortlist, then the pool by score, up to 150 per person
  --check  IN    (no credentials) one GET per URL (8 at a time, 8 s each; after 8 minutes it stops and keeps what it has); a job is dead only on HTTP 404/410 twice, or when a known hiring system
                 says so (a Greenhouse redirect carrying error=true, a Lever 404); 403/429/5xx/timeouts prove nothing
  --sql    IN    writes SQL: dead jobs are closed (never one with an application or a human decision), live ones get
                 last_verified_at = now
Usage: python engine/liveness.py --export work/liveness_targets.json [--pool work/shortlist_pool.json]
       python engine/liveness.py --check work/liveness_targets.json --out work/liveness_result.json
       python engine/liveness.py --sql work/liveness_result.json --out work/liveness.sql
"""
import argparse
import json
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PER_CANDIDATE = 75
# A Ready / Stretch row the screen shortlisted by itself (dataset_apply.mjs marks its reason) is not a person's decision: it is checked like an
# undecided row and its posting may be closed. A Ready / Stretch row without the mark was set by a person or the first import and stays protected.
AUTO = "x.qualification_status IN ('READY','STRETCH_READY') AND COALESCE(x.qualification_reason,'') LIKE 'Shortlisted automatically.%'"
DECIDED = f"(x.manual_override_status IS NOT NULL OR (x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD') AND NOT ({AUTO})))"
UA = 'Mozilla/5.0 (compatible; career-job-engine/1.0; private job search)'
EXPORT_SQL = f"""WITH protected_jobs AS (
  SELECT job_id FROM applications WHERE job_id IS NOT NULL
  UNION
  SELECT x.job_id FROM candidate_qualifications x WHERE x.job_id IS NOT NULL AND {DECIDED}
)
SELECT id, url FROM (
  SELECT j.id, CASE WHEN j.original_posting_url LIKE 'https://%' THEN j.original_posting_url ELSE j.source_url END AS url,
         ROW_NUMBER() OVER (PARTITION BY s.candidate_id ORDER BY q.qualification_status IN ('READY','STRETCH_READY') DESC, s.overall_score DESC, j.discovered_at DESC) AS rk
  FROM candidate_job_scores s
  JOIN jobs j ON j.id = s.job_id
  JOIN candidate_qualifications q ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id
  WHERE j.is_active = 1
    AND j.id NOT IN (SELECT job_id FROM protected_jobs)
    AND (j.original_posting_url LIKE 'https://%' OR j.source_url LIKE 'https://%')
) WHERE rk <= {PER_CANDIDATE}"""


POOL_PER_CANDIDATE = 150


def pool_targets(pool, per_candidate=POOL_PER_CANDIDATE):
    """Plan A1: the still-open check verifies the shortlist pool first, so the selector (which keeps only rows verified in the last 4 days) can
    choose from it. Per person: the rows on the automatic shortlist now, then the pool by score, at most `per_candidate`; active rows with an
    https posting URL only."""
    out, seen, taken = [], set(), {}
    rows = [r for r in (pool or {}).get('rows', []) if r.get('kind') in ('auto', 'pool') and r.get('active') and str(r.get('url') or '').startswith('https://')]
    rows.sort(key=lambda r: (r['kind'] != 'auto', -(r.get('score') or 0), str(r['job_id'])))
    for r in rows:
        cid = r['candidate_id']
        if taken.get(cid, 0) >= per_candidate or r['job_id'] in seen:
            continue
        seen.add(r['job_id'])
        taken[cid] = taken.get(cid, 0) + 1
        out.append({'id': r['job_id'], 'url': r['url']})
    return out


def merge_targets(first, rest):
    """The pool's targets first, then the usual export's, each job once."""
    seen = {t['id'] for t in first}
    return list(first) + [t for t in rest if t['id'] not in seen]


WORKERS = 8           # parallel requests
TIMEOUT = 8           # seconds per request
DEADLINE = 8 * 60     # seconds: the workflow step stops at 10 minutes, so the check returns what it has well before that


def probe(url, timeout=TIMEOUT):
    """('dead'|'alive'|'unknown', detail)."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.5'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (URLs from our own database, https only)
            final = r.geturl()
            r.read(65536)
            if 'greenhouse.io' in final and 'error=true' in final:
                return 'dead', 'greenhouse error redirect'
            initial_url, final_url = urlsplit(url), urlsplit(final)
            # A generic homepage after a redirect does not prove that a specific posting remains open.
            if initial_url.path.strip('/') and not final_url.path.strip('/'):
                return 'unknown', 'redirected to homepage'
            return 'alive', str(r.status)
    except urllib.error.HTTPError as e:
        return ('dead' if e.code in (404, 410) else 'unknown'), str(e.code)
    except Exception as e:   # timeouts, TLS, DNS: prove nothing
        return 'unknown', type(e).__name__


def _one(url, pause):
    state, _ = probe(url)
    if state == 'dead':   # a second look before anything is closed
        time.sleep(1)
        state, _ = probe(url)
    if pause:
        time.sleep(pause)
    return state


def check(targets, pause=0.3, workers=None, deadline=None):
    """Probe each target (WORKERS at a time). After `deadline` seconds no new probe starts and the result so far is returned,
    so a slow day still writes what it verified instead of nothing. Targets not reached are counted in 'unchecked'."""
    workers = workers or WORKERS
    deadline = DEADLINE if deadline is None else deadline
    out = {'dead': [], 'alive': [], 'unknown': 0, 'unchecked': 0}
    todo, seen = [], set()
    for t in targets:
        if t['id'] not in seen:
            seen.add(t['id'])
            todo.append(t)
    stop_at = time.monotonic() + deadline
    left = lambda: max(0.0, stop_at - time.monotonic())   # noqa: E731
    pool = ThreadPoolExecutor(max_workers=max(1, workers))
    futures = {}
    try:
        for n, t in enumerate(todo):
            while len(futures) >= workers and left() > 0:   # at most `workers` in flight, so nothing new starts after the deadline
                done, _ = wait(list(futures), timeout=left(), return_when=FIRST_COMPLETED)
                for f in done:
                    _record(out, futures.pop(f), f)
            if left() <= 0:
                out['unchecked'] += len(todo) - n
                break
            futures[pool.submit(_one, t['url'], pause)] = t['id']
        done, not_done = wait(list(futures), timeout=left())
        for f in done:
            _record(out, futures.pop(f), f)
        out['unchecked'] += len(not_done)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out


def _record(out, job_id, fut):
    try:
        state = fut.result()
    except Exception:   # noqa: BLE001 - a probe that raised proves nothing
        state = 'unknown'
    if state == 'dead':
        out['dead'].append(job_id)
    elif state == 'alive':
        out['alive'].append(job_id)
    else:
        out['unknown'] += 1


def not_verified_by_host(targets, res, top=10):
    """Tenth-man review (phase 3): which sites never answer the check (403, 429, timeouts), so a source whose rows can never be verified, and so
    never shortlisted, is visible in the run summary. Host names only; the hosts with the most targets left unverified, at most `top`."""
    done = set(res.get('alive', [])) | set(res.get('dead', []))
    counts = {}
    for t in targets:
        if t['id'] in done:
            continue
        host = urlsplit(str(t.get('url') or '')).hostname or '?'
        host = '.'.join(host.split('.')[-3:]) if not host.endswith(('oraclecloud.com', 'myworkdayjobs.com')) else '.'.join(host.split('.')[-2:])
        counts[host] = counts.get(host, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top])


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def to_sql(result, now=None):
    now = now or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    guard = ("AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id) "
             f"AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id AND {DECIDED})")
    lines = []
    for i in range(0, len(result['dead']), 100):
        ids = json.dumps(result['dead'][i:i + 100])
        lines.append(f"UPDATE jobs SET is_active = 0, expired_at = {q(now)} WHERE id IN (SELECT value FROM json_each({q(ids)})) AND is_active = 1 {guard};")
    for i in range(0, len(result['alive']), 100):
        ids = json.dumps(result['alive'][i:i + 100])
        lines.append(f"UPDATE jobs SET last_verified_at = {q(now)} WHERE id IN (SELECT value FROM json_each({q(ids)}));")
    if result['dead']:
        lines.append('UPDATE cache_state SET generation = generation + 1 WHERE id = 1;')
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--export')
    ap.add_argument('--check')
    ap.add_argument('--sql')
    ap.add_argument('--out')
    ap.add_argument('--pool', help='the shortlist pool (engine/dataset_discovery.py --shortlist-pool); its rows are checked first')
    a = ap.parse_args()
    if a.export:
        from engine.dataset_discovery import d1
        first = []
        if a.pool and Path(a.pool).exists():
            try:
                first = pool_targets(json.loads(Path(a.pool).read_text()))
            except ValueError:
                first = []   # an unreadable pool: the usual targets only (the selector does not run without a pool)
        rows = merge_targets(first, d1(EXPORT_SQL))
        Path(a.export).write_text(json.dumps(rows))
        print(json.dumps({'targets': len(rows), 'pool_targets': len(first)}))
    elif a.check:
        targets = json.loads(Path(a.check).read_text())
        res = check(targets)
        Path(a.out).write_text(json.dumps(res))
        print(json.dumps({'targets': len(targets), 'dead': len(res['dead']), 'alive': len(res['alive']),
                          'unknown': res['unknown'], 'unchecked': res['unchecked'], 'not_verified_by_host': not_verified_by_host(targets, res)}))
    elif a.sql:
        Path(a.out).write_text(to_sql(json.loads(Path(a.sql).read_text())))
    else:
        ap.error('one of --export, --check, --sql')


if __name__ == '__main__':
    sys.exit(main())

