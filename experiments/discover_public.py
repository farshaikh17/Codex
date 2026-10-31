"""Manual GET-only discovery from free employer ATS feeds. No credentials or schedules.

Writes only to a required experiment output directory; never public/ or production.
"""
import argparse,concurrent.futures,html,json,re,urllib.request
from datetime import datetime,timezone
from pathlib import Path
from job_text import clean_text

def text(value):
    return clean_text(value)

def normalize(data,provider,board):
    rows=data['jobs'] if provider=='greenhouse' else data
    if not isinstance(rows,list): raise ValueError('expected jobs list')
    jobs=[]
    for j in rows:
        if provider=='greenhouse':
            key=f"greenhouse:{board}:{j['id']}";url=j['absolute_url'];title=j['title']
            loc=(j.get('location') or {}).get('name','');description=text(j.get('content'))
            workplace=None
        else:
            key=f"lever:{board}:{j['id']}";url=j['hostedUrl'];title=j['text']
            loc=(j.get('categories') or {}).get('location','')
            description=text(' '.join([j.get('descriptionPlain') or j.get('description','')]+[x.get('text','')+' '+x.get('content','') for x in j.get('lists',[])]+[j.get('additionalPlain') or j.get('additional','')]))
            workplace=j.get('workplaceType')
        jobs.append({'key':key,'provider':provider,'company':board,'title':title,'url':url,'locations':[{'text':loc}],'workplace_type':workplace,'description':description})
    return jobs

def fetch(source):
    p,b=source['provider'],source['board']
    if p=='smartrecruiters':
        # api.smartrecruiters.com/robots.txt disallows every agent except LinkedInBot (verified 2026-10-27; recorded in
        # docs/MARKET_DISCOVERY.md on main). Not fetched without new evidence of permission. fetch_smart is kept unused.
        raise ValueError('smartrecruiters disabled: robots.txt disallows automated access')
    if p not in ('greenhouse','lever') or not re.fullmatch('[a-z0-9-]+',b):raise ValueError('unsupported source')
    url=f'https://boards-api.greenhouse.io/v1/boards/{b}/jobs?content=true' if p=='greenhouse' else f'https://api.lever.co/v0/postings/{b}?mode=json'
    req=urllib.request.Request(url,headers={'User-Agent':'read-only-recruiter-experiment/2','Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=35) as response:
        payload=response.read(15000001)
        if len(payload)>15000000:raise ValueError('response exceeds size limit')
    jobs=normalize(json.loads(payload),p,b)
    return {'schema':'public-job-board-1','source':f'{b}-{p}','collected_at':datetime.now(timezone.utc).isoformat(),'feed_url':url,'discovery_candidate':source['candidate'],'jobs':jobs}

def fetch_smart(source):
    b=source['board']
    if not re.fullmatch('[A-Za-z0-9-]+',b):raise ValueError('invalid board')
    root=f'https://api.smartrecruiters.com/v1/companies/{b}/postings'
    def get(url):
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'read-only-recruiter-experiment/2'}),timeout=35) as response:return json.load(response)
    listings=[];total=0
    for offset in (0,100):
        data=get(root+f'?country=in&limit=100&offset={offset}');total=data['totalFound'];listings.extend(data['content'])
        if len(listings)>=total:break
    def detail(j):
        d=get(root+'/'+str(j['id']));loc=d.get('location') or j['location']
        if loc.get('country','').lower()!='in':raise ValueError('country-filter drift')
        sections=(d.get('jobAd') or {}).get('sections') or {}
        description=text(' '.join(v.get('text','') for v in sections.values() if isinstance(v,dict)))
        return {'key':f"smartrecruiters:{b}:{j['id']}",'provider':'smartrecruiters','company':b,'title':d['name'],
                'url':d.get('postingUrl') or f"https://jobs.smartrecruiters.com/{b}/{j['id']}",
                'locations':[{'text':loc.get('fullLocation') or ', '.join([loc.get('city',''),'India'])}],
                'workplace_type':'remote' if loc.get('remote') else 'hybrid' if loc.get('hybrid') else None,'description':description}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:jobs=list(pool.map(detail,listings))
    return {'schema':'public-job-board-1','source':b+'-smartrecruiters','collected_at':datetime.now(timezone.utc).isoformat(),
            'feed_url':root+'?country=in','discovery_candidate':source['candidate'],'feed_total':total,'truncated':len(jobs)<total,'jobs':jobs}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--sources',default=str(Path(__file__).with_name('discovery_sources.json')));parser.add_argument('--output',required=True)
    a=parser.parse_args();dest=Path(a.output).resolve();root=Path(__file__).resolve().parents[1]
    if not dest.is_relative_to(root) or dest==root or dest.is_relative_to(root/'public'):raise ValueError('output must be isolated under experiment checkout, outside public/')
    dest.mkdir(parents=True,exist_ok=True);sources=json.loads(Path(a.sources).read_text());log=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(fetch,s):s for s in sources}
        for future in concurrent.futures.as_completed(futures):
            s=futures[future]
            try:
                board=future.result();(dest/(board['source']+'.json')).write_text(json.dumps(board,ensure_ascii=False,indent=2),encoding='utf-8');log.append({'source':board['source'],'jobs':len(board['jobs']),'status':'fetched','feed_url':board['feed_url']})
            except Exception as e:log.append({'source':s['board'],'status':'failed','error':str(e)})
    (dest.parent/'discovery-log.json').write_text(json.dumps(sorted(log,key=lambda x:x['source']),indent=2));print(json.dumps(log,indent=2))
    if not any(x['status']=='fetched' for x in log):raise SystemExit(1)
if __name__=='__main__':main()
