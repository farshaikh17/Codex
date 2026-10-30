"""Discovery role families only. No claims of verified qualifications."""
import re

def role_match(job,candidate):
    if candidate not in ('farhan','sana'):raise ValueError('unknown candidate')
    title=str(job.get('title') or '').lower();description=str(job.get('description') or '').lower()
    def has(pattern):return bool(re.search(pattern,title))
    if candidate=='farhan':
        if has(r'\b(software|backend|frontend|sde|devops|site reliability|security|infrastructure|data engineer|data scientist|staff engineer|principal engineer|engineering manager|mechanical|electrical|industrial|energy|assembly|manufacturing|csv|equipment|commissioning)\b'):
            return 0,'outside target','engineering specialty outside business-systems delivery'
        if has(r'\b(product manager|product management|sales development|account executive|recruiter|talent|renewals|marketing|customer support|customer success|finance|fp&a|helpdesk)\b'):
            return 0,'outside target','different primary profession'
        if has(r'\b(implementation|onboarding)\b'):
            if has(r'forms') or '1 year of data entry' in description:return 2,'adjacent','forms/data-entry implementation rather than systems ownership'
            return 10,'target','implementation and onboarding delivery'
        if has(r'\b(business systems|revenue operations|technical operations|crm|salesforce administrator|integration platform|netsuite systems|automation analyst|workflow)\b'):
            return 9,'target','business systems and process automation'
        if has(r'\b(integration|integrations|automation)\b') and has(r'\b(engineer|specialist|consultant|analyst)\b'):
            return 8,'target','integration and automation delivery; coding depth needs review'
        if has(r'\b(solutions? consultant|solutions? architect|technical delivery|professional services|solutions? engineer|business operations)\b'):
            return 5,'adjacent','consulting or delivery; domain and seniority need review'
    else:
        if has(r'\b(software|site reliability|database|sre|dbre|devops|cloud|network|infrastructure reliability|data engineer|data scientist|backend|frontend|support engineer|sales|account executive|business development|recruiter|marketing)\b'):
            return 0,'outside target','software or commercial profession outside industrial engineering'
        if has(r'\b(energy efficiency|decarboni[sz]ation|energy transition|energy consultant|energy analyst|technical advisor|technical advisory|asset performance)\b'):
            return 10,'target','energy improvement, research or advisory'
        if has(r'\b(reliability|maintenance|power plant|thermal|utilities)\b'):
            return 8,'target','transferable physical plant and equipment experience'
        if has(r'\b(project)\b') and not has(r'\b(commissioning|mechanical|electrical|energy|process)\b'):
            return 0,'outside target','generic project title does not establish physical engineering scope'
        if has(r'\b(commissioning|mechanical|electrical|energy|process)\b') and has(r'\b(engineer|engineering|manager|consultant|analyst)\b'):
            return 5,'adjacent','engineering/project transition; specialist tools and site load need review'
    return 0,'outside target','no role-specific target evidence in title'
