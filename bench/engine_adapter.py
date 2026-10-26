"""Optional: scores the posting store's extractor (engine/extract.py, farshaikh17/Codex#2) when it is present.

Only maps its documented output ({'warnings', 'fields': {field: {'state', 'items'}}}) to benchmark predictions.
"""
import json
from bench.score import load
def available():
    try:
        import engine.extract  # noqa: F401
        return True
    except ImportError:
        return False
def _compensation_flags(items):
    flags={}
    for i in items:
        interp=i.get('interpretation')
        if not isinstance(interp,dict): continue
        for k in ('period','estimated','variable_mentioned','equity_mentioned','multiple_ranges'):
            if k in interp and interp[k] is not None: flags[k]=flags.get(k,False) or interp[k] if isinstance(interp[k],bool) else interp[k]
        if interp.get('basis') not in (None,'unspecified'): flags['basis']=interp['basis']
        currencies={r.get('currency') for r in interp.get('ranges') or [] if r.get('currency')}
        if len(currencies)==1: flags['currency']=currencies.pop()
    return flags
def predictions(cases=None):
    from engine.extract import extract
    cases=cases or load('cases.json')
    out=[]
    for c in cases['cases']:
        p=c['posting']
        version={'title':p['title'],'locations':json.dumps(p.get('locations') or []),'workplace_type':p.get('workplace_type'),
                 'description':p['description'],'compensation_raw':p.get('compensation_raw')}
        r=extract(version,p.get('url'))
        out.append({'case':c['id'],'fields':{f:v['state'] for f,v in r['fields'].items()},'warnings':r['warnings'],
                    'compensation':_compensation_flags(r['fields'].get('compensation',{}).get('items',[]))})
    return out
def gates_available():
    try:
        import engine.gates  # noqa: F401
        return True
    except ImportError:
        return False
BENCH_PEOPLE={  # bench/fixtures/candidates.json expressed in candidate-config-1. One salary floor per candidate is all it supports.
    'cand-in':{'countries':['IN'],'years':6,'types':['full_time','contract'],'floor':(3000000,'INR'),'history':[]},
    'cand-us':{'countries':['US'],'years':3,'types':['full_time'],'floor':(120000,'USD'),
               'history':[{'posting_id':'lever:bench:already-applied','status':'applied','date':'2026-09-14'}]}}
def _config(cid,p):
    from engine import candidates as cfg
    c={'schema':'candidate-config-1','candidate_id':cid,'synthetic':True,'profile_version':'bench-1','rules_version':'bench-1',
       'profile':{'eligible_countries':p['countries'],'experience_years':p['years'],'application_history':p['history']},
       'rules':{'required_gates':['geography','engagement','qualifications','salary','application_history'],
                'engagement':{'workplace':['remote'],'employment_types':p['types']},
                'salary':{'minimum':p['floor'][0],'currency':p['floor'][1],'period':'year','basis':'base'},
                'application_history':{'employer_cooldown_days':90}}}
    cfg.validate(c)
    return c
def gate_predictions(cases=None):
    """Scores engine.gates.screen (ENGINE steps 3+4). Its qualifications gate needs a person's review of each requirement,
    so reviews are supplied from the benchmark's own qualifications labels: qualifications agreement then measures only
    the automatic years check, and every other gate is independent of the labels."""
    from datetime import date
    from engine.extract import extract
    from engine.gates import requirement_units,screen
    from bench.score import pairs
    cases=cases or load('cases.json')
    people={cid:_config(cid,p) for cid,p in BENCH_PEOPLE.items()}
    out=[]
    for c,cid,exp in pairs(cases):
        if 'verdict' not in exp: continue
        p=dict(c['posting'],posting_id=c['posting']['key'],board='bench',canonical_url=c['posting']['url'])
        record=extract(p,p['url'])
        label=exp['gates']['qualifications']
        reviews=None
        if label['value'] in ('pass','fail'):
            kind='met' if label['value']=='pass' else 'not_met'
            reviews={u['id']:{'decision':kind,'evidence':'reviewer (benchmark label): '+label['basis']} for u in requirement_units(record['fields'])}
        got=screen(people[cid],p,record,reviews,date(2026,10,26))
        out.append({'case':c['id'],'candidate':cid,'verdict':got['verdict'],'gates':{g:v['result'] for g,v in got['gates'].items()},
                    'reasons':{g:v['reason'] for g,v in got['gates'].items()}})
    return out
