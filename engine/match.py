"""Full-career, transferable-skills matching. Deterministic, stdlib only, no network, no LLM.

The candidate profile (private, outside Git) lists experience items, each with the skills, domains and functions
that real work evidenced, plus transferable rules ("founder/operator experience -> chief of staff"). A posting is
compared requirement by requirement: every mandatory line is matched to the experience items whose phrases it
names, and the unmatched lines are kept. Titles never establish fit on their own; a title phrase adds context only.
The score routes review effort; it is not a qualification decision (that needs the qualifications gate's reviews).
"""
import re
from engine.gates import requirement_units

MATCH_VERSION=5  # 5: IT infrastructure/network/cloud titles are specialist; 4: entry-level titles capped; 3: fixed phrase weights (batch-independent); 2 weighted by rarity across the scored batch
# Phrases so common in job text that one alone does not evidence a requirement. Fixed and versioned, so a posting
# scores the same whether it is scored alone or among a thousand others (v2's batch rarity weights did not).
GENERIC=frozenset(p.lower() for p in (
    'AI','API','APIs','automation','integration','integrations','configuration','documentation','testing','delivery',
    'operations','business operations','implementation','onboarding','customer-facing','cross-functional','SaaS',
    'startup','generalist','compliance','safety','equipment','electrical','power','energy','utilities','industrial',
    'manufacturing','maintenance','inspection','reliability','troubleshooting','operations manager','team lead',
    'project management','stakeholder management','process improvement','customer support','support manager','QA'))
GENERIC_WEIGHT=0.25
# Professions a title can name that need their own evidence. If the career history names none of the title's
# specialist words, keyword overlap in the body (API, testing, operations...) cannot make the job a strong fit.
SPECIALIST=re.compile(r'(?i)\b(software|backend|back-end|frontend|front-end|full ?stack|developer|sdet|engineer in test|site reliability|sre|dbre|'
                      r'database|data engineer|data scientist|data analyst|machine learning|\bml\b|ai engineer|research engineer|designer|design|'
                      r'security|devops|platform engineer|architect|counsel|legal|attorney|accountant|accounting|payroll|recruiter|'
                      r'scientist|physician|nurse|clinical|mechanical|chemical|process engineer|validation|cqv|gmp|instructor|content|seo|copywriter|'
                      r'release engineer|engineering manager|director, engineering|head of engineering|\bsde\b|it infrastructure|it operations|it support|'
                      r'network engineer|network administrator|system administrator|sysadmin|help ?desk|service desk|cloud|engineer)\b')
SOFT=('engineer',)
# Entry-level programmes: not a career move for an experienced candidate, however well the body text matches.
JUNIOR=re.compile(r'(?i)\b(intern|internship|co-?op|apprentice\w*|trainee|graduate (?:program|programme|trainee|engineer)|campus|fresher|student)\b')  # a bare 'engineer' can be exempted by a career function in the title ('Implementation Engineer')
def document_frequency(texts,profile):
    """Diagnostic only since MATCH_VERSION 3: {phrase: number of texts naming it}. match() no longer uses it."""
    ph=_phrases(profile); n=0; df={}
    for t in texts:
        n+=1
        for p,rx,_,_ in ph:
            if rx.search(t or ''): df[p]=df.get(p,0)+1
    return df,n
def _phrase(p):
    return re.compile(r'(?i)(?<![a-z0-9])%s(?![a-z0-9])'%r'[\s\-/]+'.join(re.escape(w) for w in p.split()))
def _phrases(profile):
    """[(phrase, regex, item id, kind)] for every skill, domain and function of every experience item."""
    out=[]
    for item in profile.get('experience') or []:
        for kind in ('skills','domains','functions'):
            for p in item.get(kind) or []: out.append((p,_phrase(p),item['id'],kind))
    return out
def _lines(fields,description):
    units=[u['text'] for u in requirement_units(fields)]
    if units: return units,'mandatory_requirements'
    # No recognised requirement section: requirement-like sentences of the description, never preferred ones.
    sents=[s.strip() for s in re.split(r'(?<=[.!?;])\s+|\n',description or '') if s.strip()]
    req=[s for s in sents if re.search(r'(?i)\b(experience|years|required|must|proficien|knowledge of|ability to|degree|background in)\b',s)
         and not re.search(r'(?i)\b(preferred|nice to have|a plus|bonus|desirable)\b',s)]
    return req[:30],'requirement_like_sentences'
def match(posting,fields,profile,df=None,n_docs=None):
    title,desc=posting.get('title') or '',posting.get('description') or ''
    phrases=_phrases(profile)
    lines,basis=_lines(fields,desc)
    # df and n_docs are accepted for compatibility and ignored: weights never depend on the other postings scored.
    weight=lambda p:GENERIC_WEIGHT if p.lower() in GENERIC else 1.0
    matched,unmatched=[],[]
    for line in lines:
        hits=sorted({(p,i) for p,rx,i,_ in phrases if rx.search(line)})
        # A requirement counts as evidenced by one distinctive phrase, or by two or more common ones.
        strong=sum(weight(p) for p,_ in hits)>=0.5
        (matched if hits and strong else unmatched).append({'requirement':line[:300],'evidence':[{'phrase':p,'experience':i} for p,i in hits][:6]})
    found=sorted({p for p,rx,_,_ in phrases if rx.search(desc)})
    breadth_w=sum(weight(p) for p in found)
    title_hits=sorted({p for p,rx,_,k in phrases if k=='functions' and rx.search(title)})
    transferable=[]
    text=title+'\n'+desc
    for rule in profile.get('transferable') or []:
        terms=[t for t in rule['job_terms'] if _phrase(t).search(text)]
        if terms: transferable.append({'reason':rule['reason'],'job_terms':terms,'from':rule.get('from') or []})
    coverage=len(matched)/len(lines) if lines else 0.0
    breadth=min(1.0,breadth_w/4)
    score=round(100*(0.55*coverage+0.30*breadth+0.10*bool(transferable)+0.05*bool(title_hits)))
    if not lines: score=min(score,40)  # nothing requirement-like to compare: never high-fit on keywords alone
    known=' '.join(p for p,_,_,_ in phrases)+' '+' '.join(t for r in profile.get('transferable') or [] for t in r['job_terms'])
    spec=[w.lower() for w in SPECIALIST.findall(title)]
    unevidenced=[w for w in spec if not re.search(r'(?i)(?<![a-z])%s(?![a-z])'%re.escape(w),known)]
    # Exempt only when a career function or transferable job term appears outside the unevidenced specialist words
    # ("Implementation Engineer" is exempt; "Site Reliability Engineer" is not exempted by "reliability").
    rest=title
    for w in unevidenced: rest=re.sub(r'(?i)%s'%re.escape(w),' ',rest)
    titled=[p for p,rx,_,k in phrases if k=='functions' and rx.search(rest)]+[t for r in profile.get('transferable') or [] for t in r['job_terms'] if _phrase(t).search(rest)]
    hard=[w for w in unevidenced if w not in SOFT]
    if hard or (unevidenced and not titled):
        score=min(score,15)  # below any sensible min_fit: screened, not promoted on body keywords
    junior=JUNIOR.findall(title)
    if junior and (profile.get('experience_years') is None or profile['experience_years']>=2): score=min(score,15)
    items=sorted({e['experience'] for m in matched for e in m['evidence']})
    return {'match_version':MATCH_VERSION,'score':score,'coverage':round(coverage,2),'basis':basis,
            'requirements':len(lines),'matched':matched[:12],'unmatched_mandatory':[u['requirement'] for u in unmatched][:10],
            'experience_used':items,'entry_level_title':junior,'unevidenced_title_profession':unevidenced,'skills_found':found[:20],'title_context':title_hits,'transferable':transferable,
            'note':'keyword evidence against the career history; routes review, never proves qualification'}
