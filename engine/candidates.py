"""Candidate configuration: one JSON file per candidate, kept outside Git.

Real profiles live in a private directory named by JOB_ENGINE_CANDIDATES (or --candidates), never in this
repository. Only files marked "synthetic": true may live inside the work tree; they are test fixtures.

Keys are strict, so a typo cannot silently disable a gate. A fact that is absent stays unknown (None);
an empty list is an explicit statement (for example "no earlier applications"). Nothing is defaulted from
another candidate or from shared code: every threshold comes from the candidate's own rules.
"""
import json,os,re
from pathlib import Path
from engine.places import COUNTRIES
SCHEMA='candidate-config-1'
ENV='JOB_ENGINE_CANDIDATES'
ROOT=Path(__file__).resolve().parent.parent
GATES=('geography','engagement','qualifications','salary','application_history')
WORKPLACES=('remote','hybrid','onsite')
EMPLOYMENT_TYPES=('full_time','part_time','contract','internship','temporary')
HISTORY_STATUSES=('applied','interviewing','offer','rejected','withdrawn')
KEYS={
    'top':{'schema','candidate_id','synthetic','profile_version','rules_version','profile','rules'},
    'profile':{'eligible_countries','experience_years','languages','application_history','application_history_file',
               'experience','transferable','relocation_countries','explicit_country_required','preferred_cities'},
    'rules':{'required_gates','relevance','engagement','salary','application_history','discovery','match','fx'},
    'experience':{'id','title','skills','domains','functions','evidence'},
    'transferable':{'reason','job_terms','from'},
    'match':{'min_fit','high_fit'},
    'relevance':{'title_keywords','description_keywords','minimum_score'},
    'engagement':{'workplace','employment_types'},
    'salary':{'minimum','currency','period','basis','assume_period','assume_currency_for_symbol'},
    'application_history_rule':{'employer_cooldown_days'},
    'history':{'posting_id','url','employer','title','status','date'},
}
class ConfigError(ValueError):
    pass
def _keys(obj,allowed,where):
    if not isinstance(obj,dict): raise ConfigError('%s must be an object'%where)
    extra=set(obj)-allowed
    if extra: raise ConfigError('%s: unknown keys %s'%(where,sorted(extra)))
def _strings(value,where,allowed=None):
    if value is None: return None
    if not isinstance(value,list) or not all(isinstance(v,str) and v.strip() for v in value): raise ConfigError('%s must be a list of strings'%where)
    if allowed is not None and set(value)-set(allowed): raise ConfigError('%s: unsupported %s (allowed %s)'%(where,sorted(set(value)-set(allowed)),list(allowed)))
    return value
def _history(entries,where):
    if entries is None: return None
    if not isinstance(entries,list): raise ConfigError('%s must be a list'%where)
    for n,e in enumerate(entries):
        _keys(e,KEYS['history'],'%s[%d]'%(where,n))
        if e.get('status') not in HISTORY_STATUSES: raise ConfigError('%s[%d].status must be one of %s'%(where,n,HISTORY_STATUSES))
        if not (e.get('posting_id') or e.get('url') or e.get('employer')): raise ConfigError('%s[%d] needs posting_id, url or employer'%(where,n))
        if e.get('date') and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',e['date']): raise ConfigError('%s[%d].date must be YYYY-MM-DD'%(where,n))
    return entries
def validate(config,where='config'):
    _keys(config,KEYS['top'],where)
    if config.get('schema')!=SCHEMA: raise ConfigError('%s: schema must be %s'%(where,SCHEMA))
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}',config.get('candidate_id') or ''): raise ConfigError('%s: candidate_id must be lowercase letters, digits and hyphens'%where)
    if not isinstance(config.get('synthetic'),bool): raise ConfigError('%s: synthetic must be true or false'%where)
    for k in ('profile_version','rules_version'):
        if not isinstance(config.get(k),str) or not config[k].strip(): raise ConfigError('%s: %s is required; bump it whenever %s changes'%(where,k,k.split('_')[0]))
    profile,rules=config.get('profile') or {},config.get('rules') or {}
    _keys(profile,KEYS['profile'],where+'.profile')
    _keys(rules,KEYS['rules'],where+'.rules')
    countries=_strings(profile.get('eligible_countries'),where+'.profile.eligible_countries',COUNTRIES)
    if countries==[]: raise ConfigError('%s.profile.eligible_countries is empty; omit it if unknown'%where)
    years=profile.get('experience_years')
    if years is not None and (isinstance(years,bool) or not isinstance(years,(int,float)) or years<0): raise ConfigError('%s.profile.experience_years must be a non-negative number'%where)
    _strings(profile.get('languages'),where+'.profile.languages')
    if 'application_history' in profile and 'application_history_file' in profile: raise ConfigError('%s.profile: give application_history or application_history_file, not both'%where)
    _history(profile.get('application_history'),where+'.profile.application_history')
    # Career history for transferable matching: each item names skills/domains/functions evidenced by real work.
    ids=set()
    for n,item in enumerate(profile.get('experience') or []):
        at='%s.profile.experience[%d]'%(where,n); _keys(item,KEYS['experience'],at)
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}',item.get('id') or ''): raise ConfigError(at+'.id is required')
        for k in ('skills','domains','functions'): _strings(item.get(k),at+'.'+k)
        ids.add(item['id'])
    for n,rule in enumerate(profile.get('transferable') or []):
        at='%s.profile.transferable[%d]'%(where,n); _keys(rule,KEYS['transferable'],at)
        _strings(rule.get('job_terms'),at+'.job_terms')
        if not rule.get('reason') or not rule.get('job_terms'): raise ConfigError(at+' needs reason and job_terms')
        if set(rule.get('from') or [])-ids: raise ConfigError(at+'.from names unknown experience ids')
    _strings(profile.get('relocation_countries'),where+'.profile.relocation_countries',COUNTRIES)
    _strings(profile.get('preferred_cities'),where+'.profile.preferred_cities')
    if not isinstance(profile.get('explicit_country_required',False),bool): raise ConfigError(where+'.profile.explicit_country_required must be true or false')
    m=rules.get('match')
    if m is not None:
        _keys(m,KEYS['match'],where+'.rules.match')
        if not all(isinstance(m.get(k,0),(int,float)) and 0<=m.get(k,0)<=100 for k in ('min_fit','high_fit')): raise ConfigError(where+'.rules.match thresholds are 0-100')
    _strings(rules.get('required_gates'),where+'.rules.required_gates',GATES)
    if 'discovery' in rules:
        from engine.discovery import validate as validate_discovery
        try: validate_discovery(rules['discovery'])
        except ValueError as error: raise ConfigError('%s.rules.discovery: %s'%(where,error)) from error
    rel=rules.get('relevance')
    if rel is not None:
        _keys(rel,KEYS['relevance'],where+'.rules.relevance')
        _strings(rel.get('title_keywords'),where+'.rules.relevance.title_keywords')
        _strings(rel.get('description_keywords'),where+'.rules.relevance.description_keywords')
        if rel.get('minimum_score') is not None and not isinstance(rel['minimum_score'],(int,float)): raise ConfigError('%s.rules.relevance.minimum_score must be a number'%where)
    eng=rules.get('engagement')
    if eng is not None:
        _keys(eng,KEYS['engagement'],where+'.rules.engagement')
        _strings(eng.get('workplace'),where+'.rules.engagement.workplace',WORKPLACES)
        _strings(eng.get('employment_types'),where+'.rules.engagement.employment_types',EMPLOYMENT_TYPES)
    fx=rules.get('fx')
    if fx is not None:
        # dated, sourced conversion rates supplied by the operator; the engine has no built-in rate
        if not isinstance(fx,dict) or set(fx)-{'as_of','source','rates'}: raise ConfigError('%s.rules.fx keys are as_of, source, rates'%where)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(fx.get('as_of') or '')) or not fx.get('source'): raise ConfigError('%s.rules.fx needs an as_of date (YYYY-MM-DD) and a source'%where)
        for a,targets in (fx.get('rates') or {}).items():
            if not re.fullmatch(r'[A-Z]{3}',a) or not isinstance(targets,dict) or not all(re.fullmatch(r'[A-Z]{3}',b) and isinstance(v,(int,float)) and not isinstance(v,bool) and v>0 for b,v in targets.items()):
                raise ConfigError('%s.rules.fx.rates maps ISO codes to {ISO code: positive rate}'%where)
    sal=rules.get('salary')
    if sal is not None:
        # one floor (an object) or several (a list), at most one per currency; converted only through a dated rules.fx
        floors=sal if isinstance(sal,list) else [sal]
        if not floors: raise ConfigError('%s.rules.salary is an empty list; omit it if there is no floor'%where)
        symbols={}
        for n,f in enumerate(floors):
            at=where+'.rules.salary'+('[%d]'%n if isinstance(sal,list) else '')
            _keys(f,KEYS['salary'],at)
            if isinstance(f.get('minimum'),bool) or not isinstance(f.get('minimum'),(int,float)) or f['minimum']<=0: raise ConfigError('%s.minimum must be a positive number'%at)
            if not re.fullmatch(r'[A-Z]{3}',f.get('currency') or ''): raise ConfigError('%s.currency must be an ISO 4217 code'%at)
            if f.get('period') not in ('year','month','day','hour'): raise ConfigError('%s.period must be year, month, day or hour'%at)
            if f.get('basis','base') not in ('base','total'): raise ConfigError('%s.basis must be base or total'%at)
            if f.get('assume_period') not in (None,'year','month','day','hour'): raise ConfigError('%s.assume_period must be a period or null'%at)
            sym=f.get('assume_currency_for_symbol')
            if sym is not None and (not isinstance(sym,dict) or not all(re.fullmatch(r'[A-Z]{3}',v or '') for v in sym.values())): raise ConfigError('%s.assume_currency_for_symbol maps symbols to ISO codes'%at)
            for k,v in (sym or {}).items():
                if symbols.setdefault(k,v)!=v: raise ConfigError('%s.rules.salary: symbol %s is assumed to be both %s and %s'%(where,k,symbols[k],v))
        currencies=[f['currency'] for f in floors]
        if len(set(currencies))!=len(currencies): raise ConfigError('%s.rules.salary: one floor per currency'%where)
    hist=rules.get('application_history')
    if hist is not None:
        _keys(hist,KEYS['application_history_rule'],where+'.rules.application_history')
        days=hist.get('employer_cooldown_days')
        if days is not None and (isinstance(days,bool) or not isinstance(days,int) or days<0): raise ConfigError('%s.rules.application_history.employer_cooldown_days must be a non-negative integer'%where)
    return config
def _inside_repo(path):
    try:
        Path(path).resolve().relative_to(ROOT)
        return True
    except ValueError:
        return False
def load(path):
    """Loads and validates one candidate file. A real (non-synthetic) profile inside the repository is refused."""
    path=Path(path)
    config=validate(json.loads(path.read_text(encoding='utf-8')),path.name)
    if _inside_repo(path) and not config['synthetic']:
        raise ConfigError('%s is inside the repository but not marked synthetic; real profiles belong in the private directory named by %s'%(path,ENV))
    history_file=config['profile'].get('application_history_file')
    if history_file:
        hpath=(path.parent/history_file)
        if _inside_repo(hpath) and not config['synthetic']: raise ConfigError('%s: application history must stay outside the repository'%path.name)
        config['profile']['application_history']=_history(json.loads(hpath.read_text(encoding='utf-8')),history_file)
    return config
def load_all(directory=None):
    """Every *.json candidate in the directory (default: $JOB_ENGINE_CANDIDATES). Duplicate ids are refused."""
    directory=directory or os.environ.get(ENV)
    if not directory: raise ConfigError('No candidate directory: set %s or pass --candidates'%ENV)
    out={}
    for f in sorted(Path(directory).glob('*.json')):
        if f.name.endswith('.history.json'): continue
        c=load(f)
        if c['candidate_id'] in out: raise ConfigError('Duplicate candidate_id %s'%c['candidate_id'])
        out[c['candidate_id']]=c
    if not out: raise ConfigError('No candidate files in %s'%directory)
    return out

