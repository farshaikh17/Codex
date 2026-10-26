"""Public ATS collection: no candidate screening, credentials or paid services."""
import hashlib,json,time,urllib.request
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlparse
from adapters import normalize,extract_jobs,Skip
ROOT=Path(__file__).resolve().parent
HOSTS={'greenhouse':'boards-api.greenhouse.io','lever':'api.lever.co','ashby':'api.ashbyhq.com'}
def read(path,default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
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
    keys=('key','provider','board','req_id','title','locations','workplace_type','url','apply_url','published','description','compensation_raw')
    job={k:rec[k] for k in keys}
    if not job['title'] or not job['url']: raise ValueError('Missing title or primary URL')
    job['content_hash']=hashlib.sha256(json.dumps(job,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    job['observed_at']=now
    return job
def collect(sources,output,fetcher=fetch,pause=time.sleep):
    now=datetime.now(timezone.utc).isoformat()
    statuses,index=[],[]
    for source in sources:
        path=output/'boards'/(source['id']+'.json')
        previous=read(path,{'jobs':[]})
        old={j['key']:j for j in previous['jobs']}
        status={'source':source['id'],'endpoint':source['url'],'checked_at':now}
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
                jobs.append(job)
            write(path,{'schema':'public-job-board-1','source':source['id'],'collected_at':now,'jobs':jobs})
            status.update(status='ok',jobs=len(jobs),skipped=skipped,new=sum(j['change']=='new' for j in jobs),changed=sum(j['change']=='changed' for j in jobs),no_longer_listed=sorted(set(old)-seen))
        except Exception as error:
            jobs=previous['jobs']
            status.update(status='failed',error=str(error)[:300],retained_historical_jobs=len(jobs))
        statuses.append(status)
        for j in jobs:
            index.append({k:j[k] for k in ('key','title','locations','url','content_hash','observed_at')}|{
                'board_file':'public/boards/'+source['id']+'.json','source_status':status['status'],
                'change':j.get('change') if status['status']=='ok' else 'unknown_after_failure'})
        pause(2)
    success=sum(s['status']=='ok' for s in statuses)
    result={'schema':'public-job-index-1','attempted_at':now,'status':'ok' if success==len(sources) else ('partial' if success else 'failed'),
            'successful_sources':success,'total_sources':len(sources),'listing_count':len(index),'sources':statuses,'jobs':index,
            'notice':'Public discovery data only. Not personal fit or READY evidence. Failed sources retain old timestamps; absence is not closure.'}
    write(output/'index.json',result)
    write(output/'status.json',{k:result[k] for k in ('schema','attempted_at','status','successful_sources','total_sources','listing_count','sources')})
    return result
if __name__=='__main__':
    result=collect(read(ROOT/'sources.json',[]),ROOT/'public')
    print(json.dumps({k:result[k] for k in ('status','successful_sources','total_sources','listing_count')}))
    raise SystemExit(1 if result['status']=='failed' else 0)

