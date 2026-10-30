"""Conservative offline triage for job records. Never declares READY without human review."""
from dataclasses import dataclass
import re

@dataclass(frozen=True)
class Decision:
    status: str
    reasons: tuple[str, ...]
    evidence: dict

def triage(job: dict, candidate: str = 'farhan') -> Decision:
    if candidate not in {'farhan', 'sana'}:
        raise ValueError('unknown candidate')
    title = str(job.get('title') or '')
    description = str(job.get('description') or '')
    location = str(job.get('location') or '')
    url = str(job.get('url') or '')
    reasons = []
    if not title or not url.startswith('https://'):
        reasons.append('missing title or HTTPS posting URL')
    if len(description.split()) < 80:
        reasons.append('full job description not established')
    if candidate == 'farhan':
        if re.search(r'\b(devops|site reliability engineer|machine learning engineer|accountant|sales development representative|helpdesk)\b', title.lower()):
            return Decision('REJECT', ('excluded role family',), {'title': title, 'location': location})
        if re.search(r'\b(us only|united states only|must reside in the us|europe only)\b', f'{location} {description}'.lower()):
            return Decision('REJECT', ('explicit geography exclusion',), {'title': title, 'location': location})
        if not re.search(r'\bindia\b', location.lower()):
            reasons.append('India work eligibility not affirmatively established')
        if not re.search(r'\b(remote|work from home|distributed)\b', location.lower()):
            reasons.append('remote arrangement not affirmatively established')
        reasons.append('compensation threshold not independently verified')
        reasons.append('candidate experience and actual JD require recruiter review')
    else:
        reasons.append('technical fit, work authorization and compensation require recruiter review')
    return Decision('HOLD', tuple(dict.fromkeys(reasons)), {'title': title, 'location': location})
