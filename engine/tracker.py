"""Private, durable per-candidate pipeline state (SQLite, stdlib). Never inside the repository.

Holds what must survive between runs of engine.pipeline:
- postings: every discovered posting (any source) with first/last seen, content hash and the last full snapshot,
  so a posting stays assessable when a rotating query does not return it again;
- qualifications: one row per (candidate, posting) with the current state, fit, reason and the inputs key
  (content hash + engine versions + profile/rules versions + history hash) it was computed from;
- state_events: every state change, so "new since last run" and "changed" are facts, not recomputed guesses;
- reviews: human decisions (shortlist, not_interested, applied, interviewing, offer, rejected, withdrawn, note);
  application decisions feed the existing application_history gate on the next run;
- discovery: per-query last run, so rotating discovery is incremental across runs;
- runs: one report per pipeline run.
"""
import hashlib,json,sqlite3
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
SCHEMA_VERSION=1
DECISIONS=('shortlist','not_interested','applied','interviewing','offer','rejected','withdrawn','note')
APPLICATION=('applied','interviewing','offer','rejected','withdrawn')
DDL='''
create table if not exists meta(key text primary key,value text not null);
create table if not exists postings(
  posting_id text primary key,source text,employer text,title text,url text,content_hash text not null,
  first_seen_at text not null,last_seen_at text not null,first_run_id integer,snapshot text not null);
create table if not exists qualifications(
  candidate text not null,posting_id text not null references postings,inputs_key text not null,state text not null,
  fit integer,why text,detail text not null,first_assessed_at text not null,assessed_at text not null,
  state_since text not null,primary key(candidate,posting_id));
create table if not exists state_events(
  candidate text not null,posting_id text not null,run_id integer not null,at text not null,
  from_state text,to_state text not null,why text);
create index if not exists state_events_run on state_events(candidate,run_id);
create table if not exists reviews(
  review_id integer primary key,candidate text not null,posting_id text not null,decision text not null,
  note text,at text not null,by text);
create index if not exists reviews_candidate on reviews(candidate,posting_id);
create table if not exists discovery(
  query_id text primary key,last_run_at text,last_status text,last_jobs integer,last_new integer,runs integer not null default 0);
create table if not exists runs(
  run_id integer primary key,started_at text not null,finished_at text,outcome text,report text);
'''
class TrackerError(RuntimeError): pass
def now(): return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
def connect(path):
    p=Path(path).resolve()
    if p.is_relative_to(ROOT): raise TrackerError('the tracker holds candidate decisions; it must be outside the repository')
    p.parent.mkdir(parents=True,exist_ok=True)
    conn=sqlite3.connect(str(p),timeout=30); conn.row_factory=sqlite3.Row
    conn.execute('pragma journal_mode=wal'); conn.execute('pragma foreign_keys=on')
    conn.executescript(DDL)
    v=conn.execute("select value from meta where key='schema_version'").fetchone()
    if v and int(v[0])!=SCHEMA_VERSION: raise TrackerError('tracker schema %s, code expects %s'%(v[0],SCHEMA_VERSION))
    with conn: conn.execute("insert or ignore into meta values('schema_version',?)",(str(SCHEMA_VERSION),))
    return conn
def start_run(conn,at):
    with conn: return conn.execute("insert into runs(started_at,outcome) values(?,'running')",(at,)).lastrowid
def finish_run(conn,run_id,at,outcome,report):
    with conn: conn.execute('update runs set finished_at=?,outcome=?,report=? where run_id=?',(at,outcome,json.dumps(report,ensure_ascii=False),run_id))
def _hash(job):
    keep={k:job.get(k) for k in ('title','locations','workplace_type','description','compensation_raw')}
    return hashlib.sha256(json.dumps(keep,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:20]
def upsert_postings(conn,jobs,run_id,at):
    """Returns {'new': [...], 'changed': [...], 'seen': n}. A posting is new only the first time any run sees it."""
    new,changed=[],[]
    with conn:
        for j in jobs:
            h=_hash(j); row=conn.execute('select content_hash from postings where posting_id=?',(j['key'],)).fetchone()
            snap=json.dumps(j,ensure_ascii=False)
            if row is None:
                conn.execute('insert into postings values(?,?,?,?,?,?,?,?,?,?)',(j['key'],j.get('_source'),j.get('employer_name') or j.get('board'),
                             j.get('title'),j.get('url'),h,at,at,run_id,snap)); new.append(j['key'])
            else:
                if row[0]!=h: changed.append(j['key'])
                conn.execute('update postings set last_seen_at=?,content_hash=?,snapshot=?,title=?,url=? where posting_id=?',(at,h,snap,j.get('title'),j.get('url'),j['key']))
    return {'new':new,'changed':changed,'seen':len(jobs)}
def retained(conn,since):
    """Snapshots of postings seen at or after `since` (ISO): the assessable pool, including ones a rotating query
    did not return this run. Older postings drop out of the pool but keep their history."""
    return [json.loads(r[0]) for r in conn.execute('select snapshot from postings where last_seen_at>=? order by posting_id',(since,))]
def application_history(conn,candidate):
    """Application decisions from reviews, in the candidate-config history format, for the application_history gate."""
    out=[]
    for r in conn.execute('select r.posting_id,r.decision,r.at,p.employer,p.title,p.url,p.snapshot from reviews r left join postings p using(posting_id) '
                          'where r.candidate=? and r.decision in (%s) order by r.review_id'%','.join('?'*len(APPLICATION)),(candidate,*APPLICATION)):
        board=(json.loads(r['snapshot']).get('board') if r['snapshot'] else None) or r['employer']
        out.append({'posting_id':r['posting_id'],'url':r['url'],'employer':board,'title':r['title'],'status':r['decision'],'date':r['at'][:10]})
    return out
def history_hash(entries): return hashlib.sha256(json.dumps(entries,sort_keys=True).encode()).hexdigest()[:12]
def record(conn,candidate,rows,inputs,run_id,at):
    """rows: engine.qualify.qualify() outputs. inputs: {posting_id: inputs_key}. Returns transitions this run."""
    events=[]
    with conn:
        for r in rows:
            old=conn.execute('select state,inputs_key from qualifications where candidate=? and posting_id=?',(candidate,r['key'])).fetchone()
            detail=json.dumps({k:r[k] for k in ('gates','match','locations','source','why')},ensure_ascii=False)
            if old is None:
                conn.execute('insert into qualifications values(?,?,?,?,?,?,?,?,?,?)',(candidate,r['key'],inputs[r['key']],r['state'],r['fit'],r['why'],detail,at,at,at))
                events.append((None,r['state'],r))
            else:
                since_sql=',state_since=?' if old['state']!=r['state'] else ''
                args=[inputs[r['key']],r['state'],r['fit'],r['why'],detail,at]+([at] if since_sql else [])+[candidate,r['key']]
                conn.execute('update qualifications set inputs_key=?,state=?,fit=?,why=?,detail=?,assessed_at=?%s where candidate=? and posting_id=?'%since_sql,args)
                if old['state']!=r['state']: events.append((old['state'],r['state'],r))
        for frm,to,r in events:
            conn.execute('insert into state_events values(?,?,?,?,?,?,?)',(candidate,r['key'],run_id,at,frm,to,r['why'][:500]))
    return [{'posting_id':r['key'],'from':f,'to':t} for f,t,r in events]
def cached(conn,candidate,posting_id,inputs_key):
    row=conn.execute('select state,fit,why,detail from qualifications where candidate=? and posting_id=? and inputs_key=?',(candidate,posting_id,inputs_key)).fetchone()
    return row
def review(conn,candidate,posting_id,decision,note=None,by=None,at=None):
    if decision not in DECISIONS: raise TrackerError('decision must be one of %s'%', '.join(DECISIONS))
    if not conn.execute('select 1 from postings where posting_id=?',(posting_id,)).fetchone(): raise TrackerError('unknown posting %s'%posting_id)
    with conn:
        return conn.execute('insert into reviews(candidate,posting_id,decision,note,at,by) values(?,?,?,?,?,?)',(candidate,posting_id,decision,note,at or now(),by)).lastrowid
def latest_reviews(conn,candidate):
    out={}
    for r in conn.execute('select posting_id,decision,note,at from reviews where candidate=? order by review_id',(candidate,)):
        out[r['posting_id']]={'decision':r['decision'],'note':r['note'],'at':r['at']}
    return out
def qualification_units(conn,posting_id):
    """Public mandatory lines and stable ids for a stored posting; no guessed qualifications."""
    from engine.extract import extract
    from engine.gates import requirement_units
    row=conn.execute('select snapshot from postings where posting_id=?',(posting_id,)).fetchone()
    if not row: raise TrackerError('unknown posting %s'%posting_id)
    job=json.loads(row[0])
    return requirement_units(extract(job,job.get('url'))['fields'])
def review_qualifications(conn,person,posting_id,decisions,by,at=None):
    """Append evidence-backed requirement receipts to the existing private reviews journal.
    Separate from application decisions. A receipt belongs to one candidate and profile version;
    unchanged requirement ids can survive other posting edits, as in engine.review.unit_reviews.
    """
    from engine.gates import REVIEW_DECISIONS
    if not isinstance(by,str) or not by.strip(): raise TrackerError('qualification review needs a reviewer')
    if not isinstance(decisions,dict) or not decisions: raise TrackerError('qualification review needs unit decisions')
    allowed={u['id'] for u in qualification_units(conn,posting_id)}
    for uid,d in decisions.items():
        if uid not in allowed: raise TrackerError('unknown or changed requirement id %s'%uid)
        if not isinstance(d,dict) or set(d)-{'decision','evidence'} or d.get('decision') not in REVIEW_DECISIONS:
            raise TrackerError('invalid requirement decision')
        if d['decision'] in ('met','not_met') and not (isinstance(d.get('evidence'),str) and d['evidence'].strip()):
            raise TrackerError('met/not_met requires profile evidence')
    note=json.dumps({'schema':'qualification-review-1','profile_version':person['profile_version'],'units':decisions},sort_keys=True)
    return review(conn,person['candidate_id'],posting_id,'note',note,by,at)
def qualification_reviews(conn,person,posting_id):
    out={}
    for row in conn.execute("select note from reviews where candidate=? and posting_id=? and decision='note' order by review_id",
                            (person['candidate_id'],posting_id)):
        try: receipt=json.loads(row['note'] or '')
        except (ValueError,TypeError): continue
        if isinstance(receipt,dict) and receipt.get('schema')=='qualification-review-1' and receipt.get('profile_version')==person['profile_version']:
            out.update(receipt.get('units') or {})
    return out
def due_queries(conn,queries,limit):
    """Least recently run first (never-run first), stable by id: incremental rotation across runs."""
    last={r['query_id']:r['last_run_at'] or '' for r in conn.execute('select query_id,last_run_at from discovery')}
    return sorted(queries,key=lambda q:(last.get(q['id'],''),q['id']))[:limit]
def mark_query(conn,query_id,at,status,jobs,new):
    with conn:
        conn.execute('insert into discovery(query_id,last_run_at,last_status,last_jobs,last_new,runs) values(?,?,?,?,?,1) '
                     'on conflict(query_id) do update set last_run_at=excluded.last_run_at,last_status=excluded.last_status,'
                     'last_jobs=excluded.last_jobs,last_new=excluded.last_new,runs=runs+1',(query_id,at,status,jobs,new))
