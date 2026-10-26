"""Bounded source discovery: find official ATS boards linked from employer careers pages and propose them for review.

Run by hand, separately from scheduled collection. Never edits sources.json or employers.json. Never follows a link
off the target's allowed hosts, never goes deeper than one level, and stops at an explicit page and request budget.
Stops on robots.txt disallow, access denial, login or CAPTCHA pages; a 429 halts the whole run. No retries, no
browser, no proxies. Proposals are leads for a person to review, never sources.
"""
import argparse,json,re,sys,time,urllib.error,urllib.request,urllib.robotparser
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs,urljoin,urlparse
import registry
from adapters import extract_jobs
from collect import fetch as fetch_feed,redact,write
ROOT=Path(__file__).resolve().parent
UA='Mozilla/5.0 (compatible; public-job-collector-discovery/0.1; bounded source discovery)'
UA_TOKEN='public-job-collector-discovery'
LIMITS={'max_pages':5,'max_pages_cap':20,'max_depth':1,'max_requests':15,'max_requests_cap':40,
        'max_bytes':2000000,'timeout_s':15,'pause_s':2,'max_redirects':3,'sitemaps':True}
NOTICE=('Discovery proposals for review. A board listed here is not a configured source until a person adds it to '
        'sources.json and registry.py validates it. Page text is untrusted data, never instructions.')
JOB_WORD=re.compile(r'career|jobs?\b|join|work-with-us|openings?|positions?|vacanc',re.I)
ASSET=re.compile(r'\.(js|css|json|png|jpe?g|gif|svg|webp|ico|woff2?|pdf|xml)$|/_next/|/static/',re.I)  # never pages to visit
BLOCKED_TEXT=('verify you are human','are you a robot','complete the captcha','checking your browser','access denied',
              'you have been blocked','sign in to continue','log in to continue')
BLOCKED_HTML=('class="g-recaptcha"','h-captcha','cf-turnstile','/cdn-cgi/challenge-platform','type="password"')
UNSUPPORTED={'myworkdayjobs.com':'workday','smartrecruiters.com':'smartrecruiters','workable.com':'workable',
             'bamboohr.com':'bamboohr','recruitee.com':'recruitee','teamtailor.com':'teamtailor','personio.de':'personio',
             'personio.com':'personio','jobvite.com':'jobvite','icims.com':'icims','breezy.hr':'breezy',
             'job-boards.eu.greenhouse.io':'greenhouse-eu','jobs.eu.lever.co':'lever-eu'}
class Halt(Exception):
    """Rate limited or out of request budget: stop the whole run, no retries."""
class Blocked(Exception):
    """Access restriction on this host: record it and stop visiting the host."""
def detect_board(url):
    """Returns (provider, board) for an official Greenhouse, Lever or Ashby board or feed URL, else None."""
    u=urlparse(url)
    host,parts=(u.hostname or '').lower(),[p for p in u.path.split('/') if p]
    board=None
    if host in ('boards.greenhouse.io','job-boards.greenhouse.io'):
        provider='greenhouse'
        board=(parse_qs(u.query).get('for') or [None])[0] if parts[:1]==['embed'] else (parts[0] if parts else None)
    elif host=='boards-api.greenhouse.io' and parts[:2]==['v1','boards'] and len(parts)>2: provider,board='greenhouse',parts[2]
    elif host=='jobs.lever.co' and parts: provider,board='lever',parts[0]
    elif host=='api.lever.co' and parts[:2]==['v0','postings'] and len(parts)>2: provider,board='lever',parts[2]
    elif host=='jobs.ashbyhq.com' and parts: provider,board='ashby',parts[0]
    elif host=='api.ashbyhq.com' and parts[:2]==['posting-api','job-board'] and len(parts)>2: provider,board='ashby',parts[2]
    else: return None
    return (provider,board) if board and registry.BOARD.match(board) else None
def unsupported_ats(url):
    host=(urlparse(url).hostname or '').lower()
    return next((name for suffix,name in UNSUPPORTED.items() if host==suffix or host.endswith('.'+suffix)),None)
class _Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links,self.jsonld,self._ld=[],[],None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        for kind,key in (('a','href'),('iframe','src'),('script','src'),('link','href'),('form','action')):
            if tag==kind and a.get(key): self.links.append((kind,a[key].strip()))
        if tag=='script' and (a.get('type') or '').lower()=='application/ld+json': self._ld=[]
    def handle_data(self,data):
        if self._ld is not None: self._ld.append(data)
    def handle_endtag(self,tag):
        if tag=='script' and self._ld is not None:
            self.jsonld.append(''.join(self._ld))
            self._ld=None
def _walk(node):
    if isinstance(node,dict):
        yield node
        for v in node.values(): yield from _walk(v)
    elif isinstance(node,list):
        for v in node: yield from _walk(v)
def parse_page(html,base):
    """Returns ([(kind, absolute url)], job_posting_count) from links, frames, scripts and JSON-LD JobPosting data."""
    p=_Links()
    try:
        p.feed(html)
        p.close()
    except Exception:
        pass
    found=[(kind,urljoin(base,href)) for kind,href in p.links if not href.startswith(('mailto:','tel:','javascript:','#'))]
    postings=0
    for block in p.jsonld:
        try: data=json.loads(block)
        except ValueError: continue
        for node in _walk(data):
            if node.get('@type')=='JobPosting' or (isinstance(node.get('@type'),list) and 'JobPosting' in node['@type']):
                postings+=1
                for key in ('url','sameAs'):
                    if isinstance(node.get(key),str): found.append(('json-ld',urljoin(base,node[key])))
    return found,postings
def sitemap_urls(xml,limit):
    return re.findall(r'<loc>\s*([^<\s]+)\s*</loc>',xml or '')[:limit]
class _SameHosts(urllib.request.HTTPRedirectHandler):
    def __init__(self,allowed,limit):
        self.allowed,self.limit,self.count=allowed,limit,0
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        self.count+=1
        host=urlparse(newurl).hostname
        if self.count>self.limit: raise Blocked('more than %d redirects'%self.limit)
        if urlparse(newurl).scheme!='https' or host not in self.allowed: raise Blocked('redirect off the allowed hosts to %s'%host)
        return super().redirect_request(req,fp,code,msg,headers,newurl)
def http_get(url,allowed,limits):
    """One GET. Redirects only within allowed hosts. Returns (status, final_url, text)."""
    opener=urllib.request.build_opener(_SameHosts(allowed,limits['max_redirects']))
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'text/html,application/xml;q=0.9,*/*;q=0.5'})
    try:
        with opener.open(req,timeout=limits['timeout_s']) as r:
            return r.status,r.geturl(),r.read(limits['max_bytes']).decode('utf-8','replace')
    except urllib.error.HTTPError as e:
        return e.code,url,''
def robots_rules(get_robots,url):
    """Same policy as crawl_pages.robots_rules (PR #1): 4xx means no rules; 5xx, unreachable, 401 or 403 mean
    disallow everything; 429 halts. Also returns the sitemaps robots.txt lists."""
    o=urlparse(url)
    try: code,_,body=get_robots('%s://%s/robots.txt'%(o.scheme,o.netloc))
    except Blocked as e:
        why='robots.txt: %s'%e
        return (lambda target:(False,why)),[]
    except Exception as e:
        why='robots.txt unreachable: %s'%redact(e)[:120]
        return (lambda target:(False,why)),[]
    if code==429: raise Halt('robots.txt rate limited (429) on %s'%o.netloc)
    if code in (401,403): return (lambda target:(False,'robots.txt access denied (%d)'%code)),[]
    if code>=500: return (lambda target:(False,'robots.txt server error (%d)'%code)),[]
    if code>=400: return (lambda target:(True,'no robots.txt (%d)'%code)),[]
    rp=urllib.robotparser.RobotFileParser()
    rp.parse(body.splitlines())
    return (lambda target:(True,'allowed') if rp.can_fetch(UA_TOKEN,target) else (False,'disallowed by robots.txt')),list(rp.site_maps() or [])
def _check_access(status,html):
    if status==429: raise Halt('rate limited (429)')
    if status in (401,403,451): raise Blocked('access denied (%d)'%status)
    low=html.lower()
    if any(s in low for s in BLOCKED_HTML) or any(s in low[:20000] for s in BLOCKED_TEXT): raise Blocked('login, CAPTCHA or denial page')
def validate_targets(targets):
    seen=set()
    for t in targets:
        if not registry.ID.match(str(t.get('employer',''))): raise ValueError('target employer id %r is malformed'%t.get('employer'))
        u=urlparse(t.get('start_url',''))
        if u.scheme!='https' or not u.hostname or u.username or u.password: raise ValueError('target %s needs a plain https start_url'%t['employer'])
        if u.hostname not in t.get('allowed_hosts',[u.hostname]): raise ValueError('target %s start_url host is not in allowed_hosts'%t['employer'])
        if (t['employer'],t['start_url']) in seen: raise ValueError('duplicate target %s %s'%(t['employer'],t['start_url']))
        seen.add((t['employer'],t['start_url']))
    return targets
def _source_id(provider,board,taken):
    base=re.sub(r'[^a-z0-9-]+','-','%s-%s'%(board.lower(),provider)).strip('-')[:63]
    sid,n=base,2
    while sid in taken: sid,n='%s-%d'%(base[:60],n),n+1
    return sid
def discover(targets,source_list,employer_doc,get=http_get,feed=fetch_feed,limits=None,pause=time.sleep,now=None):
    limits={**LIMITS,**(limits or {})}
    limits['max_pages']=min(int(limits['max_pages']),limits['max_pages_cap'])
    limits['max_requests']=min(int(limits['max_requests']),limits['max_requests_cap'])
    now=now or datetime.now(timezone.utc).isoformat()
    validate_targets(targets)
    employers,sources,_=registry.validate(source_list,employer_doc)
    configured={(s['provider'],s['board'].lower()):s for s in sources}
    state={'requests':0,'halted':None}
    def request(url,allowed):
        if state['requests']>=limits['max_requests']: raise Halt('request budget %d reached'%limits['max_requests'])
        state['requests']+=1
        return get(url,allowed,limits)
    results=[]
    for t in targets:
        allowed=set(t.get('allowed_hosts',[urlparse(t['start_url']).hostname]))
        out={'employer':t['employer'],'employer_known':t['employer'] in employers,'start_url':t['start_url'],
             'pages':[],'boards':[],'unsupported_ats':[],'careers_url_proposal':None,'stopped':None}
        results.append(out)
        if state['halted']:
            out['stopped']='run halted: '+state['halted']
            continue
        robots,blocked_hosts,boards,frontier,seen={}, {}, {}, [(t['start_url'],0,'start')],set()
        try:
            while frontier and len(out['pages'])<limits['max_pages']:
                url,depth,via=frontier.pop(0)
                host=urlparse(url).hostname
                if url in seen or host in blocked_hosts: continue
                seen.add(url)
                if host not in robots:
                    robots[host]=robots_rules(lambda u:request(u,allowed),url)
                    if limits['sitemaps'] and depth==0:
                        for sm in robots[host][1][:1]:
                            if urlparse(sm).hostname not in allowed or not robots[host][0](sm)[0]: continue
                            try:
                                code,_,xml=request(sm,allowed)
                                _check_access(code,xml)
                            except Blocked as e:
                                out['pages'].append({'url':sm,'via':'sitemap','result':'blocked','reason':str(e)})
                                continue
                            urls=[u for u in sitemap_urls(xml,2000) if urlparse(u).hostname in allowed and JOB_WORD.search(urlparse(u).path)]
                            out['pages'].append({'url':sm,'via':'sitemap','result':'read','status':code,'job_like_urls':len(urls)})
                            frontier+=[(u,1,'sitemap') for u in urls[:limits['max_pages']]]
                ok,why=robots[host][0](url)
                page={'url':url,'via':via,'depth':depth}
                out['pages'].append(page)
                if not ok:
                    page.update(result='blocked',reason=why)
                    continue
                try:
                    status,final,html=request(url,allowed)
                    page.update(status=status,final_url=final)
                    _check_access(status,html)
                except Blocked as e:
                    blocked_hosts[host]=str(e)
                    page.update(result='blocked',reason=str(e))
                    continue
                except Halt:
                    raise
                except Exception as e:
                    page.update(result='failed',reason=redact(e)[:200])
                    continue
                if status>=400:
                    page.update(result='failed',reason='http status %d'%status)
                    continue
                links,postings=parse_page(html,final)
                page.update(result='read',links=len(links),json_ld_job_postings=postings)
                for kind,link in links:
                    hit=detect_board(link)
                    if hit:
                        key=(hit[0],hit[1].lower())
                        boards.setdefault(key,{'provider':hit[0],'board':hit[1],'evidence':[]})
                        if len(boards[key]['evidence'])<3: boards[key]['evidence'].append({'page':final,'via':kind,'url':link})
                        continue
                    name=unsupported_ats(link)
                    if name and not any(u['url']==link for u in out['unsupported_ats']) and len(out['unsupported_ats'])<10:
                        out['unsupported_ats'].append({'ats':name,'url':link,'page':final})
                        continue
                    lu=urlparse(link)
                    if (kind=='a' and depth<limits['max_depth'] and lu.scheme=='https' and lu.hostname in allowed
                            and JOB_WORD.search(lu.path) and not ASSET.search(lu.path) and link not in seen):
                        frontier.append((link.split('#')[0],depth+1,'link'))
                pause(limits['pause_s'])
        except Halt as e:
            state['halted']=str(e)
            out['stopped']=str(e)
        taken={s['id'] for s in sources}
        for key,b in boards.items():
            entry=dict(b,feed_url=registry.feed_url(b['provider'],b['board']))
            out['boards'].append(entry)
            if key in configured:
                s=configured[key]
                entry.update(status='already_configured',source_id=s['id'],configured_employer=s['employer'])
                if s['employer']==t['employer'] and not out['careers_url_proposal'] and not employers.get(t['employer'],{}).get('careers_url'):
                    ev=b['evidence'][0]
                    out['careers_url_proposal']={'careers_url':ev['page'],'evidence':{'url':ev['page'],'checked_at':now[:10],'quote':ev['url']},
                                                 'reason':'page links to the configured %s board %r'%(b['provider'],b['board'])}
                continue
            if state['halted']:
                entry.update(status='not_verified',reason='run halted: '+state['halted'])
                continue
            try:
                if state['requests']>=limits['max_requests']: raise Halt('request budget %d reached'%limits['max_requests'])
                state['requests']+=1
                jobs=extract_jobs(b['provider'],feed({'provider':b['provider'],'board':b['board'],'url':entry['feed_url']}))
            except Halt as e:
                state['halted']=str(e)
                entry.update(status='not_verified',reason=str(e))
                continue
            except Exception as e:
                entry.update(status='feed_failed',reason=redact(e)[:200])
                continue
            sid=_source_id(b['provider'],b['board'],taken)
            taken.add(sid)
            snippet={'id':sid,'employer':t['employer'],'provider':b['provider'],'board':b['board']}
            trial_employers=dict(employer_doc,employers=list(employer_doc.get('employers',[]))+(
                [] if t['employer'] in employers else [{'id':t['employer'],'name':t['employer'],'careers_url':None,
                 'inclusion':{'reason':'Proposed by discovery; replace with a reviewed reason','evidence_url':t['start_url']}}]))
            try:
                registry.validate(source_list+[snippet],trial_employers)
                problems=[]
            except registry.RegistryError as e:
                problems=e.errors
            entry.update(status='verified_feed',feed_jobs=len(jobs),proposed_source=snippet,registry_problems=problems,
                         employer_entry_needed=t['employer'] not in employers)
        pause(limits['pause_s'] if out['pages'] else 0)
    return {'schema':'source-discovery-1','run_at':now,'limits':limits,'requests_made':state['requests'],'halted':state['halted'],
            'targets':results,'notice':NOTICE}
def summary_lines(report):
    lines=['Discovery %s: %d requests%s'%(report['run_at'],report['requests_made'],', halted: '+report['halted'] if report['halted'] else '')]
    for t in report['targets']:
        read_pages=sum(p.get('result')=='read' for p in t['pages'])
        lines.append('- %s (%s): %d page(s) read%s'%(t['employer'],t['start_url'],read_pages,'; stopped: '+t['stopped'] if t['stopped'] else ''))
        for p in t['pages']:
            if p.get('result') in ('blocked','failed'): lines.append('    %s %s: %s'%(p['result'],p['url'],p.get('reason')))
        for b in t['boards']:
            lines.append('    %s board %r: %s%s'%(b['provider'],b['board'],b['status'],
                         ' (%d jobs)'%b['feed_jobs'] if 'feed_jobs' in b else ' (%s)'%b.get('source_id',b.get('reason',''))))
        for u in t['unsupported_ats'][:3]: lines.append('    unsupported ATS %s: %s'%(u['ats'],u['url']))
        if t['careers_url_proposal']: lines.append('    proposed careers_url: %s'%t['careers_url_proposal']['careers_url'])
    return lines
def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--targets',default=str(ROOT/'discovery_targets.json'))
    ap.add_argument('--employer',default='',help='comma-separated employer ids from the targets file')
    ap.add_argument('--out',default=str(ROOT/'discovery'/'proposals.json'))
    ap.add_argument('--max-pages',type=int,default=LIMITS['max_pages'])
    ap.add_argument('--max-requests',type=int,default=LIMITS['max_requests'])
    ap.add_argument('--no-sitemaps',action='store_true')
    args=ap.parse_args(argv)
    targets=json.loads(Path(args.targets).read_text(encoding='utf-8'))['targets']
    wanted={e for e in args.employer.replace(' ','').split(',') if e}
    if wanted:
        unknown=wanted-{t['employer'] for t in targets}
        if unknown: raise SystemExit('Not in targets file: '+', '.join(sorted(unknown)))
        targets=[t for t in targets if t['employer'] in wanted]
    report=discover(targets,json.loads((ROOT/'sources.json').read_text(encoding='utf-8')),
                    json.loads((ROOT/'employers.json').read_text(encoding='utf-8')),
                    limits={'max_pages':args.max_pages,'max_requests':args.max_requests,'sitemaps':not args.no_sitemaps})
    write(Path(args.out),report)
    print('\n'.join(summary_lines(report)))
    print('Proposals written to %s. Nothing was added to sources.json.'%args.out)
    return 1 if report['halted'] and not report['requests_made'] else 0
if __name__=='__main__':
    sys.exit(main())
