"""End-to-end acceptance run (engine step 9): the whole engine, offline, on the committed real postings with the
synthetic candidates. Every stage uses the engine's own functions; nothing is mocked except the reviewer (a
deterministic synthetic reviewer, labelled as such) and the spreadsheet (FakeSheets).

python -m engine.acceptance [--out DIR]      # writes acceptance.json and acceptance.md; exit 1 on any failed check

Scope, stated in the report: this proves the engine's behaviour offline. It does not prove live collection,
scheduled execution, live Google Sheets, ChatGPT access to the repository or real candidates' outcomes.
"""
import argparse,copy,json,re,shutil,sys,tempfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
import engine.outputs as eo
import engine.run as er
import engine.review as rq
import engine.sheets as sh
from engine import candidates as cfg
from engine import leads as el
from engine.lock import LockBusy,RunLock
from engine.store import connect,extract_pending,ingest_snapshot,summary
ROOT=Path(__file__).resolve().parent.parent
FIXTURES=ROOT/'engine'/'tests'/'fixtures'/'candidates'
T0=datetime(2030,1,1,9,0,tzinfo=timezone.utc)  # a fixed clock, later than any committed snapshot
SCOPE={'proves':'engine behaviour end to end, offline: store, extraction, leads, screening, review queue, outputs, ledger sync and the locked run pipeline',
       'does_not_prove':['live collection against employer feeds','scheduled execution','live Google Sheets or tracker ingestion',
                         'ChatGPT access to this private repository','outcomes for real candidates (synthetic profiles only)']}
def at(minutes):
    return (T0+timedelta(minutes=minutes)).isoformat()
class Report:
    def __init__(self):
        self.checks,self.counts,self.notes=[],{},[]
    def check(self,area,name,ok,evidence):
        self.checks.append({'area':area,'check':name,'result':'pass' if ok else 'FAIL','evidence':evidence})
        return ok
    def not_run(self,area,name,why):
        self.checks.append({'area':area,'check':name,'result':'not_run','evidence':why})
def _copy_snapshot(src,dst):
    (dst/'boards').mkdir(parents=True)
    shutil.copy(src/'status.json',dst/'status.json')
    for f in (src/'boards').glob('*.json'): shutil.copy(f,dst/'boards'/f.name)
SYNTHETIC_SOURCE='synthetic-acceptance'
SYNTHETIC_POSTING={  # invented employer and URL (example.invalid); never collected, never published
    'key':'greenhouse:synthetic-acceptance:1','provider':'greenhouse','board':'synthetic-acceptance','req_id':'1',
    'title':'Customer Success Manager (synthetic acceptance posting)',
    'locations':[{'text':'Remote - United States','source':'location.name'}],'workplace_type':'Remote',
    'url':'https://jobs.example.invalid/synthetic-acceptance/1','apply_url':'https://jobs.example.invalid/synthetic-acceptance/1',
    'published':'2029-12-01T00:00:00+00:00',
    'description':('About the role\nSYNTHETIC ACCEPTANCE POSTING: an invented employer used only to prove the READY path end to end. '
                   'You will lead onboarding for SaaS customers and run renewals with the account team. This is a full-time position.\n'
                   'Requirements\n3+ years of customer success experience with SaaS platforms\n'
                   'Compensation\nBase salary: US$130,000 - US$150,000 per year.'),
    'compensation_raw':None,'observed_at':'2029-12-01T00:00:00+00:00','change':'new'}
def _synthetic_ready_path(r,work,fixtures):
    """A complete READY path on one clearly synthetic posting, so the path is always exercised even when no real posting
    in the committed snapshot can become READY. Own store, queue and ledger; nothing touches the real-snapshot run."""
    area='6 queue (synthetic)'
    base=work/'synthetic';snap=base/'snap';(snap/'boards').mkdir(parents=True)
    private=base/'private';private.mkdir()
    def fits(c):  # a synthetic fixture that can be READY for the synthetic posting: US-eligible with a USD salary floor
        floors=c['rules'].get('salary') or []
        floors=floors if isinstance(floors,list) else [floors]
        return c.get('synthetic') is True and 'US' in (c['profile'].get('eligible_countries') or []) and any(f.get('currency')=='USD' for f in floors)
    pick=next((f for f in sorted(fixtures.glob('*.json')) if fits(json.loads(f.read_text()))),None)
    if pick is None: return r.not_run(area,'synthetic READY path','no synthetic fixture is US-eligible with a USD floor')
    shutil.copy(pick,private/pick.name)
    people=cfg.load_all(private)
    candidate=next(iter(people))
    if any(not c.get('synthetic') for c in people.values()): return r.check(area,'synthetic READY path uses synthetic candidates only',False,'non-synthetic candidate')
    when='2029-12-01T00:00:00+00:00'
    (snap/'status.json').write_text(json.dumps({'schema':'public-job-index-1','attempted_at':when,'status':'ok','successful_sources':1,'total_sources':1,
        'listing_count':1,'sources':[{'source':SYNTHETIC_SOURCE,'endpoint':'https://jobs.example.invalid/feed','checked_at':when,'status':'ok','jobs':1,
        'skipped':0,'new':1,'changed':0,'no_longer_listed':[]}]}))
    (snap/'boards'/(SYNTHETIC_SOURCE+'.json')).write_text(json.dumps({'schema':'public-job-board-1','source':SYNTHETIC_SOURCE,'collected_at':when,'jobs':[SYNTHETIC_POSTING]}))
    sources=[{'id':SYNTHETIC_SOURCE,'provider':'greenhouse','board':'synthetic-acceptance','url':'https://jobs.example.invalid/feed'}]
    store=connect(base/'engine.sqlite3');queue=rq.connect(private/'review.sqlite3')
    ing=ingest_snapshot(store,snap,sources);extract_pending(store)
    pid=store.execute('select posting_id from postings').fetchone()[0]
    rq.enqueue(store,queue,people,now=at(100))
    pool=rq.claim(store,queue,candidate,'synthetic-ready',batch_size=10,per_employer_cap=10,now=at(101))
    item=next((i for i in pool if i['posting_id']==pid),None)
    if not item: return r.check(area,'the synthetic posting reaches the review queue',False,{'ingest':ing['warnings'],'pool':len(pool)})
    auto={g:v['result'] for g,v in item['gates'].items()}
    r.check(area,'before review, every gate but qualifications passes on stated evidence (US$ range read as USD)',
            item['blocking']==['qualifications'] and all(v=='pass' for g,v in auto.items() if g!='qualifications'),{'gates':auto,'blocking':item['blocking']})
    answers={u['id']:{'decision':'met','evidence':'synthetic acceptance reviewer: fixture profile, not a real person'}
             for u in item['gates']['qualifications'].get('units',[]) if u['status']=='pending'}
    out=rq.submit(store,queue,people,item['item_id'],'synthetic-ready',answers,now=at(102))
    r.check(area,'a reviewed synthetic item whose other gates passed becomes READY',out['verdict']=='ready' and out['state']=='completed',
            {'verdict':out['verdict'],'state':out['state'],'posting':pid})
    feed=json.loads((private/'out'/eo.write_decisions(queue,private/'out',candidate,limit=50,now=at(103),store=store)['file']).read_text())
    header=['Role','Company','Applied','Engine posting id','Notes','Engine seq','Outcome','Verdict','Link','Open questions']
    cols={'posting_id':'Engine posting id','feed_seq':'Engine seq','outcome':'Outcome','verdict':'Verdict','title':'Role','employer':'Company',
          'url':'Link','blocking':'Open questions'}
    sheet=sh.FakeSheets({'synthetic':{'Tracker':[list(header)]}})
    sh.sync(sheet,{'schema':sh.TARGET_SCHEMA,'candidate_id':candidate,'spreadsheet_id':'synthetic','tab':'Tracker','columns':cols},feed,private/'journal.json',now=at(104))
    row=next((x for x in sheet.tabs['synthetic']['Tracker'][1:] if x[3]==pid),None)
    r.check(area,'the synthetic READY decision reaches the (fake) ledger',bool(row) and row[6]=='ready',row[5:8] if row else 'no row')
def _follow_up(snap1,snap2,when,prefer=()):
    """A second collection derived from the real one: one posting's text changes, one disappears, one source fails,
    everything else is re-fetched unchanged. Returns what was changed, for the checks. The changed posting is taken
    from `prefer` (postings that already have a ledger row) when any qualifies, so the ledger checks don't depend on
    which posting happens to come first in a real snapshot."""
    _copy_snapshot(snap1,snap2)
    status=json.loads((snap2/'status.json').read_text())
    ok=[s for s in status['sources'] if s['status']=='ok']
    boards={s['source']:json.loads((snap2/'boards'/(s['source']+'.json')).read_text()) for s in ok}
    big=[s['source'] for s in ok if len(boards[s['source']]['jobs'])>=3]
    edit=next((sid for sid in big if any(j['key'] in prefer for j in boards[sid]['jobs'])),big[0])
    fail=next(s['source'] for s in ok if s['source']!=edit and boards[s['source']]['jobs'])
    jobs=boards[edit]['jobs']
    target=next((j for j in jobs if j['key'] in prefer),jobs[0])
    changed=target['key']
    removed=next(j['key'] for j in jobs if j['key']!=changed)
    target['description']+='\nRequirements\nExperience with acceptance-test fixtures.'
    boards[edit]['jobs']=[j for j in jobs if j['key']!=removed]
    status['attempted_at']=when
    for s in status['sources']:
        if s['source']==fail: s.update(status='failed',checked_at=when,error='acceptance: simulated feed failure')
        elif s['status']=='ok':
            s['checked_at']=when
            boards[s['source']]['collected_at']=when
    for sid,doc in boards.items():
        if sid!=fail: (snap2/'boards'/(sid+'.json')).write_text(json.dumps(doc))
    (snap2/'status.json').write_text(json.dumps(status))
    return {'changed':changed,'removed':removed,'failed_source':fail,'edited_source':edit}
def _answer(response_path,decide,only=None):
    doc=json.loads(response_path.read_text())
    for n,item in enumerate(doc['items']):
        if only is not None and n not in only: continue
        for uid,d in item['unit_decisions'].items(): d.update(decide(item,uid,d))
    response_path.write_text(json.dumps(doc))
def _quotes_verbatim(store):
    bad=0
    norm=lambda t:' '.join((t or '').split())
    for e in store.execute('''select e.quote,e.method,v.title,v.description,v.compensation_raw,v.workplace_type,v.locations from evidence e
                              join posting_versions v using(posting_id,content_hash)'''):
        if e['method']=='ats_field:pay_input_ranges': continue
        src=norm('\n'.join([e['title'] or '',e['description'] or '',e['compensation_raw'] or '',e['workplace_type'] or '']+
                            [l.get('text','') for l in json.loads(e['locations'] or '[]')]))
        bad+=norm(e['quote']) not in src
    return bad
def run(out,root=ROOT,fixtures=FIXTURES):
    out=Path(out)
    r=Report()
    work=Path(tempfile.mkdtemp(prefix='engine-acceptance-'))
    try:
        private=work/'private';private.mkdir()
        for f in fixtures.glob('*.json'): shutil.copy(f,private/f.name)
        people=cfg.load_all(private)
        store=connect(work/'state'/'engine.sqlite3')
        # 1. shared posting store ------------------------------------------------------------------------
        snap1=work/'snap1';_copy_snapshot(root/'public',snap1)
        status1=json.loads((snap1/'status.json').read_text())
        sources=json.loads((root/'sources.json').read_text())
        # Replay the source set actually represented in this historical snapshot.
        # Current registry additions have no historical observations; never invent them.
        snapshot_ids={s['source'] for s in status1['sources']}
        snapshot_sources=[s for s in sources if s['id'] in snapshot_ids]
        ing=ingest_snapshot(store,snap1,sources)
        from engine.store import freshness
        pending={s['id'] for s in sources if s.get('enabled',True) and s['id'] not in snapshot_ids}
        observed={s['source']:s['state'] for s in freshness(store,status1['attempted_at'],expected=pending)['sources']}
        r.check('8 reliability','new registry sources are not reported fresh before collection',
                all(observed.get(s)=='not_reported' for s in pending),{'not_yet_collected':sorted(pending)})
        expected=sum(s.get('jobs',0) for s in status1['sources'] if s['status']=='ok')
        listed=summary(store)['postings']['listed']
        r.check('1 store','every listing in the committed snapshot is stored',listed==expected and not ing['warnings'],{'listed':listed,'expected':expected})
        again=ingest_snapshot(store,snap1,sources)
        r.check('1 store','re-ingesting the same snapshot is a no-op',{s['action'] for s in again['sources']}=={'already_ingested'},
                sorted({s['action'] for s in again['sources']}))
        # 2/3. extraction ---------------------------------------------------------------------------------
        ex=extract_pending(store)
        versions=store.execute('select count(*) from posting_versions').fetchone()[0]
        r.check('3 extraction','every stored version is extracted once',ex['extracted']==versions and ex['failed']==0,ex)
        r.check('3 extraction','every evidence quote is verbatim posting text',_quotes_verbatim(store)==0,
                {'evidence_items':store.execute('select count(*) from evidence').fetchone()[0],'not_verbatim':_quotes_verbatim(store)})
        r.check('2 efficiency','a second extraction run does no work',extract_pending(store)['extracted']==0,'0 versions re-extracted')
        # leads ------------------------------------------------------------------------------------------
        if (root/'public'/'pages'/'index.json').exists() and el.capture_side_job_links():
            lo=el.ingest_pages(store,root)
            pub={p:n for p,n in store.execute('select page_id,job_links from pages') if n}
            got={p:n for p,n in store.execute('select page_id,count(*) from leads group by page_id')}
            r.check('3 extraction','career-page leads equal the published job_links counts',pub==got and not lo['warnings'],{'leads':sum(got.values()),'pages':len(pub)})
            r.check('3 extraction','leads never become postings',summary(store)['postings']['listed']==expected,'postings unchanged by lead ingestion')
        else:
            r.not_run('3 extraction','career-page leads','public/pages or crawl_pages.py not in this checkout (farshaikh17/Codex#1)')
        # 4/5. candidate isolation and screening ----------------------------------------------------------
        queue=rq.connect(private/'review.sqlite3')
        before=list(store.iterdump())
        enq=rq.enqueue(store,queue,people,now=at(0))
        r.check('4 isolation','screening and queueing write nothing to the shared store',list(store.iterdump())==before,'store dump identical')
        evid=missing=0
        for row in queue.execute('select screening from items'):
            for g in json.loads(row[0])['gates'].values():
                if g['result']!='unknown': evid+=1;missing+=not g['evidence']
        r.check('5 screening','every pass and fail carries evidence',missing==0,{'decided_gates':evid,'without_evidence':missing})
        r.check('5 screening','nothing is READY before qualifications are reviewed',all(c['ready_automatic']==0 for c in enq.values()),
                {c:v['ready_automatic'] for c,v in enq.items()})
        try:
            eo.write_decisions(queue,ROOT/'acceptance-should-not-exist',next(iter(people)))
            refused=False
        except eo.OutputError: refused=True
        r.check('4 isolation','candidate outputs inside the repository are refused',refused,'write_decisions refused a repository path')
        ids={c:{x[0] for x in queue.execute('select item_id from items where candidate_id=?',(c,))} for c in people}
        r.check('4 isolation','each candidate has its own items',all(not (ids[a]&ids[b]) for a in ids for b in ids if a<b),{c:len(v) for c,v in ids.items()})
        # 6. durable review queue -------------------------------------------------------------------------
        reviewer='acceptance-synthetic-reviewer'
        def met(item,uid,d): return {'decision':'met','evidence':'synthetic acceptance reviewer: fixture profile, not a real person'}
        reviewed={}
        for n,cid in enumerate(sorted(people)):
            b=eo.write_batch(store,queue,people,private/'out',cid,reviewer,batch_size=3,per_employer_cap=3,now=at(10+n))
            if not b: continue
            resp=private/'out'/b['files'][1]
            _answer(resp,met,only={0})  # the reviewer stops after one item...
            first=eo.submit_batch(store,queue,people,resp,reviewer,now=at(11+n))
            _answer(resp,met)           # ...then finishes the batch and resubmits the whole file
            second=eo.submit_batch(store,queue,people,resp,reviewer,now=at(12+n))
            reviewed[cid]=b['items']
            r.check('6 queue','%s: a resubmitted batch never submits twice'%cid,
                    [x['result'] for x in second['results']].count('already_submitted')==[x['result'] for x in first['results']].count('submitted') and second['errors']==0,
                    {'first':[x['result'] for x in first['results']],'second':[x['result'] for x in second['results']]})
        crash_cid=max(people,key=lambda c:rq.status(store,queue,c,now=at(20))['queue']['pending'])
        held=[i['item_id'] for i in rq.claim(store,queue,crash_cid,'run-that-dies',batch_size=2,lease_seconds=600,per_employer_cap=5,now=at(30))]
        early=rq.claim(store,queue,crash_cid,'next-run',batch_size=50,per_employer_cap=50,now=at(31))
        r.check('6 queue','live leases are never handed out twice',not ({i['item_id'] for i in early}&set(held)),{'held':len(held)})
        for i in early: rq.release(queue,i['item_id'],'next-run',now=at(31))
        resumed=[i for i in rq.claim(store,queue,crash_cid,'next-run',batch_size=50,per_employer_cap=50,now=at(45)) if i['item_id'] in held]
        for i in rq.claim(store,queue,crash_cid,'next-run',batch_size=0,now=at(45)): pass
        for row in queue.execute("select item_id from items where state='in_progress' and lease_owner='next-run'").fetchall():
            if row[0] not in held: rq.release(queue,row[0],'next-run',now=at(45))
        for i in resumed: rq.submit(store,queue,people,i['item_id'],'next-run',{u['id']:{'decision':'met','evidence':'synthetic acceptance reviewer'}
                                   for u in i['gates']['qualifications']['units'] if u['status']=='pending'},now=at(46))
        r.check('6 queue','an interrupted run resumes after its lease expires',sorted(i['item_id'] for i in resumed)==sorted(held),{'resumed':len(resumed)})
        def unit_answers(item,decision):
            return {u['id']:{'decision':decision,'evidence':'synthetic acceptance reviewer: fixture profile'}
                    for u in item['gates']['qualifications']['units'] if u['status']=='pending'}
        ready_cid,ready_item=None,None
        for c in sorted(people):  # an item whose only open question is qualifications: reviewing it must make it READY
            pool=rq.claim(store,queue,c,'ready-path',batch_size=1000,per_employer_cap=1000,now=at(50))
            pick=next((i for i in pool if i['blocking']==['qualifications']),None)
            for i in pool:
                if i is not pick: rq.release(queue,i['item_id'],'ready-path',now=at(50))
            if pick:
                ready_cid,ready_item=c,pick
                if pick['gates']['qualifications'].get('units'):
                    out_r=rq.submit(store,queue,people,pick['item_id'],'ready-path',unit_answers(pick,'met'),now=at(51))
                else:  # no requirement lines were extracted: one finding with a verbatim quote and profile basis
                    line=next(l.strip() for l in (pick['posting']['description'] or '').splitlines() if len(l.strip())>20)
                    out_r=rq.submit(store,queue,people,pick['item_id'],'ready-path',findings={'qualifications':{'result':'pass','quote':line,
                                    'reason':'synthetic acceptance reviewer','basis':'synthetic fixture profile'}},now=at(51))
                break
        if ready_item:
            r.check('6 queue','a reviewed item whose other gates passed becomes READY',out_r['verdict']=='ready' and out_r['state']=='completed',
                    {'candidate':ready_cid,'posting':ready_item['posting_id']})
        else: r.not_run('6 queue','READY path','no pending item in this snapshot had qualifications as its only open question')
        ex_cid=sorted(people)[-1]
        pool=rq.claim(store,queue,ex_cid,'exclude-path',batch_size=1,now=at(52))
        if pool:
            out_x=rq.submit(store,queue,people,pool[0]['item_id'],'exclude-path',unit_answers(pool[0],'not_met'),now=at(53))
            r.check('6 queue','a reviewer not_met with profile evidence excludes the item',out_x['verdict']=='excluded',{'candidate':ex_cid})
        counts=[x[0] for x in queue.execute("select count(*) from events where event='reviewed' group by item_id")]
        r.check('6 queue','every reviewed item was reviewed exactly once',counts and max(counts)==1,{'reviewed_items':len(counts)})
        # 8. ledger sync ----------------------------------------------------------------------------------
        header=['Role','Company','Applied','Engine posting id','Notes','Engine seq','Outcome','Verdict','Link','Open questions']
        cols={'posting_id':'Engine posting id','feed_seq':'Engine seq','outcome':'Outcome','verdict':'Verdict','title':'Role','employer':'Company',
              'url':'Link','blocking':'Open questions'}
        cid=ready_cid or (sorted(reviewed)[0] if reviewed else sorted(people)[0])
        target={'schema':sh.TARGET_SCHEMA,'candidate_id':cid,'spreadsheet_id':'acceptance','tab':'Tracker','columns':cols}
        feed=json.loads((private/'out'/eo.write_decisions(queue,private/'out',cid,limit=5000,now=at(55),store=store)['file']).read_text())
        clean=sh.FakeSheets({'acceptance':{'Tracker':[list(header),['Kept role','Kept co','yes','human-row','note','','','','','']]}})
        crash=sh.FakeSheets(copy.deepcopy(clean.tabs),fail_after=0)
        sh.sync(clean,target,feed,private/'clean-journal.json',now=at(56))
        try: sh.sync(crash,target,feed,private/'journal.json',now=at(56));crashed=False
        except OSError: crashed=True
        crash.fail_after=None
        rec=sh.sync(crash,target,feed,private/'journal.json',now=at(57))
        r.check('8 sheets','a sync that crashes recovers to exactly the clean result',crashed and crash.tabs==clean.tabs and rec['recovered'] is not None,
                {'rows':len(clean.tabs['acceptance']['Tracker'])-1})
        r.check('8 sheets','rerunning an applied feed is a no-op',sh.sync(crash,target,feed,private/'journal.json',now=at(58))['applied']=='already_applied','already_applied')
        human=[row for row in crash.tabs['acceptance']['Tracker'] if row[3]=='human-row'][0]
        r.check('8 sheets','columns the engine does not own are untouched',human[:5]==['Kept role','Kept co','yes','human-row','note'],human[:5])
        keys=[row[3] for row in crash.tabs['acceptance']['Tracker'][1:]]
        r.check('8 sheets','no duplicate rows',len(keys)==len(set(keys)),{'rows':len(keys)})
        other=next((c for c in people if c!=cid),None)
        if other:
            try: sh.sync(crash,dict(target,candidate_id=other),feed,private/'other-journal.json');iso=False
            except sh.SheetsError: iso=True
            r.check('4 isolation',"one candidate's decisions are refused for another's sheet",iso,'sync refused')
        rows=lambda:{row[3]:row for row in crash.tabs['acceptance']['Tracker'][1:]}
        if ready_item and ready_cid==cid:
            r.check('8 sheets','the READY decision reaches the ledger',rows()[ready_item['posting_id']][6]=='ready',rows()[ready_item['posting_id']][6:8])
        _synthetic_ready_path(r,work,fixtures)
        # 1/2/6 follow-up collection: change, disappearance, failure ----------------------------------------
        snap2=work/'snap2'
        info=_follow_up(snap1,snap2,(datetime.fromisoformat(max(s['checked_at'] for s in status1['sources']))+timedelta(days=1)).isoformat(),
                        prefer=set(rows()))
        ing2=ingest_snapshot(store,snap2,sources)
        avail=lambda pid:store.execute('select availability from postings where posting_id=?',(pid,)).fetchone()[0]
        failed_ids=[x[0] for x in store.execute('select posting_id from postings where source_id=?',(info['failed_source'],))]
        kinds=[dict(x) for x in store.execute('select kind,fields from version_changes where posting_id=?',(info['changed'],))]
        r.check('1 store','a changed posting gets a new version naming the changed field',
                kinds==[{'kind':'content_changed','fields':'["description"]'}],{'posting':info['changed'],'changes':kinds})
        r.check('1 store','a posting absent from a successful fetch is missing, not expired',avail(info['removed'])=='missing',{'posting':info['removed']})
        r.check('1 store','postings of a failed source are inaccessible, not missing',{avail(p) for p in failed_ids}=={'inaccessible'},
                {'source':info['failed_source'],'postings':len(failed_ids)})
        ex2=extract_pending(store)
        r.check('2 efficiency','only the changed posting is re-extracted',ex2['extracted']==1,ex2)
        enq2=rq.enqueue(store,queue,people,now=at(60))
        new=sum(v['new_items'] for v in enq2.values())
        r.check('2 efficiency','only the changed posting is re-screened, once per candidate',new==len(people) and all(v['unchanged']>0 for v in enq2.values()),
                {c:{'new':v['new_items'],'superseded':v['superseded']} for c,v in enq2.items()})
        kept=queue.execute('select count(*) from items where posting_id=?',(info['removed'],)).fetchone()[0]
        r.check('6 queue','a disappeared posting keeps its queue items',kept==len(people),{'items':kept})
        before_rows={k:list(v) for k,v in rows().items()}  # FakeSheets updates row lists in place
        page2=json.loads((private/'out'/eo.write_decisions(queue,private/'out',cid,since=json.loads((private/'journal.json').read_text())['checkpoint'],
                          limit=5000,now=at(65),store=store)['file']).read_text())
        sh.sync(crash,target,page2,private/'journal.json',now=at(66))
        after=rows()
        r.check('8 sheets','after the follow-up collection the changed posting row moves to its newest state',
                info['changed'] in before_rows and int(after[info['changed']][5])>int(before_rows[info['changed']][5]),
                {'posting':info['changed'],'seq':[before_rows.get(info['changed'],[0]*6)[5],after[info['changed']][5]],'outcome':after[info['changed']][6]})
        r.check('8 sheets','no ledger row is deleted by the follow-up sync, including a disappeared posting',all(k in after for k in before_rows),
                {'rows_before':len(before_rows),'rows_after':len(after),'removed_posting_had_row':info['removed'] in before_rows})
        keys2=[row[3] for row in crash.tabs['acceptance']['Tracker'][1:]]
        r.check('8 sheets','still no duplicate rows after an incremental sync',len(keys2)==len(set(keys2)),{'rows':len(keys2)})
        # 7. consumer outputs ----------------------------------------------------------------------------
        pub=work/'public-out'
        eo.write_postings(store,pub,limit=100,now=at(70))
        second=eo.write_postings(store,pub,limit=100,now=at(71))
        r.check('7 outputs','an unchanged re-export rewrites no record',second['records_rewritten']==0,second['records_rewritten'])
        r.check('7 outputs','status.json hashes verify every file',eo.verify(pub)==[],eo.verify(pub)[:3])
        seen,cursor=[],None
        while True:
            eo.write_postings(store,pub,since=cursor,limit=100,now=at(72))
            page=json.loads((pub/'changes.json').read_text())
            seen+=[e['posting_id'] for e in page['entries']];cursor=page['cursor_to']
            if not page['has_more']: break
        total=store.execute('select count(*) from postings').fetchone()[0]
        r.check('7 outputs','cursor pages cover every posting exactly once',len(seen)==len(set(seen))==total,{'postings':total,'paged':len(seen)})
        text=''.join(p.read_text() for p in pub.rglob('*.json'))
        r.check('4 isolation','public outputs contain no candidate id',not any(c in text for c in people),'scanned %d files'%len(list(pub.rglob('*.json'))))
        # 9. measurement ----------------------------------------------------------------------------------
        for c in sorted(people):
            s=rq.status(store,queue,c,since=at(0),now=at(90))
            r.counts[c]={'assessed':s['assessed'],'newly_qualified':s['newly_qualified'],'open_ready':s['open_ready'],'ready_not_open':s['ready_not_open'],
                         'queue':s['queue'],'ai_usage':s['ai_usage']}
        r.check('9 measurement','assessed, newly qualified and open READY are reported separately',
                all({'assessed','newly_qualified','open_ready'}<=set(v) for v in r.counts.values()),sorted(r.counts))
        r.check('9 measurement','AI usage is only what reviewers reported (the synthetic reviewer reported none)',
                all(v['ai_usage']['reviews_with_reported_usage']==0 and v['ai_usage']['reported_totals']=={} for v in r.counts.values()),
                {c:v['ai_usage']['reviews'] for c,v in r.counts.items()})
        r.counts['collection']={'first':{'sources':len(status1['sources']),'listed':expected},
                                'follow_up':{k:sum(s.get(k,0) for s in ing2['sources']) for k in ('new','changed','unchanged','missing','inaccessible')}}
        r.counts['duplicates_marked']={c:v['duplicate'] for c,v in enq.items()}
        # 8. reliability: the same two collections through the locked pipeline, on a fresh store -------------
        rdb=work/'run'/'engine.sqlite3'
        hour_after=lambda snap:(datetime.fromisoformat(json.loads((snap/'status.json').read_text())['attempted_at'])+timedelta(hours=1)).isoformat()
        run1=er.run(rdb,snap1,snapshot_sources,pages_root=root,now=hour_after(snap1))
        # The real snapshot is whatever the collector last committed. One transient fetch failure there (a rate-limited board) makes the run
        # 'partial' for a reason that has nothing to do with the code under test, and used to fail every pull request's CI until the next collection.
        # When the snapshot itself reports a non-ok source, this one check says so and is not run; every other check still runs on that snapshot.
        degraded=[x['source'] for x in status1['sources'] if x['status']!='ok']
        if degraded:
            r.not_run('8 reliability','a pipeline run on the real snapshot is ok, with every source fresh',
                      'the latest collector snapshot has %d non-ok source(s) (%s); this check needs a fully healthy snapshot and runs again on the next collection (run outcome: %s)'%(len(degraded),', '.join(degraded[:5]),run1['outcome']))
        else:
            r.check('8 reliability','a pipeline run on the real snapshot is ok, with every source fresh',
                    run1['outcome']=='ok' and set(run1['freshness']['counts'])=={'fresh'} and run1['counts']['extraction_pending']==0,
                    {'outcome':run1['outcome'],'reasons':run1['reasons'],'collected':run1['counts']['collected']})
        with RunLock(rdb,'acceptance: a run already in progress'):
            try: er.run(rdb,snap2,snapshot_sources,pages_root=root,now=hour_after(snap2));busy=False
            except LockBusy: busy=True
        r.check('8 reliability','a second run is refused while one holds the lock',busy,'LockBusy')
        run2=er.run(rdb,snap2,sources,pages_root=root,now=hour_after(snap2))
        state={f['source']:f['state'] for f in run2['freshness']['sources']}
        r.check('8 reliability','the follow-up run is partial, names the failed source and re-extracts only the change',
                run2['outcome']=='partial' and any(info['failed_source'] in x for x in run2['reasons']) and state[info['failed_source']]=='failing'
                and run2['counts']['extracted']==1,{'reasons':run2['reasons'],'extracted':run2['counts']['extracted']})
        rconn=connect(rdb)
        runs=[x[0] for x in rconn.execute('select outcome from engine_runs order by run_id')]
        rconn.close()
        r.check('8 reliability','every run is recorded with its outcome',runs==(['ok','partial'] if not degraded else [run1['outcome'],'partial']),runs)
        store.close();queue.close()
    except Exception as e:  # an unexpected failure is a failed acceptance, reported with its cause
        r.check('run','acceptance completed without an unexpected error',False,'%s: %s'%(type(e).__name__,e))
    finally:
        shutil.rmtree(work,ignore_errors=True)
    passed=sum(c['result']=='pass' for c in r.checks);failed=sum(c['result']=='FAIL' for c in r.checks)
    doc={'schema':'engine-acceptance-1','scope':SCOPE,'result':'pass' if not failed else 'FAIL','passed':passed,'failed':failed,
         'not_run':sum(c['result']=='not_run' for c in r.checks),'checks':r.checks,'counts':r.counts}
    out.mkdir(parents=True,exist_ok=True)
    (out/'acceptance.json').write_text(json.dumps(doc,indent=1,ensure_ascii=False))
    lines=['# Engine acceptance run','','Result: **%s** (%d passed, %d failed, %d not run)'%(doc['result'],passed,failed,doc['not_run']),'',
           'Proves: '+SCOPE['proves']+'.','','Does not prove: '+'; '.join(SCOPE['does_not_prove'])+'.','','| Area | Check | Result |','|---|---|---|']
    lines+=['| %s | %s | %s |'%(c['area'],c['check'],c['result']) for c in r.checks]
    (out/'acceptance.md').write_text('\n'.join(lines)+'\n')
    return doc
def main(argv=None):
    ap=argparse.ArgumentParser(prog='python -m engine.acceptance')
    ap.add_argument('--out',default=tempfile.gettempdir()+'/engine-acceptance',help='where acceptance.json and acceptance.md go')
    args=ap.parse_args(argv)
    doc=run(args.out)
    print(json.dumps({k:doc[k] for k in ('result','passed','failed','not_run')}))
    for c in doc['checks']:
        if c['result']!='pass': print('%s | %s | %s | %s'%(c['result'],c['area'],c['check'],json.dumps(c['evidence'])[:300]))
    return 0 if doc['result']=='pass' else 1
if __name__=='__main__':
    sys.exit(main())

