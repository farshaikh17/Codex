"""Bounded public-source discovery and diverse vacancy evidence; no candidate decisions.
Stdlib only. Reuses the employer-page scanner from parked PR #10.
"""
import argparse, collections, hashlib, ipaddress, json, re, socket, time, urllib.robotparser
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, urljoin
import discover, registry
from adapters import normalize, extract_jobs

NOTICE = "Untrusted public discovery evidence; never eligibility or READY. Missing is not closed; unchanged is not assessed."
FAMILIES = {
 "implementation": r"implementation|onboarding|CRM|highlevel|hubspot|salesforce admin|workflow|webhook|integration|UAT|quality assurance",
 "business-operations": r"business systems|technical operations|automation|delivery|project manager",
 "ai-delivery": r"AI implementation|AI product|AI solutions|technical product",
 "energy-advisory": r"energy|decarbon|sustainab|efficiency|power|utilit|demand response|battery|grid\b",
 "asset-projects": r"reliab|asset|commission|electrical|maintenance|industrial|plant",
}
# Software reliability and sales commissions share words with physical asset work; they are not that signal.
NOT_ASSET=r"site reliability|database reliability|reliability engineer.*(?:cloud|platform|infrastructure|database)|\bSRE\b|commission (?:analyst|plan|specialist)|sales commission"
def families(title):
    tags=[k for k, pattern in FAMILIES.items() if re.search(pattern, title, re.I)]
    if "asset-projects" in tags and re.search(NOT_ASSET,title,re.I):
        tags.remove("asset-projects")
    return tags

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
    """Every actual GET counted; redirects refused; no retries. Requests start only before the deadline and each
    body read is time- and byte-bounded. Successive requests to one host wait max(1s, robots Crawl-delay)."""
    MAX_CRAWL_DELAY=15
    def __init__(self, max_requests=40, seconds=180, sleep=time.sleep):
        self.requests=0; self.max_requests=min(max_requests,40)
        self.deadline=time.monotonic()+min(seconds,180); self.halted=None
        self.rules={}; self.last={}; self.delays={}; self.sleep=sleep
    def _polite(self,host):
        delay=max(1.0,self.delays.get(host,0))
        if delay>self.MAX_CRAWL_DELAY: raise discover.Blocked('robots Crawl-delay %ss exceeds this bounded run'%delay)
        wait=self.last.get(host,-1e9)+delay-time.monotonic()
        if wait>0:
            if time.monotonic()+wait>=self.deadline:
                self.halted="request/time budget reached"; raise discover.Halt(self.halted)
            self.sleep(wait)
    def get(self,url,allowed,limits):
        if self.halted: raise discover.Halt(self.halted)
        if self.requests>=self.max_requests or time.monotonic()>=self.deadline:
            self.halted="request/time budget reached"; raise discover.Halt(self.halted)
        u=public_url(url)
        if u.hostname not in allowed: raise discover.Blocked("host not approved")
        self._polite(u.hostname)
        self.requests+=1; self.last[u.hostname]=time.monotonic()
        remaining=max(.1,self.deadline-time.monotonic())
        result=discover.http_get(url,allowed,{**limits,"timeout_s":min(10,remaining),"max_seconds":min(30,remaining+10)})
        self.last[u.hostname]=time.monotonic()
        if u.path=='/robots.txt' and result[0]==200:
            # Learn Crawl-delay for every caller (including the reused scanner, which keeps its own rule cache).
            rp=urllib.robotparser.RobotFileParser(); rp.parse(result[2].splitlines())
            self.delays[u.hostname]=float(rp.crawl_delay(discover.UA_TOKEN) or 0)
        if result[0]==429:
            self.halted="HTTP 429; stop run"; raise discover.Halt(self.halted)
        return result
    def _allowed(self,url):
        u=public_url(url); origin=u.scheme+"://"+u.netloc
        if origin not in self.rules:
            self.rules[origin]=discover.robots_rules(lambda target:self.get(target,{u.hostname},discover.LIMITS),url)[0]
        ok,why=self.rules[origin](url)
        if not ok: raise discover.Blocked(why)
        return u
    def page(self,url):
        u=self._allowed(url)
        status, final, body=self.get(url,{u.hostname},discover.LIMITS)
        discover._check_access(status,body)
        if status>=400: raise ValueError("HTTP %s"%status)
        return body
    def feed(self,source):
        # API paths also honor robots; registry fixes host/path/options.
        u=self._allowed(source['url'])
        status,final,body=self.get(source['url'],{u.hostname},{**discover.LIMITS,'max_bytes':10000000})
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
    """(selected, deferred). Deferred targets are untouched: no request, no state change, never reported fresh."""
    due,deferred=[],[]
    for target in config["targets"]:
        prev=state.get(target["employer"],{})
        if prev.get("retry_after") and datetime.fromisoformat(prev["retry_after"])>now:
            deferred.append({"employer":target["employer"],"reason":"cooldown","retry_after":prev["retry_after"],
                             "last_checked_at":prev.get("checked_at")}); continue
        due.append(target)
    # Stalest first guarantees exploration; observed plausible yield breaks ties only.
    due.sort(key=lambda t:(state.get(t["employer"],{}).get("checked_at",""),
             -state.get(t["employer"],{}).get("plausible",0),t["employer"]))
    deferred+=[{"employer":t["employer"],"reason":"rotation_limit","last_checked_at":state.get(t["employer"],{}).get("checked_at")}
               for t in due[limit:]]
    return due[:limit],deferred

CARD=("key","req_id","title","locations","workplace_type","url","apply_url","published","observed_at",
      "employer","source_id","provenance","freshness","source_status","source_checked_at","source_last_success_at")
EXCLUDED=r"helpdesk|technical support|customer support|sales representative|account executive"
PREFERRED=r"implementation|onboarding|commissioning|reliability|maintenance|CRM administrator|automation specialist"
def diverse(jobs,cap=3,limit=60):
    """Exact identity dedup precedes selection. No private seen/assessed state. Cards are compact: no descriptions."""
    seen=set(); groups=collections.defaultdict(list)
    for job in jobs:
        identity=(job["employer"],job.get("req_id") or job["key"])
        if identity in seen: continue
        seen.add(identity)
        tags=families(job["title"])
        if tags and not re.search(EXCLUDED,job["title"],re.I):
            groups[job["employer"]].append({**{k:job[k] for k in CARD if k in job},"responsibility_signals":tags,
                "signal_basis":"public title keywords only","stage":"exact_vacancy_unreviewed",
                "eligibility":"not_assessed (private review only; remote/APAC wording is not India eligibility)"})
    # One card per employer and title: same-title requisitions in other places are listed on it, not given slots.
    for employer,values in groups.items():
        merged={}
        for card in values:
            title=re.sub(r"\W+"," ",card["title"].lower()).strip()
            if title not in merged: merged[title]={**card,"same_title_elsewhere":[]}
            else: merged[title]["same_title_elsewhere"].append({"key":card["key"],"url":card.get("url"),
                    "locations":[l.get("text") for l in card.get("locations") or []][:3]})
        groups[employer]=list(merged.values())
    for values in groups.values():
        values.sort(key=lambda j:(not bool(re.search(PREFERRED,j['title'],re.I)),
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

LEAD_RECHECK=timedelta(days=7)
def lead_id(host):
    return ("lead-"+re.sub(r"[^a-z0-9]+","-",host.lower()))[:63].strip("-")
def leads_to_validate(leads,now,limit=2):
    """Never-validated leads first (oldest seen first), then the stalest validation past its recheck time."""
    due=[l for l in leads if not l.get("validation") or datetime.fromisoformat(l["validation"]["retry_after"])<=now]
    return sorted(due,key=lambda l:(bool(l.get("validation")),(l.get("validation") or {}).get("checked_at",""),
                                    l.get("first_seen_at") or "",l["host"]))[:limit]
def validation_result(target):
    read=sum(p.get("result")=="read" for p in target["pages"])
    boards=[{k:b.get(k) for k in ("provider","board","status","feed_jobs","source_id") if b.get(k) is not None} for b in target["boards"]]
    if any(b["status"] in ("verified_feed","already_configured") for b in boards): result="supported_board_found"
    elif boards: result="board_found_unverified"  # e.g. feed robots/access refused: evidence, not a usable source
    elif target["unsupported_ats"]: result="unsupported_ats"
    elif not read or target["stopped"]: result="blocked_or_failed"
    else: result="no_board_found"
    return {"result":result,"pages_read":read,"boards":boards,"unsupported_ats":sorted({u["ats"] for u in target["unsupported_ats"]}),
            "evidence":[e for b in target["boards"] for e in b.get("evidence",[])][:3],
            "reasons":[p.get("reason") for p in target["pages"] if p.get("reason")][:3],
            "ownership":"unverified: a board linked from this host is a lead for human source review, not a source"}

def _cooldown(now,status,**extra):
    return {"checked_at":now.isoformat(),"retry_after":(now+timedelta(days=1)).isoformat(),"status":status,**extra}

def run(config,sources,employers,out,network=None,now=None):
    validate_config(config)
    now=now or datetime.now(timezone.utc)
    net=network or Network(); out=Path(out)
    old=json.loads((out/"state.json").read_text()) if (out/"state.json").exists() else {}
    state=dict(old); errors=[]; captures=[]; jobs=[]; feeds={}; deferred=[]
    prior_report=json.loads((out/'report.json').read_text()) if (out/'report.json').exists() else {}
    # Existing exact vacancies also enter the diverse evidence batch, labelled with their source's latest real attempt.
    boardroot=out.parent/"boards"
    status_doc=json.loads((out.parent/"status.json").read_text()) if (out.parent/"status.json").exists() else {}
    health={s.get("source"):s for s in status_doc.get("sources",[])}
    bysource={s["id"]:s for s in sources}
    for path in sorted(boardroot.glob("*.json")):
        sid=path.stem
        if sid not in bysource: continue
        h=health.get(sid,{})
        fresh="last_observed" if h.get("status")=="ok" else ("last_known_good_after_failure" if h.get("status")=="failed" else "not_reported")
        for job in json.loads(path.read_text(encoding="utf-8")).get("jobs",[]):
            jobs.append({**job,"employer":bysource[sid]["employer"],"source_id":sid,
                         "provenance":str(path.relative_to(out.parent)),"freshness":fresh,"source_status":h.get("status","not_reported"),
                         "source_checked_at":h.get("checked_at"),"source_last_success_at":h.get("last_success_at")})
    # Provisional employer links: one per host, first/last seen kept. A link is never a source or an ownership claim.
    leads={}
    for lead in prior_report.get('employer_leads',[]):
        host=urlparse(lead['url']).hostname
        if host: leads.setdefault(host,{**lead,"host":host,"first_seen_at":lead.get("first_seen_at") or prior_report.get("generated_at")})
    def halted(key,what):
        deferred.append({"source":key,"reason":"not_attempted: "+(net.halted or what)})
    for directory in config.get("directories",[])[:3]:
        key="directory:"+directory["url"]; prev=state.get(key,{})
        if prev.get("retry_after") and datetime.fromisoformat(prev["retry_after"])>now:
            deferred.append({"source":key,"reason":"cooldown","retry_after":prev["retry_after"]}); continue
        if net.halted: halted(key,"run halted"); continue
        try:
            found=directory_leads(net.page(directory['url']),directory['url'],directory['link_pattern'])
            offset=prev.get('offset',0)%max(1,len(found))
            for lead in (found[offset:]+found[:offset])[:25]:
                host=urlparse(lead['url']).hostname
                leads[host]={**leads.get(host,{"first_seen_at":now.isoformat()}),**lead,"host":host,"last_seen_at":now.isoformat()}
            state[key]=_cooldown(now,"ok",offset=offset+25,links_found=len(found))
        except discover.Halt:
            halted(key,"run halted")  # budget/429: never cool down or mark failed what was not attempted
        except Exception as e:
            errors.append({"source":key,"error":str(e)[:200]})
            state[key]=_cooldown(now,"failed")
    configured={(s['provider'],s['board'].lower()) for s in sources if s.get('enabled',True)}
    for approved in config.get('reviewed_feeds',[])[:2]:
        if (approved['provider'],approved['board'].lower()) in configured: continue
        key='feed:'+approved['employer']; prev=state.get(key,{})
        if prev.get('retry_after') and datetime.fromisoformat(prev['retry_after'])>now:
            deferred.append({"source":key,"reason":"cooldown","retry_after":prev["retry_after"]}); continue
        if net.halted: halted(key,"run halted"); continue
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
            state[key]=_cooldown(now,'ok')
        except discover.Halt:
            halted(key,"run halted")
        except Exception as e:
            errors.append({'source':key,'error':str(e)[:200]})
            state[key]=_cooldown(now,'failed')
    targets,later=due_targets(config,state,now)
    deferred+=[{"source":"target:"+d.pop("employer"),**d} for d in later]
    def feed(source):
        data=net.feed(source)
        feeds[(source["provider"],source["board"].lower())]=data
        return data
    report=discover.discover(targets,sources,employers,get=net.get,feed=feed,
        limits={"max_pages":2,"max_requests":40,"sitemaps":False},pause=lambda _:None,now=now.isoformat())
    for target in report["targets"]:
        if not target["pages"] and (report.get("halted") or net.halted):
            halted("target:"+target["employer"],"run halted"); continue
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
        state[target["employer"]]=_cooldown(now,"blocked_or_failed" if target["stopped"] or not any(p.get("result")=="read" for p in target["pages"]) else "read",plausible=plausible)
    # Bounded lead validation: scan a few provisional links' own sites for supported ATS boards.
    # Results stay on the lead; no source is enabled and lead-board vacancies never enter the review cards.
    lead_report=None
    picked=[] if net.halted else leads_to_validate(list(leads.values()),now)
    if picked:
        lead_targets=[{"employer":lead_id(l["host"]),"start_url":l["url"]} for l in picked]
        lead_report=discover.discover(lead_targets,sources,employers,get=net.get,feed=net.feed,
            limits={"max_pages":2,"max_requests":40,"sitemaps":False},pause=lambda _:None,now=now.isoformat())
        for lead,target in zip(picked,lead_report["targets"]):
            if not target["pages"] and (lead_report.get("halted") or net.halted):
                halted("lead:"+lead["host"],"run halted"); continue
            lead["validation"]={"checked_at":now.isoformat(),"retry_after":(now+LEAD_RECHECK).isoformat(),**validation_result(target)}
    leads=sorted(leads.values(),key=lambda l:(l.get("last_seen_at") or "",l["host"]))[-500:]
    batch=diverse(jobs)
    identities=lambda pred:len({(j["employer"],j.get("req_id") or j["key"]) for j in jobs if pred(j)})
    by_employer=collections.Counter(j["employer"] for j in batch)
    result={"schema":"market-discovery-1","notice":NOTICE,"generated_at":now.isoformat(),
        "requests":net.requests,"halted":net.halted,"employer_leads":leads,"source_proposals":report,"lead_validation":lead_report,
        "errors":errors,"deferred":deferred,"validated_feeds":captures,"vacancies":batch,
        "metrics":{"exact_identities":identities(lambda j:True),
            "plausible_title_identities":identities(lambda j:families(j["title"])),
            "fresh_feed_identities":identities(lambda j:j["freshness"] in ("fresh_feed","last_observed")),
            "stale_or_unreported_identities":identities(lambda j:j["freshness"] not in ("fresh_feed","last_observed")),
            "review_batch":len(batch),"review_employers":len(by_employer),
            "largest_employer_share":round(max(by_employer.values())/len(batch),3) if batch else None,
            "new_source_exact_identities":identities(lambda j:j["source_id"] is None),
            "provisional_employer_links":len(leads),
            "leads_validated_this_run":sum((l.get("validation") or {}).get("checked_at")==now.isoformat() for l in leads),
            "lead_validation_results":dict(collections.Counter((l.get("validation") or {}).get("result","not_validated") for l in leads)),
            "basis":"public title keywords and source health only; no candidate relevance feedback is integrated"}}
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
