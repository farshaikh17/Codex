"""Role-specific discovery priority; never changes eligibility evidence."""
from candidate_match import role_match

def rank(job,candidate):
    score,family,reason=role_match(job,candidate)
    return {'priority_score':score,'priority_band':'high' if score>=8 else 'medium' if score>=4 else 'low',
            'priority_only':True,'role_family':family,'role_reason':reason}
