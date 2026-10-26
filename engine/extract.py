"""Deterministic extraction of evidence from one stored posting version. No network, no LLM.

Every item quotes the source text it came from. interpretation is filled only when the wording is explicit
(a parsed pay range, a workplace keyword); otherwise it is None and later stages must read the quote.
Field states: stated, not_stated, conflicting (explicit statements disagree), not_retrieved (no text to read).
Nothing here decides fit, eligibility or READY.
"""
import html,json,re
# 2: 'advantage'/'beneficial' wording is preferred; 'this role is based in X' is a location statement
# 3: Ashby compensationTiers parsed per tier and component; Greenhouse pay labels converted from HTML to text
EXTRACTOR_VERSION=4  # 4: K/M/B suffixes, coded dollars (US$, CA$...), '/hr' between range amounts, company figures are not pay; 3: Ashby tiers
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
INLINE_PREFERRED=re.compile(r"\b(nice[- ]to[- ]have|preferred|is a plus|a plus|bonus points?|helpful,? but not required|not required|ideally|desirable|(?:an?|distinct|big|strong) advantage|advantageous|beneficial)\b",re.I)
CURRENCY_CODES='USD|EUR|GBP|INR|CAD|AUD|NZD|SGD|HKD|CHF|SEK|NOK|DKK|PLN|BRL|MXN|JPY|ZAR|AED'
# Dollar signs that name their currency. A bare '$' names none and stays currency-unknown.
CODED_DOLLARS={'US$':'USD','CA$':'CAD','C$':'CAD','A$':'AUD','AU$':'AUD','NZ$':'NZD','HK$':'HKD','S$':'SGD'}
_NUM=r'\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:[,.]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?'  # 12,00,000 (Indian grouping) | 120,000 | 120
_CUR=r'\b(?:US|CA|AU|NZ|HK)\$|\b[CAS]\$|R\$|[$€£₹¥]|zł|\b(?:%s)\b'%CURRENCY_CODES
_MULT=r'[kK]\b|(?:M|mn|[Mm]illion|B|bn|[Bb]illion)\b'  # thousand, million, billion
_UNIT=r'\s?/\s?(?:hr|hour|yr|year|annum|mo|month|wk|week|day)\b'  # '$30.09/hr - $37.61/hr': a unit between the amounts keeps one range
MONEY=re.compile(r'(?P<c1>%s)?\s?(?P<a>%s)\s?(?P<k1>%s)?(?:\s?(?P<s1>%s))?(?:%s)?(?:\s?(?:-|–|—|to)\s?(?P<c2>%s)?\s?(?P<b>%s)\s?(?P<k2>%s)?)?(?:\s?(?P<c3>%s))?'
                 %(_CUR,_NUM,_MULT,_CUR,_UNIT,_CUR,_NUM,_MULT,_CUR))
# A figure about the company (revenue, funding, valuation, size), not pay. Applied per sentence and only when the same
# sentence has no pay wording, so real compensation written in millions ('JPY 6M - 8M per year base salary') is kept.
COMPANY_FIGURE=re.compile(r'\b(revenue|revenues|ARR|recurring revenue|funding|funded|raised|raise|series [a-h]\b|valuation|valued|investors?|'
                          r'backed|market cap|turnover|sales|GMV|assets under management|AUM|customers|users|in (?:annual )?(?:sales|bookings)|'
                          r'generates?|generated|processes|processed|transactions?|payments volume|donations?|grants?)\b',re.I)
PAY_CONTEXT=re.compile(r'\b(salary|salaries|base pay|pay (?:range|band|is)|compensation|wage|stipend|OTE|on[- ]target|per (?:year|annum|hour|month)|'
                       r'hourly|annual (?:base|salary|pay)|bonus|commission|equity|offer)\b',re.I)
_SENTENCE=re.compile(r'(?<=[.!?;])\s+(?=[A-Z])|\n')
PAY_SIGNAL=re.compile(r'\b(salary (?:range|band)s?|base (?:salary|pay)|pay (?:range|band|transparency)|compensation (?:range|band)s?|OTE|on[- ]target earnings)\b',re.I)
PAY_LINE=re.compile(PAY_SIGNAL.pattern+r'|\b(salary|per annum|per year|annually|per hour|hourly|per month|compensation|pay)\b',re.I)
PERIODS=((r'per[- ]year|/\s?(?:yr|year)\b|annual(?:ly)?|per annum|yearly|\bLPA\b|year-salary','year'),
         (r'per[- ]hour|/\s?(?:hr|hour)\b|hourly','hour'),(r'per[- ]month|/\s?month\b|monthly','month'),(r'per[- ]day|/\s?day\b|daily rate','day'))
WORKPLACE_TEXT=((r'\b(?:fully remote|100% remote|this (?:role|position) is (?:fully )?remote)\b','remote'),
                (r'\b(?:hybrid (?:role|position|work(?:ing)? (?:model|arrangement|schedule))|this (?:role|position) is hybrid|\d days? (?:a|per) week in (?:the |our )?office)\b','hybrid'),
                (r'\b(?:on-?site (?:role|position)|in[- ]office (?:role|position)|this (?:role|position) is (?:on-?site|in[- ]office))\b','onsite'))
RESTRICTION=re.compile(r"\b((?:must|need to|needs to|required to|should) (?:be )?(?:located|based|reside|live|work from)|eligible to work|"
                       r"(?:role|position|job|you) (?:is|are|will be) (?:remote(?:ly)?,? (?:and )?)?(?:based|located) in|"
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
    if not k: return v
    return v*(1000 if k in ('k','K') else 1_000_000_000 if k in ('B','bn','billion','Billion') else 1_000_000)
def _sentence_at(text,pos):
    start=0
    for m in _SENTENCE.finditer(text):
        if m.start()>=pos: return text[start:m.start()]
        start=m.end()
    return text[start:]
def _pay_flags(text):
    low=text.lower()
    return {'period':next((p for pattern,p in PERIODS if re.search(pattern,text,re.I)),None),
            'basis':'ote' if re.search(r'\bOTE\b|on[- ]target',text,re.I) else ('base' if re.search(r'\bbase\b',low) else 'unspecified'),
            'estimated':bool(re.search(r'\b(estimated|expected|anticipated|approximate)\b',low)),
            'variable_mentioned':bool(re.search(r'\b(commission|bonus|variable|incentive)',low)),'equity_mentioned':'equity' in low,
            'amount_unit':'lakh' if re.search(r'\bLPA\b|\blakhs?\b',text,re.I) else ('crore' if re.search(r'\bcrores?\b',low) else None)}
def parse_pay(text):
    """Reads explicit pay wording. Returns None unless at least one amount has a currency or K suffix.
    Values keep the text's own units: no currency conversion, no period conversion, '$' is not assumed to be USD.
    K, M (million) and B (billion) suffixes are read as written. 'US$', 'CA$', 'A$' and similar name their currency.
    An amount in a sentence about the company (revenue, funding, valuation, size) with no pay wording is not pay."""
    ranges=[]
    for m in MONEY.finditer(text):
        cur=m.group('c1') or m.group('s1') or m.group('c2') or m.group('c3')
        if not (cur or m.group('k1') or m.group('k2')) or (not m.group('b') and not cur): continue
        sentence=_sentence_at(text,m.start())
        if COMPANY_FIGURE.search(sentence) and not PAY_CONTEXT.search(sentence): continue  # revenue, funding, valuation: not pay
        a=_amount(m.group('a'),m.group('k1') or m.group('k2'))
        b=_amount(m.group('b'),m.group('k2') or m.group('k1')) if m.group('b') else a
        found=[c for c in (m.group('c3'),m.group('c2'),m.group('s1'),m.group('c1')) if c]
        code=next((c for c in found if re.fullmatch(CURRENCY_CODES,c)),None) or next((CODED_DOLLARS[c] for c in found if c in CODED_DOLLARS),None)
        ranges.append({'min':min(a,b),'max':max(a,b),'currency':code,
                       'currency_symbol':next((c for c in found if not re.fullmatch(CURRENCY_CODES,c)),None),'text':m.group(0).strip()})
    if not ranges: return None
    return {'ranges':ranges}|_pay_flags(text)|{'multiple_ranges':len(ranges)>1 or 'multiple ranges' in text.lower()}
ASHBY_INTERVALS={'1 YEAR':'year','1 MONTH':'month','1 WEEK':'week','1 DAY':'day','1 HOUR':'hour'}
ASHBY_BASIS={'Salary':'base','Bonus':'variable','Commission':'variable','EquityCashValue':'equity','EquityPercentage':'equity'}
def _text(fragment):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>',' ',fragment or '')).split())
def _ashby_tiers(data):
    """One item per tier component, exactly as Ashby states it. Currency only from currencyCode (never from '$'),
    period only from interval ('NONE' or an unknown interval is not stated), basis from compensationType.
    minValue and maxValue are kept independently: a missing bound stays None and is never copied from the other, so a
    one-sided figure is open-ended ('at least' or 'up to'), never an exact amount. Both null give no range.
    Published values are never swapped or reordered. The quote is the component's own JSON as it appears in compensation_raw.
    A tier's additional_information is quoted verbatim with no interpretation."""
    tiers=data.get('tiers') or []
    out=[]
    for tier in tiers:
        for c in tier.get('components') or []:
            low,high=c.get('minValue'),c.get('maxValue')
            kind=c.get('compensationType')
            interp={'ranges':[{'min':low,'max':high,'currency':c.get('currencyCode'),'currency_symbol':None,'text':c.get('summary')}]
                             if low is not None or high is not None else [],
                    'period':ASHBY_INTERVALS.get(c.get('interval')),'interval_raw':c.get('interval'),
                    'basis':ASHBY_BASIS.get(kind,'unspecified'),'component_type':kind,'estimated':False,
                    'variable_mentioned':kind in ('Bonus','Commission'),'equity_mentioned':(kind or '').startswith('Equity'),
                    'amount_unit':'percent' if kind=='EquityPercentage' else None,'multiple_ranges':len(tiers)>1,'label':tier.get('title')}
            out.append((interp,json.dumps(c,ensure_ascii=False,separators=(',',':')),'ats_field:compensationTiers'))
        if tier.get('additional_information'):  # free text such as 'Estimated OTE: 65K-80K USD': quoted, never parsed into amounts
            out.append((None,tier['additional_information'],'ats_field:compensationTiers.additional_information'))
    return out
def _structured_pay(raw):
    """Greenhouse pay_input_ranges, Lever salaryRange and Ashby compensationTiers arrive as JSON text from the collector."""
    try: data=json.loads(raw)
    except (TypeError,ValueError): return None
    if isinstance(data,dict) and data.get('source')=='ashby.compensationTiers': return _ashby_tiers(data)
    if isinstance(data,dict) and {'min','max'}<=set(data):
        bounded=data['min'] is not None or data['max'] is not None  # each bound kept as published; never filled from the other
        interp={'ranges':[{'min':data['min'],'max':data['max'],'currency':data.get('currency'),'currency_symbol':None,'text':None}] if bounded else []}
        return [(interp|_pay_flags(data.get('interval') or '')|{'multiple_ranges':False},raw,'ats_field:salaryRange')]
    if isinstance(data,list):
        out=[]
        for r in data:
            if not isinstance(r,dict) or (r.get('min_cents') is None and r.get('max_cents') is None): continue
            label=' '.join(x for x in (_text(r.get('title')),_text(r.get('blurb'))) if x)
            cents=lambda k: None if r.get(k) is None else r[k]/100  # a missing bound stays None, never copied from the other
            interp={'ranges':[{'min':cents('min_cents'),'max':cents('max_cents'),'currency':r.get('currency_type'),
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
