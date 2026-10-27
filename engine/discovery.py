"""Private, weighted discovery plans. A plan is proposed work, never executed research.

Uses only stdlib; does not fetch, screen, change eligibility, or write state. Source
cooldowns and completed-batch counters are caller supplied and stay private.
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path


def validate(strategy):
    if not isinstance(strategy, dict) or set(strategy) != {'lanes'}:
        raise ValueError('discovery requires only a lanes list')
    lanes = strategy['lanes']
    if not isinstance(lanes, list) or not lanes:
        raise ValueError('discovery.lanes must be a nonempty list')
    ids = set()
    for lane in lanes:
        if not isinstance(lane, dict) or set(lane) != {'id', 'share', 'queries', 'sources'}:
            raise ValueError('each discovery lane requires id, share, queries and sources')
        key = lane['id']
        if not isinstance(key, str) or not key.strip() or key in ids:
            raise ValueError('discovery lane ids must be nonempty and unique')
        ids.add(key)
        share = lane['share']
        if isinstance(share, bool) or not isinstance(share, (int, float)) or not math.isfinite(share) or share <= 0:
            raise ValueError('discovery lane shares must be positive finite numbers')
        for field in ('queries', 'sources'):
            values = lane[field]
            if not isinstance(values, list) or not values or not all(isinstance(v, str) and v.strip() for v in values):
                raise ValueError('discovery lane %s must be a nonempty string list' % field)
            if len(set(values)) != len(values):
                raise ValueError('duplicate discovery lane %s' % field)
    if not math.isclose(sum(lane['share'] for lane in lanes), 100, abs_tol=1e-8):
        raise ValueError('discovery lane shares must sum to 100')
    return strategy


def _time(value):
    instant = datetime.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(instant, datetime) or instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError('discovery timestamps must include a timezone')
    return instant


def plan(strategy, completed=None, paused_sources=None, batches=10, now=None):
    """Allocate effort with weighted deficits, rotating queries and available sources.

    completed counts *actually completed discovery batches*, not proposed plans or
    jobs. Supply counters from the current private allocation window. Cooldowns
    map source identifiers to retry-not-before ISO timestamps. Reallocate effort
    from a fully paused lane and explicitly report it; never alter fit/pay gates.
    """
    validate(strategy)
    if isinstance(batches, bool) or not isinstance(batches, int) or not 1 <= batches <= 1000:
        raise ValueError('batches must be an integer from 1 to 1000')
    now = _time(now or datetime.now(timezone.utc))
    lanes = strategy['lanes']
    completed = {} if completed is None else completed
    paused_sources = {} if paused_sources is None else paused_sources
    if not isinstance(completed, dict) or set(completed) - {lane['id'] for lane in lanes}:
        raise ValueError('completed contains an unknown lane')
    if any(isinstance(n, bool) or not isinstance(n, int) or n < 0 for n in completed.values()):
        raise ValueError('completed counts must be nonnegative integers')
    if not isinstance(paused_sources, dict):
        raise ValueError('paused_sources must map source ids to retry timestamps')
    paused = {source for source, until in paused_sources.items() if _time(until) > now}
    available = {lane['id']: [source for source in lane['sources'] if source not in paused] for lane in lanes}
    counts = {lane['id']: completed.get(lane['id'], 0) for lane in lanes}
    planned = dict.fromkeys(counts, 0)
    tasks = []
    for _ in range(batches):
        eligible = [lane for lane in lanes if available[lane['id']]]
        if not eligible:
            break
        total = sum(counts.values()) + len(tasks) + 1
        lane = max(eligible, key=lambda item: item['share'] * total - 100 * (counts[item['id']] + planned[item['id']]))
        key = lane['id']
        ordinal = counts[key] + planned[key]
        tasks.append({'lane': key, 'query': lane['queries'][ordinal % len(lane['queries'])],
                      'source': available[key][ordinal % len(available[key])], 'stage': 'planned_not_executed'})
        planned[key] += 1
    return {'schema': 'discovery-plan-1', 'tasks': tasks, 'planned_batches': planned,
            'unavailable_lanes': [lane['id'] for lane in lanes if not available[lane['id']]],
            'unfilled_batches': batches - len(tasks), 'notice': 'Effort allocation only; no vacancies researched or qualified.'}


def main(argv=None):
    from engine import candidates as cfg
    parser = argparse.ArgumentParser(prog='python -m engine.discovery')
    parser.add_argument('--candidates', help='existing private candidate directory')
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--state', help='private JSON containing completed and paused_sources; read only')
    parser.add_argument('--batches', type=int, default=10)
    args = parser.parse_args(argv)
    people = cfg.load_all(args.candidates)
    if args.candidate not in people:
        parser.error('unknown candidate')
    strategy = people[args.candidate]['rules'].get('discovery')
    if strategy is None:
        parser.error('candidate has no discovery strategy')
    state = {}
    if args.state:
        if cfg._inside_repo(args.state):
            parser.error('discovery state must stay outside the repository')
        state = json.loads(Path(args.state).read_text(encoding='utf-8'))
        if not isinstance(state, dict) or set(state) - {'completed', 'paused_sources'}:
            parser.error('state may contain only completed and paused_sources')
    print(json.dumps(plan(strategy, batches=args.batches, **state), indent=2))


if __name__ == '__main__':
    main()
