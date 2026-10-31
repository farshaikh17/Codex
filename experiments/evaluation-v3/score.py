"""Score one implementation's review selection against the pre-registered labels on the frozen corpus.

Usage: python experiments/evaluation-v3/score.py IMPL_EXPERIMENTS_DIR BOARDS_DIR LABELS_JSON [splits] [out.json]
Selection = what the implementation would put in front of a reviewer:
  repaired: decision 'queue' == 'review'; a2458ea: evidence.shortlist_eligible; fea7e5c (no shortlist): top-50 HOLD by priority.
"""
import importlib,json,sys
from pathlib import Path
def load(impl):
    sys.path.insert(0,str(Path(impl).resolve()))
    for m in ('triage_collector','recruiter_triage','candidate_match','recruiter_priority','job_text','recruiter_dedup'):
        sys.modules.pop(m,None)
    return importlib.import_module('triage_collector')
def decisions(tc,boards,cand):
    out={}
    for p in sorted(Path(boards).glob('*.json')):
        for r in tc.analyze(json.loads(p.read_text(encoding='utf-8')),cand)['results']: out[r['key']]=r
    if not any('queue' in r or 'shortlist_eligible' in r.get('evidence',{}) for r in out.values()):
        top={k for k,_ in sorted(((k,r) for k,r in out.items() if r['status']=='HOLD'),key=lambda x:(-x[1]['priority_score'],x[0]))[:50]}
        for k,r in out.items(): r['_selected']=k in top
    for r in out.values():
        r.setdefault('_selected',r.get('queue')=='review' if 'queue' in r else bool(r.get('evidence',{}).get('shortlist_eligible')))
    return out
def apply_corrections(lab,labels):
    path=Path(labels).with_name('label-corrections.json')
    if not path.exists(): return lab
    fixes={(c['candidate'],c['key']):c for c in json.loads(path.read_text())['corrections']}
    for cand,rows in lab['candidates'].items():
        for r in rows:
            c=fixes.get((cand,r['key']))
            if c: r.update(expected=c['to'],hard_blocker=c['hard_blocker'],corrected=True)
    return lab
def score(impl,boards,labels,splits=('dev','india'),corrected=True):
    tc=load(impl); lab=json.loads(Path(labels).read_text()); result={}
    if corrected: lab=apply_corrections(lab,labels)
    for cand,rows in lab['candidates'].items():
        d=decisions(tc,boards,cand); rows=[r for r in rows if r['split'] in splits]
        wrong_ex=[r for r in rows if r['expected']=='review' and not d[r['key']]['_selected']]
        unsuitable=[r for r in rows if r['expected']!='review' and d[r['key']]['_selected']]
        hard_ok=[r for r in rows if r['expected']=='exclude' and d[r['key']]['status']=='REJECT']
        result[cand]={'labelled':len(rows),'expected_review':sum(r['expected']=='review' for r in rows),
            'selected_in_labelled':sum(d[r['key']]['_selected'] for r in rows),
            'correctly_selected':sum(r['expected']=='review' and d[r['key']]['_selected'] for r in rows),
            'wrongly_excluded':[{'key':r['key'],'note':r['note'],'status':d[r['key']]['status'],'reasons':d[r['key']]['reasons'][:6]} for r in wrong_ex],
            'unsuitable_selected':[{'key':r['key'],'expected':r['expected'],'note':r['note']} for r in unsuitable],
            'hard_blockers_rejected':'%d/%d'%(len(hard_ok),sum(r['expected']=='exclude' for r in rows)),
            'corpus_selected':sum(r['_selected'] for r in d.values()),'corpus_rejected':sum(r['status']=='REJECT' for r in d.values())}
    return result
if __name__=='__main__':
    splits=tuple(sys.argv[4].split(',')) if len(sys.argv)>4 else ('dev','india')
    r={'corrected':score(sys.argv[1],sys.argv[2],sys.argv[3],splits,True),'original':score(sys.argv[1],sys.argv[2],sys.argv[3],splits,False)}
    if len(sys.argv)>5: Path(sys.argv[5]).write_text(json.dumps(r,indent=1,ensure_ascii=False)+'\n')
    print(json.dumps({lab:{c:{k:(len(v) if isinstance(v,list) else v) for k,v in x.items()} for c,x in rr.items()} for lab,rr in r.items()},indent=1))
