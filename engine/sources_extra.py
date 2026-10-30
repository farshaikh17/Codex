"""Free public discovery beyond the collector's ATS feeds, bounded and incremental. Stdlib only.

- Himalayas Jobs API (role/location search; no key; terms permit use with attribution) through role_search and
  market_discovery.Network (robots-aware, request budget, per-host spacing, no retries).
- Workday public career-site JSON (the endpoint the employer's own career page calls; robots.txt checked per host,
  POST search + GET detail, 1 s spacing, byte cap, request budget, no retries). Only tenants listed in
  engine/discovery_sources.json are contacted.
Each query is tracked in the private tracker, so every run takes the least recently run queries first.
Output jobs have the collector's shape (key, title, url, apply_url, locations, workplace_type, description,
compensation_raw, employer_name, board, _source, observed_at) so engine.qualify reads them unchanged.
"""
import html,json,re,time,urllib.request,urllib.robotparser
from pathlib import Path
CONFIG=Path(__file__).resolve().parent/'discovery_sources.json'
UA='career-engine/1.0 (+https://github.com/farshaikh17/codex; bounded public discovery)'
MAX_BYTES=4_000_000
ADAPTER_VERSION=2  # 2: city kept with country in locations (1 dropped the city)
class Budget:
    def __init__(self,requests,sleep=time.sleep,clock=time.monotonic):
        self.left=requests; self.sleep=sleep; self.clock=clock; self.last={}; self.robots={}
    def take(self,host):
        if self.left<=0: raise BudgetExhausted('request budget reached')
        wait=self.last.get(host,-1e9)+1.0-self.clock()
        if wait>0: self.sleep(wait)
        self.left-=1; self.last[host]=self.clock()
class BudgetExhausted(RuntimeError): pass
def _http(url,data=None,timeout=20):
    req=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,
                               headers={'User-Agent':UA,'Accept':'application/json',**({'Content-Type':'application/json'} if data is not None else {})})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        body=r.read(MAX_BYTES+1)
        if len(body)>MAX_BYTES: raise ValueError('response over %d bytes'%MAX_BYTES)
        return json.loads(body)
def text_of(markup):
    t=re.sub(r'(?i)<br\s*/?>|</(p|li|h\d|div)>','\n',markup or '')
    t=html.unescape(re.sub(r'<[^>]+>',' ',t))
    return re.sub(r'[ \t]+',' ',re.sub(r'\n\s*\n+','\n',t)).strip()
WORKPLACE={'remote':'remote','hybrid':'hybrid','onsite':'onsite','on-site':'onsite','field/customer site':'onsite','office':'onsite'}
def workday_job(tenant,info,observed_at):
    locs=[]
    for loc in [info.get('jobRequisitionLocation') or {}]+(info.get('additionalLocations') and [{'descriptor':x} for x in info['additionalLocations']] or []):
        name=loc.get('descriptor') if isinstance(loc,dict) else str(loc)
        country=((loc.get('country') or {}).get('descriptor') if isinstance(loc,dict) else None) or ''
        if name: locs.append({'text':name if not country or country in name else '%s, %s'%(name,country),'source':'workday.location'})
    if not locs and info.get('location'):
        locs=[{'text':', '.join(x for x in (info['location'],(info.get('country') or {}).get('descriptor')) if x),'source':'workday.location'}]
    return {'key':'workday:%s:%s'%(tenant['id'],info.get('jobReqId') or info.get('jobPostingId')),'provider':'workday','board':tenant['id'],
            'req_id':info.get('jobReqId'),'title':info.get('title'),'url':info.get('externalUrl'),'apply_url':info.get('externalUrl'),
            'locations':locs,'workplace_type':WORKPLACE.get(str(info.get('remoteType') or '').strip().lower()),
            'published':info.get('startDate'),'description':text_of(info.get('jobDescription')),'compensation_raw':None,
            'employer_name':tenant['employer'],'_source':'workday:'+tenant['id'],'observed_at':observed_at,
            'discovery':{'channel':'workday','attribution':'Employer career site (Workday) %s'%tenant['host'],'adapter_version':ADAPTER_VERSION}}
def _robots_ok(budget,host,path,fetch_text):
    if host not in budget.robots:
        budget.take(host)
        rp=urllib.robotparser.RobotFileParser()
        try: rp.parse(fetch_text('https://%s/robots.txt'%host).splitlines())
        except Exception: rp=None  # robots unavailable: treat as disallowed (fail closed)
        budget.robots[host]=rp
    rp=budget.robots[host]
    return bool(rp) and rp.can_fetch(UA,'https://%s%s'%(host,path))
def _text(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=20) as r: return r.read(200000).decode('utf-8','replace')
def workday(tenants,queries,seen,budget,observed_at,max_details=40,http=_http,fetch_text=_text):
    """Search each (tenant, query); fetch details only for postings not already in `seen` (posting_id set).
    Returns (jobs, log). Postings already seen are not re-fetched: their stored snapshot stays in the pool."""
    jobs,log,details=[],[],0
    for t in tenants:
        for q in queries:
            entry={'source':'workday:'+t['id'],'query':q['id']}
            try:
                path='/wday/cxs/%s/%s/jobs'%(t['tenant'],t['site'])
                if not _robots_ok(budget,t['host'],path,fetch_text): entry.update(status='robots_disallowed'); log.append(entry); continue
                budget.take(t['host'])
                found=http('https://%s%s'%(t['host'],path),{'appliedFacets':{},'limit':20,'offset':0,'searchText':q['text']}).get('jobPostings') or []
                fresh=0
                for p in found:
                    ext=p.get('externalPath') or ''
                    req=(p.get('bulletFields') or [None])[0]
                    key='workday:%s:%s'%(t['id'],req) if req else None
                    if key and key in seen: continue
                    if details>=max_details: entry['truncated']=True; break
                    budget.take(t['host'])
                    info=http('https://%s/wday/cxs/%s/%s%s'%(t['host'],t['tenant'],t['site'],ext)).get('jobPostingInfo') or {}
                    details+=1
                    if info.get('posted') is False or info.get('canApply') is False: continue
                    j=workday_job(t,info,observed_at); seen.add(j['key']); jobs.append(j); fresh+=1
                entry.update(status='ok',listed=len(found),fetched=fresh)
            except BudgetExhausted as e:
                entry.update(status='budget',error=str(e)); log.append(entry); return jobs,log
            except Exception as e:
                entry.update(status='failed',error='%s: %s'%(type(e).__name__,str(e)[:200]))
            log.append(entry)
    return jobs,log
def himalayas(queries,observed_at,max_requests=30):
    """Role/location queries through role_search (Himalayas) within market_discovery.Network's budget."""
    import role_search
    from market_discovery import Network
    net=Network(max_requests=max_requests); jobs={}; log=[]
    for q in queries:
        url=role_search.search_url(q['q'],q.get('country'))
        entry={'source':'himalayas','query':q['id']}
        try:
            u=net._allowed(url); status,_,body=net.get(url,{u.hostname},{'max_bytes':3000000,'timeout_s':15,'max_redirects':0})
            got=role_search.as_jobs(json.loads(body),q['q'],q.get('country'),observed_at) if status==200 else []
            for j in got: jobs.setdefault(j['key'],j)
            entry.update(status='ok' if status==200 else 'http_%s'%status,listed=len(got))
        except Exception as e:
            entry.update(status='failed',error=str(e)[:200])
            if net.halted: log.append(entry); break
        log.append(entry)
    return list(jobs.values()),log,net.requests
def load_config(path=None):
    cfg=json.loads(Path(path or CONFIG).read_text(encoding='utf-8'))
    ids=[q['id'] for q in cfg['himalayas']['queries']]+[q['id'] for q in cfg['workday']['queries']]
    if len(ids)!=len(set(ids)): raise ValueError('discovery query ids must be unique')
    return cfg
