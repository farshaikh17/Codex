"""Role-and-location vacancy discovery beyond configured employers, through permitted public job-search APIs.

Adopted: Himalayas Jobs API (https://himalayas.app/api; no key; terms at https://himalayas.app/terms#api permit use
in our own tools provided Apply uses the supplied applicationLink unchanged, Himalayas is credited, jobs are not
passed on to other job boards, caches are used and limits respected). Robots.txt allows /jobs/api/search.
Not adopted (see docs/MARKET_DISCOVERY.md): JobSpy (Naukri via a private API with forged app headers and a signed
token; Bayt and others behind challenges it passes only by TLS impersonation), Remotive (robots disallow search),
RemoteOK (robots disallow all), Jobicy (tag filter not applied; no India geo).
Results are aggregator listings: provisional until official employer/requisition evidence is found.
"""
import json, re, sys
from adapters import html_to_text
from datetime import datetime, timezone
from urllib.parse import urlencode

HIMALAYAS = 'himalayas.app'
ATTRIBUTION = 'Listing from Himalayas (https://himalayas.app); apply only through the supplied Himalayas applicationLink.'

def search_url(query, country=None):
    params = {'q': query}
    if country: params['country'] = country
    return 'https://himalayas.app/jobs/api/search?' + urlencode(params)

def _iso(ts):
    try: return datetime.fromtimestamp(int(ts), timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError, OSError): return None

def listings(data, query, country, observed_at, limit=20):
    """Provisional aggregator cards. Identity is the Himalayas guid; employer is a name, not a verified owner."""
    if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
        raise ValueError('unexpected Himalayas response shape')
    out = []
    for job in data['jobs'][:limit]:
        if not isinstance(job, dict) or not job.get('guid') or not job.get('title'): continue
        restrictions = [r for r in (job.get('locationRestrictions') or []) if isinstance(r, str)]
        locations = [{'text': r, 'source': 'himalayas.locationRestrictions'} for r in restrictions]
        if not restrictions: locations = [{'text': 'no location restriction stated', 'source': 'himalayas.locationRestrictions'}]
        salary = None
        if job.get('minSalary') or job.get('maxSalary'):
            salary = {'min': job.get('minSalary'), 'max': job.get('maxSalary'), 'currency': job.get('currency'),
                      'unit': job.get('salaryPeriod'), 'provenance': 'Himalayas listing (aggregator, not employer-confirmed)'}
        out.append({'key': 'himalayas:' + re.sub(r'^https://himalayas\.app/companies/', '', job['guid'])[:200],
                    'req_id': None, 'title': str(job['title'])[:300], 'employer_name': str(job.get('companyName') or '')[:200],
                    'employer': 'aggregator:' + str(job.get('companySlug') or 'unknown')[:80],
                    'url': job['guid'], 'apply_url': job.get('applicationLink'), 'locations': locations,
                    'published': _iso(job.get('pubDate')), 'valid_through': _iso(job.get('expiryDate')),
                    'observed_at': observed_at, 'salary': salary, 'employment_type': job.get('employmentType'),
                    'categories': [c for c in (job.get('categories') or []) if isinstance(c, str)][:15],
                    'stage': 'aggregator_listing_provisional',
                    'discovery': {'method': 'role_search', 'channel': 'himalayas', 'query': query, 'country_filter': country,
                                  'attribution': ATTRIBUTION},
                    'official_evidence': None})
    return out

def as_jobs(data,query,country,observed_at,limit=20):
    """Himalayas listings as collector-shaped job records, so engine.qualify can screen them with full text.
    Remote board: workplace is remote; location restrictions are the only geography evidence; pay is the listing's,
    labelled as aggregator-reported. The employer is a name, not a verified owner (provisional)."""
    out=[]
    for job in data.get('jobs',[])[:limit]:
        if not isinstance(job,dict) or not job.get('guid') or not job.get('title'): continue
        locs=[{'text':r,'source':'himalayas.locationRestrictions'} for r in (job.get('locationRestrictions') or []) if isinstance(r,str)]
        pay=None
        if job.get('minSalary') or job.get('maxSalary'):
            pay='%s %s - %s per %s (aggregator-reported)'%(job.get('currency') or '',job.get('minSalary') or '',job.get('maxSalary') or '',
                                                      {'annual':'year','monthly':'month','hourly':'hour'}.get(job.get('salaryPeriod'),job.get('salaryPeriod') or 'year'))
        slug=str(job.get('companySlug') or 'unknown')[:60]
        out.append({'key':'himalayas:%s:%s'%(slug,re.sub(r'[^a-z0-9-]+','-',job['guid'].rsplit('/',1)[-1].lower())[:80]),
                    'title':str(job['title'])[:300],'url':job['guid'],'apply_url':job.get('applicationLink'),'locations':locs,
                    'workplace_type':'remote','description':html_to_text(job.get('description') or '')[:20000],'compensation_raw':pay,
                    'employer_name':job.get('companyName'),'board':slug,'observed_at':observed_at,'_source':'himalayas',
                    'discovery':{'channel':'himalayas','query':query,'country_filter':country,'attribution':ATTRIBUTION}})
    return out

def fetch(queries,out_path,max_requests=12):
    """Bounded, robots-aware fetch through market_discovery.Network (no retries, request budget, per-host spacing)."""
    from datetime import datetime, timezone
    from market_discovery import Network
    net=Network(max_requests=max_requests); now=datetime.now(timezone.utc).isoformat(); jobs={}; log=[]
    for q,c in queries:
        url=search_url(q,c)
        try:
            u=net._allowed(url); status,_,body=net.get(url,{u.hostname},{'max_bytes':3000000,'timeout_s':15,'max_redirects':0})
            got=as_jobs(json.loads(body),q,c,now) if status==200 else []
            for j in got: jobs.setdefault(j['key'],j)
            log.append({'query':q,'country':c,'status':status,'jobs':len(got)})
        except Exception as e:
            log.append({'query':q,'country':c,'error':str(e)[:200]})
            if net.halted: break
    with open(out_path,'w',encoding='utf-8') as f: json.dump(list(jobs.values()),f,ensure_ascii=False)
    return {'requests':net.requests,'jobs':len(jobs),'log':log}

def _norm(text):
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()

def resolve(listing, employers_by_name, official_jobs):
    """Look for the same requisition in a configured official feed (employer name + identical title).
    A match is evidence for review, not proof: aggregator titles can be edited, employers can share names."""
    eid = employers_by_name.get(_norm(listing['employer_name']))
    if not eid: return None
    title = _norm(listing['title'])
    hits = [j for j in official_jobs if j['employer'] == eid and _norm(j['title']) == title]
    return {'employer': eid, 'status': 'official_title_match' if hits else 'employer_configured_no_title_match',
            'official_keys': [j['key'] for j in hits][:5]}

if __name__=='__main__':
    # python role_search.py OUT.json "query|country" ...   (country may be empty)
    print(json.dumps(fetch([tuple((a.split('|')+[''])[:2]) for a in sys.argv[2:]],sys.argv[1]),indent=1))
