"""Pre-registered, implementation-independent job sample for the v3 review (seed and pools fixed before labelling).

Usage: python experiments/evaluation-v3/sample_jobs.py BOARDS_DIR OUT_JSON
Pools are broad public title screens, deliberately wider than any implementation's role rules, so that jobs an
implementation excludes can be judged. No implementation output is read here.
"""
import json,random,re,sys
from pathlib import Path
SEED=20261030
POOLS={
 'farhan':r'implement|onboard|integrat|automat|workflow|\bcrm\b|salesforce|hubspot|highlevel|business systems|systems analyst|'
          r'revenue operations|rev ?ops|operations|solutions?|technical account|professional services|delivery|project|program|'
          r'\bqa\b|quality|\buat\b|support|customer success|\bai\b|product|consultant|analyst|specialist|coordinator',
 'sana':r'energy|power|utilit|electric|maintenance|reliab|asset|commission|plant|mechanical|decarbon|sustainab|efficien|grid|'
        r'battery|thermal|industrial|field|site|project engineer|technician|hvac|process|operations engineer|facilit|construction|quality',
}
# Stratum added before any repair code was written (dev/holdout above were too sparse in India-located jobs to
# measure false exclusions): pooled jobs whose structured location names India or states no country at all.
INDIA_OR_UNRESTRICTED=r'\bindia\b|bengaluru|bangalore|pune|mumbai|hyderabad|chennai|delhi|gurgaon|gurugram|noida|^\s*(?:remote|global|worldwide|anywhere)\s*$'
def located(job):
    return any(re.search(INDIA_OR_UNRESTRICTED,(l.get('text') or ''),re.I) for l in job.get('locations') or [])
def jobs(boards):
    for p in sorted(Path(boards).glob('*.json')):
        b=json.loads(p.read_text(encoding='utf-8'))
        for j in b['jobs']: yield b['source'],j
def main(boards,out):
    rows=list(jobs(boards)); result={'seed':SEED,'pools':POOLS,'corpus_records':len(rows),'candidates':{}}
    for cand,pattern in POOLS.items():
        pool=sorted({j['key']:(s,j) for s,j in rows if re.search(pattern,j['title'],re.I)}.items())
        rng=random.Random(SEED+(0 if cand=='farhan' else 1)); keys=[k for k,_ in pool]; rng.shuffle(keys)
        used=set(keys[:60]); india=[k for k in keys if k not in used and located(dict(pool)[k][1])]
        result['candidates'][cand]={'pool_size':len(pool),'dev':keys[:40],'holdout':keys[40:60],
                                    'india_stratum_size':len(india),'india':india[:30]}
    Path(out).write_text(json.dumps(result,indent=1)+'\n')
if __name__=='__main__': main(*sys.argv[1:3])
