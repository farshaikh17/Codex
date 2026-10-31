"""Offline, read-only batch trial against committed collector exports.

Usage: python experiments/weekend_trial.py --candidate farhan --limit 30
Writes only local artifacts under trial-output/. Does not change the collector or ledger.
"""
import argparse
import json
from collections import Counter
from pathlib import Path
from triage_collector import analyze
from recruiter_dedup import group_results,diverse_shortlist

def _health(boards_dir: Path):
    status = boards_dir.parent / 'status.json'
    if not status.exists():
        return {}
    return {s.get('source'): s for s in json.loads(status.read_text(encoding='utf-8')).get('sources', [])}

def _completed(path):
    """Private review receipts (review_key list) supplied at run time from outside the repository."""
    if not path:
        return set()
    path = Path(path).resolve()
    if path.is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError('completed-review receipts are private: keep them outside the repository')
    return set(json.loads(path.read_text(encoding='utf-8')))

def run(boards_dir: Path, candidate: str, limit: int, completed=None):
    if limit < 1:
        raise ValueError('limit must be positive')
    seen = set()
    selected = []
    source_stats = []
    total = 0
    paths = sorted(boards_dir.glob('*.json'))
    health = _health(boards_dir)
    done = _completed(completed)
    if not boards_dir.is_dir() or not paths:
        raise ValueError('boards directory must exist and contain at least one JSON board')
    for path in paths:
        board = json.loads(path.read_text(encoding='utf-8'))
        data = analyze(board, candidate, health)
        total += data['jobs_seen']
        source_stats.append({'source': data['source'], 'seen': data['jobs_seen'], 'unique': data['unique_jobs'], 'counts': data['counts']})
        for item in data['results']:
            if item['key'] in seen:
                continue
            seen.add(item['key'])
            selected.append(item)
    completed_skipped = sum(1 for x in selected if x['review_key'] in done)
    selected = [x for x in selected if x['review_key'] not in done]
    all_counts=dict(Counter(x['status'] for x in selected))
    groups,exact_duplicates,unique_urls=group_results(selected)
    shortlist,cap=diverse_shortlist(groups,limit)
    groups.sort(key=lambda x:(not x['evidence']['shortlist_eligible'],x['status']=='REJECT',-x['priority_score'],x['key']))
    selected = groups[:limit]
    return {'candidate': candidate, 'total_source_records': total, 'unique_identities': len(seen),
            'sample_size': len(selected), 'sample_counts': dict(Counter(x['status'] for x in selected)),
            'sources': source_stats, 'sample': selected,'all_counts':all_counts,
            'unique_urls':unique_urls,'exact_url_duplicates':exact_duplicates,'review_groups':len(groups),
            'shortlist':shortlist,'shortlist_size':len(shortlist),'shortfall':max(0,limit-len(shortlist)),
            'per_employer_cap':cap,'shortlist_sources':dict(Counter(x['source'] for x in shortlist)),
            'queue_counts':dict(Counter(x['queue'] for x in selected)),'shortlist_tiers':dict(Counter(x['evidence']['review_tier'] for x in shortlist)),
            'completed_reviews_skipped':completed_skipped,'rules_version':'triage-v3',
            'warning': 'Offline preliminary triage only. HOLD is not READY; the shortlist is a review queue, not verified readiness. No live vacancy, salary, or India work authorization independently verified.'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--boards', default='public/boards')
    parser.add_argument('--candidate', choices=['farhan', 'sana'], required=True)
    parser.add_argument('--limit', type=int, default=30)
    parser.add_argument('--output', default='trial-output')
    parser.add_argument('--completed', help='private JSON list of completed review_keys (outside the repository)')
    args = parser.parse_args()
    result = run(Path(args.boards), args.candidate, args.limit, args.completed)
    dest = Path(args.output)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f'{args.candidate}-trial.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('sample','sources','shortlist')}, indent=2))

if __name__ == '__main__':
    main()
