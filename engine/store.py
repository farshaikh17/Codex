"""Shared posting store: stable identities, content versions, retrieval history.

Reads the collector's published snapshots (public/status.json and
public/boards/<source>.json); it never fetches employers or changes collector
output. Holds public posting data only: no candidate rules, profiles or decisions.

Availability states:
  listed        present in the latest successful retrieval of its source
  missing       absent from a successful retrieval (not proof of closure)
  inaccessible  the latest retrieval of its source failed; last known state was listed
  expired       explicit closure evidence recorded with mark_expired()
"""
import hashlib,json,re,sqlite3
from pathlib import Path
from urllib.parse import parse_qsl,urlencode,urlsplit,urlunsplit
SCHEMA_VERSION=1
CONTENT_HASH_VERSION=1
CONTENT_FIELDS=('title','locations','workplace_type','description','compensation_raw')
TRACKING=re.compile(r'^(utm_[a-z_]+|gh_src|lever-source|lever-origin|lever-via|fbclid|gclid|mc_cid|mc_eid)$',re.I)
DDL='''
create table if not exists meta(key text primary key,value text not null);
create table if not exists sources(
  source_id text primary key,provider text,board text,endpoint text,first_seen_at text not null);
create table if not exists source_runs(
  run_id integer primary key,source_id text not null references sources,attempted_at text not null,
  checked_at text not null,status text not null check(status in ('ok','failed')),error text,
  listed_count integer,unique(source_id,checked_at));
create table if not exists postings(
  posting_id text primary key,source_id text not null references sources,provider text,board text,req_id text,
  canonical_url text,url text,apply_url text,content_hash text not null,content_changed_at text not null,
  first_seen_at text not null,last_seen_at text not null,last_checked_at text not null,
  availability text not null check(availability in ('listed','missing','inaccessible','expired')),
  availability_at text not null,availability_reason text);
create index if not exists postings_canonical_url on postings(canonical_url);
create index if not exists postings_source on postings(source_id,availability);
create table if not exists posting_versions(
  posting_id text not null references postings,content_hash text not null,first_seen_at text not null,
  last_seen_at text not null,first_run_id integer not null references source_runs,
  title text,locations text,workplace_type text,published text,description text,compensation_raw text,
  description_words integer not null,source_hash text,primary key(posting_id,content_hash));
create table if not exists observations(
  run_id integer not null references source_runs,posting_id text not null references postings,
  outcome text not null check(outcome in ('listed','missing','inaccessible')),content_hash text,
  primary key(run_id,posting_id));
'''
def connect(path,timeout=30):
    """Opens the store, creating it on first use; opening an existing store never writes.
    WAL mode lets readers continue during an ingest; a second writer waits up to timeout seconds, then fails."""
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    conn=sqlite3.connect(str(path),timeout=timeout,isolation_level=None)
    conn.row_factory=sqlite3.Row
    conn.execute('pragma foreign_keys=on')
    found=None
    if conn.execute("select 1 from sqlite_master where type='table' and name='meta'").fetchone():
        found=conn.execute("select value from meta where key='schema_version'").fetchone()
    if found:
        if int(found[0])!=SCHEMA_VERSION:
            raise RuntimeError('Store schema %s, code expects %d; migrate before use'%(found[0],SCHEMA_VERSION))
        return conn
    conn.execute('pragma journal_mode=wal')
    conn.executescript(DDL)
    conn.execute("insert or ignore into meta values('schema_version',?),('content_hash_version',?)",(SCHEMA_VERSION,CONTENT_HASH_VERSION))
    return conn
def canonical_url(url):
    """Lowercase scheme and host, drop fragment, default port, trailing slash and known tracking parameters.
    Identifying parameters such as gh_jid are kept."""
    if not url: return None
    p=urlsplit(url.strip())
    host=(p.hostname or '').lower()
    if p.port and (p.scheme.lower(),p.port) not in (('https',443),('http',80)): host+=':%d'%p.port
    query=urlencode(sorted((k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if not TRACKING.match(k)))
    path=p.path.rstrip('/') or '/'
    return urlunsplit((p.scheme.lower(),host,path,query,''))
def content_hash(job):
    """Hash of the posting's relevant content only. Retrieval timestamps, URLs and change labels are excluded,
    so a re-fetch of identical text never looks like a change."""
    locs=sorted({' '.join((l.get('text') or '').split()) for l in job.get('locations') or [] if isinstance(l,dict)}-{''})
    body={k:job.get(k) for k in CONTENT_FIELDS}|{'locations':locs}
    for k in ('title','workplace_type','description','compensation_raw'):
        if isinstance(body[k],str): body[k]='\n'.join(' '.join(line.split()) for line in body[k].strip().splitlines())
    raw=json.dumps(body,sort_keys=True,ensure_ascii=False,separators=(',',':'))
    return hashlib.sha256(raw.encode()).hexdigest()
def _read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))
def _set_availability(conn,posting_id,state,at,reason):
    conn.execute('update postings set availability=?,availability_at=?,availability_reason=? where posting_id=? and availability!=?',
                 (state,at,reason,posting_id,state))
def _record_listed(conn,run_id,source_id,job,at):
    pid=job['key']
    digest=content_hash(job)
    row=conn.execute('select content_hash,availability from postings where posting_id=?',(pid,)).fetchone()
    urls=(canonical_url(job.get('url')),job.get('url'),job.get('apply_url'))
    if row is None:
        conn.execute('insert into postings values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                     (pid,source_id,job.get('provider'),job.get('board'),job.get('req_id'))+urls+
                     (digest,at,at,at,at,'listed',at,'first listed'))
        change='new'
    else:
        change='unchanged' if row['content_hash']==digest else 'changed'
        conn.execute('update postings set canonical_url=?,url=?,apply_url=?,last_seen_at=?,last_checked_at=?,content_hash=?,'
                     'content_changed_at=case when content_hash=? then content_changed_at else ? end where posting_id=?',
                     urls+(at,at,digest,digest,at,pid))
        if row['availability']!='listed':
            _set_availability(conn,pid,'listed',at,'listed again after %s'%row['availability'])
    conn.execute('insert into posting_versions values(?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(posting_id,content_hash) do update set last_seen_at=excluded.last_seen_at',
                 (pid,digest,at,at,run_id,job.get('title'),json.dumps(job.get('locations') or [],ensure_ascii=False),
                  job.get('workplace_type'),job.get('published'),job.get('description'),job.get('compensation_raw'),
                  len((job.get('description') or '').split()),job.get('content_hash')))
    conn.execute('insert into observations values(?,?,?,?)',(run_id,pid,'listed',digest))
    return change
def ingest_snapshot(conn,public,sources=()):
    """Ingests one published collector snapshot in a single transaction. Idempotent: a source retrieval already
    ingested (same source and checked_at) or older than the latest ingested one is skipped and reported."""
    public=Path(public)
    status=_read(public/'status.json')
    meta={s['id']:s for s in sources}
    result={'attempted_at':status.get('attempted_at'),'sources':[],'warnings':[]}
    conn.execute('begin immediate')
    try:
        for s in status.get('sources',[]):
            sid,at=s['source'],s['checked_at']
            out={'source':sid,'checked_at':at,'status':s['status'],'action':'ingested',
                 'new':0,'changed':0,'unchanged':0,'missing':0,'inaccessible':0,'relisted':0}
            latest=conn.execute('select max(checked_at) from source_runs where source_id=?',(sid,)).fetchone()[0]
            if latest and at<=latest:
                out['action']='already_ingested' if at==latest else 'older_than_store'
                result['sources'].append(out)
                continue
            jobs=None
            if s['status']=='ok':
                board_path=public/'boards'/(sid+'.json')
                board=_read(board_path) if board_path.exists() else None
                if not board or board.get('collected_at')!=at:
                    result['warnings'].append('%s: board file does not match status checked_at %s; skipped'%(sid,at))
                    out['action']='skipped_mismatch'
                    result['sources'].append(out)
                    continue
                jobs=board['jobs']
            m=meta.get(sid,{})
            first=(jobs or [{}])[0]
            conn.execute('insert into sources values(?,?,?,?,?) on conflict(source_id) do update set endpoint=excluded.endpoint,'
                         'provider=coalesce(excluded.provider,provider),board=coalesce(excluded.board,board)',
                         (sid,m.get('provider') or first.get('provider'),m.get('board') or first.get('board'),s.get('endpoint'),at))
            run_id=conn.execute('insert into source_runs(source_id,attempted_at,checked_at,status,error,listed_count) values(?,?,?,?,?,?)',
                                (sid,status['attempted_at'],at,s['status'],s.get('error'),len(jobs) if jobs is not None else None)).lastrowid
            known={r['posting_id']:r['availability'] for r in conn.execute('select posting_id,availability from postings where source_id=?',(sid,))}
            if jobs is None:
                for pid,state in known.items():
                    if state in ('listed','inaccessible'):
                        _set_availability(conn,pid,'inaccessible',at,'source retrieval failed: %s'%(s.get('error') or 'unknown')[:200])
                        conn.execute('insert into observations values(?,?,?,null)',(run_id,pid,'inaccessible'))
                        out['inaccessible']+=1
            else:
                seen=set()
                for job in jobs:
                    if job['key'] in seen: raise ValueError('%s: duplicate posting %s in one retrieval'%(sid,job['key']))
                    seen.add(job['key'])
                    if known.get(job['key']) in ('missing','expired'): out['relisted']+=1
                    out[_record_listed(conn,run_id,sid,job,at)]+=1
                for pid in sorted(set(known)-seen):
                    if known[pid]=='expired': continue
                    _set_availability(conn,pid,'missing',at,'absent from successful retrieval')
                    conn.execute('update postings set last_checked_at=? where posting_id=?',(at,pid))
                    conn.execute('insert into observations values(?,?,?,null)',(run_id,pid,'missing'))
                    out['missing']+=1
            result['sources'].append(out)
        conn.execute('commit')
    except BaseException:
        conn.execute('rollback')
        raise
    return result
def mark_expired(conn,posting_id,at,evidence):
    """Records explicit closure evidence (for example the official posting returned 404 or says it is closed).
    Disappearance from a feed alone is 'missing', never 'expired'."""
    if not evidence: raise ValueError('Expiry needs evidence')
    with conn:
        found=conn.execute("update postings set availability='expired',availability_at=?,availability_reason=? where posting_id=?",
                           (at,evidence[:500],posting_id)).rowcount
    if not found: raise KeyError(posting_id)
def summary(conn):
    """Compact counts and freshness per source for status reporting."""
    rows=conn.execute('''select s.source_id,
        (select status from source_runs r where r.source_id=s.source_id order by checked_at desc limit 1) last_status,
        (select max(checked_at) from source_runs r where r.source_id=s.source_id) last_attempt,
        (select max(checked_at) from source_runs r where r.source_id=s.source_id and status='ok') last_success,
        sum(p.availability='listed') listed,sum(p.availability='missing') missing,
        sum(p.availability='inaccessible') inaccessible,sum(p.availability='expired') expired
        from sources s left join postings p on p.source_id=s.source_id group by s.source_id order by s.source_id''').fetchall()
    per=[{k:(r[k] or 0) if k in ('listed','missing','inaccessible','expired') else r[k] for k in r.keys()} for r in rows]
    dupes=conn.execute('''select count(*) from (select canonical_url from postings where canonical_url is not null
        and availability!='expired' group by canonical_url having count(*)>1)''').fetchone()[0]
    totals={k:sum(p[k] for p in per) for k in ('listed','missing','inaccessible','expired')}
    return {'schema_version':SCHEMA_VERSION,'content_hash_version':CONTENT_HASH_VERSION,'postings':totals,
            'versions':conn.execute('select count(*) from posting_versions').fetchone()[0],
            'duplicate_canonical_urls':dupes,'sources':per}
