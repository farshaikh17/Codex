"""Read-only bridge from collector board exports to conservative recruiter triage.

Usage: python experiments/triage_collector.py public/boards/highlevel-lever.json
No network, AI, applications, credentials, or ledger writes.
"""
import json
import sys
import html
import re
from pathlib import Path
from collections import Counter
from recruiter_triage import triage
from recruiter_priority import rank
from job_text import clean_text

from recruiter_triage import review_key

def analyze(board, candidate, health=None):
    """health: {source_id: latest status.json entry}. A source whose latest real attempt failed keeps its jobs
    (last known good), but they are flagged unresolved; feed presence is never treated as a live-vacancy check."""
    if board.get('schema') != 'public-job-board-1' or not isinstance(board.get('jobs'), list):
        raise ValueError('unsupported collector board schema')
    seen = set()
    results = []
    for job in board['jobs']:
        key = job.get('key') or job.get('url')
        if not key or key in seen:
            continue
        seen.add(key)
        locations = job.get('locations') or []
        loc = ' / '.join(x.get('text', '') for x in locations if isinstance(x, dict))
        workplace = job.get('workplace_type') or ''
        clean_description = clean_text(job.get('description'))
        normalized = {
            'title': job.get('title'),
            'url': job.get('url'),
            'description': clean_description,
            'location': f'{loc} {workplace}',
        }
        decision = triage(normalized, candidate, raw=job)
        source_state = (health or {}).get(board.get('source')) or {}
        reasons = list(decision.reasons)
        if source_state.get('status') == 'failed':
            reasons.insert(0, 'source failed at its latest attempt; job is last-known-good, not freshly observed')
        results.append({'key': key, 'title': job.get('title'), 'url': job.get('url'),
                        'review_key': review_key(candidate, key, job.get('content_hash')),
                        'source_status': source_state.get('status', 'not_reported'), 'source_checked_at': source_state.get('checked_at'),
                        'observed_at': job.get('observed_at'),
                        'status': decision.status, 'reasons': reasons, 'queue': decision.evidence['queue'],
                        'source':board.get('source'), 'company':job.get('company') or (str(key).split(':')[1] if ':' in str(key) else board.get('source')),
                        'location':normalized['location'],'evidence':decision.evidence,
                        **rank(normalized, candidate)})
    return {'candidate': candidate, 'source': board.get('source'),
            'jobs_seen': len(board['jobs']), 'unique_jobs': len(results),
            'counts': dict(Counter(x['status'] for x in results)), 'results': results}

def main(argv):
    if len(argv) < 2:
        raise SystemExit('usage: triage_collector.py BOARD_JSON [farhan|sana]')
    candidate = argv[2] if len(argv) > 2 else 'farhan'
    board = json.loads(Path(argv[1]).read_text(encoding='utf-8'))
    print(json.dumps(analyze(board, candidate), indent=2, ensure_ascii=False))

if __name__ == '__main__':
    main(sys.argv)
