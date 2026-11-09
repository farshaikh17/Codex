"""Bounded public-source discovery and diverse vacancy evidence; no candidate decisions.
Stdlib only. Reuses the employer-page scanner from parked PR #10.
"""
import argparse, collections, hashlib, ipaddress, json, re, socket, time, urllib.robotparser
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, urljoin
import career_pages, discover, registry, role_search, signals
from adapters import normalize, extract_jobs

NOTICE = ("Untrusted public discovery evidence; never eligibility or READY. Missing is not closed; unchanged is not assessed; "
          "a healthy collection is not candidate relevance.")
def families(title):
    """Public responsibility families named by a title (keyword evidence; see signals.title_signal for strength)."""
    return signals.title_signal(title)["families"]

def write(path, value, compact=False):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    text=json.dumps(value,ensure_ascii=False,separators=(",",":"),sort_keys=True) if compact else json.dumps(value,ensure_ascii=False,indent=2)
    tmp.write_text(text+"\n",encoding="utf-8")
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

CARD=("key","req_id","title","locations","workplace_type","url","apply_url","published","valid_through","observed_at",
      "employer","employer_name","source_id","provenance","freshness","source_status","source_checked_at","source_last_success_at",
      "salary","stage","discovery","extraction","official_evidence","categories","checked_at")
PREFERRED=r"implementation|onboarding|commissioning|reliability|maintenance|CRM administrator|automation specialist|planner"
def _card(job):
    sig=signals.title_signal(job["title"]); geo=signals.geography(job.get("locations"))
    return {**{k:job[k] for k in CARD if k in job},"stage":job.get("stage","exact_vacancy_unreviewed"),
            "responsibility_signals":sig["families"],"signal_strength":sig["strength"],"signal_notes":sig["notes"],
            "signal_basis":"public title keywords only","geographic_evidence":geo,
            "eligibility":"not_assessed (private review only; remote/APAC wording is not India eligibility)"}

def diverse(jobs,cap=3,limit=60,history=None):
    """Exact identity dedup precedes selection; cards are compact (no descriptions). Sales/support-first titles are
    counted but not carded. Cards shown least often come first, and employers least recently shown lead each round,
    so the same first batch cannot hide unseen vacancies forever. history is public card exposure, not review state."""
    history=history if history is not None else {}
    seen=set(); groups=collections.defaultdict(list)
    for job in jobs:
        identity=(job["employer"],job.get("req_id") or job["key"])
        if identity in seen: continue
        seen.add(identity)
        card=_card(job)
        if card["responsibility_signals"] and card["signal_strength"]!="excluded": groups[job["employer"]].append(card)
    # Same title at one employer shares a card; every underlying identity and evidence pointer stays listed on it.
    for employer,values in groups.items():
        merged={}
        for card in sorted(values,key=lambda c:c["key"]):
            title=re.sub(r"\W+"," ",card["title"].lower()).strip()
            if title not in merged: merged[title]={**card,"same_title_elsewhere":[]}
            else: merged[title]["same_title_elsewhere"].append({"key":card["key"],"req_id":card.get("req_id"),"url":card.get("url"),
                    "provenance":card.get("provenance"),"locations":[l.get("text") for l in card.get("locations") or []][:3]})
        groups[employer]=list(merged.values())
    shown=lambda c:history.get(c["key"],[0,""])
    for values in groups.values():
        values.sort(key=lambda c:(shown(c)[0],c["signal_strength"]!="strong",not bool(re.search(PREFERRED,c['title'],re.I)),c['key']))
    order=sorted(groups,key=lambda e:(max((shown(c)[1] for c in groups[e]),default=""),e))
    selected=[]
    for i in range(cap):
        for employer in order:
            if i<len(groups[employer]) and len(selected)<limit: selected.append(groups[employer][i])
    return selected

CACHED=("key","req_id","title","employer","employer_name","url","apply_url","locations","published","valid_through","observed_at",
        "salary","stage","source_id","provenance")
def slim(r):
    """What a cached record needs to stay a card: identity, wording, evidence pointers; no descriptions or raw lists."""
    out={k:r[k] for k in CACHED if r.get(k) is not None}
    d=r.get("discovery") or {}; out["discovery"]={k:d[k] for k in ("method","channel","query","url") if k in d}  # attribution re-added on reuse
    if r.get("extraction"): out["extraction"]={"method":r["extraction"].get("method"),"uncertainty":r["extraction"].get("uncertainty",[])}
    if r.get("official_evidence"): out["official_evidence"]=r["official_evidence"]
    return out

def remember_shown(history,cards,now,observed):
    for c in cards:
        n,_=history.get(c["key"],[0,""]); history[c["key"]]=[n+1,now.isoformat()]
    for k in [k for k in history if k not in observed]: del history[k]  # bounded: only identities still observed
    return history

def validate_config(config):
    if set(config)-{'schema','notice','targets','directories','reviewed_feeds','role_queries','career_feeds'} or config.get('schema')!='market-sources-1':
        raise ValueError('invalid public market source configuration')
    discover.validate_targets(config['targets'])
    for d in config.get('directories',[]):
        if not {'url','link_pattern'}<=set(d)<={'url','link_pattern','profile_pattern','profile_exclude'} or not d['url'].startswith('https://'):
            raise ValueError('invalid directory')
        for k in ('link_pattern','profile_pattern','profile_exclude'):
            if k in d: re.compile(d[k])
    for source in config.get('reviewed_feeds',[]):
        if set(source)!={'employer','provider','board','ownership_evidence'}: raise ValueError('invalid reviewed feed')
        if source['provider'] not in registry.FEEDS or not registry.BOARD.fullmatch(source['board']): raise ValueError('invalid feed')
        if not source['ownership_evidence'].get('url','').startswith('https://'): raise ValueError('ownership evidence required')
    ids=set()
    for q in config.get('role_queries',[]):
        if set(q)-{'id','channel','query','country','families'} or q.get('channel')!='himalayas' or not registry.ID.match(q.get('id','')):
            raise ValueError('invalid role query')
        if q['id'] in ids or not 2<=len(q.get('query',''))<=80 or set(q.get('families',[]))-set(signals.FAMILIES): raise ValueError('invalid role query')
        ids.add(q['id'])
    for f in config.get('career_feeds',[]):
        if set(f)-{'employer','kind','url','id_pattern','detail_pattern','ownership_evidence'} or f.get('kind') not in ('rss','jsonld_page'):
            raise ValueError('invalid career feed')
        if not registry.ID.match(f.get('employer','')) or not f.get('url','').startswith('https://'): raise ValueError('invalid career feed')
        ev=f.get('ownership_evidence') or {}
        if not ev.get('url','').startswith('https://') or not ev.get('checked_at'): raise ValueError('career feed needs ownership evidence')
        for k in ('id_pattern','detail_pattern'):
            if k in f: re.compile(f[k])

def profile_links(html,url,pattern):
    """Same-host directory profile pages (directory -> employer profile)."""
    host=urlparse(url).hostname; out=[]
    for href in re.findall(r'href="([^"#]+)"',html[:2000000]):
        u=urljoin(url,html_unescape(href)); pu=urlparse(u)
        if pu.scheme=="https" and pu.hostname==host and not pu.query and re.search(pattern,pu.path) and u not in out: out.append(u)
        if len(out)>=500: break
    return out

SOCIAL=r"(?:^|\.)(?:linkedin|facebook|twitter|x|instagram|youtube|google|gstatic|googleapis|cloudflare|jsdelivr|jquery|cal|calendly|typeform|hubspot|wa|t|github|gitlab|medium|notion|substack|linktr|bit|apple|microsoft|wordpress|wix|tiktok|upwork|fiverr|loom|vimeo)\.(?:com|me|co|io|ee|ly|site)$"
def profile_website(html,profile_url,exclude=None):
    """The employer website a directory profile links to: the most-linked external https host, excluding the
    directory, CDNs and social/booking hosts. Returns (url or None, candidates) so the choice stays auditable."""
    own=urlparse(profile_url).hostname; counts=collections.Counter()
    for href in re.findall(r'href="(https://[^"]+)"',html[:2000000]):
        h=(urlparse(html_unescape(href)).hostname or "").lower()
        if not h or h==own or h.endswith("."+".".join(own.split(".")[-2:])) or re.search(SOCIAL,h) or (exclude and re.search(exclude,h)): continue
        if re.search(r'\.(?:png|jpe?g|gif|svg|css|js|woff2?)$',urlparse(href).path,re.I): continue
        counts[h]+=1
    cands=counts.most_common(3)
    if not cands: return None,[]
    host=re.sub(r"^(?:book|booking|app|calendar|go|get|try|my|portal|links|meet)\.(?=[^.]+\.[^.]+)","",cands[0][0])  # a booking/app subdomain names the same site
    return "https://%s/"%host,[{"host":h,"links":n} for h,n in cands]

def html_unescape(v):
    import html as _h
    return _h.unescape(v)

LEAD_RECHECK=timedelta(days=7)
def lead_id(host):
    return ("lead-"+re.sub(r"[^a-z0-9]+","-",host.lower()))[:63].strip("-")
def leads_to_validate(leads,now,limit=2):
    """Never-validated leads first (oldest seen first), then the stalest validation past its recheck time."""
    due=[l for l in leads if not l.get("validation") or datetime.fromisoformat(l["validation"]["retry_after"])<=now]
    # Profile-derived websites (an agency/partner directory's own record of the employer) before bare directory links.
    return sorted(due,key=lambda l:(bool(l.get("validation")),l.get("discovered_via")!="directory_profile",
                                    (l.get("validation") or {}).get("checked_at",""),l.get("first_seen_at") or "",l["host"]))[:limit]
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

FAILED=("failed","blocked_or_failed")
def _cooldown(now,status,prev=None,**extra):
    """24 h after success; after consecutive failures 1, 2, 4 ... up to 14 days, so dead channels stop costing requests."""
    fails=((prev or {}).get("consecutive_failures",0)+1) if status in FAILED else 0
    days=min(14,2**(fails-1)) if fails else 1
    return {"checked_at":now.isoformat(),"retry_after":(now+timedelta(days=days)).isoformat(),"status":status,
            "consecutive_failures":fails,**extra}

def _due(state,key,now):
    prev=state.get(key,{})
    return not (prev.get("retry_after") and datetime.fromisoformat(prev["retry_after"])>now)

class Meter:
    """Requests and seconds per discovery method (the run's cost)."""
    def __init__(self,net): self.net=net; self.cost={}
    def __call__(self,name):
        meter=self
        class Phase:
            def __enter__(s): s.r=meter.net.requests; s.t=time.monotonic()
            def __exit__(s,*exc):
                c=meter.cost.setdefault(name,{"requests":0,"seconds":0.0})
                c["requests"]+=meter.net.requests-s.r; c["seconds"]=round(c["seconds"]+time.monotonic()-s.t,2)
        return Phase()

def run(config,sources,employers,out,network=None,now=None):
    validate_config(config)
    now=now or datetime.now(timezone.utc)
    net=network or Network(); out=Path(out); meter=Meter(net); started=time.monotonic()
    old=json.loads((out/"state.json").read_text()) if (out/"state.json").exists() else {}
    state=dict(old); errors=[]; captures=[]; jobs=[]; provisional=[]; feeds={}; deferred=[]
    shown_history=state.pop("_shown",{}); seen_before=state.pop("_seen",{}); cache=state.pop("_cache",{})
    def cached(key,why):
        """Last records of a channel not requested this run: still observed evidence, labelled with when it was checked."""
        out=[]
        for r in cache.get(key,[]):
            r={**r,"freshness":why,"checked_at":(state.get(key) or {}).get("checked_at")}
            if r.get("discovery",{}).get("channel")=="himalayas": r["discovery"]={**r["discovery"],"attribution":role_search.ATTRIBUTION}
            out.append(r)
        return out
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
            jobs.append({**job,"employer":bysource[sid]["employer"],"source_id":sid,"discovery":{"method":"configured_feed"},
                         "provenance":str(path.relative_to(out.parent)),"freshness":fresh,"source_status":h.get("status","not_reported"),
                         "source_checked_at":h.get("checked_at"),"source_last_success_at":h.get("last_success_at")})
    # Provisional employer links: one per host, first/last seen kept. A link is never a source or an ownership claim.
    leads={}
    for lead in prior_report.get('employer_leads',[]):
        host=urlparse(lead['url']).hostname
        if host: leads.setdefault(host,{**lead,"host":host,"first_seen_at":lead.get("first_seen_at") or prior_report.get("generated_at")})
    def halted(key,what):
        deferred.append({"source":key,"reason":"not_attempted: "+(net.halted or what)})
    def add_lead(url,**extra):
        host=urlparse(url).hostname
        if not host: return
        leads[host]={**leads.get(host,{"first_seen_at":now.isoformat()}),"url":url,"stage":"provisional_employer_link",
                     "ownership":"unverified","collection_enabled":False,**extra,"host":host,"last_seen_at":now.isoformat()}

    # 1. Directories (stalest three), with bounded directory -> profile -> employer website traversal.
    dirs=sorted(config.get("directories",[]),key=lambda d:state.get("directory:"+d["url"],{}).get("checked_at",""))
    with meter("directories"):
        for directory in dirs:
            key="directory:"+directory["url"]; prev=state.get(key,{})
            if not _due(state,key,now):
                deferred.append({"source":key,"reason":"cooldown","retry_after":prev["retry_after"]}); continue
            if sum(1 for k in state if k.startswith("directory:") and state[k].get("checked_at")==now.isoformat())>=3:
                deferred.append({"source":key,"reason":"rotation_limit"}); continue
            if net.halted: halted(key,"run halted"); continue
            try:
                page=net.page(directory['url'])
                found=directory_leads(page,directory['url'],directory['link_pattern'])
                offset=prev.get('offset',0)%max(1,len(found))
                for lead in (found[offset:]+found[:offset])[:25]:
                    add_lead(lead["url"],discovered_from=directory["url"],discovered_via="directory_link")
                extra={"offset":offset+25,"links_found":len(found)}
                if directory.get("profile_pattern"):
                    profiles=profile_links(page,directory["url"],directory["profile_pattern"])
                    po=prev.get("profile_offset",0)%max(1,len(profiles))
                    visited=0
                    for purl in (profiles[po:]+profiles[:po])[:3]:
                        try:
                            site,cands=profile_website(net.page(purl),purl,directory.get("profile_exclude"))
                            visited+=1
                            if site: add_lead(site,discovered_from=directory["url"],discovered_via="directory_profile",
                                              profile_url=purl,website_candidates=cands)
                        except discover.Halt: halted("profile:"+purl,"run halted"); break
                        except Exception as e: visited+=1; errors.append({"source":"profile:"+purl,"error":str(e)[:200]})
                    extra.update(profile_offset=po+visited,profiles_found=len(profiles))
                state[key]=_cooldown(now,"ok",prev,**extra)
            except discover.Halt:
                halted(key,"run halted")  # budget/429: never cool down or mark failed what was not attempted
            except Exception as e:
                errors.append({"source":key,"error":str(e)[:200]})
                state[key]=_cooldown(now,"failed",prev)
    configured={(s['provider'],s['board'].lower()) for s in sources if s.get('enabled',True)}
    with meter("reviewed_feeds"):
        for approved in config.get('reviewed_feeds',[])[:2]:
            if (approved['provider'],approved['board'].lower()) in configured: continue
            key='feed:'+approved['employer']; prev=state.get(key,{})
            if not _due(state,key,now):
                deferred.append({"source":key,"reason":"cooldown","retry_after":prev["retry_after"]}); continue
            if net.halted: halted(key,"run halted"); continue
            try:
                source={**approved,'url':registry.feed_url(approved['provider'],approved['board'])}
                data=net.feed(source); rawjobs=extract_jobs(source['provider'],data)
                count=0
                for raw in rawjobs:
                    rec=normalize(source['provider'],source['board'],raw)
                    if not rec['req_id'] or not rec['title'] or not rec['url']: continue
                    jobs.append({**rec,'employer':approved['employer'],'source_id':None,"discovery":{"method":"reviewed_feed"},
                        'provenance':approved['ownership_evidence'],'observed_at':now.isoformat(),'freshness':'fresh_feed'})
                    count+=1
                captures.append({'employer':approved['employer'],'provider':approved['provider'],
                    'board':approved['board'],'exact_vacancies':count,'status':'validated_feed'})
                state[key]=_cooldown(now,'ok',prev)
            except discover.Halt:
                halted(key,"run halted")
            except Exception as e:
                errors.append({'source':key,'error':str(e)[:200]})
                state[key]=_cooldown(now,'failed',prev)

    # 2. Role-and-location search beyond configured employers (permitted public API; provisional listings).
    names={re.sub(r"[^a-z0-9]+"," ",e["name"].lower()).strip():e["id"] for e in employers.get("employers",[]) if e.get("name")}
    official=[j for j in jobs if j.get("source_id")]
    queries=[q for q in config.get("role_queries",[]) if _due(state,"query:"+q["id"],now)]
    deferred+=[{"source":"query:"+q["id"],"reason":"cooldown","retry_after":state["query:"+q["id"]]["retry_after"]}
               for q in config.get("role_queries",[]) if q not in queries]
    stale=sorted(queries,key=lambda q:(state.get("query:"+q["id"],{}).get("checked_at",""),q["id"]))
    rest=sorted(stale[2:],key=lambda q:(-state.get("query:"+q["id"],{}).get("strong_rate",0),q["id"]))
    picked_q=stale[:2]+rest[:1]  # two stalest explore; one with the best public strong-signal rate exploits
    deferred+=[{"source":"query:"+q["id"],"reason":"rotation_limit"} for q in queries if q not in picked_q]
    for q in config.get("role_queries",[]):
        if q not in picked_q: provisional+=cached("query:"+q["id"],"cached_from_last_check")
    with meter("role_search"):
        for q in picked_q:
            key="query:"+q["id"]; prev=state.get(key,{})
            if net.halted: halted(key,"run halted"); continue
            url=role_search.search_url(q["query"],q.get("country"))
            try:
                u=net._allowed(url)
                status,_,body=net.get(url,{u.hostname},{**discover.LIMITS,"max_bytes":3000000})
                discover._check_access(status,body)
                if status>=400: raise ValueError("HTTP %s"%status)
                found=role_search.listings(json.loads(body),q["query"],q.get("country"),now.isoformat())
                for l in found:
                    l["official_evidence"]=role_search.resolve(l,names,official)
                    l["discovery"]["families_sought"]=q.get("families",[])
                provisional+=found; cache[key]=[slim(r) for r in found]
                strong=sum(signals.title_signal(l["title"])["strength"]=="strong" for l in found)
                india=sum(signals.geography(l["locations"])["class"]=="india_explicit" for l in found)
                state[key]=_cooldown(now,"ok",prev,results=len(found),strong=strong,india_explicit=india,
                                     strong_rate=round(strong/len(found),3) if found else 0.0)
            except discover.Halt: halted(key,"run halted"); provisional+=cached(key,"cached_from_last_check")
            except Exception as e:
                errors.append({"source":key,"error":str(e)[:200]}); state[key]=_cooldown(now,"failed",prev)
                provisional+=cached(key,"cached_after_failure")

    # 3. Official career pages/feeds of ownership-reviewed employers (JSON-LD or career RSS), detail pages deduped first.
    detail_cache=state.pop("_detail_cache",{}); new_cache={}
    career=[f for f in config.get("career_feeds",[]) if _due(state,"career:"+f["employer"]+":"+f["url"],now)]
    career.sort(key=lambda f:(state.get("career:"+f["employer"]+":"+f["url"],{}).get("checked_at",""),f["employer"]))
    deferred+=[{"source":"career:"+f["employer"],"reason":"cooldown"} for f in config.get("career_feeds",[]) if f not in career]
    deferred+=[{"source":"career:"+f["employer"],"reason":"rotation_limit"} for f in career[2:]]
    def keep(records):
        for r in records: (jobs if r["stage"]=="exact_vacancy_unreviewed" else provisional).append(r)
    for f in config.get("career_feeds",[]):
        if f not in career[:2]: keep(cached("career:"+f["employer"]+":"+f["url"],"cached_from_last_check"))
    with meter("career_pages"):
        for f in career[:2]:
            key="career:"+f["employer"]+":"+f["url"]; prev=state.get(key,{})
            if net.halted: halted(key,"run halted"); continue
            try:
                body=net.page(f["url"])
                if f["kind"]=="rss": recs=career_pages.rss_items(body,f["url"],f["employer"],True,f.get("id_pattern"))
                else:
                    recs=career_pages.jsonld_postings(body,f["url"],f["employer"],True,f.get("id_pattern"))
                    listed=profile_links(body,f["url"],f["detail_pattern"]) if f.get("detail_pattern") else []
                    fetched=0
                    for durl in listed:
                        if durl in detail_cache:  # already extracted and still listed: reuse, no request
                            recs+=detail_cache[durl]; new_cache[durl]=detail_cache[durl]; continue
                        if fetched>=3: continue  # at most three new detail pages per feed per run
                        try:
                            fetched+=1
                            got=career_pages.jsonld_postings(net.page(durl),durl,f["employer"],True,f.get("id_pattern"))
                            recs+=got; new_cache[durl]=got
                        except discover.Halt: halted("detail:"+durl,"run halted"); break
                        except Exception as e: errors.append({"source":"detail:"+durl,"error":str(e)[:200]})
                for r in recs:
                    r.update(observed_at=now.isoformat(),freshness="fresh_feed",source_id=None,
                             provenance={"career_feed":f["url"],"ownership_evidence":f["ownership_evidence"]["url"]},
                             discovery={"method":"career_"+f["kind"],"url":f["url"]})
                keep(recs); cache[key]=[slim(r) for r in recs]
                state[key]=_cooldown(now,"ok",prev,records=len(recs),exact=sum(r["stage"]=="exact_vacancy_unreviewed" for r in recs))
            except discover.Halt: halted(key,"run halted"); keep(cached(key,"cached_from_last_check"))
            except Exception as e:
                errors.append({"source":key,"error":str(e)[:200]}); state[key]=_cooldown(now,"failed",prev)
                keep(cached(key,"cached_after_failure"))

    # 4. Allowlisted employer seeds, then 5. provisional lead validation, through the reused scanner. Pages read are
    # also searched for JobPosting JSON-LD; those records stay provisional (ownership not reviewed).
    pages={}
    def capture(url,allowed,limits):
        result=net.get(url,allowed,limits)
        if result[0]==200 and "JobPosting" in result[2] and len(pages)<20: pages[result[1]]=result[2]
        return result
    targets,later=due_targets(config,state,now)
    deferred+=[{"source":"target:"+d.pop("employer"),**d} for d in later]
    def feed(source):
        data=net.feed(source)
        feeds[(source["provider"],source["board"].lower())]=data
        return data
    with meter("employer_targets"):
        report=discover.discover(targets,sources,employers,get=capture,feed=feed,
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
                except (ValueError,KeyError,TypeError,AttributeError): continue
                if not rec["req_id"] or not rec["title"] or not rec["url"]: continue
                jobs.append({**rec,"employer":target["employer"],"source_id":None,"discovery":{"method":"employer_target_board"},
                    "provenance":board["evidence"],"observed_at":now.isoformat(),"freshness":"fresh_feed"})
                plausible+=bool(families(rec["title"]))
        state[target["employer"]]=_cooldown(now,"blocked_or_failed" if target["stopped"] or not any(p.get("result")=="read" for p in target["pages"]) else "read",
                                            state.get(target["employer"]),plausible=plausible)
    lead_report=None
    picked=[] if net.halted else leads_to_validate(list(leads.values()),now)
    if picked:
        lead_targets=[{"employer":lead_id(l["host"]),"start_url":l["url"]} for l in picked]
        with meter("lead_validation"):
            lead_report=discover.discover(lead_targets,sources,employers,get=capture,feed=net.feed,
                limits={"max_pages":2,"max_requests":40,"sitemaps":False},pause=lambda _:None,now=now.isoformat())
        for lead,target in zip(picked,lead_report["targets"]):
            if not target["pages"] and (lead_report.get("halted") or net.halted):
                halted("lead:"+lead["host"],"run halted"); continue
            lead["validation"]={"checked_at":now.isoformat(),"retry_after":(now+LEAD_RECHECK).isoformat(),**validation_result(target)}
    seed={t["start_url"]:t["employer"] for t in targets}|{l["url"]:lead_id(l["host"]) for l in picked}
    for url,page in pages.items():
        owner=next((e for s_,e in seed.items() if urlparse(s_).hostname==urlparse(url).hostname),"unknown")
        for r in career_pages.jsonld_postings(page,url,owner,False):
            r.update(observed_at=now.isoformat(),freshness="fresh_page",source_id=None,provenance={"page":url},
                     discovery={"method":"scanned_page_jsonld"})
            provisional.append(r)
    leads=sorted(leads.values(),key=lambda l:(l.get("last_seen_at") or "",l["host"]))[-500:]

    # 6. Compact, diverse outputs and public source-quality measurements.
    batch=diverse(jobs,history=shown_history)
    pbatch=diverse(provisional,cap=2,limit=40,history=shown_history)
    observed={j["key"] for j in jobs}|{p["key"] for p in provisional}
    new_keys={k for k in observed if k not in seen_before}
    seen_now={k:seen_before.get(k,now.isoformat()[:13]) for k in observed}  # hour precision keeps state small
    remember_shown(shown_history,batch+pbatch,now,observed)
    identities=lambda rows,pred=lambda j:True:len({(j["employer"],j.get("req_id") or j["key"]) for j in rows if pred(j)})
    by_employer=collections.Counter(j["employer"] for j in batch)
    def tally(rows):
        sig=collections.Counter(); geo=collections.Counter(); strength=collections.Counter(); method=collections.Counter()
        for j in rows:
            t=signals.title_signal(j["title"]); strength[t["strength"]]+=1; geo[signals.geography(j.get("locations"))["class"]]+=1
            method[(j.get("discovery") or {}).get("method","configured_feed")]+=1
            for f in t["families"]:
                if t["strength"]=="strong": sig[f]+=1
        return {"strong_by_family":dict(sig),"signal_strength":dict(strength),"geography":dict(geo),"by_method":dict(method)}
    uncertainty=collections.Counter(u for r in jobs+provisional for u in (r.get("extraction") or {}).get("uncertainty",[]))
    lead_results=collections.Counter((l.get("validation") or {}).get("result","not_validated") for l in leads)
    result={"schema":"market-discovery-1","notice":NOTICE,"generated_at":now.isoformat(),
        "requests":net.requests,"halted":net.halted,"employer_leads":leads,"source_proposals":report,"lead_validation":lead_report,
        "errors":errors,"deferred":deferred,"validated_feeds":captures,"vacancies":batch,"provisional_cards":pbatch,
        "metrics":{"exact_identities":identities(jobs),
            "plausible_title_identities":identities(jobs,lambda j:families(j["title"])),
            "fresh_feed_identities":identities(jobs,lambda j:j["freshness"] in ("fresh_feed","last_observed")),
            "stale_or_unreported_identities":identities(jobs,lambda j:j["freshness"] not in ("fresh_feed","last_observed")),
            "cached_identities":identities(jobs+provisional,lambda j:str(j.get("freshness","")).startswith("cached")),
            "provisional_identities":identities(provisional),
            "new_identities_since_last_run":len(new_keys),"repeated_identities":len(observed-new_keys),
            "review_batch":len(batch),"review_employers":len(by_employer),
            "largest_employer_share":round(max(by_employer.values())/len(batch),3) if batch else None,
            "provisional_batch":len(pbatch),"provisional_employers":len({c["employer"] for c in pbatch}),
            "cards_never_shown_before":sum(shown_history.get(c["key"],[0])[0]==1 for c in batch+pbatch),
            "new_source_exact_identities":identities(jobs,lambda j:j.get("source_id") is None),
            "exact":tally(jobs),"provisional":tally(provisional),
            "extraction_uncertainty":dict(uncertainty),
            "sources":{"enabled_configured":len(sources),"ownership_reviewed_career_feeds":len(config.get("career_feeds",[])),
                       "provisional_employer_links":len(leads),"leads_with_supported_board":lead_results.get("supported_board_found",0),
                       "scanner_verified_feed_proposals":sum(b.get("status")=="verified_feed" for t in report["targets"] for b in t["boards"]),
                       "links_by_route":dict(collections.Counter(l.get("discovered_via","directory_link") for l in leads))},
            "provisional_employer_links":len(leads),
            "leads_validated_this_run":sum((l.get("validation") or {}).get("checked_at")==now.isoformat() for l in leads),
            "lead_validation_results":dict(lead_results),
            "role_queries":{k[6:]:{x:v.get(x) for x in ("status","results","strong","india_explicit","strong_rate","consecutive_failures")}
                            for k,v in state.items() if k.startswith("query:")},
            "cost":{"requests":net.requests,"seconds":round(time.monotonic()-started,2),"by_method":meter.cost},
            "basis":"public title keywords, location wording and source health only; no candidate relevance feedback is integrated"}}
    live={"query:"+q["id"] for q in config.get("role_queries",[])}|{"career:"+f["employer"]+":"+f["url"] for f in config.get("career_feeds",[])}
    state["_shown"]=shown_history; state["_seen"]=seen_now; state["_cache"]={k:v[:200] for k,v in cache.items() if k in live}
    # Cache entries of feeds not visited this run are kept; visited feeds keep only still-listed detail pages.
    visited={f["url"] for f in career[:2]}
    state["_detail_cache"]={**{u:v for u,v in detail_cache.items() if not any(u.startswith(urlparse(x).scheme+"://"+urlparse(x).netloc) for x in visited)},**new_cache}
    write(out/"report.json",result); write(out/"state.json",state,compact=True)
    return result

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config",default="market_sources.json"); ap.add_argument("--out",default="public/discovery")
    args=ap.parse_args(); _,sources,_=registry.load()
    employers=json.loads(Path("employers.json").read_text())
    result=run(json.loads(Path(args.config).read_text()),sources,employers,args.out)
    print(json.dumps({"requests":result["requests"],"metrics":result["metrics"],"errors":result["errors"]},indent=2))
if __name__=="__main__": main()
