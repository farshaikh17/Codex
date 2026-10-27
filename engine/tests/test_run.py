import contextlib,io,json,subprocess,sys,tempfile,unittest
from datetime import datetime,timedelta
from pathlib import Path
from unittest import mock
from collect import collect
import engine.run as er
from engine import store as st
from engine.benchmark import FIXTURES
from engine.lock import LockBusy,RunLock
from engine.tests.test_store import posting
ROOT=Path(__file__).resolve().parents[2]
def source(board):
    return {'id':board+'-lever','provider':'lever','board':board,'url':'https://api.lever.co/v0/postings/%s?mode=json'%board}
A,B=source('alpha'),source('beta')
class Clock:
    """A monotonic clock that advances a fixed step on every reading."""
    def __init__(self,step):
        self.t,self.step=0.0,step
    def __call__(self):
        self.t+=self.step
        return self.t
class RunTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.dir=Path(self.tmp.name)
        self.public,self.db=self.dir/'public',self.dir/'state'/'engine.sqlite3'
        self.sources=self.dir/'sources.json'
        self.sources.write_text(json.dumps([A,B]))
    def tearDown(self):
        self.tmp.cleanup()
    def collect(self,feeds):
        """feeds: {source: [postings] or an exception}"""
        def fetch(s):
            f=feeds[s['id']]
            if isinstance(f,Exception): raise f
            return f
        collect([A,B],self.public,fetch,lambda _:None)
        return json.loads((self.public/'status.json').read_text())['attempted_at']
    def engine_run(self,hours_after=1,**kw):
        attempted=json.loads((self.public/'status.json').read_text())['attempted_at']
        now=(datetime.fromisoformat(attempted)+timedelta(hours=hours_after)).isoformat()
        return er.run(self.db,self.public,self.sources,pages_root=self.dir,now=now,**kw)
    def runs(self):
        conn=st.connect(self.db)
        try: return [dict(r) for r in conn.execute('select * from engine_runs order by run_id')]
        finally: conn.close()
    def test_clean_run_then_noop_rerun_with_history(self):
        self.collect({'alpha-lever':[posting('a1'),posting('a2')],'beta-lever':[posting('b1')]})
        first=self.engine_run()
        self.assertEqual((first['outcome'],first['reasons']),('ok',[]))
        self.assertEqual({k:first['counts'][k] for k in ('collected','new','extracted','extraction_pending')},{'collected':3,'new':3,'extracted':3,'extraction_pending':0})
        self.assertEqual(first['freshness']['counts'],{'fresh':2})
        self.assertEqual({n:s['status'] for n,s in first['stages'].items()},
                         {'ingest':'ok','extract':'ok','leads':'skipped','outputs':'skipped','candidates':'skipped'})
        again=self.engine_run()
        self.assertEqual((again['outcome'],again['counts']['collected'],again['counts']['extracted']),('ok',0,0),'an unchanged snapshot does no work')
        self.assertEqual([r['outcome'] for r in self.runs()],['ok','ok'])
        conn=st.connect(self.db)
        self.assertEqual([h['run_id'] for h in er.history(conn)],[2,1])
        conn.close()
    def test_failed_source_makes_the_run_partial_and_the_source_failing(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        self.engine_run()
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':OSError('feed down')})
        out=self.engine_run()
        self.assertEqual(out['outcome'],'partial')
        self.assertIn('1 source retrieval(s) failed in this snapshot: beta-lever',out['reasons'])
        beta=next(f for f in out['freshness']['sources'] if f['source']=='beta-lever')
        self.assertEqual((beta['state'],beta['consecutive_failures']),('failing',1))
        self.assertEqual(out['counts']['postings']['inaccessible'],1)
    def test_source_not_attempted_by_the_collector_changes_nothing_and_never_crashes_ingest(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        self.engine_run()
        status=json.loads((self.public/'status.json').read_text())
        beta=next(s for s in status['sources'] if s['source']=='beta-lever')
        beta.update(status='not_attempted',not_attempted_reason='backoff until 2031-01-01',checked_at='2031-01-01T00:00:00+00:00')
        alpha=next(s for s in status['sources'] if s['source']=='alpha-lever')
        alpha['status']='skipped'
        alpha.pop('checked_at')
        (self.public/'status.json').write_text(json.dumps(status))
        out=self.engine_run()
        self.assertEqual(out['outcome'],'partial')
        self.assertIn('2 source(s) not attempted in this snapshot: alpha-lever, beta-lever',out['reasons'])
        conn=st.connect(self.db)
        self.assertEqual({r[0] for r in conn.execute('select availability from postings')},{'listed'},'a skipped source is not evidence about its postings')
        self.assertEqual(conn.execute('select count(*) from source_runs').fetchone()[0],2,'no retrieval was recorded for a skipped source')
        conn.close()
    def test_stale_snapshot_and_sources_are_reported(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        out=self.engine_run(hours_after=30)
        self.assertEqual(out['outcome'],'partial')
        self.assertEqual(out['freshness']['counts'],{'stale':2})
        self.assertTrue(any(r.startswith('latest snapshot is 30.0 hours old') for r in out['reasons']))
        self.assertIn('source freshness: 2 stale',out['reasons'])
    def test_a_daily_source_is_judged_against_its_own_poll_interval(self):
        self.sources.write_text(json.dumps([A,B|{'poll_interval_hours':24}]))
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        state=lambda out:{f['source']:f['state'] for f in out['freshness']['sources']}
        self.assertEqual(state(self.engine_run(hours_after=20)),{'alpha-lever':'stale','beta-lever':'fresh'})
        self.assertEqual(state(self.engine_run(hours_after=31))['beta-lever'],'stale','a missed daily poll is stale')
    def test_expected_source_never_reported_is_flagged(self):
        self.sources.write_text(json.dumps([A,B,source('gamma')]))
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        out=self.engine_run()
        self.assertIn('source freshness: 1 not_reported',out['reasons'])
    def test_extraction_time_budget_stops_cleanly_and_the_next_run_resumes(self):
        self.collect({'alpha-lever':[posting('a%d'%n) for n in range(250)],'beta-lever':[posting('b1')]})
        out=self.engine_run(extract_budget_seconds=15,clock=Clock(10))
        self.assertEqual(out['outcome'],'partial')
        self.assertEqual((out['counts']['extracted'],out['counts']['extraction_pending']),(200,51),'two batches of 100 fit the budget')
        self.assertTrue(any('time budget' in r for r in out['reasons']))
        resumed=self.engine_run()
        self.assertEqual((resumed['outcome'],resumed['counts']['extracted'],resumed['counts']['extraction_pending']),('ok',51,0))
    def test_core_stage_failure_is_recorded_and_the_next_run_resumes(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        with mock.patch.object(st,'extract_pending',side_effect=RuntimeError('disk full')):
            with self.assertRaises(RuntimeError):self.engine_run()
        failed=self.runs()[-1]
        self.assertEqual((failed['outcome'],failed['error']),('failed','RuntimeError: disk full'))
        self.assertEqual(json.loads(failed['report'])['stages']['ingest']['status'],'ok','ingest committed before the failure')
        out=self.engine_run()
        self.assertEqual((out['outcome'],out['counts']['extracted'],out['counts']['collected']),('ok',2,0))
    def test_a_run_that_died_is_reported_as_interrupted(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        conn=st.connect(self.db)
        with conn: conn.execute("insert into engine_runs(started_at,outcome) values('2026-10-26T00:00:00+00:00','running')")
        conn.close()
        out=self.engine_run()
        self.assertEqual(out['previous_interrupted'],[1])
        self.assertEqual([r['outcome'] for r in self.runs()],['interrupted','ok'])
    def test_optional_stage_failure_is_partial_and_later_stages_still_run(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        blocker=self.dir/'not-a-directory'
        blocker.write_text('x')
        out=self.engine_run(public_out=blocker)
        self.assertEqual((out['outcome'],out['stages']['outputs']['status'],out['stages']['candidates']['status']),('partial','failed','skipped'))
        self.assertIn('stage outputs failed',out['reasons'][0])
    def test_public_outputs_are_written_and_verified(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        out=self.engine_run(public_out=self.dir/'out')
        self.assertEqual((out['outcome'],out['stages']['outputs']['detail']['verified'],out['stages']['outputs']['detail']['totals']['listed']),('ok',True,2))
    def test_candidate_counts_stay_out_of_the_store(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        out=self.engine_run(candidates_dir=FIXTURES,queue_path=self.dir/'private'/'queue.sqlite3')
        ids=sorted(out['candidates'])
        self.assertGreaterEqual(len(ids),2)
        self.assertEqual(out['candidates'][ids[0]]['enqueue']['new_items'],2)
        stored=json.dumps(self.runs())
        self.assertFalse(any(i in stored for i in ids),'the public store never holds candidate ids')
        bad=self.dir/'bad-candidates'
        bad.mkdir()
        for name in ('one.json','two.json'): (bad/name).write_text((FIXTURES/(ids[0]+'.json')).read_text())
        out=self.engine_run(candidates_dir=bad,queue_path=self.dir/'private'/'queue.sqlite3')
        self.assertEqual((out['outcome'],out['stages']['candidates']['error']),('partial','ConfigError'),'the error message (which names the candidate) is not stored')
        self.assertNotIn(ids[0],json.dumps(self.runs()))
    def test_discovery_plan_is_private_and_not_counted_as_executed_work(self):
        self.collect({'alpha-lever':[posting('a1')],'beta-lever':[posting('b1')]})
        directory=self.dir/'discovery-candidates'
        directory.mkdir()
        candidate=json.loads(next(FIXTURES.glob('*.json')).read_text())
        candidate['rules']['discovery']={'lanes':[
            {'id':'private-lane-canary','share':100,'queries':['private-query-canary'],
             'sources':['private-source-canary']}]}
        (directory/'person.json').write_text(json.dumps(candidate))
        out=self.engine_run(candidates_dir=directory,queue_path=self.dir/'private'/'queue.sqlite3')
        tasks=out['candidates'][candidate['candidate_id']]['discovery_plan']['tasks']
        self.assertEqual(len(tasks),10)
        self.assertTrue(all(t['stage']=='planned_not_executed' for t in tasks))
        stored=json.dumps(self.runs())
        for secret in ('private-lane-canary','private-query-canary','private-source-canary',candidate['candidate_id']):
            self.assertNotIn(secret,stored)
class LockTests(unittest.TestCase):
    def test_second_holder_is_refused_with_the_holder_named(self):
        with tempfile.TemporaryDirectory() as d:
            db=Path(d)/'engine.sqlite3'
            with RunLock(db,'first run'):
                with self.assertRaises(LockBusy) as err:
                    with RunLock(db,'second run',wait_seconds=0.3,poll=0.05):pass
                self.assertEqual(err.exception.holder['purpose'],'first run')
            with RunLock(db,'after release'):pass
    def test_a_killed_holder_never_leaves_a_stale_lock(self):
        with tempfile.TemporaryDirectory() as d:
            db=Path(d)/'engine.sqlite3'
            code='import sys,time;from engine.lock import RunLock;l=RunLock(sys.argv[1],"doomed").__enter__();print("held",flush=True);time.sleep(60)'
            p=subprocess.Popen([sys.executable,'-c',code,str(db)],cwd=ROOT,stdout=subprocess.PIPE,text=True)
            try:
                self.assertEqual(p.stdout.readline().strip(),'held')
                with self.assertRaises(LockBusy):
                    with RunLock(db,'while held'):pass
                p.kill()
                p.wait()
                with RunLock(db,'after the holder died',wait_seconds=5):pass
            finally:
                p.kill();p.wait();p.stdout.close()
class CliTests(unittest.TestCase):
    def test_candidate_report_inside_the_repository_is_refused(self):
        with self.assertRaises(SystemExit),contextlib.redirect_stderr(io.StringIO()):
            er.main(['--db','/nonexistent/x.sqlite3','--candidates',str(FIXTURES),'--queue','/tmp/q','--report',str(ROOT/'report.json')])
        self.assertFalse((ROOT/'report.json').exists())
if __name__=='__main__':unittest.main()

