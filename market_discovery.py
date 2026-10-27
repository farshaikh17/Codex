"""Bounded public-source discovery and diverse vacancy evidence; no candidate decisions.
Stdlib only. Reuses the employer-page scanner from parked PR #10.
"""
import argparse, collections, hashlib, ipaddress, json, re, socket, time
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, urljoin
import discover, registry
from adapters import normalize, extract_jobs

NOTICE = "Untrusted public discovery evidence; never eligibility or READY. Missing is not closed; unchanged is not assessed."
FAMILIES = {
 "implementation": r"implementation|onboarding|CRM|highlevel|workflow|webhook|integration|UAT|quality assurance",
 "business-operations": r"business systems|technical operations|automation|delivery|project manager",
 "ai-delivery": r"AI implementation|AI product|AI solutions|technical product",
 "energy-advisory": r"energy|decarbon|sustainab|efficiency|power|utilities",
 "asset-projects": r"reliab|asset|commission|electrical|maintenance|industrial|plant",
}
def families(title):
    return [k for k, pattern in FAMILIES.items() if re.search(pattern, title, re.I)]

def write(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    tmp.replace(path)

def public_url(url):
    u=urlparse(url)
    if u.scheme!="https" or not u.hostname or u.username or u.password or u.port not in (None,443):
        raise ValueError("plain public HTTPS URL required")
    if u.hostname=="localhost" or u.hostname.endswith(".local"): raise ValueError("local address")
    for item in socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(item[4][0]).is_global: raise ValueError("nonpublic address")
    return u

class Network:
    """Every actual GET counted; redirects refused. No retries; total wall deadline."""
    def __init__(self, max_requests=40, seconds=180):
        self.requests=0; self.max_requests=min(max_requests,40)
        self.deadline=time.monotonic()+min(seconds,180); self.halted=None
        self.rules={}
    def get(self,url,allowed,limits):
        if self.halted: raise discover.Halt(self.halted)
        if self.requests>=self.max_requests or time.monotonic()>=self.deadline:
            self.halted="request/time budget reached"; raise discover.Halt(self.halted)
        u=public_url(url)
        if u.hostname not in allowed: raise discover.Blocked("host not approved")
        self.requests+=1
        result=discover.http_get(url,allowed,{**limits,"timeout_s":min(10,max(.1,self.deadline-time.monotonic()))})
        if result[0]==429:
            self.halted="HTTP 429; stop run"; raise discover.Halt(self.halted)
        return result
    def page(self,url):
        u=public_url(url); origin=u.scheme+"://"+u.netloc
        if origin not in self.rules:
            self.rules[origin]=discover.robots_rules(lambda target:self.get(target,{u.hostname},discover.LIMITS),url)[0]
        ok,why=self.rules[origin](url)
        if not ok: raise discover.Blocked(why)
        status, final, body=self.get(url,{u.hostname},discover.LIMITS)
        discover._check_access(status,body)
        if status>=400: raise ValueError("HTTP %s"%status)
        time.sleep(1)
        return body
    def feed(self,source):
        # API paths also honor robots; registry fixes host/path/options.
        url=source['url']; u=public_url(url); origin=u.scheme+'://'+u.netloc
        if origin not in self.rules:
            self.rules[origin]=discover.robots_rules(lambda target:self.get(target,{u.hostname},discover.LIMITS),url)[0]
        ok,why=self.rules[origin](url)
        if not ok: raise discover.Blocked(why)
        status,final,body=self.get(url,{u.hostname},{**discover.LIMITS,'max_bytes':10000000})
        discover._check_access(status,body)
        if status>=400: raise ValueError('HTTP %s'%status)
        return json.loads(body)

class DirectoryLinks(HTMLParser):
    def __init__(self,base,selector):
        super().__init__(); self.base=base; self.selector=re.compile(selector); self.links=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag!="a" or not attrs.get("href"): return
        url=urljoin(self.base,attrs["href"]).split("#")[0]; u=urlparse(url)
        if (u.scheme=="https" and u.hostname and not u.username and not u.query
            and u.hostname!=urlparse(self.base).hostname and self.selector.search(url)
            and not re.search(r'\.(?:png|jpe?g|gif|svg|pdf|js|css|woff2?)(?:$|[?#])',u.path,re.I) and len(self.links)<2000): self.links.append(url)

def directory_leads(html, url, selector):
    parser=DirectoryLinks(url,selector); parser.feed(html[:2000000])
    return [{"url":v,"discovered_from":url,"stage":"provisional_employer_link",
             "ownership":"unverified","collection_enabled":False}
            for v in sorted(set(parser.links))]

def due_targets(config,state,now,limit=4):
    due=[]
    for target in config["targets"]:
        prev=state.get(target["employer"],{})
        if prev.get("retry_after") and datetime.fromisoformat(prev["retry_after"])>now: continue
        due.append(target)
    # Stalest first guarantees exploration; observed plausible yield breaks ties only.
    return sorted(due,key=lambda t:(state.get(t["employer"],{}).get("checked_at",""),
                  -state.get(t["employer"],{}).get("plausible",0),t["employer"]))[:limit]

def diverse(jobs,cap=3,limit=60):
    """Exact identity dedup precedes selection. No private seen/assessed state."""
    seen=set(); groups=collections.defaultdict(list)
    for job in jobs:
        identity=(job["employer"],job.get("req_id") or job["key"])
        if identity in seen: continue
        seen.add(identity)
        tags=families(job["title"])
        if tags and not re.search(r"helpdesk|technical support|customer support|sales representative|account executive",job["title"],re.I): groups[job["employer"]].append({**job,"families":tags,"stage":"exact_vacancy_unreviewed"})
    for values in groups.values():
        values.sort(key=lambda j:(
            not bool(re.search(r'implementation|onboarding|commissioning|reliability|maintenance|CRM administrator|automation specialist',j['title'],re.I)),
            bool(re.search(r'staff engineer|principal engineer|architect|data analyst',j['title'],re.I)),j['key']))
    selected=[]
    for i in range(cap):
        for employer in sorted(groups):
            if i<len(groups[employer]) and len(selected)<limit: selected.append(groups[employer][i])
    return selected

def validate_config(config):
    if set(config)-{'schema','notice','targets','directories','reviewed_feeds'} or config.get('schema')!='market-sources-1':
        raise ValueError('invalid public market source configuration')
    discover.validate_targets(config['targets'])
    for d in config.get('directories',[]):
        if set(d)!={'url','link_pattern'} or not d['url'].startswith('https://'): raise ValueError('invalid directory')
        re.compile(d['link_pattern'])
    for source in config.get('reviewed_feeds',[]):
        if set(source)!={'employer','provider','board','ownership_evidence'}: raise ValueError('invalid reviewed feed')
        if source['provider'] not in registry.FEEDS or not registry.BOARD.fullmatch(source['board']): raise ValueError('invalid feed')
        if not source['ownership_evidence'].get('url','').startswith('https://'): raise ValueError('ownership evidence required')

def run(config,sources,employers,out,network=None,now=None):
    validate_config(config)
    now=now or datetime.now(timezone.utc)
    net=network or Network(); out=Path(out)
    old=json.loads((out/"state.json").read_text()) if (out/"state.json").exists() else {}
    state=dict(old); leads=[]; errors=[]; captures=[]; jobs=[]; feeds={}
    prior_report=json.loads((out/'report.json').read_text()) if (out/'report.json').exists() else {}
    leads=list(prior_report.get('employer_leads',[]))
    # Existing exact vacancies also enter the diverse evidence batch.
    boardroot=out.parent/"boards"
    bysource={s["id"]:s for s in sources}
    for path in sorted(boardroot.glob("*.json")):
        sid=path.stem
        if sid not in bysource: continue
        for job in json.loads(path.read_text(encoding="utf-8")).get("jobs",[]):
            jobs.append({**job,"employer":bysource[sid]["employer"],"source_id":sid,
                         "provenance":str(path.relative_to(out.parent)),"freshness":"last_observed"})
    for directory in config.get("directories",[])[:3]:
        key="directory:"+directory["url"]; prev=state.get(key,{})
        if prev.get("retry_after") and datetime.fromisoformat(prev["retry_after"])>now: continue
        try:
            found=directory_leads(net.page(directory['url']),directory['url'],directory['link_pattern'])
            offset=prev.get('offset',0)%max(1,len(found))
            leads+=(found[offset:]+found[:offset])[:25]
            state[key]={"checked_at":now.isoformat(),"retry_after":(now+timedelta(days=1)).isoformat(),"status":"ok","offset":offset+25}
        except Exception as e:
            errors.append({"source":key,"error":str(e)[:200]})
            state[key]={"checked_at":now.isoformat(),"retry_after":(now+timedelta(days=1)).isoformat(),"status":"failed"}
    configured={(s['provider'],s['board'].lower()) for s in sources if s.get('enabled',True)}
    for approved in config.get('reviewed_feeds',[])[:2]:
        if (approved['provider'],approved['board'].lower()) in configured: continue
        key='feed:'+approved['employer']; prev=state.get(key,{})
        if prev.get('retry_after') and datetime.fromisoformat(prev['retry_after'])>now: continue
        try:
            source={**approved,'url':registry.feed_url(approved['provider'],approved['board'])}
            data=net.feed(source); rawjobs=extract_jobs(source['provider'],data)
            count=0
            for raw in rawjobs:
                rec=normalize(source['provider'],source['board'],raw)
                if not rec['req_id'] or not rec['title'] or not rec['url']: continue
                jobs.append({**rec,'employer':approved['employer'],'source_id':None,
                    'provenance':approved['ownership_evidence'],'observed_at':now.isoformat(),'freshness':'fresh_feed'})
                count+=1
            captures.append({'employer':approved['employer'],'provider':approved['provider'],
                'board':approved['board'],'exact_vacancies':count,'status':'validated_feed'})
            state[key]={'checked_at':now.isoformat(),'retry_after':(now+timedelta(days=1)).isoformat(),'status':'ok'}
        except Exception as e:
            errors.append({'source':key,'error':str(e)[:200]})
            state[key]={'checked_at':now.isoformat(),'retry_after':(now+timedelta(days=1)).isoformat(),'status':'failed'}
    targets=due_targets(config,state,now)
    def feed(source):
        data=net.feed(source)
        feeds[(source["provider"],source["board"].lower())]=data
        return data
    report=discover.discover(targets,sources,employers,get=net.get,feed=feed,
        limits={"max_pages":2,"max_requests":40,"sitemaps":False},pause=lambda _:None,now=now.isoformat())
    for target in report["targets"]:
        if not target["pages"] and report.get("halted"): continue
        plausible=0
        for board in target["boards"]:
            data=feeds.get((board["provider"],board["board"].lower()))
            if data is None: continue
            for raw in extract_jobs(board["provider"],data):
                try: rec=normalize(board["provider"],board["board"],raw)
                except (ValueError,KeyError): continue
                if not rec["req_id"] or not rec["title"] or not rec["url"]: continue
                jobs.append({**rec,"employer":target["employer"],"source_id":None,
                    "provenance":board["evidence"],"observed_at":now.isoformat(),"freshness":"fresh_feed"})
                plausible+=bool(families(rec["title"]))
        state[target["employer"]]={"checked_at":now.isoformat(),"plausible":plausible,
            "retry_after":(now+timedelta(days=1)).isoformat(),
            "status":"blocked_or_failed" if target["stopped"] or not any(p.get("result")=="read" for p in target["pages"]) else "read"}
    leads=list({lead['url']:lead for lead in leads}.values())[-500:]
    batch=diverse(jobs)
    result={"schema":"market-discovery-1","notice":NOTICE,"generated_at":now.isoformat(),
        "requests":net.requests,"halted":net.halted,"employer_leads":leads,"source_proposals":report,
        "errors":errors,"validated_feeds":captures,"vacancies":batch,
        "metrics":{"exact_identities":len({(j["employer"],j["key"]) for j in jobs}),
            "plausible_title_identities":len({(j["employer"],j["key"]) for j in jobs if families(j["title"])}),
            "review_batch":len(batch),"review_employers":len({j["employer"] for j in batch}),
            "new_source_exact_identities":len({(j["employer"],j["key"]) for j in jobs if j["source_id"] is None}),
            "provisional_employer_links":len(leads)}}
    write(out/"report.json",result); write(out/"state.json",state)
    return result

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config",default="market_sources.json"); ap.add_argument("--out",default="public/discovery")
    args=ap.parse_args(); _,sources,_=registry.load()
    employers=json.loads(Path("employers.json").read_text())
    result=run(json.loads(Path(args.config).read_text()),sources,employers,args.out)
    print(json.dumps({"requests":result["requests"],"metrics":result["metrics"],"errors":result["errors"]},indent=2))
if __name__=="__main__": main()
