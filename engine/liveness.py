"""Daily "still open?" check of the best-ranked jobs (owner decision 2026-11-07).

Three steps, so credentials never reach the step that visits third-party websites:
  --export OUT   (D1 credentials) the 50 best-scored undecided jobs per candidate, with their posting URL
  --check  IN    (no credentials) one GET per URL; a job is dead only on HTTP 404/410 twice, or when a known hiring system
                 says so (a Greenhouse redirect carrying error=true, a Lever 404); 403/429/5xx/timeouts prove nothing
  --sql    IN    writes SQL: dead jobs are closed (never one with an application or a human decision), live ones get
                 last_verified_at = now
Usage: python engine/liveness.py --export work/liveness_targets.json
       python engine/liveness.py --check work/liveness_targets.json --out work/liveness_result.json
       python engine/liveness.py --sql work/liveness_result.json --out work/liveness.sql
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PER_CANDIDATE = 50
UA = 'Mozilla/5.0 (compatible; career-job-engine/1.0; private job search)'
EXPORT_SQL = f"""SELECT id, url FROM (
  SELECT j.id, CASE WHEN j.original_posting_url LIKE 'https://%' THEN j.original_posting_url ELSE j.source_url END AS url,
         ROW_NUMBER() OVER (PARTITION BY s.candidate_id ORDER BY s.overall_score DESC, j.discovered_at DESC) AS rk
  FROM candidate_job_scores s
  JOIN jobs j ON j.id = s.job_id
  JOIN candidate_qualifications q ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id
  WHERE j.is_active = 1 AND q.manual_override_status IS NULL AND q.qualification_status IN ('NEEDS_REVIEW', 'HOLD')
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = j.id
                    AND (x.manual_override_status IS NOT NULL OR x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD')))
    AND (j.original_posting_url LIKE 'https://%' OR j.source_url LIKE 'https://%')
) WHERE rk <= {PER_CANDIDATE}"""


def probe(url, timeout=20):
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


def check(targets, pause=0.3):
    out = {'dead': [], 'alive': [], 'unknown': 0}
    seen = set()
    for t in targets:
        if t['id'] in seen:
            continue
        seen.add(t['id'])
        state, _ = probe(t['url'])
        if state == 'dead':   # a second look before anything is closed
            time.sleep(1)
            state, _ = probe(t['url'])
        if state == 'dead':
            out['dead'].append(t['id'])
        elif state == 'alive':
            out['alive'].append(t['id'])
        else:
            out['unknown'] += 1
        time.sleep(pause)
    return out


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def to_sql(result, now=None):
    now = now or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    guard = ("AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id) "
             "AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = jobs.id "
             "AND (x.manual_override_status IS NOT NULL OR x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD')))")
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
    a = ap.parse_args()
    if a.export:
        from engine.dataset_discovery import d1
        rows = d1(EXPORT_SQL)
        Path(a.export).write_text(json.dumps(rows))
        print(json.dumps({'targets': len(rows)}))
    elif a.check:
        res = check(json.loads(Path(a.check).read_text()))
        Path(a.out).write_text(json.dumps(res))
        print(json.dumps({'dead': len(res['dead']), 'alive': len(res['alive']), 'unknown': res['unknown']}))
    elif a.sql:
        Path(a.out).write_text(to_sql(json.loads(Path(a.sql).read_text())))
    else:
        ap.error('one of --export, --check, --sql')


if __name__ == '__main__':
    sys.exit(main())

