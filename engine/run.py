"""One engine run (step 8): ingest, extract, page leads, public outputs and, optionally, candidate queues, under a
run lock, with a run record, freshness and partial-run reporting.

  python -m engine.run [--public-out DIR] [--candidates DIR --queue PATH] [--report FILE] [--strict]
  python -m engine.run --history 10

Outcome:
  ok       every stage ran and every source is fresh
  partial  the run finished but something is incomplete or old: a source failed, was not attempted or is stale,
           extraction stopped on its time budget, or an optional stage failed. Each reason is listed.
  failed   a core stage (ingest, extract) raised; later stages did not run. Work already committed is kept
           (ingest is one transaction, extraction commits per batch), so the next run resumes.
A run that dies without finishing is marked interrupted by the next run.

The run record in the store (engine_runs) holds public facts only. Candidate counts appear in the report this
command prints or writes, never in the store, and a report that includes them is refused inside the repository.
Collector-side budgets and backoff belong to collect.py (docs/ENGINE.md section 3); this module never fetches.
"""
import argparse,json,sys,time
from datetime import datetime,timezone
from pathlib import Path
from engine import store as st
from engine.lock import LockBusy,RunLock
ROOT=Path(__file__).resolve().parent.parent
SCHEMA='engine-run-1'
class RunError(RuntimeError):
    pass
def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')
def _sources(path):
    if isinstance(path,(list,tuple)): return list(path)
    path=Path(path) if path else None
    return json.loads(path.read_text(encoding='utf-8')) if path and path.exists() else []
def _stage(report,name,fn,clock,core,private=False):
    began=clock()
    try:
        detail=fn()
        report['stages'][name]={'status':'skipped' if isinstance(detail,str) else 'ok','seconds':round(clock()-began,3),
                                'detail':detail}
        return detail
    except Exception as e:
        # A private stage's message can name a candidate; the stage record goes to the store, so it keeps the type only.
        report['stages'][name]={'status':'failed','seconds':round(clock()-began,3),'error':type(e).__name__ if private else '%s: %s'%(type(e).__name__,e)}
        if core: raise
        report['reasons'].append('stage %s failed: %s'%(name,type(e).__name__))
        return None
def run(db,public,sources_file=None,pages_root=None,public_out=None,candidates_dir=None,queue_path=None,
        stale_after_hours=12,extract_budget_seconds=None,wait_seconds=0,now=None,clock=time.monotonic):
    fixed=now is not None
    now=now or _now()
    with RunLock(db,'engine run',wait_seconds):
        conn=st.connect(db)
        try:
            interrupted=[r[0] for r in conn.execute("select run_id from engine_runs where outcome='running'")]
            with conn:
                # We hold the lock and only locked runs write engine_runs, so a 'running' row is a run that died.
                conn.execute("update engine_runs set outcome='interrupted',finished_at=? where outcome='running'",(now,))
                run_id=conn.execute("insert into engine_runs(started_at,outcome) values(?,'running')",(now,)).lastrowid
            report={'schema':SCHEMA,'run_id':run_id,'started_at':now,'finished_at':None,'outcome':'running','reasons':[],
                    'previous_interrupted':interrupted,'stages':{}}
            try:
                _run(conn,report,public,sources_file,pages_root,public_out,candidates_dir,queue_path,stale_after_hours,
                     extract_budget_seconds,now,clock)
                report['outcome']='partial' if report['reasons'] else 'ok'
            except Exception as e:
                report['outcome']='failed'
                report['error']='%s: %s'%(type(e).__name__,e)
                raise
            finally:
                report['finished_at']=now if fixed else _now()
                public_part={k:v for k,v in report.items() if k!='candidates'}
                with conn:
                    conn.execute('update engine_runs set finished_at=?,outcome=?,reasons=?,report=?,error=? where run_id=?',
                                 (report['finished_at'],report['outcome'],json.dumps(report['reasons']),
                                  json.dumps(public_part,ensure_ascii=False),report.get('error'),run_id))
            return report
        finally:
            conn.close()
def _run(conn,report,public,sources_file,pages_root,public_out,candidates_dir,queue_path,stale_after_hours,budget,now,clock):
    sources=_sources(sources_file)
    ing=_stage(report,'ingest',lambda:st.ingest_snapshot(conn,public,sources),clock,core=True)
    by_status,by_action={},{}  # from what was ingested, not a second read of status.json the collector may have replaced
    for s in ing['sources']:
        by_status[s['status']]=by_status.get(s['status'],0)+1
        by_action[s['action']]=by_action.get(s['action'],0)+1
    totals={k:sum(s[k] for s in ing['sources']) for k in ('new','changed','unchanged','missing','inaccessible','relisted')}
    report['stages']['ingest']['detail']={'sources_by_action':by_action,'warnings':ing['warnings']}
    age=st._hours(now,ing['attempted_at']) if ing.get('attempted_at') else None
    report['snapshot']={'attempted_at':ing.get('attempted_at'),'hours_old':age,'sources_by_status':by_status}
    failed=sorted(s['source'] for s in ing['sources'] if s['action']=='ingested' and s['status']=='failed')
    skipped=sorted(s['source'] for s in ing['sources'] if s['action']=='not_attempted')
    if failed: report['reasons'].append('%d source retrieval(s) failed in this snapshot: %s'%(len(failed),', '.join(failed)))
    if skipped: report['reasons'].append('%d source(s) not attempted in this snapshot: %s'%(len(skipped),', '.join(skipped)))
    if ing['warnings']: report['reasons'].append('%d ingest warning(s)'%len(ing['warnings']))
    if age is not None and age>stale_after_hours: report['reasons'].append('latest snapshot is %.1f hours old'%age)
    ex=_stage(report,'extract',lambda:st.extract_pending(conn,max_seconds=budget,clock=clock),clock,core=True)
    if ex['budget_exhausted']: report['reasons'].append('extraction stopped on its %ss time budget; %d version(s) pending'%(budget,ex['pending']))
    if ex['failed']: report['reasons'].append('%d extraction(s) failed'%ex['failed'])
    fresh=st.freshness(conn,now,stale_after_hours,[s['id'] for s in sources if s.get('enabled',True) is not False])
    bad={k:v for k,v in fresh['counts'].items() if k!='fresh'}
    if bad: report['reasons'].append('source freshness: '+', '.join('%d %s'%(v,k) for k,v in sorted(bad.items())))
    report['freshness']=fresh
    summ=st.summary(conn)
    report['counts']={'collected':totals['new']+totals['changed']+totals['unchanged'],**totals,
                      'postings':summ['postings'],'duplicate_canonical_urls':summ['duplicate_canonical_urls'],
                      'extracted':ex['extracted'],'extraction_failed':ex['failed'],'extraction_pending':ex['pending']}
    root=Path(pages_root) if pages_root else None
    def leads():
        if not root or not (root/'public'/'pages'/'index.json').exists(): return 'no public/pages/index.json under %s'%root
        from engine.leads import ingest_pages
        out=ingest_pages(conn,root)
        if out['warnings']: report['reasons'].append('%d page-capture warning(s)'%len(out['warnings']))
        return out
    _stage(report,'leads',leads,clock,core=False)
    def outputs():
        if not public_out: return 'no --public-out given'
        from engine.outputs import verify,write_postings
        written=write_postings(conn,public_out,now=now)
        bad=verify(public_out)
        if bad: raise RunError('public outputs failed verification: %s'%bad)
        return {'out':str(public_out),'totals':written['totals'],'records_rewritten':written['records_rewritten'],'verified':True}
    _stage(report,'outputs',outputs,clock,core=False)
    def candidates():
        if not candidates_dir or not queue_path: return 'no --candidates and --queue given'
        from engine import candidates as cfg,review as rq
        people=cfg.load_all(candidates_dir)
        queue=rq.connect(queue_path)
        try:
            enq=rq.enqueue(conn,queue,people,now=now)
            report['candidates']={c:{'enqueue':enq[c],'status':rq.status(conn,queue,c,now=now)} for c in sorted(people)}
        finally:
            queue.close()
        return {'candidates':len(people),'note':'per-candidate counts are in this report only, never in the store'}
    _stage(report,'candidates',candidates,clock,core=False,private=True)
def history(conn,limit=10):
    return [{'run_id':r['run_id'],'started_at':r['started_at'],'finished_at':r['finished_at'],'outcome':r['outcome'],
             'reasons':json.loads(r['reasons'] or '[]'),'error':r['error'],
             'seconds':{k:v.get('seconds') for k,v in json.loads(r['report'] or '{}').get('stages',{}).items()}}
            for r in conn.execute('select * from engine_runs order by run_id desc limit ?',(limit,))]
def main(argv=None):
    ap=argparse.ArgumentParser(prog='python -m engine.run')
    ap.add_argument('--db',default=str(ROOT/'state'/'engine.sqlite3'))
    ap.add_argument('--public',default=str(ROOT/'public'),help='collector output to ingest')
    ap.add_argument('--sources',default=str(ROOT/'sources.json'),help='expected sources, for freshness and provider metadata')
    ap.add_argument('--pages-root',default=str(ROOT),help='checkout holding public/pages/ (leads are skipped if absent)')
    ap.add_argument('--public-out',help='write public posting outputs here (location is an owner decision, D3)')
    ap.add_argument('--candidates',help='private candidate directory; with --queue, screens and queues new postings')
    ap.add_argument('--queue',help='private review queue database (refused inside the repository)')
    ap.add_argument('--report',help='also write the run report here')
    ap.add_argument('--stale-after-hours',type=float,default=12)
    ap.add_argument('--extract-budget-seconds',type=float)
    ap.add_argument('--wait-seconds',type=float,default=0,help='wait this long for another run to finish')
    ap.add_argument('--strict',action='store_true',help='exit 3 when the outcome is partial')
    ap.add_argument('--history',type=int,metavar='N',help='print the last N runs and exit')
    args=ap.parse_args(argv)
    if args.history:
        conn=st.connect(args.db)
        print(json.dumps(history(conn,args.history),indent=1))
        return 0
    if args.report and args.candidates:
        from engine.review import _inside_repo
        if _inside_repo(args.report): ap.error('a report with candidate counts must be written outside the repository')
    try:
        report=run(args.db,args.public,args.sources,args.pages_root,args.public_out,args.candidates,args.queue,
                   args.stale_after_hours,args.extract_budget_seconds,args.wait_seconds)
    except LockBusy as e:
        print('error: %s'%e,file=sys.stderr)
        return 2
    except Exception as e:
        print('error: run failed: %s: %s'%(type(e).__name__,e),file=sys.stderr)
        return 1
    text=json.dumps(report,indent=1,ensure_ascii=False)
    if args.report: Path(args.report).write_text(text+'\n',encoding='utf-8')
    print(text)
    return 3 if args.strict and report['outcome']=='partial' else 0
if __name__=='__main__':
    sys.exit(main())
