"""Evidence-preserving offline eligibility checks. Never declares READY."""
from dataclasses import dataclass
import re
from candidate_match import role_match

@dataclass(frozen=True)
class Decision:
    status:str
    reasons:tuple[str,...]
    evidence:dict

def triage(job,candidate='farhan',minimum_fixed_annual_inr=None):
    if candidate not in ('farhan','sana'):raise ValueError('unknown candidate')
    title=str(job.get('title') or '');desc=str(job.get('description') or '');loc=str(job.get('location') or '')
    lower=desc.lower();location=loc.lower();reasons=[];blocks=[]
    score,family,role_reason=role_match(job,candidate)
    evidence={'title':title,'location':loc,'role_family':family,'role_reason':role_reason,'excerpts':[]}
    if not title or not str(job.get('url') or '').startswith('https://'):blocks.append('missing title or HTTPS posting URL')
    if len(desc.split())<80:reasons.append('full job description not established')
    if family=='outside target':blocks.append('excluded role family')
    if re.search(r'\b(no longer accepting applications|position (has been |is )?filled|this (job|position) is closed)\b',lower):blocks.append('posting contains a closed-vacancy notice')
    sentences=[s.strip() for s in re.split(r'(?<=[.!?])\s+|\n',lower) if s.strip()]
    hiring=[s for s in sentences if not re.search(r'\b(salary|compensation|pay range)\b',s) or re.search(r'\b(applicants?|candidates?) (must|need|are required)',s)]
    auth=next((s for s in hiring if re.search(r'(authorized|authorised|eligible|able|right) to work in (the )?(us\b|united states|canada|uk\b|united kingdom|europe|australia)',s)),None)
    explicit=next((s for s in hiring if re.search(r'\b(us only|united states only|must reside in the us|europe only)\b',s)),None)
    india=bool(re.search(r'\bindia\b',location))
    india_statement=re.search(r'location\s*[:\-]\s*[^.\n]{0,100}\bindia\b|(?:this (?:role|position) is|remote)\s+(?:based )?(?:in|within|across)\s+india\b',lower)
    if india_statement:
        india=True;evidence['excerpts'].append({'field':'india','text':india_statement.group(0)})
    if auth and india:reasons.append('conflicting location and foreign work authorization; manual resolution required')
    global_scope=bool(re.search(r'\b(worldwide|anywhere in the world|global remote)\b',location))
    foreign=bool(re.search(r'\b(united states|usa|us|canada|europe|emea|united kingdom|uk|australia|singapore|netherlands|germany|france|norway|mexico)\b',location))
    if (auth or explicit) and not india:
        evidence['excerpts'].append({'field':'work_authorization','text':(auth or explicit)[:700]})
        if candidate=='farhan':blocks.append('explicit geography exclusion')
        else:reasons.append('foreign work authorization required; not established for candidate')
    if re.search(r'\b(us only|united states only|europe only)\b',location):blocks.append('explicit geography exclusion')
    if foreign and not india and not global_scope:
        if candidate=='farhan':blocks.append('posting location excludes India')
        else:reasons.append('overseas relocation and work authorization not established')
    remote=bool(re.search(r'\b(remote|work from home|distributed)\b',location))
    role_remote=next((s for s in sentences if re.search(r'(this (position|role)|work (model|location)|location:)\b',s) and re.search(r'\b(remote|work from home)\b',s)),None)
    if role_remote:
        remote=True;evidence['excerpts'].append({'field':'remote','text':role_remote[:700]})
    hybrid=bool(re.search(r'\b(hybrid|on[ -]?site)\b',location))
    if candidate=='farhan':
        if hybrid:blocks.append('onsite or hybrid arrangement conflicts with fully remote requirement')
        if not india:reasons.append('India work eligibility not affirmatively established')
        if not remote:reasons.append('remote arrangement not affirmatively established')
        reasons.extend(['compensation threshold not independently verified','candidate experience and actual JD require recruiter review'])
    else:
        if not india and not global_scope:reasons.append('India hiring or supported relocation not established')
        if re.search(r'\b(on[ -]?site|field|shift)\b',location+' '+title.lower()):reasons.append('site load, shifts and office/hybrid preference require review')
        reasons.append('technical fit, work authorization and compensation require recruiter review')
    pay=re.search(r'(?:fixed (?:annual )?(?:salary|pay)[ :]+(?:inr|rs\.?|₹)\s*)([\d,]+)\s*(?:per year|p\.?a\.?|annually)',lower)
    if pay:
        evidence['fixed_annual_inr']=int(pay.group(1).replace(',',''))
        if minimum_fixed_annual_inr and evidence['fixed_annual_inr']<minimum_fixed_annual_inr:blocks.append('explicit fixed INR salary below supplied minimum')
    gaps=[]
    high_years=[int(m.group(1)) for s in sentences if not re.search(r'\b(company|founded|established|combined)\b',s) for m in re.finditer(r'\b(\d{1,2})\s*\+?\s*years?\b.{0,80}\bexperience\b',s)]
    if high_years and max(high_years)>=12:gaps.append('requires '+str(max(high_years))+' years of specialist experience; exceeds documented candidate scope')
    if candidate=='farhan':
        if re.search(r'\b(director|head of|vice president|vp)\b',title.lower()):gaps.append('leadership seniority exceeds verified candidate scope; recruiter review required')
        if any(re.search(r'\b(certification|certified)\b',s) and re.search(r'\b(required|mandatory)\b',s) and not re.search(r'\b(preferred|not required|nice to have)\b',s) for s in sentences):gaps.append('mandatory certification must be checked against candidate evidence')
        if 'epm' in lower and re.search(r'(expertise|experience).{0,70}(required|must)',lower):gaps.append('specialist EPM experience requires verification')
        if re.search(r'\b(ansi x12|edifact)\b',lower):gaps.append('specialist EDI standards experience not established')
        if any('sql' in s and re.search(r'\b(advanced|proficien\w*|strong)\b',s) and not re.search(r'\b(preferred|plus|not required)\b',s) for line in sentences for s in re.split(';',line)):gaps.append('advanced SQL requirement not established by candidate evidence')
        if 'product solution engineer' in title.lower() and 'technical support' in lower:gaps.append('primary technical-support work requires candidate preference review')
    else:
        if re.search(r'\b(layout|bim|designer|design engineer|piping|high voltage|substation|hv primary|hv secondary|automation engineer)\b',title.lower()):gaps.append('specialist design/modelling experience not established; qualification review required')
        for tool in ('sap','cmms','autocad','matlab','etap','revit','amtech','dialux','aspen','unisim','htri'):
            if any(re.search(r'\b'+tool+r'\b',s) and re.search(r'\b(required|must|proficien\w*|expertise)',s) and not re.search(r'\b(preferred|nice to have|not required)\b',s) for s in sentences):gaps.append(tool.upper()+' requirement exceeds documented tool evidence')
    reasons.extend(gaps)
    evidence.update({'india_location':india,'remote_advertised':remote,'geography_conflict':bool(foreign and not india and not global_scope),'qualification_gaps':gaps})
    evidence['shortlist_eligible']=not blocks and len(desc.split())>=80 and score>=4 and (india or global_scope) and (candidate=='sana' or remote) and not gaps and family in ('target','adjacent') and not auth
    return Decision('REJECT' if blocks else 'HOLD',tuple(dict.fromkeys(blocks+reasons)),evidence)
