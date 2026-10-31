"""Discovery relevance only: a routing priority, never an exclusion and never evidence of qualification.

As in engine/gates.py relevance: a job outside the target families is not rejected, it is routed below the review
queue. Hard exclusions (geography, arrangement, documented candidate rules) live in recruiter_triage.py.
"""
import re

# Specialist professions a title alone identifies as outside the candidate's discovery strategy.
FARHAN_OUTSIDE=(r'\b(software|backend|frontend|full ?stack|sde|developer|devops|site reliability|sre|security|infrastructure|'
                r'data engineer|data scientist|machine learning|ml engineer|research engineer|staff engineer|principal engineer|'
                r'engineering manager|mechanical|electrical|industrial|energy|assembly|manufacturing|csv|equipment|commissioning|'
                r'validation|process engineer|gmp|marketing|designer|design manager|recruit|talent|finance|fp&a|payroll|billing|'
                r'accountant|legal|counsel|people operations|benefits|communications|chargeback|data analyst|product analyst|'
                r'solutions? architect|field cto|content developer)\b')
# Product titles are adjacent only when the product itself is automation, integration, CRM or AI work.
FARHAN_PRODUCT_SCOPE=r'\b(ai|automation|workflow|integrations?|api|webhooks?|crm|marketing os|lead ?gen|email marketing|voice ai|ask ai)\b'
SANA_OUTSIDE=(r'\b(software|site reliability|database|sre|dbre|devops|cloud|network|infrastructure|data engineer|data scientist|platform engineer|'
              r'backend|frontend|developer|sde|support engineer|sales|account executive|business development|recruiter|marketing|'
              r'marketer|clickhouse|field cto|qa intern|quality assurance engineering)\b')
SANA_PHARMA=r'\b(pharma\w*|bioprocess|gmp|batch record|qualification validation|cqv engineer)\b'

def role_match(job,candidate):
    """(priority score 0-10, family target|adjacent|outside target, reason). Title-led with description context."""
    if candidate not in ('farhan','sana'):raise ValueError('unknown candidate')
    title=str(job.get('title') or '').lower();description=str(job.get('description') or '').lower()
    has=lambda pattern:bool(re.search(pattern,title))
    if candidate=='farhan':
        if has(r'\b(implementation|onboarding)\b'):
            if has(r'forms') or '1 year of data entry' in description:return 5,'adjacent','implementation of forms/data entry; scope and seniority need review'
            return 10,'target','implementation and onboarding delivery'
        if has(r'\b(product (?:manager|owner|lead)|group product manager)\b') and not has(r'\bproduct marketing\b'):
            if has(FARHAN_PRODUCT_SCOPE) or re.search(r'\b(workflow automation|webhooks?|crm integrations?|apis?, (?:integrations|webhooks))\b',description[:6000]):
                return 6,'adjacent','technical product ownership of automation/integration/CRM/AI products'
            return 0,'outside target','general product management outside the automation/integration/AI scope'
        # A specialist profession in the title outranks CRM/automation keywords ('Software Development Engineer - CRM').
        if has(FARHAN_OUTSIDE):return 0,'outside target','specialist profession outside business-systems delivery'
        if has(r'\b(crm|salesforce admin\w*|hubspot|highlevel|business systems|revenue operations|revops|gtm operations|'
               r'technical operations|integration platform|netsuite systems|automation (?:analyst|specialist)|workflow|enablement)\b'):
            return 9,'target','CRM, business systems, revenue/technical operations or automation'
        if has(r'\b(integration|integrations|automation)\b') and has(r'\b(engineer|specialist|consultant|analyst)\b'):
            return 8,'target','integration and automation delivery; coding depth needs review'
        if has(r'\b(project manager|program manager|programme manager|technical program|delivery manager|business analyst|'
               r'professional services|solutions? consultant|technical delivery|business operations|service delivery|qa\b|quality assurance|uat)\b'):
            return 6,'adjacent','delivery coordination, analysis, QA or professional services'
        if has(r'\b(customer success)\b') and has(r'\b(architect|onboarding|implementation)\b'):
            return 4,'adjacent','post-sales delivery; may be support- or sales-heavy'
    else:
        if has(SANA_OUTSIDE):return 0,'outside target','software or commercial profession outside industrial engineering'
        if has(r'\b(energy efficiency|decarboni[sz]ation|energy transition|energy consultant|energy analyst|technical advis\w+|asset performance)\b'):
            return 10,'target','energy improvement, research or advisory'
        if has(r'\b(reliability|maintenance|power plant|thermal|utilities|electrical)\b'):
            return 8,'target','electrical, reliability, maintenance or utilities experience transfers'
        if has(SANA_PHARMA) or (has(r'\b(process|c&q|commissioning (?:&|and) qualification)\b')
                and re.search(r'\b(bioprocess|bioreactors?|biopharm\w*|chromatography|upstream and downstream)\b',description)):
            return 0,'outside target','pharmaceutical process/validation specialism'
        if has(r'\bcommissioning\b|\(cx\)'):return 7,'adjacent','commissioning of physical systems; discipline and site load need review'
        if has(r'\b(project)\b') and not has(r'\b(mechanical|electrical|energy|process)\b'):
            return 0,'outside target','generic project title does not establish physical engineering scope'
        if has(r'\b(mechanical|energy|process|field engineer|technician)\b') and has(r'\b(engineer|engineering|manager|consultant|analyst|technician)\b'):
            return 5,'adjacent','engineering/project transition; specialist tools and site load need review'
    return 0,'outside target','no role-specific target evidence in title'
