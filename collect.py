"""Public ATS collection: no candidate screening, credentials or paid services."""
import argparse,fcntl,hashlib,json,os,re,secrets,shutil,sys,tempfile,time,urllib.request
from contextlib import contextmanager
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urlparse
from adapters import normalize,extract_jobs,Skip
import registry
ROOT=Path(__file__).resolve().parent
HOSTS={p:feed[0] for p,feed in registry.FEEDS.items()}
DUE_SLACK=timedelta(minutes=15)  # hourly ticks drift; without slack a 5-hour interval becomes 6
FIELDS=('key','provider','board','req_id','title','locations','workplace_type','url','apply_url','published','description','compensation_raw')
NOTICE='Public discovery data only. Not personal fit or READY evidence. Failed sources retain old timestamps; absence is not closure.'
def read(path,default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name('.%s.tmp'%path.name)
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    os.replace(tmp,path)
SECRET_QUERY=re.compile(r'(?i)\b((?:access_)?token|api_?key|key|secret|password|passwd|signature|sig|auth)=[^&\s]+')
def redact(text):
    text=re.sub(r'(?i)(https?://)[^/\s@]+@',r'\1[redacted]@',str(text))
    text=re.sub(r'(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+',r'\1 [redacted]',text)
    return SECRET_QUERY.sub(lambda m:m.group(1)+'=[redacted]',text)
@contextmanager
def exclusive_lock(path):
    """Refuses to start while another local run holds the lock; released automatically if the process dies."""
    path.parent.mkdir(parents=True,exist_ok=True)
    with open(path,'w') as f:
        try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('Another collection run holds %s'%path) from None
        yield
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('Redirect requires source review')
def fetch(source):
    parsed=urlparse(source['url'])
    if parsed.scheme!='https' or parsed.netloc!=HOSTS[source['provider']]:
        raise ValueError('Unapproved endpoint')
    req=urllib.request.Request(source['url'],headers={'User-Agent':'public-job-collector/1.0','Accept':'application/json'})
    with urllib.request.build_opener(NoRedirect).open(req,timeout=25) as response:
        body=response.read(25000001)
    if len(body)>25000000: raise ValueError('Response exceeds 25 MB')
    return json.loads(body)
def public_job(source,raw,now):
    rec=normalize(source['provider'],source['board'],raw)
    job={k:rec[k] for k in FIELDS}
    if not job['title'] or not job['url']: raise ValueError('Missing title or primary URL')
    job['content_hash']=hashlib.sha256(json.dumps(job,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    job['observed_at']=now
    return job
def _time(v):
    try: return datetime.fromisoformat(v) if v else None
    except (TypeError,ValueError): return None
def due_sources(sources,status,now):
    """Ids to collect on a scheduled run. A source without poll_interval_hours is collected on every run; one with an
    interval only once its last real attempt is that old (less DUE_SLACK, so run drift can't slip it a whole run).
    Never-attempted sources are always due."""
    last={s.get('source'):_time(s.get('checked_at')) for s in (status or {}).get('sources',[])}
    return {s['id'] for s in sources
            if not s.get('poll_interval_hours') or not last.get(s['id'])
            or now-last[s['id']]>=timedelta(hours=s['poll_interval_hours'])-DUE_SLACK}
def next_due(sources,status):
    last={s.get('source'):_time(s.get('checked_at')) for s in (status or {}).get('sources',[])}
    times=[last[s['id']]+timedelta(hours=s['poll_interval_hours'])-DUE_SLACK for s in sources if s.get('poll_interval_hours') and last.get(s['id'])]
    return min(times).isoformat() if times else None
def publish(output,files):
    """Stage every file first, then move boards, index and finally status.json into place.
    A crash or error before the moves leaves the previous publication untouched."""
    output.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='.collect-staging-',dir=output.parent))
    try:
        for rel,value in files.items(): write(stage/rel,value)
        for rel in sorted(files,key=lambda r:(r=='status.json',r=='index.json',r)):
            (output/rel).parent.mkdir(parents=True,exist_ok=True)
            os.replace(stage/rel,output/rel)
    finally:
        shutil.rmtree(stage,ignore_errors=True)
def collect(sources,output,fetcher=fetch,pause=time.sleep,due=None,run_id=None,trigger='local'):
    if not sources: raise ValueError('No sources to collect; previous output left unchanged')
    now=datetime.now(timezone.utc).isoformat()
    run_id=run_id or 'local-%s-%s'%(now[:19].replace(':','').replace('-',''),secrets.token_hex(3))
    due=None if due is None else set(due)
    prior_sources={s.get('source'):s for s in read(output/'status.json',{}).get('sources',[])}
    def carried(source):
        """A source is skipped only when its latest real attempt is on record (and its board file exists if it succeeded)."""
        prior=prior_sources.get(source['id']) or {}
        return (due is not None and source['id'] not in due and prior.get('status') in ('ok','failed') and prior.get('checked_at')
                and (prior['status']!='ok' or (output/'boards'/(source['id']+'.json')).exists()))
    staged,statuses,index={},[],[]
    attempted=[s for s in sources if not carried(s)]
    for source in sources:
        rel='boards/'+source['id']+'.json'
        previous=read(output/rel,{'jobs':[]})
        old={j['key']:j for j in previous['jobs']}
        prior=prior_sources.get(source['id'],{})
        if source not in attempted:
            # status describes the latest real attempt, copied unchanged; this run made no request.
            jobs=previous['jobs']
            status=dict(prior)|{'attempted_this_run':False}
        else:
            status={'source':source['id'],'endpoint':source['url'],'checked_at':now,'attempted_this_run':True,
                    'endpoint_changed':bool(prior.get('endpoint')) and prior.get('endpoint')!=source['url']}
            try:
                jobs,skipped,seen=[],0,set()
                for raw in extract_jobs(source['provider'],fetcher(source)):
                    try: job=public_job(source,raw,now)
                    except Skip:
                        skipped+=1
                        continue
                    if job['key'] in seen: raise ValueError('Duplicate requisition in source')
                    seen.add(job['key'])
                    job['change']='new' if job['key'] not in old else ('unchanged' if job['content_hash']==old[job['key']]['content_hash'] else 'changed')
                    if job['change']=='changed': job['changed_fields']=sorted(k for k in FIELDS if job[k]!=old[job['key']].get(k))
                    jobs.append(job)
                staged[rel]={'schema':'public-job-board-1','source':source['id'],'run_id':run_id,'collected_at':now,'jobs':jobs}
                status.update(status='ok',jobs=len(jobs),skipped=skipped,new=sum(j['change']=='new' for j in jobs),changed=sum(j['change']=='changed' for j in jobs),no_longer_listed=sorted(set(old)-seen))
            except Exception as error:
                jobs=previous['jobs']
                status.update(status='failed',error_type=type(error).__name__,error=redact(error)[:300],retained_historical_jobs=len(jobs))
            if source is not attempted[-1]: pause(2)
            earlier_success=prior.get('last_success_at') or (prior.get('checked_at') if prior.get('status')=='ok' else None)
            status['last_success_at']=now if status['status']=='ok' else earlier_success
            failures=prior.get('consecutive_failures',1 if prior.get('status')=='failed' else 0)
            status['consecutive_failures']=0 if status['status']=='ok' else failures+1
        status.setdefault('last_success_at',status['checked_at'] if status['status']=='ok' else None)
        status.setdefault('consecutive_failures',1 if status['status']=='failed' else 0)
        hours=source.get('poll_interval_hours')
        status.update(poll_interval_hours=hours,next_due_at=(_time(status['checked_at'])+timedelta(hours=hours)).isoformat() if hours else None)
        statuses.append(status)
        if not status['attempted_this_run']: change='not_checked'
        else: change=None if status['status']=='ok' else 'unknown_after_failure'
        for j in jobs:
            index.append({k:j[k] for k in ('key','title','locations','url','content_hash','observed_at')}|{
                'board_file':'public/'+rel,'source_status':status['status'],'change':change or j.get('change')}|(
                {'changed_fields':j['changed_fields']} if not change and j.get('changed_fields') else {}))
    success=sum(s['attempted_this_run'] and s['status']=='ok' for s in statuses)
    failed=sum(s['attempted_this_run'] and s['status']=='failed' for s in statuses)
    state='ok' if success==len(attempted) else ('partial' if success else 'failed')
    if state=='ok': outcome='All %d attempted sources succeeded.'%success
    elif state=='partial': outcome='%d of %d attempted sources failed; their previous jobs are retained with original observed_at.'%(failed,len(attempted))
    else: outcome='No attempted source succeeded. Published jobs are last-known-good data from earlier runs, not a fresh collection.'
    known={s['id']+'.json' for s in sources}
    orphans=sorted(p.name for p in (output/'boards').glob('*.json') if p.name not in known) if (output/'boards').exists() else []
    result={'schema':'public-job-index-1','run_id':run_id,'trigger':trigger,'attempted_at':now,'status':state,'outcome':outcome,
            'successful_sources':success,'failed_sources':failed,'attempted_sources':len(attempted),
            'not_due_sources':len(sources)-len(attempted),'total_sources':len(sources),'listing_count':len(index),
            'orphan_board_files':orphans,'sources':statuses,'jobs':index,'notice':NOTICE}
    staged['index.json']=result
    staged['status.json']={k:result[k] for k in result if k!='jobs'}
    publish(output,staged)
    return result
def summary(lines,level=None,message=None):
    """Prints to the log and, under GitHub Actions, to the job summary and annotations."""
    text='\n'.join(lines)+'\n'
    print(text)
    if level and message: print('::%s::%s'%(level,message))
    path=os.environ.get('GITHUB_STEP_SUMMARY')
    if path:
        with open(path,'a',encoding='utf-8') as f: f.write(text)
def report(result):
    lines=['## Collection run %s: %s'%(result['run_id'],result['status'].upper()),'',result['outcome'],'',
           'Trigger: %s. Attempted %d of %d enabled sources (%d not due). Listings in index: %d.'%(
               result['trigger'],result['attempted_sources'],result['total_sources'],result['not_due_sources'],result['listing_count']),'',
           '| source | status | jobs | new | changed | consecutive failures | error |','|---|---|---|---|---|---|---|']
    for s in result['sources']:
        state=s['status'] if s['attempted_this_run'] else 'not due (last: %s at %s)'%(s['status'],s['checked_at'])
        lines.append('| %s | %s | %s | %s | %s | %s | %s |'%(s['source'],state,s.get('jobs',s.get('retained_historical_jobs','')),
                     s.get('new',''),s.get('changed',''),s['consecutive_failures'],(s.get('error') or '').replace('|','/')))
    if result['orphan_board_files']: lines+=['','Board files not in the registry (left untouched): '+', '.join(result['orphan_board_files'])]
    level={'partial':'warning','failed':'error'}.get(result['status'])
    summary(lines,level,result['outcome'])
def main(argv=None):
    ap=argparse.ArgumentParser(description='Collect official ATS feeds from sources.json')
    ap.add_argument('--trigger',default='local',help='GitHub event name; "schedule" collects only sources that are due')
    ap.add_argument('--ids',default='',help='comma-separated source ids to collect now regardless of schedule')
    args=ap.parse_args(argv)
    try: _,sources,warnings=registry.load(ROOT/'sources.json',ROOT/'employers.json')
    except registry.RegistryError as e:
        summary(['## Collection not started: invalid sources.json or employers.json','']+['- '+redact(m) for m in e.errors],'error','Invalid source registry; no requests made')
        return 2
    enabled=[s for s in sources if s['enabled']]
    output=ROOT/'public'
    ids={i for i in args.ids.replace(' ','').split(',') if i}
    if ids-{s['id'] for s in enabled}:
        summary(['Not enabled sources: '+', '.join(sorted(ids-{s['id'] for s in enabled}))],'error','Unknown source ids')
        return 2
    with exclusive_lock(ROOT/'.collect.lock'):
        status=read(output/'status.json',{})
        due=None
        if ids: due=ids
        elif args.trigger=='schedule':
            due=due_sources(enabled,status,datetime.now(timezone.utc))
            if not due:
                summary(['## Collection skipped: no source is due','','Scheduled check only; no employer requests were made and no files changed.',
                         'Last attempt: %s. Next source due at: %s.'%(status.get('attempted_at'),next_due(enabled,status))])
                return 0
        result=collect(enabled,output,due=due,trigger=args.trigger,
                       run_id='gh-%s-%s'%(os.environ['GITHUB_RUN_ID'],os.environ.get('GITHUB_RUN_ATTEMPT','1')) if os.environ.get('GITHUB_RUN_ID') else None)
    for w in warnings: print('registry warning:',w)
    report(result)
    return 1 if result['status']=='failed' else 0
if __name__=='__main__':
    sys.exit(main())
