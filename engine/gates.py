"""Evidence-based screening of one posting version for one candidate. Deterministic; no network, no LLM.

Gates: geography, engagement, qualifications, salary, application_history. Each returns pass, fail or unknown
with a reason. pass and fail always carry evidence: quotes from the posting (with source URL and retrieval time)
and the candidate fact or rule they were compared with. An unknown is never turned into a pass or a fail.

Verdict: excluded if any required gate fails; conditional if none fails and any required gate is unknown;
ready only if every required gate passes. Relevance is a separate priority score: it routes work, it never
excludes and it never proves qualification.

Qualifications never pass on keyword overlap. The deterministic part can only find explicit shortfalls
(required years above the profile's total years, a required language the profile lacks). Every other mandatory
requirement needs a review decision with profile evidence (input `reviews`), which the review queue supplies.
"""
import hashlib,re
from datetime import date
from engine.places import covers,places
# 2: pay described as an estimate, third-party or not employer-provided is never compared
# 3: owner rule: a bare '$' is USD when every listed location is in the United States; amounts in millions or
#    billions ('$1B annually') are company figures, never pay
# 4: owner rule: an explicit commission-only or no-base-salary statement fails a base floor
# 5: owner rule: several floors, one per currency, each range compared only with its own currency's floor; a range
#    limited to residents of places that exclude the candidate is not compared
GATES_VERSION=5
SCHEMA='screening-1'
REVIEW_DECISIONS=('met','not_met','not_a_requirement')
SYMBOL_CURRENCY={'₹':'INR','€':'EUR','£':'GBP','zł':'PLN','¥':None,'$':None,'R$':'BRL'}  # $ and ¥ are ambiguous
UNIT_MULTIPLIER={'lakh':100000,'crore':10000000}
# Pay the employer did not publish, or calls an estimate, is not compared with a floor: a third-party figure or an
# estimate could otherwise turn into a salary pass. Read from the quote itself, so it holds whatever the extractor flags say.
NOT_EMPLOYER_PAY=re.compile(r"(?i)\b(?:estimat(?:e|es|ed|ion)|third[- ]party|not (?:provided|published|stated|set|confirmed) by (?:the )?(?:employer|company|hiring (?:company|team))|"
                            r"glassdoor|levels\.fyi|payscale|salary\.com|indeed)\b")
SCOPE=re.compile(r"(?i)\b(located|based|reside|residents?|live|eligible to work|authori[sz]ed to work|right to work|open to|candidates (?:in|from)|hire in|hiring in|only)\b")
NEGATION=re.compile(r"(?i)\b(not|cannot|can't|unable|outside(?: of)?|except|excluding|exclude)\b")
YEARS=re.compile(r'(?i)\b(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b')
LANGUAGES=('English','French','German','Spanish','Portuguese','Italian','Dutch','Polish','Japanese','Mandarin','Chinese','Korean','Hindi','Arabic',
           'Swedish','Norwegian','Danish','Finnish','Turkish','Russian','Romanian','Czech','Hebrew','Thai','Vietnamese','Indonesian','Tagalog')
FLUENCY=re.compile(r'(?i)\b(fluen\w*|native|proficien\w*|business[- ]level|professional working|written and (?:spoken|verbal)|(?:spoken|verbal) and written|speak|required)\b')
class EvidenceError(AssertionError):
    pass
def _item(i,field):
    return {'field':field,'quote':i['quote'],'method':i['method'],'source_url':i.get('source_url'),'retrieved_at':i.get('retrieved_at')}
def _gate(result,reason,evidence=(),basis=None,**extra):
    if result not in ('pass','fail','unknown'): raise ValueError(result)
    if result!='unknown' and not evidence: raise EvidenceError('%s without evidence: %s'%(result,reason))
    return {'result':result,'reason':reason,'evidence':list(evidence),'candidate_basis':basis}|extra
def _unknown_missing(what):
    return _gate('unknown','candidate %s not provided; not assumed'%what)
def geography(fields,profile):
    countries=profile.get('eligible_countries')
    if not countries: return _unknown_missing('eligible_countries')
    basis='profile.eligible_countries = %s'%', '.join(countries)
    listed,listed_items,support,exclude,negated=set(),[],[],[],[]
    for i in fields['location']['items']:
        if i['method'].startswith('ats_field:'):
            found=places(i['quote'])
            if found:
                listed|=found
                listed_items.append((found,_item(i,'location')))
            continue
        # Text is judged clause by clause, and only clauses that state where the person must be count.
        for clause in re.split(r'(?<=[.;!?])\s+',i['quote']):
            found=places(clause)
            if not found or not (i['method'].startswith('description_section:') or SCOPE.search(clause)): continue
            ev=_item(i,'location')|{'quote':clause.strip()}
            if NEGATION.search(clause):
                if covers(found,countries): negated.append(ev)
            else: (support if covers(found,countries) else exclude).append(ev)
    if listed:  # listed locations are a union: the role is offered in any of them
        if covers(listed,countries): support+=[ev for found,ev in listed_items if covers(found,countries)]
        else: exclude+=[ev for _,ev in listed_items]
    if negated:
        return _gate('unknown','a negated statement mentions an eligible country; needs a person to read it',negated,basis)
    if support and exclude:
        return _gate('unknown','posting statements disagree about where the role can be done',support+exclude,basis)
    if support: return _gate('pass','posting names an eligible country, a region containing one, or worldwide',support,basis)
    if exclude: return _gate('fail','every place the posting names is outside the eligible countries',exclude,basis)
    return _gate('unknown','posting names no recognised country or region (city-only or unstated)')
def _allowed(field,allowed,label):
    values={i['interpretation'] for i in field['items'] if i['interpretation']}
    if field['state']=='conflicting': return 'unknown','%s statements conflict'%label,field['items']
    if not values: return 'unknown','%s not stated in the posting'%label,[]
    if values<=set(allowed): return 'pass','%s %s accepted'%(label,'/'.join(sorted(values))),field['items']
    if not values&set(allowed): return 'fail','%s %s not accepted'%(label,'/'.join(sorted(values))),field['items']
    return 'unknown','%s partly accepted (%s)'%(label,'/'.join(sorted(values))),field['items']
def engagement(fields,rules):
    rule=rules.get('engagement')
    if rule is None: return _gate('unknown','candidate engagement rules not provided; not assumed')
    parts=[]
    for key,field,label in (('workplace','workplace','workplace'),('employment_types','employment_type','employment type')):
        if rule.get(key) is None:
            parts.append(('pass','any %s accepted by rule'%label,[{'field':field,'quote':'rules.engagement.%s = any'%key,'method':'candidate_rule'}]))
        else:
            result,reason,items=_allowed(fields[field],rule[key],label)
            parts.append((result,reason,[_item(i,field) for i in items]))
    basis='rules.engagement = %s'%{k:v for k,v in rule.items()}
    evidence=[e for p in parts for e in p[2]]
    reason='; '.join(p[1] for p in parts)
    if any(p[0]=='fail' for p in parts): return _gate('fail',reason,[e for p in parts if p[0]=='fail' for e in p[2]],basis)
    if any(p[0]=='unknown' for p in parts): return _gate('unknown',reason,evidence,basis)
    return _gate('pass',reason,evidence,basis)
def requirement_units(fields):
    """Mandatory requirement lines, each with a stable id (hash of its normalised text). A review decision keyed
    by that id survives content changes elsewhere in the posting."""
    units=[]
    for i in fields['requirements_mandatory']['items']:
        for line in i['quote'].split('\n'):
            text=re.sub(r'^[\s\-–•*·]+','',line).strip()
            if text:
                uid=hashlib.sha256(' '.join(text.lower().split()).encode()).hexdigest()[:16]
                if uid not in {u['id'] for u in units}: units.append({'id':uid,'text':text,'source':_item(i,'requirements_mandatory')|{'quote':line.strip()}})
    return units
def _shortfall(text,profile):
    """Explicit, mechanical shortfalls only. Returns a reason string or None."""
    if re.search(r'(?i)\b(equivalent|preferred|ideally|a plus|advantage|advantageous|beneficial|desirable|or (?:a )?(?:related|similar))\b',text): return None
    years=profile.get('experience_years')
    if years is not None and re.search(r'(?i)experience|years of',text):
        needed=[int(m.group(1)) for m in YEARS.finditer(text) if int(m.group(1))<=40]
        # "8+ years in X or 10+ years in Y" is satisfied by the smaller alternative; "8 years, with at least 6 in Y" needs the larger.
        bar=(min(needed) if re.search(r'(?i)\bor\b',text) else max(needed)) if needed else None
        if bar is not None and bar>years:
            return 'requires %d years; profile.experience_years = %s'%(bar,years)
    langs=profile.get('languages')
    if langs is not None and FLUENCY.search(text):
        needed=[l for l in LANGUAGES if re.search(r'\b%s\b'%l,text)]
        known={l.lower() for l in langs}
        if needed and not any(l.lower() in known for l in needed) and not re.search(r'(?i)\bor\b',text):
            return 'requires %s; profile.languages = %s'%(' and '.join(needed),', '.join(langs) or 'none')
    return None
def qualifications(fields,profile,reviews):
    state=fields['requirements_mandatory']['state']
    if state!='stated':
        return _gate('unknown','no mandatory requirements section was extracted (%s); the full description needs review'%state,units=[])
    units=requirement_units(fields)
    out,failed,pending=[],[],[]
    for u in units:
        short=_shortfall(u['text'],profile)
        review=(reviews or {}).get(u['id'])
        if review and review.get('decision') not in REVIEW_DECISIONS: raise ValueError('review %s: decision must be one of %s'%(u['id'],REVIEW_DECISIONS))
        if review and review['decision'] in ('met','not_met') and not (review.get('evidence') or '').strip():
            raise EvidenceError('review %s marks %s without profile evidence'%(u['id'],review['decision']))
        if short: status,why='not_met',short
        elif review: status,why=review['decision'],review.get('evidence') or 'reviewer: not a requirement'
        else: status,why='pending','needs review against the profile'
        out.append({'id':u['id'],'text':u['text'],'status':status,'basis':why,'automatic':bool(short)})
        if status=='not_met': failed.append(u['source']|{'basis':why})
        if status=='pending': pending.append(u['id'])
    if failed: return _gate('fail','%d mandatory requirement(s) not met'%len(failed),failed,'profile facts and review decisions',units=out)
    if pending: return _gate('unknown','%d of %d mandatory requirement(s) await review'%(len(pending),len(out)),basis='profile facts',units=out)
    met=[u['source']|{'basis':o['basis']} for u,o in zip(units,out) if o['status']=='met']
    if not met: return _gate('unknown','no requirement was confirmed as met',units=out)
    return _gate('pass','every mandatory requirement reviewed; %d met, %d not requirements'%(len(met),len(out)-len(met)),met,'review decisions',units=out)
# CA$, A$, HK$ ... are not US dollars. US$ is, but the extractor does not yet parse 'US$x - US$y' as one range,
# so it is left unknown here rather than compared on a broken range.
OTHER_DOLLARS=re.compile(r'[A-Za-z]\$|\b(?:CAD|AUD|NZD|SGD|HKD|MXN|TWD|BRL)\b')
def _magnitude(r,quote):
    """True when the amount is written in millions or billions ('$1B', '$2.5 million'): a company figure, not pay."""
    return bool(r.get('text')) and bool(re.search(re.escape(r['text'])+r'\s?(?:[MB]\b|bn\b|mn\b|million\b|billion\b)',quote,re.I))
def us_only(fields):
    """True when the job board lists at least one location and every listed location is recognised as the United
    States. City-only entries ('San Francisco, CA') are not recognised, so they leave this False."""
    listed=[places(i['quote']) for i in fields['location']['items'] if i['method'].startswith('ats_field:')]
    return bool(listed) and all(found=={'US'} for found in listed)
def _currency(r,rule,quote='',us_posting=False):
    if r.get('currency'): return r['currency'],None
    sym=r.get('currency_symbol')
    if sym in SYMBOL_CURRENCY and SYMBOL_CURRENCY[sym]: return SYMBOL_CURRENCY[sym],'currency from unambiguous symbol %s'%sym
    if sym=='$' and us_posting and not OTHER_DOLLARS.search(quote):
        return 'USD','bare "$" read as USD because every listed location is in the United States (owner rule)'
    assumed=(rule.get('assume_currency_for_symbol') or {}).get(sym)
    if assumed: return assumed,'currency %s assumed for symbol %s by rules.salary.assume_currency_for_symbol'%(assumed,sym)
    return None,None
COMMISSION_ONLY=re.compile(r"(?i)\b(?:commission[- ]only|100% commission|straight commission|(?:no|without(?: a| any)?) (?:base salary|base pay|fixed salary|guaranteed salary)(?! (?:cap|limit|range|band|ranges|information|info|details|data|figure|amount|is (?:listed|disclosed|stated|provided|shown|published)|has been))\b)")
# "no base salary range is listed" says pay is undisclosed, not absent: never a commission-only statement
COMMISSION_NEGATED=re.compile(r"(?i)\b(?:not|isn't|is not|never)\b[^.;]{0,25}(?:commission[- ]only|100% commission|straight commission)")
def commission_only(posting,fields):
    """Verbatim description lines that explicitly say the role has no base pay. OTE-only wording does not count:
    it leaves the base unstated rather than saying there is none."""
    retrieved=next((i.get('retrieved_at') for f in fields.values() for i in f['items'] if i.get('retrieved_at')),None)
    lines=[l.strip() for l in (posting.get('description') or '').split('\n')]
    return [{'field':'compensation','quote':l,'method':'description_text','source_url':posting.get('canonical_url'),'retrieved_at':retrieved}
            for l in lines if COMMISSION_ONLY.search(l) and not COMMISSION_NEGATED.search(l)]
RESIDENTS=re.compile(r"(?i)\b(?:residents? of|resid(?:e|es|ing) in|(?:candidates|applicants|employees|people) (?:located|based|living|residing|hired) in|"
                     r"applies (?:only )?to (?:candidates |roles |positions )?(?:located |based )?in)\s+(?:the\s+)?([^.;:()\n]{2,80})")
def residency_limit(quote,countries):
    """The phrase limiting a pay statement to residents of places that do not include the candidate's eligible
    countries, or None. Places that are not recognised ('residents of listed locations') never limit anything.
    Without known eligible countries, any recognised residency limit counts, since it cannot be confirmed."""
    text=' '.join(re.sub(r'<[^>]+>',' ',quote or '').split())
    for m in RESIDENTS.finditer(text):
        found=places(m.group(1))
        if found and (not countries or not covers(found,countries)): return m.group(0).strip()
    return None
def salary(fields,rules,posting=None,profile=None):
    rule=rules.get('salary')
    if rule is None: return _gate('unknown','candidate salary rule not provided; not assumed')
    floors={f['currency']:f for f in (rule if isinstance(rule,list) else [rule])}
    symbols={k:v for f in floors.values() for k,v in (f.get('assume_currency_for_symbol') or {}).items()}
    countries=(profile or {}).get('eligible_countries')
    desc='; '.join('rules.salary minimum %s %s per %s (%s)'%(f['minimum'],c,f['period'],f.get('basis','base')) for c,f in floors.items())
    comp=fields['compensation']
    no_base=commission_only(posting or {},fields) if any(f.get('basis','base')=='base' for f in floors.values()) else []
    if comp['state']!='stated':
        if no_base: return _gate('fail','the posting states there is no base pay; the candidate requires a base floor (owner rule)',no_base,desc)
        return _gate('unknown','compensation %s in the posting'%comp['state'].replace('_',' '),basis=desc)
    outcomes,notes=[],[]
    us_posting=us_only(fields)
    for i in comp['items']:
        pay=i['interpretation']
        if not pay: continue
        if NOT_EMPLOYER_PAY.search(i['quote']):
            notes.append('%s: an estimate or not employer-published pay; not compared'%i['quote'][:120])
            continue
        limit=residency_limit(i['quote'],countries)
        if limit:
            notes.append('"%s": pay for residents elsewhere; not compared (eligible countries: %s)'%(limit,', '.join(countries or ['unknown'])))
            continue
        for r in pay['ranges']:
            if _magnitude(r,i['quote']):
                notes.append('%s: an amount in millions or billions, not pay; not compared'%r['text'])
                continue
            cur,cur_note=_currency(r,{'assume_currency_for_symbol':symbols},i['quote'],us_posting)
            if cur not in floors:
                notes.append('%s: currency %s has no floor; not converted'%(r.get('text') or i['quote'],cur or 'unstated')); continue
            rule=floors[cur]
            floor,basis=rule['minimum'],rule.get('basis','base')
            period,period_note=pay.get('period'),None
            if period is None and rule.get('assume_period'):
                period,period_note=rule['assume_period'],'period %s assumed by the %s floor'%(rule['assume_period'],cur)
            why=[n for n in (cur_note,period_note) if n]
            if period!=rule['period']: notes.append('%s: period %s, not annualised or converted'%(r.get('text') or i['quote'],period or 'unstated')); continue
            mult=UNIT_MULTIPLIER.get(pay.get('amount_unit'),1)
            low,high=r['min']*mult,r['max']*mult
            kind=pay.get('basis','unspecified')
            plain=kind=='unspecified' and not pay.get('variable_mentioned')
            ev=_item(i,'compensation')|{'basis':'; '.join(why+['range %s-%s %s per %s, basis %s, against the %s floor %s (%s)'%(low,high,cur,period,kind,cur,floor,basis)])}
            if basis=='base':
                if kind=='base' or plain: verdict='pass' if low>=floor else 'fail' if high<floor else 'span'
                elif kind=='ote' and high<floor: verdict='fail'  # base is below OTE, so below the floor too
                else: verdict='incomparable'
            else:
                if kind=='ote' or plain: verdict='pass' if low>=floor else 'fail' if high<floor else 'span'
                elif kind=='base' and low>=floor: verdict='pass'  # total pay is at least base
                else: verdict='incomparable'
            if verdict=='incomparable': notes.append('%s: basis %s%s cannot be compared with a %s floor'%(r.get('text') or i['quote'],kind,' with variable pay' if pay.get('variable_mentioned') else '',basis)); continue
            outcomes.append((verdict,ev))
    if no_base:
        if any(o[0]=='pass' for o in outcomes):
            return _gate('unknown','the posting says there is no base pay but also states a base range at or above the floor',no_base+[o[1] for o in outcomes],desc,notes=notes)
        return _gate('fail','the posting states there is no base pay; the candidate requires a base floor (owner rule)',no_base+[o[1] for o in outcomes],desc,notes=notes)
    if not outcomes: return _gate('unknown','no stated range is comparable: '+('; '.join(notes) or 'no parsed amount'),[],desc,notes=notes)
    kinds={o[0] for o in outcomes}
    evidence=[o[1] for o in outcomes]
    if kinds=={'pass'}: return _gate('pass','every comparable range starts at or above the floor',evidence,desc,notes=notes)
    if kinds=={'fail'}: return _gate('fail','every comparable range ends below the floor',evidence,desc,notes=notes)
    return _gate('unknown','ranges span the floor or disagree' if 'span' in kinds else 'ranges disagree',evidence,desc,notes=notes)
def _norm(text):
    return re.sub(r'[^a-z0-9]+',' ',(text or '').lower()).strip()
def application_history(posting,profile,rules,today):
    history=profile.get('application_history')
    if history is None: return _unknown_missing('application_history')
    basis='profile.application_history (%d entries)'%len(history)
    cool=(rules.get('application_history') or {}).get('employer_cooldown_days')
    employer=_norm(posting.get('board'))
    exact,similar,cooling=[],[],[]
    for e in history:
        ev={'field':'application_history','quote':'%s %s %s on %s'%(e['status'],e.get('employer') or '',e.get('title') or e.get('posting_id') or e.get('url'),e.get('date') or 'unknown date'),
            'method':'candidate_history'}
        if (e.get('posting_id') and e['posting_id']==posting.get('posting_id')) or (e.get('url') and _norm(e['url'])==_norm(posting.get('canonical_url'))):
            exact.append(ev)
        elif e.get('employer') and _norm(e['employer'])==employer:
            if e.get('title') and _norm(e['title'])==_norm(posting.get('title')): similar.append(ev)
            if cool is not None and e.get('date') and e['status']=='rejected' and (today-date.fromisoformat(e['date'])).days<cool: cooling.append(ev)
    if exact: return _gate('fail','already in the application history',exact,basis)
    if cooling: return _gate('fail','rejected by this employer within rules.application_history.employer_cooldown_days = %d'%cool,cooling,basis)
    if similar: return _gate('unknown','same employer and title in history; may be a reopened or duplicate requisition',similar,basis)
    return _gate('pass','no matching posting, URL or employer cooldown in the history',
                 [{'field':'application_history','quote':'no match among %d entries'%len(history),'method':'candidate_history'}],basis)
def relevance(posting,rules):
    rule=rules.get('relevance') or {}
    title,desc=posting.get('title') or '',posting.get('description') or ''
    hit=lambda kw,text:re.search(r'(?i)(?<![a-z0-9])%s(?![a-z0-9])'%re.escape(kw),text)
    matched=[('title',k) for k in rule.get('title_keywords') or [] if hit(k,title)]+[('description',k) for k in rule.get('description_keywords') or [] if hit(k,desc)]
    score=sum(3 if where=='title' else 1 for where,_ in matched)
    minimum=rule.get('minimum_score')
    return {'score':score,'matched':['%s:%s'%m for m in matched],
            'routing':'queue' if minimum is None or score>=minimum else 'below_relevance_threshold',
            'note':'priority only; never an exclusion and never evidence of qualification'}
def screen(candidate,posting,extraction,reviews=None,today=None):
    """posting: posting_id, content_hash, canonical_url, board, title, description. extraction: extract() output."""
    if extraction is None: raise ValueError('posting %s has no extraction; run extraction first'%posting.get('posting_id'))
    today=today or date.today()
    profile,rules,fields=candidate['profile'],candidate['rules'],extraction['fields']
    required=set(rules.get('required_gates') or ('geography','engagement','qualifications','salary','application_history'))
    gates={'geography':geography(fields,profile),'engagement':engagement(fields,rules),
           'qualifications':qualifications(fields,profile,reviews),'salary':salary(fields,rules,posting,profile),
           'application_history':application_history(posting,profile,rules,today)}
    for name,g in gates.items(): g['required']=name in required
    results={g['result'] for g in gates.values() if g['required']}
    verdict='excluded' if 'fail' in results else 'conditional' if 'unknown' in results else 'ready'
    return {'schema':SCHEMA,'gates_version':GATES_VERSION,'extractor_version':extraction.get('extractor_version'),
            'candidate_id':candidate['candidate_id'],'profile_version':candidate['profile_version'],'rules_version':candidate['rules_version'],
            'posting_id':posting.get('posting_id'),'content_hash':posting.get('content_hash'),'verdict':verdict,
            'blocking':sorted(n for n,g in gates.items() if g['required'] and g['result']!='pass'),
            'extraction_state':extraction.get('state'),'extraction_warnings':extraction.get('warnings',[]),
            'relevance':relevance(posting,rules),'gates':gates}
