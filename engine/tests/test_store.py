import json,sqlite3,tempfile,unittest
from pathlib import Path
from collect import collect
from engine.store import canonical_url,connect,content_hash,ingest_snapshot,mark_expired,summary
ROOT=Path(__file__).resolve().parents[2]
SOURCE={'id':'sample-lever','provider':'lever','board':'sample','url':'https://api.lever.co/v0/postings/sample?mode=json'}
def posting(pid='one',text='Full public description',**extra):
    return {'id':pid,'text':'Implementation Manager','hostedUrl':'https://jobs.lever.co/sample/'+pid,
            'descriptionPlain':text,'categories':{'location':'India'},'workplaceType':'remote'}|extra
class Harness:
    """Runs the real collector against a synthetic feed, then ingests its published snapshot."""
    def __init__(self,folder):
        self.public=Path(folder)/'public'
        self.conn=connect(Path(folder)/'state'/'engine.sqlite3')
    def run(self,feed):
        fetch=feed if callable(feed) else (lambda _:feed)
        collect([SOURCE],self.public,fetch,lambda _:None)
        return ingest_snapshot(self.conn,self.public,[SOURCE])['sources'][0]
    def posting(self,pid='lever:sample:one'):
        return dict(self.conn.execute('select * from postings where posting_id=?',(pid,)).fetchone())
    def count(self,table):
        return self.conn.execute('select count(*) from '+table).fetchone()[0]
def down(_):raise OSError('network unavailable')
class StoreTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.h=Harness(self.folder.name)
    def tearDown(self):
        self.h.conn.close()
        self.folder.cleanup()
    def test_retrieval_time_is_separate_from_content_change_time(self):
        first=self.h.run([posting()])
        self.assertEqual((first['new'],first['changed']),(1,0))
        created=self.h.posting()
        again=self.h.run([posting()])
        self.assertEqual(again['unchanged'],1)
        same=self.h.posting()
        self.assertEqual(same['content_changed_at'],created['content_changed_at'])
        self.assertGreater(same['last_seen_at'],created['last_seen_at'])
        self.assertEqual(self.h.count('posting_versions'),1)
        self.assertEqual(self.h.run([posting(text='Revised requirements')])['changed'],1)
        changed=self.h.posting()
        self.assertGreater(changed['content_changed_at'],same['content_changed_at'])
        self.assertEqual(changed['first_seen_at'],created['first_seen_at'])
        texts=[r[0] for r in self.h.conn.execute('select description from posting_versions order by first_seen_at')]
        self.assertEqual(texts,['Full public description','Revised requirements'])
        self.assertEqual(self.h.count('observations'),3)
    def test_url_and_timestamp_churn_is_not_a_content_change(self):
        self.h.run([posting(hostedUrl='https://jobs.lever.co/sample/one?lever-source=x')])
        moved=self.h.run([posting(hostedUrl='https://jobs.lever.co/sample/one/',createdAt=1700000000000,applyUrl='https://jobs.lever.co/sample/one/apply')])
        self.assertEqual(moved['unchanged'],1)
        row=self.h.posting()
        self.assertEqual(row['canonical_url'],'https://jobs.lever.co/sample/one')
        self.assertEqual(row['apply_url'],'https://jobs.lever.co/sample/one/apply')
    def test_reingest_is_idempotent_and_older_snapshots_are_ignored(self):
        self.h.run([posting()])
        older=Path(self.folder.name)/'older'
        collect([SOURCE],older,lambda _:[posting(text='stale')],lambda _:None)
        self.h.run([posting()])
        before=(self.h.count('observations'),self.h.count('source_runs'))
        self.assertEqual(ingest_snapshot(self.h.conn,self.h.public,[SOURCE])['sources'][0]['action'],'already_ingested')
        self.assertEqual(ingest_snapshot(self.h.conn,older,[SOURCE])['sources'][0]['action'],'older_than_store')
        self.assertEqual((self.h.count('observations'),self.h.count('source_runs')),before)
        self.assertEqual(self.h.count('posting_versions'),1)
    def test_failed_source_is_inaccessible_not_missing(self):
        self.h.run([posting()])
        seen=self.h.posting()
        self.assertEqual(self.h.run(down)['inaccessible'],1)
        row=self.h.posting()
        self.assertEqual(row['availability'],'inaccessible')
        self.assertIn('network unavailable',row['availability_reason'])
        self.assertEqual((row['last_seen_at'],row['last_checked_at']),(seen['last_seen_at'],seen['last_checked_at']))
        self.assertEqual(self.h.run([posting()])['relisted'],0)
        self.assertEqual(self.h.posting()['availability'],'listed')
    def test_absence_is_missing_and_never_expired(self):
        self.h.run([posting(),posting('two')])
        self.assertEqual(self.h.run([posting()])['missing'],1)
        gone=self.h.posting('lever:sample:two')
        self.assertEqual(gone['availability'],'missing')
        self.assertEqual(self.h.run(down)['inaccessible'],1)
        self.assertEqual(self.h.posting('lever:sample:two')['availability'],'missing')
        back=self.h.run([posting(),posting('two')])
        self.assertEqual(back['relisted'],1)
        row=self.h.posting('lever:sample:two')
        self.assertEqual((row['availability'],row['availability_reason']),('listed','listed again after missing'))
        self.assertEqual(row['first_seen_at'],gone['first_seen_at'])
    def test_expiry_needs_evidence_and_survives_absence(self):
        self.h.run([posting()])
        with self.assertRaises(ValueError):mark_expired(self.h.conn,'lever:sample:one','2026-01-01T00:00:00+00:00','')
        with self.assertRaises(KeyError):mark_expired(self.h.conn,'lever:sample:none','2026-01-01T00:00:00+00:00','404')
        mark_expired(self.h.conn,'lever:sample:one','2026-01-01T00:00:00+00:00','official page returned 410')
        self.assertEqual(self.h.run([])['missing'],0)
        self.assertEqual(self.h.run(down)['inaccessible'],0)
        self.assertEqual(self.h.posting()['availability'],'expired')
        self.assertEqual(self.h.run([posting()])['relisted'],1)
        self.assertEqual(self.h.posting()['availability'],'listed')
    def test_mismatched_board_file_is_skipped_without_writes(self):
        self.h.run([posting()])
        collect([SOURCE],self.h.public,lambda _:[posting(text='new text')],lambda _:None)
        board=self.h.public/'boards'/'sample-lever.json'
        doc=json.loads(board.read_text())
        board.write_text(json.dumps(doc|{'collected_at':'2000-01-01T00:00:00+00:00'}))
        out=ingest_snapshot(self.h.conn,self.h.public,[SOURCE])
        self.assertEqual(out['sources'][0]['action'],'skipped_mismatch')
        self.assertTrue(out['warnings'])
        self.assertEqual(self.h.count('posting_versions'),1)
    def test_failure_mid_ingest_rolls_back_everything(self):
        self.h.run([posting()])
        before={t:self.h.count(t) for t in ('source_runs','observations','posting_versions')}
        collect([SOURCE],self.h.public,lambda _:[posting(text='changed')],lambda _:None)
        board=self.h.public/'boards'/'sample-lever.json'
        doc=json.loads(board.read_text())
        board.write_text(json.dumps(doc|{'jobs':doc['jobs']*2}))
        with self.assertRaises(ValueError):ingest_snapshot(self.h.conn,self.h.public,[SOURCE])
        self.assertEqual({t:self.h.count(t) for t in before},before)
        self.assertEqual(self.h.posting()['availability'],'listed')
    def test_concurrent_writer_is_refused_while_ingest_holds_the_store(self):
        self.h.run([posting()])
        other=sqlite3.connect(str(Path(self.folder.name)/'state'/'engine.sqlite3'),timeout=0.1,isolation_level=None)
        other.execute('begin immediate')
        try:
            blocked=connect(Path(self.folder.name)/'state'/'engine.sqlite3',timeout=0.1)
            self.assertEqual(summary(blocked)['postings']['listed'],1)
            collect([SOURCE],self.h.public,lambda _:[posting()],lambda _:None)
            with self.assertRaises(sqlite3.OperationalError):ingest_snapshot(blocked,self.h.public,[SOURCE])
            blocked.close()
        finally:
            other.execute('rollback')
            other.close()
        self.assertEqual(ingest_snapshot(self.h.conn,self.h.public,[SOURCE])['sources'][0]['unchanged'],1)
    def test_schema_version_mismatch_is_refused(self):
        self.h.conn.execute("update meta set value='99' where key='schema_version'")
        with self.assertRaises(RuntimeError):connect(Path(self.folder.name)/'state'/'engine.sqlite3')
    def test_store_holds_public_posting_data_only(self):
        columns={r[1] for t in ('postings','posting_versions','observations','sources','source_runs')
                 for r in self.h.conn.execute('pragma table_info(%s)'%t)}
        for word in ('candidate','profile','eligib','decision','salary_pref','applied','cv','resume'):
            self.assertFalse([c for c in columns if word in c],word)
class HelperTests(unittest.TestCase):
    def test_canonical_url(self):
        self.assertEqual(canonical_url('HTTPS://Jobs.Lever.co:443/x/one/?utm_source=li&lever-source=y#apply'),'https://jobs.lever.co/x/one')
        self.assertEqual(canonical_url('https://boards.greenhouse.io/x/jobs?gh_jid=5&gh_src=a'),'https://boards.greenhouse.io/x/jobs?gh_jid=5')
        self.assertEqual(canonical_url('https://x.example/a?b=2&a=1'),canonical_url('https://x.example/a?a=1&b=2'))
        self.assertEqual(canonical_url('https://x.example:8443/a'),'https://x.example:8443/a')
        self.assertIsNone(canonical_url(None))
    def test_content_hash_ignores_whitespace_and_location_order_but_not_text(self):
        base={'title':'Role','locations':[{'text':'India','source':'a'},{'text':'Remote','source':'b'}],'description':'Needs SQL.\nFive years.'}
        same=base|{'locations':base['locations'][::-1],'description':'  Needs   SQL.\nFive years. ','observed_at':'x','url':'y'}
        self.assertEqual(content_hash(base),content_hash(same))
        self.assertNotEqual(content_hash(base),content_hash(base|{'description':'Needs SQL.\nSix years.'}))
        self.assertNotEqual(content_hash(base),content_hash(base|{'compensation_raw':'INR 10-12 LPA'}))
class CommittedSnapshotTests(unittest.TestCase):
    def test_ingests_the_repository_snapshot_read_only(self):
        status=json.loads((ROOT/'public'/'status.json').read_text())
        sources=json.loads((ROOT/'sources.json').read_text())
        with tempfile.TemporaryDirectory() as folder:
            conn=connect(Path(folder)/'engine.sqlite3')
            out=ingest_snapshot(conn,ROOT/'public',sources)
            again=ingest_snapshot(conn,ROOT/'public',sources)
            s=summary(conn)
            conn.close()
        self.assertEqual(out['warnings'],[])
        ok=[x for x in status['sources'] if x['status']=='ok']
        self.assertEqual(s['postings']['listed'],sum(x['jobs'] for x in ok))
        self.assertEqual(len(s['sources']),status['total_sources'])
        self.assertEqual({x['action'] for x in again['sources']},{'already_ingested'})
if __name__=='__main__':unittest.main()
