"""Public title and location signals for source rotation and review ordering. Generic tags only.

These are keyword observations about public text, never candidate fit or eligibility: a "strong" title signal
means the title names concrete delivery/engineering work in a tracked family, nothing more. Private matching,
effort allocation and decisions stay in the private Sheet review.
"""
import re

FAMILIES = {
    'crm-implementation': r'implementation|onboarding|\bCRM\b|go ?high ?level|highlevel|hubspot|salesforce|zoho|dynamics 365|'
                          r'workflow|webhook|\bAPI\b|integration|\bUAT\b|\bQA\b|quality assurance|solutions? consultant',
    'business-systems-automation': r'business systems|technical operations|automation|rev ?ops|revenue operations|'
                                   r'systems analyst|no-?code|zapier|\bn8n\b|make\.com',
    'ai-implementation': r'\bAI\b.*(?:implementation|solutions|deployment|product)|technical product (?:owner|manager)|forward deployed',
    'power-utilities-energy': r'energy|\bpower\b|utilit|decarboni|sustainab|efficiency|demand response|\bgrid\b|transmission|'
                              r'substation|renewable|solar|\bwind\b|battery|\bBESS\b|net zero|\bESCO\b',
    'asset-reliability-maintenance': r'reliab|\basset|maintenance|commission|electrical|\bplant\b|industrial|\bO&M\b|'
                                     r'condition monitoring|planner|field service|turbine|transformer|switchgear|\bHVAC\b',
    'delivery-coordination': r'project (?:manager|engineer|coordinator|lead)|delivery|program(?:me)? manager|coordinator|\bPMO\b',
}
SUPPORT_FIRST = r'help ?desk|technical support|customer support|support (?:specialist|engineer|agent|representative|associate)|service desk|call cent'
SALES = (r'\bsales\b|account executive|business development|\bBDR\b|\bSDR\b|account manager|partnerships? (?:manager|director|lead)|'
         r'\bmarketing\b|growth manager|demand generation|recruit')
SPECIALIST_SOFTWARE = (r'software (?:engineer|developer)|\bdeveloper\b|back ?end|front ?end|full ?stack|site reliability|\bSRE\b|devops|'
                       r'data (?:engineer|scientist)|machine learning|\bML\b|security engineer|platform engineer|database|'
                       r'cloud (?:engineer|architect)|staff engineer|principal engineer|engineering manager|'
                       r'test (?:engineer|specialist)|\btester\b|automation test|test automation|QA automation|automation QA|'
                       r'\bpython\b|\bjava\b|C#|C\+\+|\.net\b|forward deployed engineer|\bAI engineer|automation engineer|automation developer')
# A named language or test-automation role stays specialist even when it says implementation.
LANGUAGE_OR_TEST = r'software development engineer|\bSDET\b|development engineer in test|\bpython\b|\bjava\b|C#|C\+\+|\.net\b|test (?:engineer|specialist)|\btester\b|automation test|test automation|QA automation|automation QA'
SOFTWARE_RELIABILITY = r'site reliability|database reliability|reliability engineer.*(?:cloud|platform|infrastructure|database)|\bSRE\b'
NOT_COMMISSIONING = r'commission (?:analyst|plan|specialist)|sales commission'
ROLE_NOUN = (r'implementation|onboarding|consultant|specialist|administrator|analyst|coordinator|planner|engineer|'
             r'manager|lead|advisor|architect|owner|technician|supervisor|executive engineer')

def title_signal(title):
    """{'families', 'strength': strong|weak|excluded|none, 'notes'}; keyword evidence only."""
    t = title or ''
    fams = [k for k, p in FAMILIES.items() if re.search(p, t, re.I)]
    notes = []
    if 'asset-reliability-maintenance' in fams and (re.search(SOFTWARE_RELIABILITY, t, re.I) or re.search(NOT_COMMISSIONING, t, re.I)):
        fams.remove('asset-reliability-maintenance'); notes.append('software reliability or sales commission, not asset work')
    if not fams: return {'families': [], 'strength': 'none', 'notes': notes}
    if re.search(SUPPORT_FIRST, t, re.I):
        return {'families': fams, 'strength': 'excluded', 'notes': notes + ['support-first title']}
    if re.search(SALES, t, re.I):
        return {'families': fams, 'strength': 'excluded', 'notes': notes + ['sales/marketing title; family words do not make it delivery work']}
    if re.search(LANGUAGE_OR_TEST, t, re.I) or (re.search(SPECIALIST_SOFTWARE, t, re.I)
            and not re.search(r'implementation|onboarding|integration consultant|solutions consultant', t, re.I)):
        return {'families': fams, 'strength': 'weak', 'notes': notes + ['specialist software title']}
    if not re.search(ROLE_NOUN, t, re.I):
        return {'families': fams, 'strength': 'weak', 'notes': notes + ['no concrete role noun']}
    return {'families': fams, 'strength': 'strong', 'notes': notes + ['title keywords only; fit not assessed']}

INDIA = (r'\bindia\b|bengaluru|bangalore|\bpune\b|mumbai|hyderabad|chennai|delhi|gurgaon|gurugram|noida|kolkata|ahmedabad|'
         r'vadodara|jaipur|kochi|coimbatore|nagpur|indore|chandigarh|bhubaneswar|lucknow|visakhapatnam|thiruvananthapuram|mysuru|mysore')
REGION_ONLY = r'remote|worldwide|anywhere|global|\bAPAC\b|asia|\bEMEA\b|international|no location restriction'

def geography(locations):
    """Location evidence class from original wording. 'india_explicit' names India or an Indian city; region/remote
    wording alone (APAC, worldwide) is 'remote_or_region_only' and is never India eligibility."""
    texts = [str(l.get('text') or '') for l in (locations or []) if isinstance(l, dict)]
    joined = ' | '.join(texts)
    if not joined.strip(): return {'class': 'unstated', 'india_terms': []}
    terms = sorted({m.group(0).lower() for m in re.finditer(INDIA, joined, re.I)})
    if terms: return {'class': 'india_explicit', 'india_terms': terms}
    if all(re.search(REGION_ONLY, t, re.I) for t in texts if t.strip()): return {'class': 'remote_or_region_only', 'india_terms': []}
    return {'class': 'other_locations', 'india_terms': []}
