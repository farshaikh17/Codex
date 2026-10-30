"""Deterministic shortlist priority; never substitutes for eligibility verification."""
import re

FARHAN_POSITIVE = (
    (r'\b(crm|highlevel|gohighlevel|salesforce|hubspot)\b', 5),
    (r'\b(implementation|integrations?|automation|workflow|business systems|technical operations)\b', 4),
    (r'\b(operations|solutions|delivery|onboarding|platform|systems)\b', 2),
)
SANA_POSITIVE = (
    (r'\b(power plant|thermal power|industrial maintenance|reliability|asset performance)\b', 5),
    (r'\b(energy efficiency|decarboni[sz]ation|energy transition|utilities|renewable energy)\b', 4),
    (r'\b(mechanical|electrical|maintenance|energy|technical consultant)\b', 2),
)
FARHAN_NEGATIVE = r'\b(affiliate|sales|account executive|customer support|customer success|recruiter|marketing|finance|security engineer|backend engineer|frontend engineer)\b'
SANA_NEGATIVE = r'\b(software engineer|devops|cloud engineer|sales|marketing|account executive|customer support)\b'

def rank(job, candidate):
    if candidate not in ('farhan','sana'):
        raise ValueError('unknown candidate')
    title = str(job.get('title') or '').lower()
    description = str(job.get('description') or '').lower()
    positive = FARHAN_POSITIVE if candidate == 'farhan' else SANA_POSITIVE
    negative = FARHAN_NEGATIVE if candidate == 'farhan' else SANA_NEGATIVE
    score = sum(weight for pattern,weight in positive if re.search(pattern,title))
    if re.search(negative,title):
        score -= 8
    score += min(2,sum(1 for pattern,_ in positive if re.search(pattern,description)))
    return {'priority_score':score, 'priority_band':'high' if score>=6 else 'medium' if score>=3 else 'low',
            'priority_only':True}
