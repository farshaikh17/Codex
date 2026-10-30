"""Exact URL identity and separate same-employer/title review groups.

Same-title requisitions are grouped, not declared duplicate vacancies. Variants
retain their own evidence and eligibility; never union regional eligibility.
"""
import re
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode

def canonical_url(url):
    p=urlsplit(str(url or ''));host=p.netloc.lower()
    if host in ('boards.greenhouse.io','job-boards.greenhouse.io'):host='job-boards.greenhouse.io'
    path=p.path.rstrip('/')
    if host=='jobs.lever.co' and path.endswith('/apply'):path=path[:-6]
    query=urlencode(sorted((k,v) for k,v in parse_qsl(p.query) if not (k.lower().startswith('utm_') or k.lower() in ('gh_src','source','ref','lever-source'))))
    return urlunsplit((p.scheme.lower(),host,path,query,''))

def group_results(items):
    exact={};groups={};duplicates=0
    for item in items:
        identity=canonical_url(item.get('url')) or item['key']
        if identity in exact:
            duplicates+=1;existing=exact[identity]
            existing.setdefault('duplicate_records',[]).append({'key':item['key'],'location':item.get('location'),'status':item['status'],'evidence':item['evidence']})
            if any(existing['evidence'].get(field)!=item['evidence'].get(field) for field in ('india_location','remote_advertised')):
                existing['evidence']['shortlist_eligible']=False
                existing['reasons']=list(existing['reasons'])+['conflicting geography/arrangement on duplicate URL; verify primary posting']
            continue
        copy={**item,'evidence':dict(item['evidence'])};exact[identity]=copy
        company=str(item.get('company') or item.get('source') or '').lower()
        title=re.sub(r'\s+',' ',item['title'].casefold()).strip()
        groups.setdefault((company,title),[]).append(copy)
    output=[]
    for (company,title),variants in sorted(groups.items()):
        variants.sort(key=lambda x:(not x['evidence']['shortlist_eligible'],x['status']=='REJECT',-x['priority_score'],x['key']))
        representative=dict(variants[0]);representative['review_group']=company+' / '+title
        representative['variant_count']=len(variants)
        representative['variants']=[{'key':x['key'],'url':x['url'],'location':x.get('location'),'status':x['status'],'reasons':x['reasons'],'evidence':x['evidence']} for x in variants]
        output.append(representative)
    return output,duplicates,len(exact)

def diverse_shortlist(groups,limit,per_employer=None):
    if limit<1:raise ValueError('limit must be positive')
    cap=per_employer or max(2,(limit+4)//5);counts={};selected=[]
    for x in sorted(groups,key=lambda x:(-x['priority_score'],x['key'])):
        if not x['evidence']['shortlist_eligible'] or x['priority_score']<4:continue
        employer=x['company']
        if counts.get(employer,0)>=cap:continue
        selected.append(x);counts[employer]=counts.get(employer,0)+1
        if len(selected)>=limit:break
    return selected,cap
