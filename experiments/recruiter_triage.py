"""Evidence-preserving offline triage. Never declares READY.

Repair (v3) restores the established engine semantics (engine/gates.py) that the v2 experiment had dropped:
- separate states for relevance, eligibility blockers, qualifications, pay and application history;
- relevance routes priority and never rejects (outside-target jobs are `below_relevance`, not REJECT);
- only a confirmed, documented hard restriction rejects; an UNKNOWN qualification (SQL, certification, tools,
  years, seniority) is listed for review and never removes a job from the review queue;
- evidence comes from the established deterministic extractor (engine.extract) and geography gate
  (engine.gates.geography, engine.places), not new regex copies.
Candidate policies are generic public discovery rules; private facts (CV, pay floor, history) are never read here.
"""
from dataclasses import dataclass
import hashlib,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine.extract import extract  # noqa: E402
from engine.gates import geography as engine_geography  # noqa: E402
from engine.places import places,covers  # noqa: E402
from candidate_match import role_match

RULES_VERSION='triage-v3'
POLICIES={
 'farhan':{'eligible_countries':['IN'],'workplace':('remote',),'india_must_be_explicit':True,'foreign_location_is_blocker':True,
           'title_blockers':((r'\b(support (?:engineer|representative|specialist|agent|associate)|customer support|help ?desk|service desk|'
                              r'technical support|csr\b)','support-first primary duty (documented candidate rule)'),
                             (r'\b(account executive|sales (?:manager|director|representative|specialist|development)|bdr|sdr|'
                              r'business development)','quota-carrying sales (documented candidate rule)'))},
 'sana':{'eligible_countries':['IN'],'workplace':None,'india_must_be_explicit':False,'foreign_location_is_blocker':False,
         'title_blockers':()},
}
# Statements that only people who already hold foreign work rights (or are located there) can be hired.
EXISTING_RIGHTS=re.compile(r"(?i)(?:\b(?:must|need to|needs to) (?:be|have)[^.\n]{0,40}?(?:authori[sz]ed|eligible|legal(?:ly)? (?:able|right)|right|full working rights) to work (?:in|from their home location \(in)|"
                           r"\b(?:able|eligible|authori[sz]ed) to work in (?:the )?[A-Z][\w ]{1,30}? without (?:the need for )?(?:visa )?sponsorship|"
                           r"\b(?:candidates|applicants) (?:must|need to) be (?:either )?(?:an? )?[A-Z]\w+ citizens?|\bcitizen or (?:an? )?(?:PR|permanent resident)|"
                           r"\bmust be (?:located|based) in|\bopen to candidates based in [^.\n]{0,60}\bonly|^[\s\-–•·*]*eligible to work (?:full-time )?in)[^.\n]{0,120}",re.M)
MANDATORY_CREDENTIAL=re.compile(r"(?i)\b(?:master'?s|m\.?\s?tech|m\.?e\.)\b[^.\n]{0,60}\b(?:required|mandatory|must)\b|\b(?:required|mandatory|must have)\b[^.\n]{0,40}\bmaster'?s\b|"
                                r"\bBEE\b[^.\n]{0,60}\b(?:certified|certification)\b[^.\n]{0,40}\b(?:required|mandatory|must)\b|"
                                r"\b(?:required|mandatory)\b[^.\n]{0,40}\bBEE\b[^.\n]{0,40}\b(?:certified|certification|auditor|manager)\b")
CHECKS=((r'\bsql\b','SQL'),(r'\b(?:certification|certified)\b','certification'),(r'\bepm\b','EPM'),(r'\b(?:ansi x12|edifact|edi)\b','EDI standards'),
        (r'\b(?:sap|cmms|plc|scada|autocad|matlab|etap|revit|dialux|aspen|python|java|go|ruby|node\.?js|typescript)\b','named tool or language'),
        (r'\b(?:fluent|native)\b[^.\n]{0,20}\b(?:german|french|japanese|spanish|dutch|italian|portuguese|mandarin)\b','language'))
YEARS=re.compile(r'(?i)\b(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b')

@dataclass(frozen=True)
class Decision:
    status:str          # REJECT only for a confirmed hard restriction; HOLD otherwise. Never READY.
    reasons:tuple[str,...]
    evidence:dict

def _version(job,raw):
    if raw is not None:
        return {'title':job.get('title'),'locations':raw.get('locations') or [],'workplace_type':raw.get('workplace_type'),
                'description':job.get('description') or '','compensation_raw':raw.get('compensation_raw')}
    loc=str(job.get('location') or '')
    return {'title':job.get('title'),'locations':[{'text':loc,'source':'location'}] if loc else [],'workplace_type':job.get('workplace_type'),
            'description':job.get('description') or '','compensation_raw':None}

def _explicit_india(quotes):
    return any('IN' in places(q) for q in quotes)

def review_key(candidate,key,content_hash):
    """Stable receipt key: a private review of this candidate, posting content and rules version stays completed
    across repeated runs; any change to content or rules makes it due again."""
    return hashlib.sha256('|'.join([candidate,str(key),str(content_hash or ''),RULES_VERSION]).encode()).hexdigest()[:24]

def triage(job,candidate='farhan',minimum_fixed_annual_inr=None,raw=None):
    if candidate not in POLICIES:raise ValueError('unknown candidate')
    policy=POLICIES[candidate]
    title=str(job.get('title') or '');desc=str(job.get('description') or '')
    version=_version(job,raw);fields=extract(version,job.get('url'))['fields']
    score,family,role_reason=role_match(job,candidate)
    blockers,unresolved,checks=[],[],[]
    evidence={'title':title,'location':str(job.get('location') or ''),'role_family':family,'role_reason':role_reason,'excerpts':[]}
    if not title or not str(job.get('url') or '').startswith('https://'):blockers.append('missing title or HTTPS posting URL')
    if re.search(r'(?i)\b(no longer accepting applications|position (has been |is )?filled|this (job|position) is closed)\b',desc):
        blockers.append('posting contains a closed-vacancy notice')
    if len(desc.split())<80:unresolved.append('full job description not established')
    for pattern,why in policy['title_blockers']:
        if re.search(pattern,title,re.I):blockers.append(why)
    # Geography: the established gate (clause-level, negation-aware, union of listed places).
    geo=engine_geography(fields,{'eligible_countries':policy['eligible_countries']})
    quotes=[e['quote'] for e in geo['evidence']]
    rights=[m.group(0).strip() for m in EXISTING_RIGHTS.finditer(desc)]
    rights=[r for r in rights if not covers(places(r) or {'NONE'},policy['eligible_countries'])]
    india=geo['result']=='pass' and (_explicit_india(quotes) or not policy['india_must_be_explicit'])
    for r in rights[:2]:evidence['excerpts'].append({'field':'work_authorization','text':r[:300]})
    if rights and india:unresolved.append('India is named but the posting also requires existing foreign work rights; manual resolution')
    elif rights:blockers.append('posting requires existing work rights or location outside India')
    if geo['result']=='fail':
        if policy['foreign_location_is_blocker']:blockers.append('every listed location is outside India')
        else:unresolved.append('overseas location: relocation and work authorisation not established')
    elif geo['result']=='pass' and not india:unresolved.append('only region/worldwide wording; India not named (insufficient on its own)')
    elif geo['result']=='unknown':unresolved.append('India eligibility not established: %s'%geo['reason'])
    for q in quotes[:2]:evidence['excerpts'].append({'field':'location','text':q[:300]})
    # Arrangement: explicit workplace values from the extractor (ATS field or location text).
    work={i['interpretation'] for i in fields['workplace']['items'] if i['interpretation']}
    remote=work=={'remote'} or bool(re.search(r'(?i)\b(this (position|role) (will be|is) (fully )?remote|all of our roles are remote|remote in india)\b',desc))
    if policy['workplace']:
        if work and not work&set(policy['workplace']):blockers.append('onsite or hybrid arrangement conflicts with the fully remote requirement')
        elif not remote:unresolved.append('remote arrangement not affirmatively established')
    elif work&{'onsite','hybrid'}:unresolved.append('site/office arrangement: preference review')
    # Qualifications: listed for review against private evidence. Never a blocker, except a genuinely mandatory
    # credential under a documented candidate rule (Sana: mandatory master's degree or BEE certification).
    mandatory='\n'.join(i['quote'] for i in fields['requirements_mandatory']['items'])
    where='mandatory requirements'
    if fields['requirements_mandatory']['state']!='stated':  # no requirement headings: read the whole text, say so
        where='unsectioned description'
        mandatory='\n'.join(x for x in re.split(r'(?<=[.!?;])\s+|\n',desc)
                             if not re.search(r'(?i)\b(preferred|nice to have|a plus|is a bonus|bonus|desirable|advantage\w*|not required)\b',x))
    for pattern,label in CHECKS:
        if re.search(pattern,mandatory,re.I):checks.append('%s named in %s'%(label,where))
    years=[int(m.group(1)) for m in YEARS.finditer(mandatory) if int(m.group(1))<=40]
    if years:checks.append('%d+ years stated in %s'%(max(years),where))
    if re.search(r'\b(director|head of|vice president|vp|principal|staff|group product)\b',title,re.I):checks.append('seniority level in title')
    if candidate=='sana':
        m=MANDATORY_CREDENTIAL.search(mandatory)
        if m:blockers.append('mandatory credential not established (documented rule: master\'s/BEE): '+m.group(0)[:120])
    pay=re.search(r'(?:fixed (?:annual )?(?:salary|pay)[ :]+(?:inr|rs\.?|₹)\s*)([\d,]+)\s*(?:per year|p\.?a\.?|annually)',desc.lower())
    pay_state={'state':fields['compensation']['state'],'note':'no private floor supplied; never assumed'}
    if pay:
        evidence['fixed_annual_inr']=int(pay.group(1).replace(',',''))
        if minimum_fixed_annual_inr:
            below=evidence['fixed_annual_inr']<minimum_fixed_annual_inr
            pay_state={'state':'fail' if below else 'pass','note':'explicit fixed INR annual salary against the supplied minimum'}
            if below:blockers.append('explicit fixed INR salary below supplied minimum')
    relevant=family in ('target','adjacent') and score>=4
    queue='excluded' if blockers else 'review' if relevant else 'below_relevance'
    tier=None
    if queue=='review':
        clear=india and not rights and (remote or not policy['workplace']) and len(desc.split())>=80
        tier='A' if clear else 'B'
    evidence.update({'india_location':india,'remote_advertised':remote,'geography_gate':{'result':geo['result'],'reason':geo['reason']},
                     'states':{'relevance':{'family':family,'score':score},'eligibility':{'blockers':blockers,'unresolved':unresolved},
                               'qualifications':{'state':'unknown','checks':checks,'note':'review against private evidence; not a blocker'},
                               'pay':pay_state,'application_history':{'state':'not_provided','note':'private; checked in the private review'}},
                     'qualification_gaps':checks,'queue':queue,'review_tier':tier,'shortlist_eligible':queue=='review',
                     'rules_version':RULES_VERSION})
    if pay_state['state']!='pass':unresolved.append('compensation threshold not independently verified')
    reasons=blockers+unresolved+checks+['READY needs private eligibility, pay, history and qualification review']
    return Decision('REJECT' if blockers else 'HOLD',tuple(dict.fromkeys(reasons)),evidence)
