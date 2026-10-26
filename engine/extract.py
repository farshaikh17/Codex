"""Deterministic extraction of evidence from one stored posting version. No network, no LLM.

Every item quotes the source text it came from. interpretation is filled only when the wording is explicit
(a parsed pay range, a workplace keyword); otherwise it is None and later stages must read the quote.
Field states: stated, not_stated, conflicting (explicit statements disagree), not_retrieved (no text to read).
Nothing here decides fit, eligibility or READY.
"""
import json,re
EXTRACTOR_VERSION=1
EVIDENCE_SCHEMA='evidence-1'
FIELDS=('location','workplace','employment_type','compensation','requirements_mandatory','requirements_preferred')
THIN_WORDS=80
def _norm(line):
    return re.sub(r'\s+',' ',re.sub(r'^[\W_]+|[\W_]+$','',line.replace('’',"'").lower())).strip()
HEADINGS=[(kind,re.compile('^(?:%s)$'%pattern)) for kind,pattern in (
    ('requirements_preferred',r"desired|nice[- ]to[- ]haves?|preferred(?: qualifications| skills| experience)?|bonus(?: points)?|"
        r"bonus / nice[- ]to[- ]have experience|helpful experience|what will make (?:you|us) (?:stand out|love you)|extra credit|"
        r"good to have|ideally(?:,? you (?:have|bring))?|pluses|it'?s a plus if you have"),
    ('requirements_mandatory',r"\*?required|requirements|core requirements|minimum requirements|(?:minimum|basic|required) qualifications|"
        r"qualifications|what you'?(?:ll| will)? (?:bring|need)(?: to accomplish the job)?|what you bring|you'?ll also need|who you are|"
        r"about you|what we'?re looking for|who we'?re looking for|to succeed in this role,? you (?:must|will) have|must[- ]haves?|"
        r"you have|you should have|experience|skills(?: and experience)?|what you need"),
    ('compensation',r"compensation(?: range| and benefits| & benefits)?|salary(?: range)?|(?:[a-z ]+ )?(?:salary|pay) range|base (?:pay|salary)(?: range)?|"
        r"pay transparency.*|total rewards|pay"),
    ('location',r"(?:job |work )?location(?: requirements?)?|where (?:you'?ll|you will) (?:work|be based)"),
    ('other',r"responsibilities|key responsibilities|what you'?(?:ll| will) (?:do|own|be doing)|things you'?ll do|in this role,? you'?ll|"
        r"the role|about the (?:role|job|team|company)|role (?:overview|summary)|overview|an overview of this role|about [a-z0-9 .&-]{2,30}|"
        r"who we are|we are|benefits|what we offer|perks|why join [a-z0-9 .&-]{2,30}|what'?s in it for you|how [a-z0-9 ]{2,30} supports? .*|"
        r"benefits to support your health, finances, and well-being|hiring (?:and how we work|process)|how to apply|application deadline.*|"
        r"travel|what success looks like|success factors|what this role is not|how we work.*|how you work|stay alert to recruitment fraud|"
        r"quick note on scammers|equal opportunity.*|eeo.*|see yourself at [a-z]+|[a-z]+ thinks big\. do you"))]
INLINE_PREFERRED=re.compile(r"\b(nice[- ]to[- ]have|preferred|is a plus|a plus|bonus points?|helpful,? but not required|not required|ideally|desirable)\b",re.I)
CURRENCY_CODES='USD|EUR|GBP|INR|CAD|AUD|NZD|SGD|CHF|SEK|NOK|DKK|PLN|BRL|MXN|JPY|ZAR|AED'
_NUM=r'\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:[,.]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?'  # 12,00,000 (Indian grouping) | 120,000 | 120
_CUR=r'R\$|[$€£₹¥]|zł|\b(?:%s)\b'%CURRENCY_CODES
MONEY=re.compile(r'(?P<c1>%s)?\s?(?P<a>%s)\s?(?P<k1>[kK]\b)?(?:\s?(?P<s1>%s))?(?:\s?(?:-|–|—|to)\s?(?P<c2>%s)?\s?(?P<b>%s)\s?(?P<k2>[kK]\b)?)?(?:\s?(?P<c3>%s))?'
                 %(_CUR,_NUM,_CUR,_CUR,_NUM,_CUR))
PAY_SIGNAL=re.compile(r'\b(salary (?:range|band)s?|base (?:salary|pay)|pay (?:range|band|transparency)|compensation (?:range|band)s?|OTE|on[- ]target earnings)\b',re.I)
PAY_LINE=re.compile(PAY_SIGNAL.pattern+r'|\b(salary|per annum|per year|annually|per hour|hourly|per month|compensation|pay)\b',re.I)
PERIODS=((r'per[- ]year|/\s?(?:yr|year)\b|annual(?:ly)?|per annum|yearly|\bLPA\b|year-salary','year'),
         (r'per[- ]hour|/\s?(?:hr|hour)\b|hourly','hour'),(r'per[- ]month|/\s?month\b|monthly','month'),(r'per[- ]day|/\s?day\b|daily rate','day'))
WORKPLACE_TEXT=((r'\b(?:fully remote|100% remote|this (?:role|position) is (?:fully )?remote)\b','remote'),
                (r'\b(?:hybrid (?:role|position|work(?:ing)? (?:model|arrangement|schedule))|this (?:role|position) is hybrid|\d days? (?:a|per) week in (?:the |our )?office)\b','hybrid'),
                (r'\b(?:on-?site (?:role|position)|in[- ]office (?:role|position)|this (?:role|position) is (?:on-?site|in[- ]office))\b','onsite'))
RESTRICTION=re.compile(r"\b((?:must|need to|needs to|required to|should) (?:be )?(?:located|based|reside|live|work from)|eligible to work|"
                       r"work(?:ing)? authori[sz]ation|right to work|(?:visa|immigration) sponsorship|sponsor (?:a |your )?(?:visa|work permit)|(?:only|unable to) (?:hire|consider|accept)|"
                       r"(?:candidates|applicants) (?:must be|located|based) in|time ?zones?\b|overlap with|\b(?:utc|gmt)\s?[+±-])",re.I)
TITLE_TYPE=((r'\bpart[- ]time\b','part_time'),(r'\b(?:contract|contractor|freelance)\b','contract'),(r'\bintern(?:ship)?\b','internship'),
            (r'\btemporary|fixed[- ]term\b','temporary'))
_ROLE=r'(?:role|position|job|opportunity|employment|basis|hire|contract)\b'
TEXT_TYPE=((r'\bfull[- ]time %s|\b(?:is a|for a|seeking a|hiring a) full[- ]time\b'%_ROLE,'full_time'),
           (r'\bpart[- ]time %s|\b(?:is a|for a|seeking a|hiring a) part[- ]time\b'%_ROLE,'part_time'),
           (r'\b(?:contract|contractor|freelance|fixed[- ]term) (?:role|position|basis|engagement|opportunity)\b','contract'),
           (r'\b(?:internship|intern) (?:role|position|program)\b','internship'))
def _workplace(value):
    v=re.sub(r'[^a-z]','',(value or '').lower())
    return {'remote':'remote','isremotetrue':'remote','hybrid':'hybrid','onsite':'onsite','office':'onsite','inoffice':'onsite'}.get(v)
def sections(text):
    """Splits a description at recognised heading lines. Returns [(kind, heading, [lines])], 'intro' for text before the first heading.
    Unrecognised short lines stay content, so an unfamiliar heading can extend the previous section."""
    out=[['intro',None,[]]]
    for line in (text or '').split('\n'):
        stripped=line.strip()
        if not stripped: continue
        key=_norm(stripped)
        kind=next((k for k,p in HEADINGS if len(stripped)<=90 and not stripped.endswith('.') and p.match(key)),None)
        if kind: out.append([kind,stripped,[]])
        else: out[-1][2].append(stripped)
    return [tuple(s) for s in out if s[2] or s[0]!='intro']
def _amount(num,k):
    if re.fullmatch(r'\d{1,3}(?:\.\d{3})+',num): num=num.replace('.','')  # 90.000 written with dot separators
    v=float(num.replace(',',''))
    return v*1000 if k else v
def _pay_flags(text):
    low=text.lower()
    return {'period':next((p for pattern,p in PERIODS if re.search(pattern,text,re.I)),None),
            'basis':'ote' if re.search(r'\bOTE\b|on[- ]target',text,re.I) else ('base' if re.search(r'\bbase\b',low) else 'unspecified'),
            'estimated':bool(re.search(r'\b(estimated|expected|anticipated|approximate)\b',low)),
            'variable_mentioned':bool(re.search(r'\b(commission|bonus|variable|incentive)',low)),'equity_mentioned':'equity' in low,
            'amount_unit':'lakh' if re.search(r'\bLPA\b|\blakhs?\b',text,re.I) else ('crore' if re.search(r'\bcrores?\b',low) else None)}
def parse_pay(text):
    """Reads explicit pay wording. Returns None unless at least one amount has a currency or K suffix.
    Values keep the text's own units: no currency conversion, no period conversion, '$' is not assumed to be USD."""
    ranges=[]
    for m in MONEY.finditer(text):
        cur=m.group('c1') or m.group('s1') or m.group('c2') or m.group('c3')
        if not (cur or m.group('k1') or m.group('k2')) or (not m.group('b') and not cur): continue
        a=_amount(m.group('a'),m.group('k1') or m.group('k2'))
        b=_amount(m.group('b'),m.group('k2') or m.group('k1')) if m.group('b') else a
        found=[c for c in (m.group('c3'),m.group('c2'),m.group('s1'),m.group('c1')) if c]
        code=next((c for c in found if re.fullmatch(CURRENCY_CODES,c)),None)
        ranges.append({'min':min(a,b),'max':max(a,b),'currency':code,'currency_symbol':next((c for c in found if not re.fullmatch(CURRENCY_CODES,c)),None),
                       'text':m.group(0).strip()})
    if not ranges: return None
    return {'ranges':ranges}|_pay_flags(text)|{'multiple_ranges':len(ranges)>1 or 'multiple ranges' in text.lower()}
def _structured_pay(raw):
    """Greenhouse pay_input_ranges and Lever salaryRange arrive as JSON text from the collector."""
    try: data=json.loads(raw)
    except (TypeError,ValueError): return None
    if isinstance(data,dict) and {'min','max'}<=set(data):
        interp={'ranges':[{'min':data['min'],'max':data['max'],'currency':data.get('currency'),'currency_symbol':None,'text':None}]}
        return [(interp|_pay_flags(data.get('interval') or '')|{'multiple_ranges':False},raw,'ats_field:salaryRange')]
    if isinstance(data,list):
        out=[]
        for r in data:
            if not isinstance(r,dict) or r.get('min_cents') is None: continue
            label=' '.join(x for x in (r.get('title'),r.get('blurb')) if x)
            interp={'ranges':[{'min':r['min_cents']/100,'max':(r.get('max_cents') or r['min_cents'])/100,'currency':r.get('currency_type'),
                               'currency_symbol':None,'text':None}]}|_pay_flags(label)|{'multiple_ranges':len(data)>1,'label':label or None}
            out.append((interp,json.dumps(r,ensure_ascii=False),'ats_field:pay_input_ranges'))
        return out
    return None
def _summarise(items):
    """conflicting only when two explicit interpretations differ; quotes without an interpretation never conflict."""
    return 'conflicting' if len({i['interpretation'] for i in items if i['interpretation']})>1 else 'stated'
def extract(version,source_url=None):
    """version: dict with title, locations (JSON text or list), workplace_type, description, compensation_raw,
    content_hash, first_seen_at. Returns {'state','warnings','fields':{field:{'state','items'}}}."""
    desc=version.get('description') or ''
    words=len(desc.split())
    locs=version.get('locations') or []
    if isinstance(locs,str): locs=json.loads(locs)
    items={f:[] for f in FIELDS}
    def add(field,quote,method,interpretation=None):
        quote=(quote or '').strip()
        if quote and not any(i['quote']==quote and i['interpretation']==interpretation for i in items[field]):
            items[field].append({'field':field,'source_url':source_url,'retrieved_at':version.get('first_seen_at'),'quote':quote,
                                 'interpretation':interpretation,'method':method,'schema_version':EVIDENCE_SCHEMA})
    for loc in locs:
        text=loc.get('text') if isinstance(loc,dict) else loc
        add('location',text,'ats_field:%s'%(loc.get('source') if isinstance(loc,dict) else 'location'))
        w=_workplace(text) or ('remote' if re.search(r'\bremote\b',text or '',re.I) else 'hybrid' if re.search(r'\bhybrid\b',text or '',re.I) else None)
        if w: add('workplace',text,'location_text',w)
    if version.get('workplace_type'):
        add('workplace',version['workplace_type'],'ats_field:workplace_type',_workplace(version['workplace_type']))
    for pattern,etype in TITLE_TYPE:
        if re.search(pattern,version.get('title') or '',re.I): add('employment_type',version['title'],'title',etype)
    raw=version.get('compensation_raw')
    if raw:
        structured=_structured_pay(raw)
        if structured:
            for interp,quote,method in structured: add('compensation',quote,method,interp)
        else:
            segments=[s for s in re.split(r'\s*•\s*',raw) if s.strip()]
            for segment in segments:
                pay=parse_pay(segment)
                if pay and 'multiple ranges' in raw.lower(): pay['multiple_ranges']=True
                add('compensation',segment,'ats_field:compensation',pay)
    parts=sections(desc)
    for kind,heading,lines in parts:
        body='\n'.join(lines)
        if kind=='requirements_mandatory':
            run=[]  # contiguous mandatory lines, so every quote is a verbatim span of the source
            for l in lines+[None]:
                if l is not None and not (INLINE_PREFERRED.search(l) and not re.search(r'\(required\)',l,re.I)):
                    run.append(l)
                    continue
                if run: add('requirements_mandatory','\n'.join(run),'description_section:%s'%heading)
                run=[]
                if l is not None: add('requirements_preferred',l,'inline_marker_in:%s'%heading)
        elif kind=='requirements_preferred': add('requirements_preferred',body,'description_section:%s'%heading)
        elif kind=='compensation':
            add('compensation',body,'description_section:%s'%heading,parse_pay(body))
        elif kind=='location': add('location',body,'description_section:%s'%heading)
    comp_quotes='\n'.join(i['quote'] for i in items['compensation'])
    for line in desc.split('\n'):
        line=line.strip()
        if not line: continue
        if RESTRICTION.search(line): add('location',line,'description_text')
        for pattern,w in WORKPLACE_TEXT:
            if re.search(pattern,line,re.I): add('workplace',line,'description_text',w)
        for pattern,etype in TEXT_TYPE:
            if re.search(pattern,line,re.I): add('employment_type',line,'description_text',etype)
        if line not in comp_quotes and PAY_LINE.search(line):
            pay=parse_pay(line)
            if pay: add('compensation',line,'description_text',pay)
    warnings=[]
    if not desc.strip(): warnings.append('empty_description')
    else:
        lines=[l for l in desc.split('\n') if l.strip()]
        if words<THIN_WORDS: warnings.append('thin_description')
        if len(lines)>=8 and sum(len(l.split())<4 for l in lines)/len(lines)>0.7 and words<300: warnings.append('navigation_only')
        if re.search(r'(\.\.\.|…|\bread more|\bsee more|\bshow more)\s*$',desc.strip(),re.I): warnings.append('possibly_truncated')
        if sum(bool(re.fullmatch(r'(apply( now)?|view (job|role|details)|learn more)',_norm(l))) for l in lines)>=3: warnings.append('list_captured_as_description')
        if not items['compensation'] and PAY_SIGNAL.search(desc): warnings.append('compensation_signalled_not_found')
        if words>=150 and not items['requirements_mandatory'] and not items['requirements_preferred']: warnings.append('requirements_not_sectioned')
    fields={}
    for f in FIELDS:
        if not items[f]: state='not_retrieved' if not desc.strip() else 'not_stated'
        elif f in ('workplace','employment_type'): state=_summarise(items[f])
        else: state='stated'
        fields[f]={'state':state,'items':items[f]}
    if 'empty_description' in warnings: state='failed'
    elif {'thin_description','navigation_only'}&set(warnings): state='thin'
    elif warnings: state='uncertain'
    else: state='ok'
    return {'extractor_version':EXTRACTOR_VERSION,'state':state,'warnings':warnings,'description_words':words,'fields':fields}
