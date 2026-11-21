"""Pre-screen of the job-site and employer-site results before the duplicate check (max discovery, 20 Nov 2026).

The job-site search, remote boards and more sources write work/jobsite_raw.json with every posting whose title passes a person's role rule. Each
row costs D1 reads in the duplicate check (`dataset_discovery.py --dedupe`, about 11 rows read per row) and, once imported, about 27 rows written,
even when the Worker's screen then scores it far below the person's threshold (dataset_apply.mjs stores every row from 30 up, and the
shortlist step moves those at 45 or below to Hold the same day). This step scores every (posting, person) pair on the runner with the Worker's own
screen (dashboard/scripts/prescore.mjs: evaluate(), free compute, no database access) and keeps a person on a posting only when it can still
reach a list: not ineligible and at or above dataset_discovery.fit_floor(threshold), the same rule as the open-dataset intake. A posting no
person keeps is dropped. So the collectors can read many more postings without more database reads or writes.

If the pre-score cannot run (Node missing, a script error), every row is kept, as before this step existed.

Usage: python engine/prescreen.py --raw work/jobsite_raw.json --candidates work/candidates.json --work work [--report work/prescreen_report.json]
"""
import argparse
import json
import sys
from pathlib import Path

try:   # run as a script (engine/ on sys.path) or as part of the engine package (tests)
    from dataset_discovery import fit_floor, node_scorer
except ImportError:   # pragma: no cover
    from engine.dataset_discovery import fit_floor, node_scorer

DROP = ('INELIGIBLE', 'UNKNOWN_CANDIDATE')


def default_threshold(cid):
    return 70 if cid == 'farhan_shaikh' else 60


def prescreen(jobs, cands, scorer):
    """Returns (kept jobs, report). Each kept job's `candidates` lists only the people it can still fit."""
    thresholds = {c['id']: c.get('qualification_threshold') or default_threshold(c['id']) for c in cands}
    items = [(cid, j) for j in jobs for cid in (j.get('candidates') or [])]
    results = scorer(items) if items else []
    keep = {}
    report = {'in': len(jobs), 'pairs': len(items), 'per_person': {}, 'by_source': {}}
    for (cid, j), res in zip(items, results):
        t = thresholds.get(cid) or default_threshold(cid)
        per = report['per_person'].setdefault(cid, {'in': 0, 'kept': 0, 'at_threshold': 0, 'floor': fit_floor(t)})
        per['in'] += 1
        res = res or {'score': 0, 'status': 'INELIGIBLE'}
        if res.get('status') in DROP or res.get('score', 0) < fit_floor(t):
            continue
        per['kept'] += 1
        per['at_threshold'] += res['score'] >= t
        keep.setdefault(id(j), []).append(cid)
    out = []
    for j in jobs:
        src = str(j.get('ats_type') or 'unknown')
        s = report['by_source'].setdefault(src, {'in': 0, 'kept': 0})
        s['in'] += 1
        cids = keep.get(id(j))
        if cids:
            out.append({**j, 'candidates': [c for c in (j.get('candidates') or []) if c in cids]})
            s['kept'] += 1
    report['kept'] = len(out)
    return out, report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True, help='jobsite_raw.json; rewritten in place with only the rows that can fit')
    ap.add_argument('--candidates', required=True)
    ap.add_argument('--work', required=True)
    ap.add_argument('--report', default=None)
    a = ap.parse_args()
    raw_path = Path(a.raw)
    raw = json.loads(raw_path.read_text())
    jobs = raw.get('jobs') or []
    try:
        cands = json.loads(Path(a.candidates).read_text())
        kept, report = prescreen(jobs, cands, node_scorer(a.work, a.candidates))
    except Exception as e:   # noqa: BLE001 - the step only saves reads; without it every row goes on as before
        print(f'::warning::Pre-screen skipped ({type(e).__name__}: {str(e)[:160]}); every job-site row goes to the duplicate check', file=sys.stderr)
        report = {'in': len(jobs), 'kept': len(jobs), 'skipped': f'{type(e).__name__}'}
        kept = jobs
    raw_path.write_text(json.dumps({**raw, 'jobs': kept}, default=str))
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != 'by_source'}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
