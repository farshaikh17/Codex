"""Benchmark fixtures and scoring. Standard library only; no network.

Labels are test expectations written with the fixtures, never model output. Gating metrics use only
author_constructed cases; needs_human_review cases are reported separately until a person confirms them.
"""
import json
from pathlib import Path
FIXTURES=Path(__file__).resolve().parent/'fixtures'
GATES=('geography','engagement','experience','salary','prior_application')
GATE_VALUES={'pass','fail','unknown'}
DECISIONS={'READY','EXCLUDE','NEEDS_REVIEW'}
EVIDENCE_STATES={'stated','not_stated','conflicting','not_retrieved'}
AVAILABILITY={'listed','missing','closed_stated'}
LABEL_STATUS={'author_constructed','needs_human_review'}
def load(name):
    return json.loads((FIXTURES/name).read_text(encoding='utf-8'))
def decide(gates):
    """The benchmark's decision rule: any fail excludes, all pass is READY, anything else needs review."""
    values=[gates[g]['value'] if isinstance(gates[g],dict) else gates[g] for g in GATES]
    if 'fail' in values: return 'EXCLUDE'
    return 'READY' if all(v=='pass' for v in values) else 'NEEDS_REVIEW'
def validate(cases=None,candidates=None):
    """Returns a list of problems in the fixtures themselves; empty means the labels are internally consistent."""
    cases=cases or load('cases.json')
    candidates=candidates or load('candidates.json')
    cids={c['id'] for c in candidates['candidates']}
    problems,seen=[],set()
    for c in cases['cases']:
        where='case %s'%c.get('id')
        if c.get('id') in seen: problems.append(where+': duplicate id')
        seen.add(c.get('id'))
        if c.get('label_status') not in LABEL_STATUS: problems.append(where+': bad label_status')
        p=c.get('posting') or {}
        if not p.get('key') or 'description' not in p: problems.append(where+': posting needs key and description')
        if c['label_status']=='author_constructed' and not str(p.get('url','')).startswith('https://jobs.example.invalid/'):
            problems.append(where+': synthetic postings must use example.invalid URLs')
        for f,state in (c.get('expected_extraction') or {}).items():
            if f=='availability':
                if state not in AVAILABILITY: problems.append('%s: availability %r'%(where,state))
            elif state not in EVIDENCE_STATES: problems.append('%s: extraction %s state %r'%(where,f,state))
        for cid,exp in (c.get('expected') or {}).items():
            if cid not in cids: problems.append('%s: unknown candidate %s'%(where,cid))
            gates=exp.get('gates') or {}
            for g,v in gates.items():
                if g not in GATES or v.get('value') not in GATE_VALUES: problems.append('%s/%s: bad gate %s'%(where,cid,g))
                elif not str(v.get('basis','')).strip(): problems.append('%s/%s: gate %s needs a basis quote'%(where,cid,g))
                elif c['label_status']=='author_constructed' and v['value']!='unknown':
                    quote=v['basis'].split(' (')[0].strip('"')
                    text=' '.join([p.get('description') or '',p.get('compensation_raw') or '']+[l['text'] for l in p.get('locations') or []])
                    if g!='prior_application' and quote not in text:
                        problems.append('%s/%s: %s basis %r is not quoted from the posting'%(where,cid,g,quote))
            if 'decision' in exp:
                if set(gates)!=set(GATES): problems.append('%s/%s: a decision label needs every gate'%(where,cid))
                elif exp['decision'] not in DECISIONS or exp['decision']!=decide(gates):
                    problems.append('%s/%s: decision %s contradicts the decision rule (%s)'%(where,cid,exp.get('decision'),decide(gates)))
            elif c['label_status']=='author_constructed': problems.append('%s/%s: author_constructed labels need a decision'%(where,cid))
            if exp.get('relevance') not in ('match','no_match'): problems.append('%s/%s: relevance must be match or no_match'%(where,cid))
    return problems
def pairs(cases,status=('author_constructed',)):
    for c in cases['cases']:
        if c['label_status'] in status:
            for cid,exp in (c.get('expected') or {}).items(): yield c,cid,exp
def score_assessments(predictions,cases=None,status=('author_constructed',)):
    """predictions: [{case, candidate, decision, gates?:{gate: value}}]. Missing predictions count as not READY and are listed."""
    cases=cases or load('cases.json')
    got={(p['case'],p['candidate']):p for p in predictions}
    r={'pairs':0,'false_ready':[],'missed_ready':[],'incorrect_exclusions':[],'expected_unknowns':0,'retained_unknowns':0,
       'missing':[],'gate_agreement':{g:[0,0] for g in GATES},'decision_matrix':{}}
    for c,cid,exp in pairs(cases,status):
        if 'decision' not in exp: continue
        r['pairs']+=1
        key=(c['id'],cid)
        p=got.get(key)
        if p is None: r['missing'].append('%s/%s'%key)
        pd=(p or {}).get('decision','MISSING')
        cell='%s->%s'%(exp['decision'],pd)
        r['decision_matrix'][cell]=r['decision_matrix'].get(cell,0)+1
        if pd=='READY' and exp['decision']!='READY': r['false_ready'].append('%s/%s'%key)
        if exp['decision']=='READY' and pd!='READY': r['missed_ready'].append('%s/%s'%key)
        if pd=='EXCLUDE' and exp['decision'] in ('READY','NEEDS_REVIEW'): r['incorrect_exclusions'].append('%s/%s'%key)
        if exp['decision']=='NEEDS_REVIEW':
            r['expected_unknowns']+=1
            r['retained_unknowns']+=pd=='NEEDS_REVIEW'
        for g in GATES:
            if p and g in (p.get('gates') or {}):
                r['gate_agreement'][g][1]+=1
                r['gate_agreement'][g][0]+=p['gates'][g]==exp['gates'][g]['value']
    r['gate_agreement']={g:'%d/%d'%tuple(v) for g,v in r['gate_agreement'].items() if v[1]}
    return r
def score_extraction(predictions,cases=None,status=('author_constructed',)):
    """predictions: [{case, fields:{field: state}, warnings?:[...], compensation?:{flag: value}}]."""
    cases=cases or load('cases.json')
    got={p['case']:p for p in predictions}
    r={'fields_checked':0,'fields_agreed':0,'disagreements':[],'warnings_expected':0,'warnings_found':0,
       'compensation_checked':0,'compensation_agreed':0,'compensation_disagreements':[],'unmeasured':[]}
    for c in cases['cases']:
        if c['label_status'] not in status: continue
        p=got.get(c['id'])
        if p is None:
            r['unmeasured'].append(c['id'])
            continue
        for f,state in c.get('expected_extraction',{}).items():
            if f not in p.get('fields',{}):
                r['unmeasured'].append('%s.%s'%(c['id'],f))
                continue
            r['fields_checked']+=1
            if p['fields'][f]==state: r['fields_agreed']+=1
            else: r['disagreements'].append('%s.%s: expected %s, got %s'%(c['id'],f,state,p['fields'][f]))
        for w in c.get('expected_warnings',[]):
            r['warnings_expected']+=1
            r['warnings_found']+=w in p.get('warnings',[])
        for k,v in c.get('expected_compensation',{}).items():
            if k not in (p.get('compensation') or {}): continue
            r['compensation_checked']+=1
            if p['compensation'][k]==v: r['compensation_agreed']+=1
            else: r['compensation_disagreements'].append('%s.%s: expected %r, got %r'%(c['id'],k,v,p['compensation'][k]))
    return r
def score_duplicates(groups,collection=None):
    """groups: predicted duplicate groups (lists of posting keys). Pairwise precision and recall."""
    collection=collection or load('collection.json')
    expected=[g for s in collection['scenarios'] for g in s.get('downstream',{}).get('duplicate_groups',[])]
    pairs_of=lambda gs:{tuple(sorted((a,b))) for g in gs for a in g for b in g if a<b}
    e,p=pairs_of(expected),pairs_of(groups)
    return {'expected_pairs':len(e),'predicted_pairs':len(p),'true_pairs':len(e&p),'missed':sorted(e-p),'spurious':sorted(p-e)}
def score_queue(runs,collection=None):
    """runs: [{scenario, processed:[item ids in order], pending_after_interrupt:[...]}]."""
    collection=collection or load('collection.json')
    got={r['scenario']:r for r in runs}
    out={}
    for s in collection['queue_scenarios']:
        r=got.get(s['id'])
        if r is None:
            out[s['id']]='unmeasured'
            continue
        done=r['processed']
        out[s['id']]={'completed':set(done)==set(s['items']),'each_once':len(done)==len(set(done)),
                      'pending_after_interrupt_ok':sorted(r.get('pending_after_interrupt',[]))==sorted(s['expected']['pending_after_interrupt'])}
    return out
def baseline(name,cases=None):
    """Trivial assessors that show the metrics discriminate: always_ready, always_exclude, always_review."""
    cases=cases or load('cases.json')
    decision={'always_ready':'READY','always_exclude':'EXCLUDE','always_review':'NEEDS_REVIEW'}[name]
    return [{'case':c['id'],'candidate':cid,'decision':decision} for c,cid,exp in pairs(cases) if 'decision' in exp]
