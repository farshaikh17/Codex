"""Store persistence and recovery without committing the database.

Source of truth: the collector snapshots already committed to Git (public/status.json and
public/boards/*.json at each commit), plus a small committed journal for facts that are not in any snapshot
(expiry evidence). The SQLite file in state/ is a rebuildable cache: losing or corrupting it loses nothing.

The journal holds public posting facts only. Its keys are fixed; anything else is refused, so candidate
information cannot be written into the committed file through this module.
"""
import json,subprocess,tempfile
from pathlib import Path
from engine.store import ingest_snapshot,mark_expired
EVENT_KEYS={'expired':('event','posting_id','at','evidence')}
def _git(repo,*args):
    return subprocess.run(['git','-C',str(repo)]+list(args),check=True,capture_output=True).stdout
def snapshot_commits(repo,ref='HEAD'):
    """Commits that changed public/status.json, oldest first. Needs full history (actions/checkout fetch-depth: 0)."""
    out=_git(repo,'log','--reverse','--format=%H',ref,'--','public/status.json').decode().split()
    if _git(repo,'rev-parse','--is-shallow-repository').decode().strip()=='true':
        raise RuntimeError('Shallow clone: snapshot history is incomplete; fetch full history before rebuilding')
    return out
def extract(repo,commit,dest):
    """Writes public/status.json and public/boards/*.json as they were at commit."""
    dest=Path(dest)
    names=[n for n in _git(repo,'ls-tree','-r','--name-only',commit,'public/').decode().splitlines()
           if n=='public/status.json' or (n.startswith('public/boards/') and n.endswith('.json'))]
    for name in names:
        path=dest/Path(name).relative_to('public')
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(_git(repo,'show','%s:%s'%(commit,name)))
    return dest
def read_journal(path):
    events=[]
    if not Path(path).exists(): return events
    for n,line in enumerate(Path(path).read_text(encoding='utf-8').splitlines(),1):
        if not line.strip(): continue
        e=json.loads(line)
        keys=EVENT_KEYS.get(e.get('event'))
        if not keys or set(e)!=set(keys): raise ValueError('journal line %d: unsupported event or keys %s'%(n,sorted(e)))
        events.append(e)
    return events
def record_expiry(conn,journal,posting_id,at,evidence):
    """Marks a posting expired in the store and appends the evidence to the committed journal."""
    mark_expired(conn,posting_id,at,evidence)
    with open(journal,'a',encoding='utf-8') as f:
        f.write(json.dumps({'event':'expired','posting_id':posting_id,'at':at,'evidence':evidence},ensure_ascii=False,sort_keys=True)+'\n')
def rebuild(conn,repo,sources=(),ref='HEAD',journal=None):
    """Ingests every committed snapshot in order, applying journal events at their place in time (an expiry is
    applied before the first snapshot attempted after it, so a later relisting still wins). Safe to rerun after
    an interruption: snapshots already in the store are skipped by ingest_snapshot, so a rerun resumes."""
    report={'commits':0,'ingested_sources':0,'skipped':{},'warnings':[],'journal_events':0}
    events=sorted(read_journal(journal) if journal else [],key=lambda e:e['at'])
    def apply_until(limit):
        while events and (limit is None or events[0]['at']<limit):
            e=events.pop(0)
            mark_expired(conn,e['posting_id'],e['at'],e['evidence'])
            report['journal_events']+=1
    for commit in snapshot_commits(repo,ref):
        with tempfile.TemporaryDirectory() as tmp:
            public=extract(repo,commit,tmp)
            apply_until(json.loads((public/'status.json').read_text(encoding='utf-8')).get('attempted_at'))
            out=ingest_snapshot(conn,public,sources)
        report['commits']+=1
        for s in out['sources']:
            if s['action']=='ingested': report['ingested_sources']+=1
            else: report['skipped'][s['action']]=report['skipped'].get(s['action'],0)+1
        report['warnings']+=['%s: %s'%(commit[:10],w) for w in out['warnings']]
    apply_until(None)
    return report
def check(conn):
    """Integrity check for the cache. Anything other than ['ok'] means delete the file and rebuild."""
    return [r[0] for r in conn.execute('pragma integrity_check')]
def dump(conn):
    """Deterministic content of every table, for comparing an incrementally built store with a rebuilt one."""
    tables=[r[0] for r in conn.execute("select name from sqlite_master where type='table' order by name")]
    return {t:[tuple(r) for r in conn.execute('select * from %s order by 1,2'%t)] for t in tables}
