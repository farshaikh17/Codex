"""Per-candidate qualification states over collected postings. Read-only on the store; writes private outputs.

python -m engine.qualify --candidates DIR --out DIR [--boards public/boards] [--extra jobs.json ...]

States (one per candidate x posting, from evidence only):
  REJECT        a required gate failed with evidence (geography/work rights, engagement, salary below floor, cooldown)
  APPLIED       already in the private application history
  CLOSED        the store holds expiry evidence (feed absence alone is never closure)
  HOLD          evidence missing (thin or unextracted description)
  NEEDS_REVIEW  promising, but eligibility (geography, work rights, arrangement) is unresolved
  PAY_UNKNOWN   promising and eligible, compensation not stated or not comparable
  HIGH_FIT      strong career match, eligible, pay at or above the floor; qualifications still need review
  VERIFIED_READY only when every required gate passes, including reviewed qualifications
  SCREENED      collected and screened, career match below the candidate's high-fit bar
Unknown pay, uncertain eligibility and cross-industry matches are kept; only a confirmed failure rejects.
"""
import argparse,json,re,sys
from collections import Counter
from pathlib import Path
from engine import candidates as cfg
from engine.extract import extract
from engine.gates import screen
from engine.match import document_frequency,match
ROOT=Path(__file__).resolve().parent.parent
STATES=('VERIFIED_READY','HIGH_FIT','PAY_UNKNOWN','NEEDS_REVIEW','HOLD','SCREENED','REJECT','APPLIED','CLOSED')
def state_of(result,fit,extraction,availability=None,rules=None):
    m=(rules or {}).get('match') or {}
    high,low=m.get('high_fit',55),m.get('min_fit',25)
    g=result['gates']
    if availability=='expired': return 'CLOSED','expiry evidence recorded'
    h=g['application_history']
    if h['result']=='fail' and h['reason'].startswith('already in'): return 'APPLIED',h['reason']
    failed=[n for n,x in g.items() if x['required'] and x['result']=='fail']
    if failed: return 'REJECT','; '.join('%s: %s'%(n,g[n]['reason']) for n in failed)
    if extraction['state'] in ('failed','thin'): return 'HOLD','description %s'%extraction['state']
    if fit['score']<low: return 'SCREENED','career match %d below %d'%(fit['score'],low)
    if result['verdict']=='ready': return 'VERIFIED_READY','every required gate passed with evidence'
    unresolved=[n for n in ('geography','engagement') if g[n]['required'] and g[n]['result']!='pass']
    if unresolved: return 'NEEDS_REVIEW','; '.join('%s: %s'%(n,g[n]['reason']) for n in unresolved)
    if g['salary']['required'] and g['salary']['result']!='pass': return 'PAY_UNKNOWN',g['salary']['reason']
    if fit['score']>=high: return 'HIGH_FIT','career match %d; qualifications need review'%fit['score']
    return 'SCREENED','career match %d below high-fit %d'%(fit['score'],high)
def qualify(person,job,availability=None,df=None,n_docs=None):
    extraction=extract(job,job.get('url'))
    posting={'posting_id':job['key'],'content_hash':job.get('content_hash'),'canonical_url':job.get('url'),
             'board':job.get('board') or str(job['key']).split(':')[1] if ':' in str(job['key']) else '','title':job.get('title'),
             'description':job.get('description')}
    result=screen(person,posting,extraction)
    fit=match(posting,extraction['fields'],person['profile'],df,n_docs)
    state,why=state_of(result,fit,extraction,availability,person['rules'])
    return {'key':job['key'],'title':job.get('title'),'url':job.get('url'),'state':state,'why':why,'fit':fit['score'],
            'locations':[l.get('text') for l in job.get('locations') or [] if isinstance(l,dict)][:5],
            'gates':{n:{'result':x['result'],'reason':x['reason']} for n,x in result['gates'].items()},
            'match':fit,'source':job.get('_source'),'observed_at':job.get('observed_at')}
def load_jobs(boards,extras=()):
    jobs={}
    for p in sorted(Path(boards).glob('*.json')) if boards else []:
        b=json.loads(p.read_text(encoding='utf-8'))
        for j in b.get('jobs',[]): jobs.setdefault(j['key'],{**j,'_source':b.get('source')})
    for e in extras:
        for j in json.loads(Path(e).read_text(encoding='utf-8')): jobs.setdefault(j['key'],{**j,'_source':j.get('_source','extra')})
    return list(jobs.values())
def group_key(r):
    board=r['key'].split(':')[1] if r['key'].count(':')>=2 else r['source']
    return board,re.sub(r'\W+',' ',(r['title'] or '').lower()).strip()
def run(people,jobs):
    out={}
    for cid,person in sorted(people.items()):
        df,n=document_frequency([j.get('description') for j in jobs],person['profile'])
        rows=[qualify(person,j,None,df,n) for j in jobs]
        rank={s:i for i,s in enumerate(STATES)}
        groups={}
        for r in sorted(rows,key=lambda r:(rank[r['state']],-r['fit'],r['key'])):
            g=groups.setdefault(group_key(r),{**r,'regional_variants':[]})
            if g is not r and g['key']!=r['key']: g['regional_variants'].append({'key':r['key'],'state':r['state'],'locations':r['locations']})
        reps=list(groups.values())
        out[cid]={'counts':dict(Counter(r['state'] for r in rows)),'groups':len(reps),
                  'group_counts':dict(Counter(r['state'] for r in reps)),'sources':dict(Counter(r['source'] for r in reps if r['state'] in STATES[:4])),
                  'jobs':[r for r in reps if r['state'] not in ('SCREENED','REJECT')],
                  'rejected_sample':[{k:r[k] for k in ('key','title','why')} for r in reps if r['state']=='REJECT'][:40]}
    return out
def main(argv=None):
    ap=argparse.ArgumentParser(prog='python -m engine.qualify')
    ap.add_argument('--candidates'); ap.add_argument('--boards',default=str(ROOT/'public'/'boards'))
    ap.add_argument('--extra',action='append',default=[]); ap.add_argument('--out',required=True)
    a=ap.parse_args(argv); out=Path(a.out).resolve()
    if out.is_relative_to(ROOT): raise SystemExit('outputs contain candidate decisions: --out must be outside the repository')
    people=cfg.load_all(a.candidates); result=run(people,load_jobs(a.boards,a.extra))
    out.mkdir(parents=True,exist_ok=True)
    for cid,data in result.items(): (out/(cid+'.json')).write_text(json.dumps(data,indent=1,ensure_ascii=False))
    print(json.dumps({c:{'counts':d['counts'],'group_counts':d['group_counts']} for c,d in result.items()},indent=1))
if __name__=='__main__': sys.exit(main())
