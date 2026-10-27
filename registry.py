"""Employer and source registry: validate employers.json and sources.json before any request.

sources.json stays a JSON list of source objects (other readers, such as the
posting store, iterate it as a list). Employer facts live in employers.json.

Public employer facts only. Candidate preferences, profiles and application
history never belong here; unknown keys are rejected so they cannot slip in.
"""
import json,re,sys
from pathlib import Path
from urllib.parse import urlparse,parse_qsl
ROOT=Path(__file__).resolve().parent
SCHEMA='employer-registry-1'
DEFAULTS={'enabled':True,'poll_interval_hours':None}  # None: collected on every scheduled run (owner's five daily runs)
ID=re.compile(r'^[a-z0-9][a-z0-9-]{1,62}$')
BOARD=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')
# Official feed per adapter. The URL must be exactly this endpoint plus only the listed query options.
FEEDS={
    'greenhouse':('boards-api.greenhouse.io','/v1/boards/{board}/jobs',{'content':{'true'},'pay_transparency':{'true'}}),
    'lever':('api.lever.co','/v0/postings/{board}',{'mode':{'json'}}),
    'ashby':('api.ashbyhq.com','/posting-api/job-board/{board}',{'includeCompensation':{'true'}}),
}
# Compensation is requested wherever the feed offers it; Lever includes salary fields by default.
DEFAULT_URL={'greenhouse':'?content=true&pay_transparency=true','lever':'?mode=json','ashby':'?includeCompensation=true'}
COMPENSATION_OPTION={'greenhouse':'pay_transparency','ashby':'includeCompensation'}
GEO_BASIS={'explicit_statement','posting_location'}
EMPLOYER_KEYS={'id','name','careers_url','careers_url_evidence','job_families','geography','inclusion','notes'}
SOURCE_KEYS={'id','employer','provider','board','url','enabled','poll_interval_hours','notes'}
LIMITS={'min_poll_hours':1,'max_poll_hours':168}
class RegistryError(ValueError):
    def __init__(self,errors):
        super().__init__('; '.join(errors))
        self.errors=errors
def feed_url(provider,board):
    host,path,_=FEEDS[provider]
    return 'https://%s%s%s'%(host,path.format(board=board),DEFAULT_URL[provider])
def _url_errors(where,s):
    host,path,options=FEEDS[s['provider']]
    u=urlparse(s['url'])
    errs=[]
    if u.scheme!='https' or u.netloc!=host: errs.append('%s url must use https://%s'%(where,host))
    if u.path!=path.format(board=s['board']): errs.append('%s url path %r does not match board %r'%(where,u.path,s['board']))
    if u.params or u.fragment: errs.append('%s url has params or a fragment'%where)
    for k,v in parse_qsl(u.query,keep_blank_values=True):
        if v not in options.get(k,()): errs.append('%s url query option %s=%s is not allowed for %s'%(where,k,v,s['provider']))
    return errs
def _evidence_errors(where,ev):
    if not isinstance(ev,dict) or not str(ev.get('url','')).startswith('https://') or not ev.get('checked_at'):
        return ['%s needs evidence {url (https), checked_at, quote?}'%where]
    return []
def validate(source_list,employer_doc):
    """Returns (employers, sources, warnings). Raises RegistryError listing every problem."""
    errs,warns=[],[]
    if not isinstance(employer_doc,dict) or employer_doc.get('schema')!=SCHEMA:
        raise RegistryError(['employers.json must be an object with schema %r'%SCHEMA])
    if not isinstance(source_list,list): raise RegistryError(['sources.json must be a JSON list of sources'])
    extra=set(employer_doc)-{'schema','employers','notice'}
    if extra: errs.append('employers.json unknown top-level keys: %s'%', '.join(sorted(extra)))
    employers={}
    for n,e in enumerate(employer_doc.get('employers') or []):
        where='employers[%d]'%n
        if not isinstance(e,dict): errs.append(where+' is not an object'); continue
        if set(e)-EMPLOYER_KEYS: errs.append('%s unknown keys: %s'%(where,', '.join(sorted(set(e)-EMPLOYER_KEYS))))
        if not ID.match(str(e.get('id',''))): errs.append(where+' id must match %s'%ID.pattern); continue
        where='employer %s'%e['id']
        if e['id'] in employers: errs.append('duplicate employer id %s'%e['id'])
        employers[e['id']]=e
        if not str(e.get('name','')).strip(): errs.append(where+' needs name')
        if e.get('careers_url') is None: warns.append(where+' has no verified careers_url')
        elif urlparse(str(e['careers_url'])).scheme!='https': errs.append(where+' careers_url must be https')
        elif e.get('careers_url_evidence') is None: warns.append(where+' careers_url has no careers_url_evidence')
        else: errs+=_evidence_errors(where+' careers_url',e['careers_url_evidence'])
        inc=e.get('inclusion')
        if not isinstance(inc,dict) or not str(inc.get('reason','')).strip(): errs.append(where+' needs inclusion.reason')
        for f in e.get('job_families') or []:
            if not isinstance(f,dict) or not f.get('family'): errs.append(where+' job_families entries need family'); continue
            errs+=_evidence_errors('%s job family %s'%(where,f['family']),f.get('evidence'))
        for g in e.get('geography') or []:
            if not isinstance(g,dict) or not g.get('region'): errs.append(where+' geography entries need region'); continue
            if g.get('basis') not in GEO_BASIS:
                errs.append('%s geography %s basis must be one of %s (remote wording alone is not geographic evidence)'%(where,g['region'],sorted(GEO_BASIS)))
            errs+=_evidence_errors('%s geography %s'%(where,g['region']),g.get('evidence'))
    sources,boards,used=[],{},set()
    for n,raw in enumerate(source_list):
        where='sources[%d]'%n
        if not isinstance(raw,dict): errs.append(where+' is not an object'); continue
        if set(raw)-SOURCE_KEYS: errs.append('%s unknown keys: %s'%(where,', '.join(sorted(set(raw)-SOURCE_KEYS))))
        s=DEFAULTS|raw
        if not ID.match(str(s.get('id',''))): errs.append(where+' id must match %s'%ID.pattern); continue
        where='source %s'%s['id']
        if any(x['id']==s['id'] for x in sources): errs.append('duplicate source id %s'%s['id']); continue
        if s.get('employer') not in employers: errs.append('%s employer %r is not in employers'%(where,s.get('employer')))
        used.add(s.get('employer'))
        if s.get('provider') not in FEEDS: errs.append('%s provider must be one of %s'%(where,sorted(FEEDS))); continue
        if not BOARD.match(str(s.get('board',''))): errs.append('%s board %r is malformed'%(where,s.get('board'))); continue
        key=(s['provider'],s['board'].lower())
        if key in boards: errs.append('%s duplicates the %s board %r already configured as %s'%(where,s['provider'],s['board'],boards[key]))
        boards[key]=s['id']
        s.setdefault('url',feed_url(s['provider'],s['board']))
        errs+=_url_errors(where,s)
        option=COMPENSATION_OPTION.get(s['provider'])
        if option and (option,'true') not in parse_qsl(urlparse(s['url']).query):
            warns.append('%s does not request employer-published compensation (%s=true)'%(where,option))
        if not isinstance(s['enabled'],bool): errs.append(where+' enabled must be true or false')
        hours=s['poll_interval_hours']
        if hours is not None and (isinstance(hours,bool) or not isinstance(hours,(int,float)) or not LIMITS['min_poll_hours']<=hours<=LIMITS['max_poll_hours']):
            errs.append('%s poll_interval_hours must be between %d and %d'%(where,LIMITS['min_poll_hours'],LIMITS['max_poll_hours']))
        sources.append(s)
    for eid in sorted(set(employers)-used): warns.append('employer %s has no sources'%eid)
    if not any(s.get('enabled') is True for s in sources): errs.append('no enabled sources')
    if errs: raise RegistryError(errs)
    return employers,sources,warns
def _read(path):
    try: return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError,ValueError) as e: raise RegistryError(['cannot read %s: %s'%(path,e)])
def load(sources=ROOT/'sources.json',employers=ROOT/'employers.json'):
    return validate(_read(sources),_read(employers))
if __name__=='__main__':
    try: employers,sources,warns=load(*sys.argv[1:3])
    except RegistryError as e:
        for m in e.errors: print('ERROR',m)
        raise SystemExit(1)
    for m in warns: print('WARNING',m)
    print('OK: %d employers, %d sources (%d enabled)'%(len(employers),len(sources),sum(s['enabled'] for s in sources)))
