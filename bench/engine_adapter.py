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
