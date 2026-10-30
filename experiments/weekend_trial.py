"""Offline, read-only batch trial against committed collector exports.

Usage: python experiments/weekend_trial.py --candidate farhan --limit 30
Writes only local artifacts under trial-output/. Does not change the collector or ledger.
"""
import argparse
import json
from collections import Counter
from pathlib import Path
from triage_collector import analyze

def run(boards_dir: Path, candidate: str, limit: int):
    if limit < 1:
        raise ValueError('limit must be positive')
    seen = set()
    selected = []
    source_stats = []
    total = 0
    for path in sorted(boards_dir.glob('*.json')):
        board = json.loads(path.read_text(encoding='utf-8'))
        data = analyze(board, candidate)
        total += data['jobs_seen']
        source_stats.append({'source': data['source'], 'seen': data['jobs_seen'], 'unique': data['unique_jobs'], 'counts': data['counts']})
        for item in data['results']:
            if item['key'] in seen:
                continue
            seen.add(item['key'])
            if len(selected) < limit:
                selected.append(item)
    selected.sort(key=lambda x: (-x['priority_score'], x['key']))
    return {'candidate': candidate, 'total_source_records': total, 'unique_identities': len(seen),
            'sample_size': len(selected), 'sample_counts': dict(Counter(x['status'] for x in selected)),
            'sources': source_stats, 'sample': selected,
            'warning': 'Offline preliminary triage only. HOLD is not READY. No live vacancy, salary, or India work authorization independently verified.'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--boards', default='public/boards')
    parser.add_argument('--candidate', choices=['farhan', 'sana'], required=True)
    parser.add_argument('--limit', type=int, default=30)
    parser.add_argument('--output', default='trial-output')
    args = parser.parse_args()
    result = run(Path(args.boards), args.candidate, args.limit)
    dest = Path(args.output)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f'{args.candidate}-trial.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('sample','sources')}, indent=2))

if __name__ == '__main__':
    main()
