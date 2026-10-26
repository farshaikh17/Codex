import json,os,tempfile,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from collect import collect,public_job,due_sources,redact,exclusive_lock,verify_publication
from unittest import mock
SOURCE={'id':'sample-lever','provider':'lever','board':'sample','url':'https://api.lever.co/v0/postings/sample?mode=json'}
def posting(text='Full public description'):
    return {'id':'one','text':'Implementation Manager','hostedUrl':'https://jobs.lever.co/sample/one','descriptionPlain':text,'categories':{'location':'India'},'workplaceType':'remote'}
class CollectionTests(unittest.TestCase):
    def test_incremental_failure_and_removal(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            run=lambda data:collect([SOURCE],path,lambda _:data,lambda _:None)
            self.assertEqual(run([posting()])['jobs'][0]['change'],'new')
            self.assertEqual(run([posting()])['jobs'][0]['change'],'unchanged')
            self.assertEqual(run([posting('changed')])['jobs'][0]['change'],'changed')
            observed=run([posting()])['jobs'][0]['observed_at']
            def fail(_):raise OSError('network unavailable')
            failed=collect([SOURCE],path,fail,lambda _:None)
            self.assertEqual(failed['status'],'failed')
            self.assertEqual(failed['jobs'][0]['observed_at'],observed)
            self.assertEqual(failed['jobs'][0]['change'],'unknown_after_failure')
            empty=run([])
            self.assertEqual(empty['listing_count'],0)
            self.assertEqual(empty['sources'][0]['no_longer_listed'],['lever:sample:one'])
    def test_public_only_and_complete_description(self):
        job=public_job(SOURCE,posting('X'*50000),'test-date')
        self.assertEqual(len(job['description']),50000)
        self.assertFalse(set(job)&{'raw','history','eligibility','pay','profile','candidate'})
    def test_duplicate_feed_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            collect([SOURCE],path,lambda _:[posting()],lambda _:None)
            result=collect([SOURCE],path,lambda _:[posting(),posting()],lambda _:None)
            self.assertEqual(result['status'],'failed')
            self.assertEqual(result['listing_count'],1)
    def test_other_adapters(self):
        from adapters import normalize
        gh=normalize('greenhouse','sample',{'id':123,'title':'Role','location':{'name':'India'},'absolute_url':'https://example.com/123','content':'<p>Complete JD</p>'})
        self.assertEqual(gh['description'],'Complete JD')
        ash=normalize('ashby','sample',{'id':'xyz','title':'Role','location':'India','isRemote':True,'jobUrl':'https://example.com/xyz','descriptionPlain':'Complete JD'})
        self.assertTrue(ash['remote_flag'])
        self.assertEqual(ash['description'],'Complete JD')
OTHER={'id':'other-ashby','provider':'ashby','board':'other','url':'https://api.ashbyhq.com/posting-api/job-board/other'}
def ashby():
    return {'jobs':[{'id':'two','title':'Support Lead','jobUrl':'https://jobs.ashbyhq.com/other/two','descriptionPlain':'JD','location':'Remote'}]}
def by_source(data):
    return lambda source:data[source['id']]() if callable(data[source['id']]) else data[source['id']]
def snapshot(path):
    return {p.relative_to(path).as_posix():p.read_bytes() for p in path.rglob('*') if p.is_file()}
class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.out=Path(self.tmp.name)/'public'
    def tearDown(self): self.tmp.cleanup()
    def run_both(self,**kw):
        return collect([SOURCE,OTHER],self.out,by_source({'sample-lever':[posting()],'other-ashby':ashby}),lambda _:None,**kw)
    def test_zero_sources_never_publishes(self):
        self.run_both()
        before=snapshot(self.out)
        with self.assertRaises(ValueError): collect([],self.out,lambda _:[],lambda _:None)
        self.assertEqual(snapshot(self.out),before)
    def test_crash_mid_run_leaves_previous_publication_intact(self):
        self.run_both()
        before=snapshot(self.out)
        def crash(source):
            if source['id']=='other-ashby': raise KeyboardInterrupt
            return [posting('changed text')]
        with self.assertRaises(KeyboardInterrupt): collect([SOURCE,OTHER],self.out,crash,lambda _:None)
        self.assertEqual(snapshot(self.out),before)
        self.assertFalse(list(Path(self.tmp.name).glob('.collect-staging-*')))
    def test_crash_during_replacement_is_detected_not_silent(self):
        self.run_both(run_id='gen1')
        self.assertEqual(verify_publication(self.out),[])
        real=os.replace
        moves=[]
        def flaky(src,dst):
            if '.collect-staging-' in str(src) and '.collect-staging-' not in str(dst):
                moves.append(dst)
                if len(moves)==2: raise OSError('simulated crash during replacement')
            return real(src,dst)
        with mock.patch('collect.os.replace',flaky):
            with self.assertRaises(OSError): self.run_both(run_id='gen2')
        runs={p.name:json.loads(p.read_text())['run_id'] for p in (self.out/'boards').glob('*.json')}
        self.assertEqual(sorted(runs.values()),['gen1','gen2'])  # mixed generations really are on disk
        self.assertEqual(json.loads((self.out/'status.json').read_text())['run_id'],'gen1')
        problems=verify_publication(self.out)
        self.assertTrue(problems)
        self.assertTrue(any('does not match status.json run gen1' in p for p in problems))
        self.run_both(run_id='gen3')  # next complete run repairs it
        self.assertEqual(verify_publication(self.out),[])
    def test_manifest_covers_carried_boards(self):
        self.run_both(run_id='gen1')
        collect([SOURCE,OTHER],self.out,lambda s:[posting('x')],lambda _:None,due={'sample-lever'},run_id='gen2')
        manifest=json.loads((self.out/'status.json').read_text())['manifest']
        self.assertEqual(sorted(manifest),['boards/other-ashby.json','boards/sample-lever.json','index.json'])
        self.assertEqual(verify_publication(self.out),[])
        (self.out/'boards/other-ashby.json').write_text('{}')
        self.assertEqual(verify_publication(self.out),['boards/other-ashby.json does not match status.json run gen2'])
    def test_legacy_status_without_manifest_is_unverifiable(self):
        self.out.mkdir(parents=True,exist_ok=True)
        (self.out/'status.json').write_text('{"schema":"public-job-index-1"}')
        self.assertIn('no manifest',verify_publication(self.out)[0])
    def test_run_id_links_boards_index_and_status(self):
        result=self.run_both(run_id='gh-1-1',trigger='workflow_dispatch')
        status=json.loads((self.out/'status.json').read_text())
        board=json.loads((self.out/'boards/sample-lever.json').read_text())
        self.assertEqual((result['run_id'],status['run_id'],board['run_id']),('gh-1-1',)*3)
        self.assertNotIn('jobs',status)
        self.assertEqual(status['trigger'],'workflow_dispatch')
    def test_failure_history_and_last_known_good(self):
        first=self.run_both()
        good_at=first['attempted_at']
        def down(source):
            if source['id']=='other-ashby': raise OSError('HTTP Error 503 for https://user:pw@api.ashbyhq.com/x?token=abc')
            return [posting()]
        for n in (1,2):
            result=collect([SOURCE,OTHER],self.out,down,lambda _:None)
            other=result['sources'][1]
            self.assertEqual((result['status'],other['status'],other['consecutive_failures']),('partial','failed',n))
            self.assertEqual(other['last_success_at'],good_at)
            self.assertNotIn('pw',other['error'])
            self.assertNotIn('abc',other['error'])
        retained=[j for j in result['jobs'] if j['key'].startswith('ashby')]
        self.assertEqual((retained[0]['observed_at'],retained[0]['change']),(good_at,'unknown_after_failure'))
        self.assertEqual(self.run_both()['sources'][1]['consecutive_failures'],0)
    def test_all_failed_is_failed_not_ok(self):
        self.run_both()
        def down(_): raise OSError('offline')
        result=collect([SOURCE,OTHER],self.out,down,lambda _:None)
        self.assertEqual(result['status'],'failed')
        self.assertIn('last-known-good',result['outcome'])
        self.assertEqual(result['listing_count'],2)
    def test_not_due_sources_carried_without_requests(self):
        first=self.run_both()
        asked=[]
        def fetch(source):
            asked.append(source['id'])
            return [posting()]
        result=collect([SOURCE,OTHER],self.out,fetch,lambda _:None,due={'sample-lever'})
        self.assertEqual(asked,['sample-lever'])
        self.assertEqual((result['status'],result['not_due_sources'],result['attempted_sources']),('ok',1,1))
        other=result['sources'][1]
        # status is the latest real attempt, unchanged; only attempted_this_run says it was not this run
        self.assertEqual((other['status'],other['attempted_this_run'],other['checked_at']),('ok',False,first['sources'][1]['checked_at']))
        board=json.loads((self.out/'boards/other-ashby.json').read_text())
        self.assertEqual(board['collected_at'],other['checked_at'])
        self.assertEqual([j['change'] for j in result['jobs'] if j['key'].startswith('ashby')],['not_checked'])
        again=collect([SOURCE,OTHER],self.out,fetch,lambda _:None,due={'sample-lever'})
        self.assertEqual(again['sources'][1]['checked_at'],first['sources'][1]['checked_at'])
    def test_every_published_source_state_is_a_real_attempt(self):
        """Consumers such as the posting store accept only ok/failed attempts with a checked_at."""
        collect([SOURCE],self.out,lambda _:[posting()],lambda _:None)
        asked=[]
        def fetch(source):
            asked.append(source['id'])
            return by_source({'sample-lever':[posting()],'other-ashby':ashby})(source)
        result=collect([SOURCE,OTHER],self.out,fetch,lambda _:None,due={'sample-lever'})
        self.assertEqual(asked,['sample-lever','other-ashby'])  # never attempted, so attempted anyway
        for s in json.loads((self.out/'status.json').read_text())['sources']:
            self.assertIn(s['status'],('ok','failed'))
            self.assertTrue(s['checked_at'])
            if s['status']=='ok':
                self.assertEqual(json.loads((self.out/'boards'/(s['source']+'.json')).read_text())['collected_at'],s['checked_at'])
    def test_carried_failure_keeps_failure_count(self):
        self.run_both()
        def down(source):
            if source['id']=='other-ashby': raise OSError('offline')
            return [posting()]
        collect([SOURCE,OTHER],self.out,down,lambda _:None)
        result=collect([SOURCE,OTHER],self.out,down,lambda _:None,due={'sample-lever'})
        other=result['sources'][1]
        self.assertEqual((other['status'],other['consecutive_failures'],other['attempted_this_run']),('failed',1,False))
        self.assertEqual(result['failed_sources'],0)
    def test_due_selection(self):
        now=datetime(2026,10,26,12,tzinfo=timezone.utc)
        status={'sources':[{'source':'sample-lever','checked_at':(now-timedelta(hours=4,minutes=50)).isoformat()},
                           {'source':'other-ashby','checked_at':(now-timedelta(hours=2)).isoformat()}]}
        self.assertEqual(due_sources([SOURCE|{'poll_interval_hours':5},OTHER|{'poll_interval_hours':5}],status,now),{'sample-lever'})
        self.assertEqual(due_sources([SOURCE,OTHER|{'poll_interval_hours':1}],status,now),{'sample-lever','other-ashby'})
        self.assertEqual(due_sources([SOURCE],{},now),{'sample-lever'})
    def test_owner_schedule_collects_every_run_without_an_interval(self):
        # Owner's five daily runs (01:37, 06:37, 11:37, 16:37, 21:37 UTC) include a 4-hour gap: no source may be skipped there.
        now=datetime(2026,10,27,1,37,tzinfo=timezone.utc)
        status={'sources':[{'source':s,'checked_at':(now-timedelta(hours=4)).isoformat()} for s in ('sample-lever','other-ashby')]}
        self.assertEqual(due_sources([SOURCE,OTHER],status,now),{'sample-lever','other-ashby'})
        daily=OTHER|{'poll_interval_hours':24}
        self.assertEqual(due_sources([SOURCE,daily],status,now),{'sample-lever'})  # an opt-in interval still waits
        result=collect([SOURCE],self.out,lambda _:[posting()],lambda _:None)
        self.assertEqual((result['sources'][0]['poll_interval_hours'],result['sources'][0]['next_due_at']),(None,None))
    def test_redaction(self):
        text=redact('GET https://me:secret@host/x?api_key=K1&page=2 Authorization: Bearer abc.def')
        for leaked in ('secret','K1','abc.def'): self.assertNotIn(leaked,text)
        self.assertIn('page=2',text)
    def test_concurrent_run_refused(self):
        lock=Path(self.tmp.name)/'.collect.lock'
        with exclusive_lock(lock):
            with self.assertRaises(RuntimeError):
                with exclusive_lock(lock): pass
        with exclusive_lock(lock): pass
if __name__=='__main__':unittest.main()

