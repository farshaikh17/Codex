"""python -m bench [validate|collection|baselines|engine|score PREDICTIONS.json]

score reads {"assessments": [...], "extraction": [...], "duplicate_groups": [...], "queue_runs": [...]}; every key is optional.
Exit 1 when the fixtures are inconsistent, a collection expectation fails, or scored predictions contain a false READY.
"""
import json,sys
from bench import score
def report(name,value):
    print(json.dumps({name:value},indent=1,ensure_ascii=False))
def main(argv):
    cmd=argv[0] if argv else 'validate'
    problems=score.validate()
    if problems or cmd=='validate':
        report('fixture_problems',problems)
        return 1 if problems else 0
    if cmd=='collection':
        from bench.collection import run_all
        results=run_all()
        report('collection',results)
        return 1 if any(r['failures'] for r in results.values()) else 0
    if cmd=='baselines':
        for name in ('always_ready','always_exclude','always_review'):
            r=score.score_assessments(score.baseline(name))
            report(name,{k:(len(v) if isinstance(v,list) else v) for k,v in r.items() if k!='decision_matrix'})
        return 0
    if cmd=='engine':
        from bench import engine_adapter
        if not engine_adapter.available():
            report('engine','engine/extract.py not present on this checkout; nothing measured')
            return 0
        preds=engine_adapter.predictions()
        report('extraction',score.score_extraction(preds))
        report('extraction_needs_human_review',score.score_extraction(preds,status=('needs_human_review',)))
        return 0
    if cmd=='score' and len(argv)>1:
        preds=json.loads(open(argv[1],encoding='utf-8').read())
        out={}
        if 'assessments' in preds: out['assessments']=score.score_assessments(preds['assessments'])
        if 'extraction' in preds: out['extraction']=score.score_extraction(preds['extraction'])
        if 'duplicate_groups' in preds: out['duplicates']=score.score_duplicates(preds['duplicate_groups'])
        if 'queue_runs' in preds: out['queue']=score.score_queue(preds['queue_runs'])
        report('score',out)
        return 1 if out.get('assessments',{}).get('false_ready') else 0
    print(__doc__)
    return 2
sys.exit(main(sys.argv[1:]))
