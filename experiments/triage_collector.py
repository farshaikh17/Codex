"""Read-only bridge from collector board exports to conservative recruiter triage.

Usage: python experiments/triage_collector.py public/boards/highlevel-lever.json
No network, AI, applications, credentials, or ledger writes.
"""
import json
import sys
from pathlib import Path
from collections import Counter
from recruiter_triage import triage

def analyze(board, candidate):
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
        decision = triage({
            'title': job.get('title'),
            'url': job.get('url'),
            'description': job.get('description'),
            'location': f'{loc} {workplace}',
        }, candidate)
        results.append({'key': key, 'title': job.get('title'), 'url': job.get('url'),
                        'status': decision.status, 'reasons': list(decision.reasons)})
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
