"""Implementation-independent dossiers for labelling: posting evidence only, no implementation decisions.

Usage (repository root): python experiments/evaluation-v3/dossiers.py BOARDS_DIR SAMPLE_JSON OUT_DIR
"""
import json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from engine.extract import extract
GEO=re.compile(r'(?i)\b(india|remote|work from home|anywhere|worldwide|relocat|visa|sponsor|authori[sz]|right to work|eligible to work|resid|citizen|based in|located in|onsite|on-site|hybrid|in[- ]office|travel)\b')
PAY=re.compile(r'(?i)(salary|compensation|pay range|base pay|ote|₹|inr|lakh|\$|usd|eur|gbp)')
def sentences(text):
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n',text or '') if s.strip()]
def main(boards,sample,out):
    jobs={}
    for p in sorted(Path(boards).glob('*.json')):
        b=json.loads(p.read_text(encoding='utf-8'))
        for j in b['jobs']: jobs[j['key']]=(b['source'],j)
    s=json.loads(Path(sample).read_text()); Path(out).mkdir(parents=True,exist_ok=True)
    for cand,parts in s['candidates'].items():
        lines=['# %s dossiers (posting evidence only)'%cand,'']
        for split in ('dev','holdout','india'):
            for n,key in enumerate(parts.get(split,[]),1):
                src,j=jobs[key]; ex=extract(j)
                req=[i['quote'] for i in ex['fields']['requirements_mandatory']['items']]
                req_lines=[l.strip(' -•*') for q in req for l in q.split('\n') if l.strip()][:14]
                desc=j.get('description') or ''
                geo=[x[:260] for x in sentences(desc) if GEO.search(x)][:8]
                pay=[x[:200] for x in sentences(desc) if PAY.search(x) and re.search(r'\d',x)][:3]
                lines+=['## %s-%02d %s'%(split,n,key),'title: %s | source: %s'%(j['title'],src),
                        'locations: %s | workplace_type: %s | words: %d'%('; '.join(l.get('text','') for l in j.get('locations') or []),j.get('workplace_type'),len(desc.split())),
                        'url: %s'%j.get('url'),'geo/arrangement:']+['  - '+g for g in geo]+['mandatory requirements (%s):'%ex['fields']['requirements_mandatory']['state']]+['  - '+r[:220] for r in req_lines]+(['pay:']+['  - '+p for p in pay] if pay else [])+['']
        Path(out,cand+'.md').write_text('\n'.join(lines),encoding='utf-8')
if __name__=='__main__': main(*sys.argv[1:4])
