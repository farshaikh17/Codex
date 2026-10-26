import json,os,shutil,subprocess,tempfile,unittest
from datetime import datetime,timezone
from pathlib import Path
from unittest import mock
from collect import collect
from engine import persist
from engine.persist import check,dump,read_journal,rebuild,record_expiry
from engine.store import connect,ingest_snapshot
SOURCE={'id':'sample-lever','provider':'lever','board':'sample','url':'https://api.lever.co/v0/postings/sample?mode=json'}
def posting(pid='one',text='Full public description'):
    return {'id':pid,'text':'Implementation Manager','hostedUrl':'https://jobs.lever.co/sample/'+pid,
            'descriptionPlain':text,'categories':{'location':'India'},'workplaceType':'remote'}
def down(_):raise OSError('network unavailable')
@unittest.skipUnless(shutil.which('git'),'git not installed')
class PersistenceTests(unittest.TestCase):
    """A synthetic repository whose history holds several collector snapshots, like main does."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.repo=Path(self.tmp.name)/'repo'
        self.repo.mkdir()
        self.git('init','-q')
        self.journal=self.repo/'data'/'posting-events.jsonl'
        self.journal.parent.mkdir()
        self.live=connect(Path(self.tmp.name)/'live.sqlite3')
    def tearDown(self):
        self.live.close()
        self.tmp.cleanup()
    def git(self,*args):
        env=dict(os.environ,GIT_AUTHOR_NAME='t',GIT_AUTHOR_EMAIL='t@example.com',GIT_COMMITTER_NAME='t',GIT_COMMITTER_EMAIL='t@example.com')
        subprocess.run(['git','-C',str(self.repo)]+list(args),check=True,capture_output=True,env=env)
    def snapshot(self,feed):
        collect([SOURCE],self.repo/'public',feed if callable(feed) else (lambda _:feed),lambda _:None)
        self.git('add','-A')
        self.git('commit','-q','-m','snapshot')
        ingest_snapshot(self.live,self.repo/'public',[SOURCE])  # the incrementally maintained store
    def history(self):
        self.snapshot([posting(),posting('two')])
        self.snapshot([posting(text='Revised requirements'),posting('two')])
        self.snapshot(down)
        self.snapshot([posting(text='Revised requirements')])
    def fresh(self,name='rebuilt.sqlite3'):
        return connect(Path(self.tmp.name)/name)
    def test_rebuild_reproduces_incremental_store_exactly(self):
        self.history()
        conn=self.fresh()
        report=rebuild(conn,self.repo,[SOURCE])
        self.assertEqual((report['commits'],report['ingested_sources'],report['warnings']),(4,4,[]))
        self.assertEqual(dump(conn),dump(self.live))
        versions=conn.execute("select count(*) from posting_versions where posting_id='lever:sample:one'").fetchone()[0]
        self.assertEqual(versions,2)
        self.assertEqual(conn.execute("select availability from postings where posting_id='lever:sample:two'").fetchone()[0],'missing')
    def test_interrupted_rebuild_resumes_to_the_same_result(self):
        self.history()
        conn=self.fresh()
        real=persist.ingest_snapshot
        calls=[0]
        def crash(*args,**kwargs):
            calls[0]+=1
            if calls[0]==3: raise KeyboardInterrupt
            return real(*args,**kwargs)
        with mock.patch('engine.persist.ingest_snapshot',crash):
            with self.assertRaises(KeyboardInterrupt): rebuild(conn,self.repo,[SOURCE])
        self.assertEqual(conn.execute('select count(*) from source_runs').fetchone()[0],2)
        again=rebuild(conn,self.repo,[SOURCE])
        self.assertEqual(again['skipped'],{'already_ingested':1,'older_than_store':1})
        self.assertEqual(dump(conn),dump(self.live))
    def test_expiry_evidence_survives_rebuild_and_later_relisting_wins(self):
        now=lambda:datetime.now(timezone.utc).isoformat()
        self.snapshot([posting(),posting('two')])
        record_expiry(self.live,self.journal,'lever:sample:two',now(),'official page returned 410')
        self.snapshot([posting()])
        conn=self.fresh()
        self.assertEqual(rebuild(conn,self.repo,[SOURCE],journal=self.journal)['journal_events'],1)
        self.assertEqual(dump(conn),dump(self.live))
        self.assertEqual(conn.execute("select availability from postings where posting_id='lever:sample:two'").fetchone()[0],'expired')
        self.snapshot([posting(),posting('two')])  # relisted after the expiry evidence
        conn2=self.fresh('again.sqlite3')
        rebuild(conn2,self.repo,[SOURCE],journal=self.journal)
        self.assertEqual(conn2.execute("select availability from postings where posting_id='lever:sample:two'").fetchone()[0],'listed')
        self.assertEqual(dump(conn2),dump(self.live))
    def test_journal_refuses_anything_but_public_expiry_facts(self):
        for line in ({'event':'expired','posting_id':'x','at':'t','evidence':'e','candidate':'Farhan'},
                     {'event':'decision','posting_id':'x','status':'applied'}):
            self.journal.write_text(json.dumps(line)+'\n')
            with self.assertRaises(ValueError): read_journal(self.journal)
    def test_corrupt_cache_is_detected_and_rebuilt(self):
        self.history()
        path=Path(self.tmp.name)/'cache.sqlite3'
        conn=connect(path)
        rebuild(conn,self.repo,[SOURCE])
        conn.execute('pragma wal_checkpoint(truncate)')
        conn.close()
        data=bytearray(path.read_bytes())
        data[4096:8192]=b'\xff'*4096
        path.write_bytes(bytes(data))
        try:
            damaged=connect(path)
            healthy=check(damaged)==['ok']
            damaged.close()
        except Exception:
            healthy=False
        self.assertFalse(healthy)
        path.unlink()
        conn=connect(path)
        rebuild(conn,self.repo,[SOURCE])
        self.assertEqual(check(conn),['ok'])
        self.assertEqual(dump(conn),dump(self.live))
    def test_shallow_clone_is_refused(self):
        self.history()
        shallow=Path(self.tmp.name)/'shallow'
        subprocess.run(['git','clone','-q','--depth','1','file://%s'%self.repo,str(shallow)],check=True,capture_output=True)
        with self.assertRaises(RuntimeError): rebuild(self.fresh(),shallow,[SOURCE])
