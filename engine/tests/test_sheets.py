import json,tempfile,unittest
from pathlib import Path
import engine.outputs as eo
import engine.review as rq
import engine.sheets as sh
from engine import candidates as cfg
from engine.tests.test_review import A,World,at,lever
COLUMNS={'posting_id':'Engine posting id','feed_seq':'Engine seq','item_id':'Engine item','outcome':'Engine outcome','verdict':'Engine verdict',
         'title':'Role','employer':'Company','url':'Link','blocking':'Open questions','evidence':'Evidence','decided_at':'Decided at'}
HEADER=['Role','Company','Applied','Engine posting id','Notes','Engine seq','Engine outcome','Link','Engine verdict','Engine item','Open questions',
        'Evidence','Decided at']  # human columns (Applied, Notes) mixed in; any order
def target(candidate=A):
    return {'schema':sh.TARGET_SCHEMA,'candidate_id':candidate,'spreadsheet_id':'sheet-1','tab':'Tracker','columns':COLUMNS}
class SheetsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.w=World(self.tmp.name)
        self.private=Path(self.tmp.name)/'private'
        self.journal=self.private/'sheet-journal.json'
        self.w.collect({'x':[lever('p%d'%n) for n in range(4)]+[lever('us',categories={'location':'Remote - US'}),
                             lever('eq',title='=HYPERLINK("http://evil.example","Implementation Manager")')]})
        self.w.enqueue()
        for item in rq.claim(self.w.store,self.w.q,A,'w1',batch_size=10,per_employer_cap=10,now=at(1)):
            if item['posting_id'] in ('lever:x:p0','lever:x:p1'):
                rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',self.w.met_all(item),now=at(2))
            else: rq.release(self.w.q,item['item_id'],'w1',now=at(2))
        self.sheet=sh.FakeSheets({'sheet-1':{'Tracker':[list(HEADER)]}})
    def tearDown(self):
        self.w.store.close();self.w.q.close();self.tmp.cleanup()
    def feed(self,since=None,limit=200):
        out=eo.write_decisions(self.w.q,self.private,A,since=since,limit=limit,now=at(3),store=self.w.store)
        return json.loads((self.private/out['file']).read_text())
    def rows(self):
        rows=self.sheet.tabs['sheet-1']['Tracker']
        h=rows[0]
        return {r[h.index('Engine posting id')]:dict(zip(h,r+['']*(len(h)-len(r)))) for r in rows[1:]}
    def test_sync_writes_owned_columns_and_keeps_human_ones(self):
        self.sheet.tabs['sheet-1']['Tracker'].append(['Old role','Acme','yes','lever:x:p0','call back','','','','','','','',''])
        out=sh.sync(self.sheet,target(),self.feed(),self.journal,now=at(4))
        rows=self.rows()
        self.assertEqual(sorted(rows),['lever:x:p0','lever:x:p1','lever:x:us'])
        self.assertEqual((rows['lever:x:p0']['Applied'],rows['lever:x:p0']['Notes']),('yes','call back'),'human columns untouched')
        self.assertEqual(rows['lever:x:p0']['Engine outcome'],'ready')
        self.assertEqual(rows['lever:x:us']['Engine outcome'],'excluded')
        self.assertIn('geography',rows['lever:x:us']['Open questions'])
        self.assertEqual(out['applied']['rows_appended'],2)
        self.assertEqual(self.sheet.tabs['sheet-1']['Tracker'][0],HEADER,'header never changed')
    def test_rerun_is_a_no_op_and_the_checkpoint_chains_pages(self):
        first=self.feed(limit=1)
        sh.sync(self.sheet,target(),first,self.journal,now=at(4))
        self.assertEqual(sh.sync(self.sheet,target(),first,self.journal,now=at(5))['applied'],'already_applied')
        with self.assertRaises(sh.SheetsError):sh.sync(self.sheet,target(),self.feed(),self.journal,now=at(5))  # a page not starting at the checkpoint
        while True:
            page=self.feed(since=json.loads(self.journal.read_text())['checkpoint'],limit=1)
            sh.sync(self.sheet,target(),page,self.journal,now=at(6))
            if not page['has_more']: break
        self.assertEqual(sorted(self.rows()),['lever:x:p0','lever:x:p1','lever:x:us'])
    def test_crash_mid_sync_recovers_without_duplicates(self):
        feed=self.feed()
        self.sheet.tabs['sheet-1']['Tracker'].append(['','','','lever:x:p0','','1','','','','','','',''])  # an existing row to update
        clean=sh.FakeSheets(json.loads(json.dumps(self.sheet.tabs)))
        sh.sync(clean,target(),feed,self.private/'clean-journal.json',now=at(4))
        self.sheet.fail_after=1  # the cell updates succeed, the append crashes
        with self.assertRaises(OSError):sh.sync(self.sheet,target(),feed,self.journal,now=at(4))
        journal=json.loads(self.journal.read_text())
        self.assertIsNotNone(journal['pending'],'the planned batch was saved before writing')
        self.assertIsNone(journal['checkpoint'],'the checkpoint did not advance')
        self.sheet.fail_after=None
        out=sh.sync(self.sheet,target(),feed,self.journal,now=at(5))
        self.assertEqual(out['recovered']['rows_appended'],2)
        self.assertEqual(out['applied'],'already_applied')
        self.assertEqual(self.sheet.tabs,clean.tabs,'recovered sheet equals a clean run')
        keys=[r[3] for r in self.sheet.tabs['sheet-1']['Tracker'][1:]]
        self.assertEqual(len(keys),len(set(keys)),'no duplicate rows')
    def test_older_feed_never_regresses_a_row(self):
        feed=self.feed()
        sh.sync(self.sheet,target(),feed,self.journal,now=at(4))
        row=[r for r in self.sheet.tabs['sheet-1']['Tracker'] if r[3]=='lever:x:p0'][0]
        row[HEADER.index('Engine seq')]='999999'
        stale=sh.plan(self.sheet.tabs['sheet-1']['Tracker'],target(),feed['entries'])
        self.assertEqual((stale['updates'],stale['appends'],stale['skipped']),([],[],3))
    def test_changed_postings_show_the_newest_state(self):
        sh.sync(self.sheet,target(),self.feed(),self.journal,now=at(4))
        self.w.collect({'x':[lever('p0',text='Requirements\nKubernetes experience'),lever('p1',text='Requirements\n9+ years of experience')]+
                        [lever('p%d'%n) for n in range(2,4)]+[lever('us',categories={'location':'Remote - US'}),
                         lever('eq',title='=HYPERLINK("http://evil.example","Implementation Manager")')]})
        self.w.enqueue()
        page=self.feed(since=json.loads(self.journal.read_text())['checkpoint'])
        sh.sync(self.sheet,target(),page,self.journal,now=at(5))
        rows=self.rows()
        self.assertEqual(rows['lever:x:p0']['Engine outcome'],'re-review pending','new version needs a review: the old READY must not stand')
        self.assertEqual(rows['lever:x:p1']['Engine outcome'],'excluded','new version decided automatically (9+ years against 7)')
    def test_refusals_write_nothing(self):
        before=json.dumps(self.sheet.tabs)
        with self.assertRaises(sh.SheetsError):sh.sync(self.sheet,target('synthetic-design-eu'),self.feed(),self.journal)
        dup=sh.FakeSheets({'sheet-1':{'Tracker':[list(HEADER),['','','','lever:x:p0']+['']*9,['','','','lever:x:p0']+['']*9]}})
        with self.assertRaises(sh.SheetsError):sh.sync(dup,target(),self.feed(),self.private/'j2.json')
        bare=sh.FakeSheets({'sheet-1':{'Tracker':[['Role','Notes']]}})
        with self.assertRaises(sh.SheetsError):sh.sync(bare,target(),self.feed(),self.private/'j3.json')
        self.assertEqual(json.dumps(self.sheet.tabs),before)
        self.assertEqual(dup.calls+bare.calls,[])
    def test_formula_like_text_is_stored_as_text(self):
        item=[i for i in rq.claim(self.w.store,self.w.q,A,'w2',batch_size=5,now=at(2)) if i['posting_id']=='lever:x:eq'][0]
        rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w2',self.w.met_all(item),now=at(2))
        sh.sync(self.sheet,target(),self.feed(),self.journal,now=at(4))
        self.assertTrue(self.rows()['lever:x:eq']['Role'].startswith("'="))
    def test_init_headers_only_on_an_empty_tab(self):
        empty=sh.FakeSheets({})
        sh.init_headers(empty,target())
        self.assertEqual(empty.tabs['sheet-1']['Tracker'][0][0],'Engine posting id')
        with self.assertRaises(sh.SheetsError):sh.init_headers(self.sheet,target())
    def test_private_files_refused_inside_repository(self):
        path=cfg.ROOT/'state'/'target.json'
        with self.assertRaises(sh.SheetsError):sh.load_target(path)
        with self.assertRaises(sh.SheetsError):sh.sync(self.sheet,target(),self.feed(),cfg.ROOT/'state'/'journal.json')
    def test_target_validation(self):
        p=self.private/'t.json';p.parent.mkdir(parents=True,exist_ok=True)
        for bad in (target()|{'extra':1},target()|{'columns':{'title':'Role'}},target()|{'columns':COLUMNS|{'salary':'Pay'}},
                    target()|{'columns':{'posting_id':'X','feed_seq':'X'}}):
            p.write_text(json.dumps(bad))
            with self.assertRaises(sh.SheetsError):sh.load_target(p)
        p.write_text(json.dumps(target()))
        self.assertEqual(sh.load_target(p)['tab'],'Tracker')
if __name__=='__main__':unittest.main()
