"""Screening benchmark over hand-labelled synthetic cases.

python -m engine.benchmark   # prints metrics and every label mismatch; exit 1 on any false READY or mismatch

Primary metric: false READY (labelled not ready, screened ready). Reported next to incorrect exclusions
(screened excluded, labelled not excluded), missed exclusions, retained unknowns and per-gate label mismatches.
"""
import json,sys
from datetime import date
from pathlib import Path
from engine import candidates as cfg
from engine.extract import extract
from engine.gates import requirement_units,screen
FIXTURES=Path(__file__).resolve().parent/'tests'/'fixtures'/'candidates'
def _reviews(case,record):
    decision=case.get('review_all')
    if not decision: return None
    (kind,evidence),=decision.items()
    return {u['id']:{'decision':kind,'evidence':evidence} for u in requirement_units(record['fields'])}
def run(cases,people):
    results,mismatches=[],[]
    m={'cases':len(cases),'false_ready':0,'incorrect_exclusions':0,'missed_exclusions':0,'unknowns_retained':0,'gate_mismatches':0}
    for case in cases:
        p=case['posting']
        record=extract(p,p.get('canonical_url'))
        today=date.fromisoformat(case['today']) if case.get('today') else date(2026,10,26)
        got=screen(people[case['candidate']],p,record,_reviews(case,record),today)
        want=case['expected']
        if got['verdict']=='ready' and want['verdict']!='ready': m['false_ready']+=1
        if got['verdict']=='excluded' and want['verdict']!='excluded': m['incorrect_exclusions']+=1
        if want['verdict']=='excluded' and got['verdict']!='excluded': m['missed_exclusions']+=1
        if want['verdict']=='conditional' and got['verdict']=='conditional': m['unknowns_retained']+=1
        bad={g:(r,got['gates'][g]['result']) for g,r in want.get('gates',{}).items() if got['gates'][g]['result']!=r}
        m['gate_mismatches']+=len(bad)
        if bad or got['verdict']!=want['verdict']:
            mismatches.append({'case':case['id'],'verdict':(want['verdict'],got['verdict']),
                               'gates':{g:{'expected':e,'got':o,'reason':got['gates'][g]['reason']} for g,(e,o) in bad.items()}})
        results.append(got)
    return m,mismatches,results
if __name__=='__main__':
    from engine.tests.screening_cases import CASES
    people={c['candidate_id']:c for c in (cfg.load(f) for f in sorted(FIXTURES.glob('*.json')))}
    metrics,mismatches,_=run(CASES,people)
    print(json.dumps({'metrics':metrics,'mismatches':mismatches},indent=1))
    sys.exit(1 if metrics['false_ready'] or mismatches else 0)
