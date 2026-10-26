"""Runs the collection scenarios through collect.collect() with synthetic feeds and no network."""
import tempfile
from pathlib import Path
from collect import collect
from bench.score import load
class FeedError(Exception):
    pass
def run_scenario(s):
    """Returns (checks, failures): every expectation checked, and the ones that did not hold."""
    checks,failures,observed=0,[],[]
    with tempfile.TemporaryDirectory() as folder:
        out=Path(folder)/'public'
        sources={x['id']:dict(x) for x in s['sources']}
        for n,step in enumerate(s['steps']):
            for sid,url in step.get('source_urls',{}).items(): sources[sid]['url']=url
            def fetch(source,feeds=step['feeds']):
                feed=feeds[source['id']]
                if isinstance(feed,dict): raise FeedError(feed['error'])
                return [s['postings'][p] for p in feed]
            result=collect(list(sources.values()),out,fetch,lambda _:None,due=step.get('due'),run_id='bench-%s-%d'%(s['id'],n))
            observed.append(result['attempted_at'])
            exp=step.get('expect',{})
            jobs={j['key']:j for j in result['jobs']}
            by_source={x['source']:x for x in result['sources']}
            def check(ok,what):
                nonlocal checks
                checks+=1
                if not ok: failures.append('%s step %d: %s'%(s['id'],n,what))
            if 'status' in exp: check(result['status']==exp['status'],'status %s != %s'%(result['status'],exp['status']))
            if 'listing_count' in exp: check(result['listing_count']==exp['listing_count'],'listing_count %s != %s'%(result['listing_count'],exp['listing_count']))
            for sid,fields in exp.get('sources',{}).items():
                for k,v in fields.items(): check(by_source[sid].get(k)==v,'source %s %s=%r, expected %r'%(sid,k,by_source[sid].get(k),v))
            for sid,keys in exp.get('no_longer_listed',{}).items():
                check(by_source[sid].get('no_longer_listed')==keys,'source %s no_longer_listed %r'%(sid,by_source[sid].get('no_longer_listed')))
            for key,fields in exp.get('jobs',{}).items():
                j=jobs.get(key)
                if j is None:
                    check(False,'%s missing from index'%key)
                    continue
                for k,v in fields.items():
                    if k=='observed_at_step': check(j['observed_at']==observed[v],'%s observed_at not preserved from step %d'%(key,v))
                    else: check(j.get(k)==v,'%s %s=%r, expected %r'%(key,k,j.get(k),v))
    return checks,failures
def run_all():
    results={}
    for s in load('collection.json')['scenarios']:
        checks,failures=run_scenario(s)
        results[s['id']]={'checks':checks,'failures':failures}
    return results
