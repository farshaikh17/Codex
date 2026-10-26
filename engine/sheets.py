"""Google Sheets ledger adapter (engine step 7): interface, planning, journaled sync and an in-memory fake.

No live Google client is included and nothing here contacts Google. A real client implements SheetsClient
(spreadsheets.values.get / values.batchUpdate / values.append, with valueInputOption RAW) and is supplied by
whoever runs the sync with the owner's credentials. Tests and local dry runs use FakeSheets.

Safety rules:
- One private target file per candidate names the spreadsheet, tab and the columns the engine owns (found by
  header text, any order). Every other column (Applied, Notes, ...) is never written, cleared or reordered, and
  rows are never deleted or moved.
- The feed's candidate must match the target's candidate, so one person's decisions can't reach another's sheet.
- Upsert key: posting id. A row is changed only when the incoming feed sequence is newer than the row's, so a
  replay or an out-of-order feed never regresses a row and never duplicates it.
- Write-ahead journal: the planned batch is saved before any write; the checkpoint cursor advances only after
  every write succeeded. After a crash, rerunning re-plans the saved batch against the sheet as it is now, so rows
  already written become no-ops and missing ones are written once.
- Cell values that a spreadsheet could read as a formula (=, +, -, @) are stored with a leading apostrophe:
  posting text is untrusted.
"""
import argparse,json,re,secrets,sys
from datetime import datetime,timezone
from pathlib import Path
from engine import review as rq
TARGET_SCHEMA='sheets-target-1'
JOURNAL_SCHEMA='sheets-journal-1'
FIELDS=('posting_id','item_id','feed_seq','outcome','state','verdict','blocking','title','employer','url','gates','evidence','decided_by','decided_at','versions')
REQUIRED=('posting_id','feed_seq')
CHUNK=100
class SheetsError(RuntimeError):
    pass
class SheetsClient:
    """Interface a live client implements. Ranges are A1 notation on one tab; values are lists of row lists."""
    def get_values(self,spreadsheet_id,a1_range): raise NotImplementedError
    def batch_update(self,spreadsheet_id,updates): raise NotImplementedError   # updates: [{'range':A1,'values':[[...]]}]
    def append_rows(self,spreadsheet_id,tab,rows): raise NotImplementedError
class FakeSheets(SheetsClient):
    """In-memory sheets for tests and dry runs. fail_after: raise on the Nth write call (crash simulation)."""
    def __init__(self,tabs=None,fail_after=None):
        self.tabs=tabs or {}
        self.fail_after,self.writes,self.calls=fail_after,0,[]
    def _tab(self,spreadsheet_id,tab):
        return self.tabs.setdefault(spreadsheet_id,{}).setdefault(tab,[])
    def _write_call(self,kind):
        self.calls.append(kind)
        if self.fail_after is not None and self.writes>=self.fail_after: raise OSError('simulated failure during %s'%kind)
        self.writes+=1
    def get_values(self,spreadsheet_id,a1_range):
        return [list(r) for r in self._tab(spreadsheet_id,a1_range.split('!')[0].strip("'"))]
    def batch_update(self,spreadsheet_id,updates):
        self._write_call('batch_update')
        for u in updates:
            tab,cell=u['range'].rsplit('!',1)
            col,row=re.fullmatch(r'([A-Z]+)(\d+)',cell).groups()
            rows=self._tab(spreadsheet_id,tab.strip("'"))
            r,c=int(row)-1,col_index(col)
            while len(rows)<=r: rows.append([])
            while len(rows[r])<=c: rows[r].append('')
            rows[r][c]=u['values'][0][0]
    def append_rows(self,spreadsheet_id,tab,rows):
        self._write_call('append_rows')
        self._tab(spreadsheet_id,tab).extend([list(r) for r in rows])
def col_index(letters):
    n=0
    for ch in letters: n=n*26+ord(ch)-64
    return n-1
def col_letters(index):
    s,index='',index+1
    while index: index,rem=divmod(index-1,26);s=chr(65+rem)+s
    return s
def _safe(value):
    text='' if value is None else str(value)
    return "'"+text if text[:1] in ('=','+','-','@') else text
def load_target(path):
    path=Path(path)
    if rq._inside_repo(path): raise SheetsError('%s is inside the repository; sheet targets are private'%path)
    t=json.loads(path.read_text(encoding='utf-8'))
    extra=set(t)-{'schema','candidate_id','spreadsheet_id','tab','columns'}
    if t.get('schema')!=TARGET_SCHEMA or extra: raise SheetsError('target must be %s with keys schema, candidate_id, spreadsheet_id, tab, columns'%TARGET_SCHEMA)
    cols=t.get('columns') or {}
    if set(cols)-set(FIELDS): raise SheetsError('unknown column fields %s'%sorted(set(cols)-set(FIELDS)))
    if not set(REQUIRED)<=set(cols): raise SheetsError('columns must map at least %s'%list(REQUIRED))
    if len(set(cols.values()))!=len(cols): raise SheetsError('two fields map to the same header')
    if not all(t.get(k) for k in ('candidate_id','spreadsheet_id','tab')): raise SheetsError('candidate_id, spreadsheet_id and tab are required')
    return t
def _row_values(entry):
    cur,p=entry['current'],entry.get('posting') or {}
    if cur.get('state')=='superseded':
        # the old item's outcome is no longer valid (content, rules or profile changed): never leave a stale READY
        cur=dict(cur,outcome='re-review pending',verdict='',blocking=[],gates={})
    gates=cur.get('gates') or {}
    return {'posting_id':entry['posting_id'],'item_id':entry['item_id'],'feed_seq':str(entry['seq']),
            'outcome':cur.get('outcome') or cur.get('state'),
            'state':cur.get('state'),'verdict':cur.get('verdict'),'blocking':', '.join(cur.get('blocking') or []),
            'title':p.get('title'),'employer':p.get('board'),'url':p.get('canonical_url'),
            'gates':'; '.join('%s: %s'%(n,g['result']) for n,g in gates.items()),
            'evidence':' | '.join('%s: %s'%(n,(g['evidence'] or [''])[0][:200]) for n,g in gates.items() if g['result']!='pass' or g['evidence'])[:2000],
            'decided_by':cur.get('decided_by'),'decided_at':entry['at'],
            'versions':'rules %(rules)s; profile %(profile)s; gates %(gates)s; extractor %(extractor)s'%entry['versions']}
def plan(rows,target,entries):
    """Pure: compares feed entries with the current sheet rows. Returns {'header':..., 'updates':[...], 'appends':[...], 'skipped':n}."""
    tab,cols=target['tab'],target['columns']
    if not rows: raise SheetsError("tab %r is empty: add a header row with the engine's columns first (python -m engine.sheets init-headers)"%tab)
    header=[h.strip() for h in rows[0]]
    missing=[h for h in cols.values() if h not in header]
    if missing: raise SheetsError('header row lacks engine columns %s; the adapter never adds or renames columns'%missing)
    pos={f:header.index(h) for f,h in cols.items()}
    key_col,seq_col=pos['posting_id'],pos['feed_seq']
    existing={}
    for n,row in enumerate(rows[1:],start=2):
        key=row[key_col].strip() if key_col<len(row) else ''
        if not key: continue
        if key in existing: raise SheetsError('posting %s appears in rows %d and %d; fix the sheet by hand, nothing was written'%(key,existing[key][0],n))
        seq=row[seq_col] if seq_col<len(row) else ''
        existing[key]=(n,int(seq) if str(seq).isdigit() else -1,row)
    latest={}
    for e in entries:
        if e['posting_id'] not in latest or e['seq']>latest[e['posting_id']]['seq']: latest[e['posting_id']]=e
    updates,appends,skipped=[],[],0
    for pid,e in sorted(latest.items(),key=lambda kv:kv[1]['seq']):
        values={f:_safe(v) for f,v in _row_values(e).items() if f in cols}
        if pid in existing:
            n,seq,row=existing[pid]
            if seq>=e['seq']: skipped+=1;continue
            for f,v in values.items():
                if (row[pos[f]] if pos[f]<len(row) else '')!=v:
                    updates.append({'range':"'%s'!%s%d"%(tab,col_letters(pos[f]),n),'values':[[v]]})
        else:
            width=max(pos.values())+1
            new=['']*width
            for f,v in values.items(): new[pos[f]]=v
            appends.append(new)
    return {'header':header,'updates':updates,'appends':appends,'skipped':skipped}
def _journal(path):
    path=Path(path)
    if rq._inside_repo(path): raise SheetsError('%s is inside the repository; the sync journal is private'%path)
    if not path.exists(): return {'schema':JOURNAL_SCHEMA,'checkpoint':None,'pending':None,'history':[]}
    return json.loads(path.read_text(encoding='utf-8'))
def _save(path,journal):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name('.'+path.name+'.tmp')
    tmp.write_text(json.dumps(journal,ensure_ascii=False,indent=1),encoding='utf-8')
    tmp.replace(path)
def _apply(client,target,entries):
    rows=client.get_values(target['spreadsheet_id'],"'%s'"%target['tab'])
    ops=plan(rows,target,entries)
    for i in range(0,len(ops['updates']),CHUNK): client.batch_update(target['spreadsheet_id'],ops['updates'][i:i+CHUNK])
    for i in range(0,len(ops['appends']),CHUNK): client.append_rows(target['spreadsheet_id'],target['tab'],ops['appends'][i:i+CHUNK])
    return {'cells_updated':len(ops['updates']),'rows_appended':len(ops['appends']),'skipped_not_newer':ops['skipped']}
def sync(client,target,feed,journal_path,now=None):
    """Applies one decision-feed page (decision-feed-1) to the candidate's sheet. Finishes an interrupted batch first."""
    now=now or datetime.now(timezone.utc).isoformat()
    journal=_journal(journal_path)
    if feed.get('schema')!='decision-feed-1': raise SheetsError('feed must be decision-feed-1')
    if feed['candidate_id']!=target['candidate_id']: raise SheetsError('feed is for %s but the target sheet belongs to %s'%(feed['candidate_id'],target['candidate_id']))
    report={'recovered':None,'applied':None}
    if journal['pending']:
        p=journal['pending']
        report['recovered']=_apply(client,target,p['entries'])|{'batch_id':p['batch_id']}
        journal['checkpoint']=p['cursor_to']
        journal['history']=(journal['history']+[{k:p[k] for k in ('batch_id','cursor_from','cursor_to','planned_at')}|{'completed_at':now,'recovered':True}])[-50:]
        journal['pending']=None
        _save(journal_path,journal)
    if feed['cursor_to']==journal['checkpoint'] and feed['cursor_from']!=journal['checkpoint']:
        report['applied']='already_applied'
        return report|{'checkpoint':journal['checkpoint']}
    if feed['cursor_from']!=journal['checkpoint']:
        raise SheetsError('feed starts at %r but the sheet is at %r: regenerate it with --since %s'%(feed['cursor_from'],journal['checkpoint'],journal['checkpoint'] or '(none)'))
    batch={'batch_id':secrets.token_hex(4),'cursor_from':feed['cursor_from'],'cursor_to':feed['cursor_to'],'planned_at':now,'entries':feed['entries']}
    journal['pending']=batch
    _save(journal_path,journal)  # write-ahead: saved before the sheet is touched
    report['applied']=_apply(client,target,feed['entries'])|{'batch_id':batch['batch_id']}
    journal['checkpoint']=feed['cursor_to']
    journal['history']=(journal['history']+[{k:batch[k] for k in ('batch_id','cursor_from','cursor_to','planned_at')}|{'completed_at':now,'recovered':False}])[-50:]
    journal['pending']=None
    _save(journal_path,journal)
    return report|{'checkpoint':journal['checkpoint'],'has_more':feed.get('has_more')}
def init_headers(client,target):
    """Writes the engine's header cells into an empty tab only. Never touches a tab that already has content."""
    rows=client.get_values(target['spreadsheet_id'],"'%s'"%target['tab'])
    if rows: raise SheetsError('tab %r is not empty; add the engine columns by hand where they fit'%target['tab'])
    client.append_rows(target['spreadsheet_id'],target['tab'],[[target['columns'][f] for f in FIELDS if f in target['columns']]])
def main(argv=None):
    ap=argparse.ArgumentParser(prog='python -m engine.sheets',description='Ledger sync. Only the local fake sheet is available here; no live Google access.')
    ap.add_argument('command',choices=('plan','sync','init-headers'))
    ap.add_argument('--target',required=True,help='private sheets-target-1 file')
    ap.add_argument('--fake-sheet',required=True,help='private JSON file standing in for the spreadsheet (dry run)')
    ap.add_argument('--feed',help='decision-feed-1 file from python -m engine.outputs decisions')
    ap.add_argument('--journal',help='private sync journal (sync only)')
    args=ap.parse_args(argv)
    target=load_target(args.target)
    fake_path=Path(args.fake_sheet)
    if rq._inside_repo(fake_path): raise SheetsError('the fake sheet holds candidate data; keep it outside the repository')
    client=FakeSheets(json.loads(fake_path.read_text(encoding='utf-8')) if fake_path.exists() else {})
    if args.command=='init-headers': init_headers(client,target);out={'initialised':target['tab']}
    else:
        feed=json.loads(Path(args.feed).read_text(encoding='utf-8'))
        if args.command=='plan':
            ops=plan(client.get_values(target['spreadsheet_id'],"'%s'"%target['tab']),target,feed['entries'])
            out={'cells_to_update':len(ops['updates']),'rows_to_append':len(ops['appends']),'skipped_not_newer':ops['skipped']}
        else:
            if not args.journal: ap.error('sync needs --journal')
            out=sync(client,target,feed,args.journal)
    fake_path.write_text(json.dumps(client.tabs,ensure_ascii=False,indent=1),encoding='utf-8')
    print(json.dumps(out,indent=1))
    return 0
if __name__=='__main__':
    try: sys.exit(main())
    except (SheetsError,rq.QueueError) as e: sys.exit('error: %s'%e)
