"""Free AI review of the best new jobs (owner-approved 2026-11-07), through GitHub Models' free tier with the workflow's own
token (permission models: read). No names or contact details are sent: each request carries the job text and a short,
generic description of what the candidate wants.

Input:  work/top.json from dataset_apply.mjs: [{candidate_id, job_id, title, company, location, description, profile}]
Output: work/triage.sql: the score moves by at most TRIAGE_MAX points either way, and the review text is put in front of
        the qualification reason. Applied, decided, READY and STRETCH rows are never touched (SQL guards).
Failures (rate limit, outage, bad JSON) skip the batch; the run never fails because of this step.
Usage: python engine/ai_triage.py --in work/top.json --out work/triage.sql [--batch 5] [--max 100]
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = 'https://models.github.ai/inference/chat/completions'
MODEL = os.environ.get('TRIAGE_MODEL', 'openai/gpt-4o-mini')
TRIAGE_MAX = 10
SYSTEM = ('You screen job postings for a job seeker. For each posting return strict JSON only: an array of objects '
          '{"i": index, "fit": 0-100, "eligible": "yes"|"no"|"unclear", "why": "two short sentences"}. '
          '"eligible" means the posting, read literally, allows the candidate described (location, work authorisation, remote policy). '
          'Judge fit from the posting text and the candidate description only. Never invent requirements.')


class ReplyError(Exception):
    """The endpoint answered, but not with the JSON a chat completion should be. Carries what is needed to see why (no secrets)."""


def call(messages, token, timeout=60):
    body = json.dumps({'model': MODEL, 'messages': messages, 'temperature': 0.1, 'max_tokens': 900}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, method='POST', headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Accept-Encoding': 'identity', 'User-Agent': 'career-job-engine/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310
        raw, status, ctype = r.read(), getattr(r, 'status', '?'), r.headers.get('Content-Type', '?')
    try:
        d = json.loads(raw)
        return d['choices'][0]['message']['content']
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        snippet = re.sub(r'\s+', ' ', raw[:160].decode('utf-8', 'replace'))
        raise ReplyError(f'{type(e).__name__}: HTTP {status}, {ctype}, {len(raw)} bytes, starts: {snippet!r}') from None


def describe(e):
    """One line saying what went wrong, safe to print."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            detail = re.sub(r'\s+', ' ', e.read(160).decode('utf-8', 'replace'))
        except Exception:   # noqa: BLE001
            detail = ''
        return f'HTTP {e.code} {e.reason}: {detail!r}'
    return str(e) if isinstance(e, ReplyError) else f'{type(e).__name__}: {str(e)[:120]}'


def parse(content, n):
    m = re.search(r'\[.*\]', content, re.S)
    if not m:
        return {}
    try:
        rows = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}
    out = {}
    for r in rows if isinstance(rows, list) else []:
        try:
            i = int(r.get('i')); fit = int(r.get('fit'))
        except (TypeError, ValueError, AttributeError):
            continue
        if 0 <= i < n and 0 <= fit <= 100:
            out[i] = {'fit': fit, 'eligible': str(r.get('eligible') or 'unclear').lower()[:10], 'why': re.sub(r'\s+', ' ', str(r.get('why') or ''))[:300]}
    return out


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def to_sql(job, rev, now):
    delta = max(-TRIAGE_MAX, min(TRIAGE_MAX, round((rev['fit'] - 60) / 4)))   # 60 = neutral; +-10 at the extremes
    if rev['eligible'] == 'no':
        delta = -TRIAGE_MAX
    note = f"AI review (fit {rev['fit']}, eligibility {rev['eligible']}): {rev['why']} "
    guard = (f"WHERE candidate_id = {q(job['candidate_id'])} AND job_id = {q(job['job_id'])} "
             f"AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = {q(job['candidate_id'])} AND a.job_id = {q(job['job_id'])}) "
             f"AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = {q(job['candidate_id'])} AND x.job_id = {q(job['job_id'])} "
             f"AND (x.manual_override_status IS NOT NULL OR x.qualification_status NOT IN ('NEEDS_REVIEW','HOLD')))")
    return [
        f"UPDATE candidate_job_scores SET overall_score = MAX(0, MIN(100, overall_score + ({delta}))), calculated_at = {q(now)} {guard} AND score_breakdown NOT LIKE '%\"ai_review\"%';",
        f"UPDATE candidate_job_scores SET score_breakdown = json_set(score_breakdown, '$.ai_review', json({q(json.dumps(rev))})) {guard} AND json_valid(score_breakdown) AND score_breakdown NOT LIKE '%\"ai_review\"%';",
        f"UPDATE candidate_qualifications SET qualification_reason = {q(note)} || qualification_reason {guard} AND qualification_reason NOT LIKE 'AI review%';",
    ]


def batches(jobs, size):
    """Groups of at most `size` jobs that all belong to ONE candidate: a request carries a single candidate description, so a group
    must never mix candidates (the input lists one person's jobs after another's, and a group of 5 can straddle the boundary)."""
    by = {}
    for j in jobs:
        by.setdefault(j['candidate_id'], []).append(j)
    for group in by.values():
        for i in range(0, len(group), size):
            yield group[i:i + size]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--batch', type=int, default=5)
    ap.add_argument('--max', type=int, default=100)
    ap.add_argument('--probe', action='store_true', help='send one tiny request and print what came back (no job data)')
    a = ap.parse_args()
    token = os.environ.get('GITHUB_TOKEN', '')
    if a.probe:
        try:
            out = call([{'role': 'user', 'content': 'Reply with the single word: ready'}], token, 30)
            print(json.dumps({'probe': 'ok', 'model': MODEL, 'reply': out[:60]}))
            return 0
        except Exception as e:   # noqa: BLE001
            print(json.dumps({'probe': 'failed', 'model': MODEL, 'endpoint': ENDPOINT, 'why': describe(e), 'token_present': bool(token)}))
            return 1
    jobs = json.loads(Path(a.inp).read_text())[:a.max]
    if not token or not jobs:
        Path(a.out).write_text('')
        print(json.dumps({'reviewed': 0, 'skipped': 'no token or no jobs'}))
        return
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    lines, reviewed, failed, samples, streak = [], 0, 0, [], 0
    for batch in batches(jobs, a.batch):
        user = 'Candidate: ' + batch[0]['profile'] + '\n\nPostings:\n' + '\n\n'.join(
            f"[{k}] Title: {j['title']}\nEmployer: {j['company']}\nLocation: {j['location']}\n{j['description'][:1800]}" for k, j in enumerate(batch))
        try:
            content = call([{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': user}], token)
        except Exception as e:   # noqa: BLE001
            failed += 1; streak += 1
            why = describe(e)
            if len(samples) < 3 and why not in samples:
                samples.append(why)
            print(f'batch failed: {why}', file=sys.stderr)
            if isinstance(e, urllib.error.HTTPError) and e.code == 429:
                print('rate limited; stopping', file=sys.stderr)
                break
            if streak >= 3:   # the same wall three times in a row is not going to move; do not hammer it for the rest of the list
                print('three failed batches in a row; stopping the review', file=sys.stderr)
                break
            continue
        streak = 0
        for k, rev in parse(content, len(batch)).items():
            lines += to_sql(batch[k], rev, now)
            reviewed += 1
        time.sleep(1.5)
    if lines:
        lines.append('UPDATE cache_state SET generation = generation + 1 WHERE id = 1;')
    Path(a.out).write_text('\n'.join(lines) + ('\n' if lines else ''))
    print(json.dumps({'reviewed': reviewed, 'failed_batches': failed, 'model': MODEL, 'failure_samples': samples}))


if __name__ == '__main__':
    sys.exit(main())
