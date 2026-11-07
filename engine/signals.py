"""Ranking signals built outside the database (owner-approved 2026-11-07), no credentials needed.

  * UK sponsor register: employers licensed for the Skilled Worker route (GOV.UK, a daily CSV). For Sana, a UK posting from a
    licensed sponsor is not penalised as "no visa route".
  * Taste model: learns from the operator's own decisions. Positive = saved, applied, interviewing, offer, or set READY by hand;
    negative = set INELIGIBLE, HOLD or CLOSED by hand. A tiny naive-Bayes model over title and company words, per candidate.
    It only switches on once a candidate has at least MIN_LABELS decisions, and it only ever moves a score by a few points.

Usage:
  python engine/signals.py --uk-register PATH.csv --taste-rows work/taste_rows.json --out work/
Writes work/signals.json: {"uk_sponsors": [...keys], "taste": {candidate_id: {"n": N, "pos": {...}, "neg": {...}}}}
"""
import argparse
import csv
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.global_hirers import company_key  # noqa: E402

MIN_LABELS = 10
POSITIVE = {'SAVED', 'APPLIED', 'SUBMITTED', 'INTERVIEWING', 'OFFER', 'READY', 'STRETCH_READY', 'READY_HIGH'}
NEGATIVE = {'INELIGIBLE', 'HOLD', 'CLOSED', 'DISMISSED'}
STOP = {'and', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'a', 'an', 'at', 'or', 'by', 'ltd', 'inc', 'llc', 'remote', 'senior', 'junior', 'ii', 'iii'}


def uk_sponsors(path):
    keys = set()
    with open(path, encoding='utf-8-sig', errors='replace', newline='') as f:
        for row in csv.DictReader(f):
            route = (row.get('Route') or '').strip().lower()
            if 'skilled worker' in route or 'global business mobility' in route:
                k = company_key(row.get('Organisation Name'))
                if k:
                    keys.add(k)
    return keys


def tokens(title, company):
    words = re.findall(r'[a-z][a-z0-9+#]{1,}', f'{title} {company}'.lower())
    return {w for w in words if w not in STOP}


def train(rows):
    """rows: [{candidate_id, title, company, label}] with label in POSITIVE|NEGATIVE. Returns per-candidate log-odds per token."""
    by = {}
    for r in rows:
        lab = str(r.get('label') or '').upper()
        if lab not in POSITIVE and lab not in NEGATIVE:
            continue
        c = by.setdefault(r['candidate_id'], {'pos': Counter(), 'neg': Counter(), 'np': 0, 'nn': 0})
        bucket = 'pos' if lab in POSITIVE else 'neg'
        c[bucket].update(tokens(r.get('title'), r.get('company')))
        c['np' if bucket == 'pos' else 'nn'] += 1
    out = {}
    for cid, c in by.items():
        n = c['np'] + c['nn']
        if n < MIN_LABELS or c['np'] == 0 or c['nn'] == 0:
            out[cid] = {'n': n, 'active': False, 'weights': {}}
            continue
        vocab = set(c['pos']) | set(c['neg'])
        w = {}
        for t in vocab:
            p = (c['pos'][t] + 1) / (c['np'] + 2)
            q = (c['neg'][t] + 1) / (c['nn'] + 2)
            lo = math.log(p / q)
            if abs(lo) >= 0.4 and c['pos'][t] + c['neg'][t] >= 2:
                w[t] = round(lo, 3)
        out[cid] = {'n': n, 'active': bool(w), 'weights': w}
    return out


def taste_score(model, title, company):
    """Sum of token log-odds, squashed to [-1, 1]. Shared with dataset_apply.mjs (same formula there)."""
    if not model or not model.get('active'):
        return 0.0
    s = sum(model['weights'].get(t, 0.0) for t in tokens(title, company))
    return max(-1.0, min(1.0, s / 3.0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--uk-register')
    ap.add_argument('--taste-rows')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    sig = {'uk_sponsors': [], 'taste': {}}
    report = {}
    try:
        sig['uk_sponsors'] = sorted(uk_sponsors(a.uk_register)) if a.uk_register and Path(a.uk_register).exists() else []
    except Exception as e:
        print(f'uk register: {e}', file=sys.stderr)
    report['uk_sponsors'] = len(sig['uk_sponsors'])
    try:
        rows = json.loads(Path(a.taste_rows).read_text()) if a.taste_rows and Path(a.taste_rows).exists() else []
        sig['taste'] = train(rows)
    except Exception as e:
        print(f'taste: {e}', file=sys.stderr)
    report['taste'] = {cid: {'n': m['n'], 'active': m['active'], 'terms': len(m['weights'])} for cid, m in sig['taste'].items()}
    (out / 'signals.json').write_text(json.dumps(sig))
    print(json.dumps(report))


if __name__ == '__main__':
    sys.exit(main())
