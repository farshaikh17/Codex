"""One run: discovery -> qualification -> durable per-candidate state -> private dashboard and exports.

python -m engine.pipeline run    --candidates DIR --state FILE --out DIR [--boards public/boards] [--offline]
python -m engine.pipeline review --state FILE --candidate ID --posting KEY --decision applied [--note TEXT]
python -m engine.pipeline status --state FILE [--candidate ID]

- Discovery: the collector's ATS boards (public/boards, every run) plus incremental free searches
  (engine/discovery_sources.json: Himalayas API, Workday career sites), least recently run queries first.
  Search-discovered postings stay assessable for retain_days after they were last seen.
- Qualification: engine.qualify (batch-independent). A (candidate, posting) is reassessed only when the content,
  engine versions, profile/rules versions or application history change; otherwise the stored result is reused.
- State: engine.tracker (private SQLite). State changes are events; reviews and applications persist; application
  decisions feed the application_history gate, so an applied job becomes APPLIED on the next run.
- Outputs (private, refused inside the repository): <out>/index.html, <out>/<candidate>/dashboard.html, jobs.csv,
  results.json, run.json. Nothing here applies, sends or contacts anyone.
"""
import argparse,csv,hashlib,html,json,sys,time
from datetime import datetime,timedelta,timezone
from pathlib import Path
from engine import candidates as cfg,tracker as tk,sources_extra as sx
from engine import qualify as q
from engine.extract import EXTRACTOR_VERSION
from engine.gates import GATES_VERSION
from engine.match import MATCH_VERSION
ROOT=Path(__file__).resolve().parent.parent
PIPELINE_VERSION=1
SEARCH_PREFIXES=('himalayas:','workday:')
PROMISING=('VERIFIED_READY','HIGH_FIT','PAY_UNKNOWN','NEEDS_REVIEW','EXPERIENCE_GAP','HOLD')
SHOWN=PROMISING+('APPLIED',)
def _iso(dt): return dt.replace(microsecond=0).isoformat()
def _private(path,what):
    p=Path(path).resolve()
    if p.is_relative_to(ROOT): raise SystemExit('%s holds candidate data: it must be outside the repository'%what)
    return p
def inputs_key(job,person,history):
    parts=[tk._hash(job),'m%s'%MATCH_VERSION,'g%s'%GATES_VERSION,'e%s'%EXTRACTOR_VERSION,'p%s'%PIPELINE_VERSION,
           person['profile_version'],person['rules_version'],tk.history_hash(history)]
    return hashlib.sha256('|'.join(map(str,parts)).encode()).hexdigest()[:24]
def discover(conn,run_at,config,boards,offline,fetchers=None):
    """Returns (pool_jobs, report). fetchers: optional {'himalayas': fn(queries)->(jobs,log,requests),
    'workday': fn(tenants,queries,seen)->(jobs,log,requests)} for tests."""
    fetchers=fetchers or {}
    t0=time.monotonic()
    board_jobs=list(q.load_jobs(boards,[])) if boards and Path(boards).exists() else []
    found,log,requests=[],[],0
    if not offline:
        hc=config['himalayas']; hq=tk.due_queries(conn,hc['queries'],hc['per_run'])
        fn=fetchers.get('himalayas') or (lambda qs:sx.himalayas(qs,run_at,hc['max_requests']))
        jobs,hlog,n=fn(hq); found+=jobs; log+=hlog; requests+=n
        wc=config['workday']; wq=tk.due_queries(conn,wc['queries'],wc['per_run'])
        # Postings stored by an older adapter version are fetched again (e.g. v1 dropped the city).
        seen={r[0] for r in conn.execute("select posting_id,snapshot from postings where posting_id like 'workday:%'")
              if (json.loads(r[1]).get('discovery') or {}).get('adapter_version')==sx.ADAPTER_VERSION}
        if fetchers.get('workday'): jobs,wlog,n=fetchers['workday'](wc['tenants'],wq,seen)
        else:
            budget=sx.Budget(wc['max_requests'])
            jobs,wlog=sx.workday(wc['tenants'],wq,seen,budget,run_at,wc['max_details']); n=wc['max_requests']-budget.left
        found+=jobs; log+=wlog; requests+=n
        known={r[0] for r in conn.execute('select posting_id from postings')}
        for qd in hq:
            hits=[e for e in hlog if e.get('query')==qd['id']]
            tk.mark_query(conn,qd['id'],run_at,(hits[0]['status'] if hits else 'not_run'),sum(e.get('listed',0) for e in hits),0)
        for qd in wq:
            hits=[e for e in wlog if e.get('query')==qd['id']]
            if any(e.get('truncated') or e.get('status')=='budget' for e in hits) or not hits: continue  # stays due: unfetched postings remain
            tk.mark_query(conn,qd['id'],run_at,','.join(sorted({e['status'] for e in hits})) or 'not_run',sum(e.get('listed',0) for e in hits),sum(e.get('fetched',0) for e in hits))
    run_id=conn.execute("select max(run_id) from runs").fetchone()[0]
    up=tk.upsert_postings(conn,board_jobs+found,run_id,run_at)
    retain=max(config['himalayas']['retain_days'],config['workday']['retain_days'])
    since=_iso(datetime.fromisoformat(run_at)-timedelta(days=retain))
    pool={j['key']:j for j in board_jobs}
    for j in tk.retained(conn,since):
        if j['key'].startswith(SEARCH_PREFIXES): pool.setdefault(j['key'],j)
    failures=[e for e in log if e.get('status') not in ('ok',None)]
    rep={'board_jobs':len(board_jobs),'search_fetched':len(found),'search_unique':len({j['key'] for j in found}),
         'new_postings':len(up['new']),'changed_postings':len(up['changed']),'pool':len(pool),
         'employers_in_pool':len({(j.get('employer_name') or j.get('board') or '').lower() for j in pool.values()}),
         'requests':requests,'queries':log,'failures':failures,'seconds':round(time.monotonic()-t0,1),'offline':offline}
    return list(pool.values()),rep,set(up['new'])
def qualify_candidate(conn,cid,person,jobs,dup,run_id,run_at,new_keys):
    history=list(person['profile'].get('application_history') or [])+tk.application_history(conn,cid)
    p={**person,'profile':{**person['profile'],'application_history':history if (history or person['profile'].get('application_history') is not None) else None}}
    rows,inputs,reused=[],{},0
    for j in jobs:
        key=inputs_key(j,p,history); inputs[j['key']]=key
        c=tk.cached(conn,cid,j['key'],key)
        if c:
            d=json.loads(c['detail']); reused+=1
            rows.append({'key':j['key'],'title':j.get('title'),'url':j.get('url'),'state':c['state'],'why':c['why'],'fit':c['fit'],
                         'locations':d['locations'],'gates':d['gates'],'match':d['match'],'source':d['source'],'observed_at':j.get('observed_at')})
        else: rows.append(q.qualify(p,j))
    events=tk.record(conn,cid,rows,inputs,run_id,run_at)
    reps=q.group_rows(rows,dup)
    summary=q.summarise(rows,reps)
    reviews=tk.latest_reviews(conn,cid)
    meta={r['posting_id']:r for r in conn.execute('select posting_id,first_seen_at from postings')}
    since={r['posting_id']:r['state_since'] for r in conn.execute('select posting_id,state_since from qualifications where candidate=?',(cid,))}
    byjob={j['key']:j for j in jobs}
    shown=[]
    for r in reps:
        if r['state'] not in SHOWN: continue
        j=byjob[r['key']]
        shown.append({**{k:r[k] for k in ('key','title','url','state','why','fit','locations')},
            'employer':j.get('employer_name') or j.get('board'),'workplace':j.get('workplace_type'),'pay':j.get('compensation_raw'),
            'apply_url':j.get('apply_url') or j.get('url'),'source':r['source'],'first_seen':meta[r['key']]['first_seen_at'],
            'state_since':since.get(r['key']),'new_this_run':r['key'] in new_keys,'review':reviews.get(r['key']),
            'salary_gate':r['gates']['salary']['reason'],'geography_gate':r['gates']['geography']['reason'],
            'unmatched_mandatory':r['match'].get('unmatched_mandatory',[])[:4],'experience_used':r['match'].get('experience_used',[]),
            'duplicates':[d['key'] for d in r.get('cross_source_duplicates',[])],'variants':len(r.get('regional_variants',[])),
            'preferred_city':any(c.lower() in ' '.join(x for x in r['locations'] if x).lower() for c in p['profile'].get('preferred_cities') or [])})
    newly=[e for e in events if e['to'] in PROMISING]
    return {'candidate':cid,'assessed':len(rows),'reused':reused,'recomputed':len(rows)-reused,'counts':summary['counts'],
            'group_counts':summary['group_counts'],'transitions':len(events),'newly_promising':len(newly),
            'new_postings_promising':sum(1 for s in shown if s['new_this_run'] and s['state'] in PROMISING),
            'verified_ready':sum(1 for s in shown if s['state']=='VERIFIED_READY'),'jobs':shown}
RANK={s:i for i,s in enumerate(SHOWN)}
COLS=('state','fit','preferred_city','title','employer','locations','workplace','pay','why','salary_gate','geography_gate','unmatched_mandatory','first_seen','state_since','new_this_run','review','apply_url','url','key','duplicates')
def _cell(v):
    if isinstance(v,(list,dict)): return json.dumps(v,ensure_ascii=False)
    return '' if v is None else str(v)
def write_exports(out,res,run):
    d=out/res['candidate']; d.mkdir(parents=True,exist_ok=True)
    jobs=sorted(res['jobs'],key=lambda s:(RANK[s['state']],not s.get('preferred_city'),-(s['fit'] or 0),s['key']))
    with open(d/'jobs.csv','w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(COLS)
        for s in jobs: w.writerow([_cell(s.get(c)) for c in COLS])
    (d/'results.json').write_text(json.dumps({**res,'jobs':jobs,'run':run},indent=1,ensure_ascii=False),encoding='utf-8')
    e=html.escape
    rows=[]
    for s in jobs:
        rev=s['review']['decision'] if s['review'] else ''
        rows.append('<tr class="%s"><td>%s%s</td><td>%s</td><td><a href="%s" rel="noreferrer">%s</a><div class=k>%s</div></td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s<div class=k>%s</div></td><td>%s</td><td>%s</td></tr>'%(
            e(s['state'].lower()),e(s['state']),' <b class=new>NEW</b>' if s['new_this_run'] else '',s['fit'],e(s['apply_url'] or ''),e(s['title'] or ''),e(s['key']),
            e(s['employer'] or ''),e('; '.join(x for x in s['locations'] if x)[:120]),e(s['workplace'] or 'not stated'),
            e(json.dumps(s['pay'],ensure_ascii=False)[:80] if s['pay'] else 'PAY_UNKNOWN'),e(s['why'][:220]),e('; '.join(s['unmatched_mandatory'])[:300]),
            e(s['first_seen'][:10]),e(rev)))
    counts=' · '.join('%s %d'%(k,v) for k,v in sorted(res['group_counts'].items(),key=lambda kv:RANK.get(kv[0],99)))
    page='''<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Job results: %s</title><style>
:root{--bg:#fff;--fg:#1d1d1f;--mut:#6b6b70;--line:#e3e3e8;--acc:#0b5cad;--new:#b25000}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--mut:#9a9aa3;--line:#2c2c31;--acc:#6aa8ff;--new:#ffaa5c}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px}
table{border-collapse:collapse;width:100%%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:var(--bg)}a{color:var(--acc)}.k{color:var(--mut);font-size:12px}.new{color:var(--new)}
.wrap{overflow-x:auto}.applied td{opacity:.6}</style>
<h1>Job results: %s</h1><p class=k>Run %s at %s · %s postings assessed (%s reused, %s recomputed) · %s new promising this run · VERIFIED_READY %s</p>
<p>%s</p><p class=k>Private. States come from public posting text and the private profile; nothing was applied for or sent. PAY_UNKNOWN and NEEDS_REVIEW need a person to confirm pay and eligibility before applying.</p>
<div class=wrap><table><tr><th>State</th><th>Fit</th><th>Role</th><th>Employer</th><th>Location</th><th>Workplace</th><th>Pay</th><th>Why / unmatched mandatory</th><th>First seen</th><th>Review</th></tr>
%s</table></div></html>'''%(e(res['candidate']),e(res['candidate']),run['run_id'],e(run['started_at']),res['assessed'],res['reused'],res['recomputed'],
        res['new_postings_promising'],res['verified_ready'],e(counts),'\n'.join(rows))
    (d/'dashboard.html').write_text(page,encoding='utf-8')
    return d
def run(candidates_dir,state,out,boards=None,offline=False,config=None,fetchers=None,now=None):
    out=_private(out,'--out'); _private(state,'--state')
    people=cfg.load_all(candidates_dir)
    config=config or sx.load_config()
    run_at=now or tk.now()
    conn=tk.connect(state); run_id=tk.start_run(conn,run_at)
    report={'run_id':run_id,'started_at':run_at,'pipeline_version':PIPELINE_VERSION,'versions':{'match':MATCH_VERSION,'gates':GATES_VERSION,'extractor':EXTRACTOR_VERSION}}
    try:
        t0=time.monotonic()
        jobs,disc,new_keys=discover(conn,run_at,config,boards,offline,fetchers)
        report['discovery']=disc
        dup=q.cross_source_duplicates(jobs)
        out.mkdir(parents=True,exist_ok=True)
        report['candidates']={}
        for cid,person in sorted(people.items()):
            res=qualify_candidate(conn,cid,person,jobs,dup,run_id,run_at,new_keys)
            write_exports(out,res,report)
            report['candidates'][cid]={k:v for k,v in res.items() if k!='jobs'}|{'shown':len(res['jobs'])}
        report['seconds']=round(time.monotonic()-t0,1); report['outcome']='partial' if disc['failures'] else 'ok'
        index=['<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Job results</title>',
               '<style>body{font:15px system-ui,sans-serif;padding:16px;background:#fff;color:#111}@media (prefers-color-scheme:dark){body{background:#141416;color:#eee}a{color:#6aa8ff}}</style>',
               '<h1>Job results</h1><p>Run %d · %s · outcome %s · %d postings in pool, %d new this run</p><ul>'%(run_id,html.escape(run_at),report['outcome'],disc['pool'],disc['new_postings'])]
        for cid,r in report['candidates'].items():
            index.append('<li><a href="%s/dashboard.html">%s</a>: %d shown, %d new promising, VERIFIED_READY %d (<a href="%s/jobs.csv">CSV</a>)</li>'%(html.escape(cid),html.escape(cid),r['shown'],r['new_postings_promising'],r['verified_ready'],html.escape(cid)))
        (out/'index.html').write_text('\n'.join(index)+'</ul>',encoding='utf-8')
        (out/'run.json').write_text(json.dumps(report,indent=1,ensure_ascii=False),encoding='utf-8')
        tk.finish_run(conn,run_id,tk.now(),report['outcome'],report)
        return report
    except BaseException as e:
        report['outcome']='failed'; report['error']='%s: %s'%(type(e).__name__,e)
        tk.finish_run(conn,run_id,tk.now(),'failed',report); raise
    finally:
        conn.execute('pragma wal_checkpoint(truncate)'); conn.close()  # one self-contained file for encryption/backup
def main(argv=None):
    ap=argparse.ArgumentParser(prog='python -m engine.pipeline'); sub=ap.add_subparsers(dest='cmd',required=True)
    r=sub.add_parser('run'); r.add_argument('--candidates'); r.add_argument('--state',required=True); r.add_argument('--out',required=True)
    r.add_argument('--boards',default=str(ROOT/'public'/'boards')); r.add_argument('--offline',action='store_true')
    v=sub.add_parser('review'); v.add_argument('--state',required=True); v.add_argument('--candidate',required=True)
    v.add_argument('--posting',required=True); v.add_argument('--decision',required=True,choices=tk.DECISIONS); v.add_argument('--note')
    s=sub.add_parser('status'); s.add_argument('--state',required=True); s.add_argument('--candidate')
    a=ap.parse_args(argv)
    if a.cmd=='run':
        rep=run(a.candidates,a.state,a.out,a.boards,a.offline)
        print(json.dumps({'run_id':rep['run_id'],'outcome':rep['outcome'],'discovery':{k:v for k,v in rep['discovery'].items() if k!='queries'},
                          'candidates':{c:{k:v for k,v in x.items() if k in ('assessed','reused','group_counts','newly_promising','new_postings_promising','verified_ready','shown')} for c,x in rep['candidates'].items()}},indent=1))
    elif a.cmd=='review':
        _private(a.state,'--state'); conn=tk.connect(a.state)
        print('review',tk.review(conn,a.candidate,a.posting,a.decision,a.note,by='cli'))
    else:
        _private(a.state,'--state'); conn=tk.connect(a.state)
        for row in conn.execute('select run_id,started_at,outcome from runs order by run_id desc limit 5'): print(dict(row))
        where,args=('where candidate=?',(a.candidate,)) if a.candidate else ('',())
        for row in conn.execute('select candidate,state,count(*) n from qualifications %s group by 1,2 order by 1,2'%where,args): print(dict(row))
if __name__=='__main__': sys.exit(main())
