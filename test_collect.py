import tempfile,unittest
from pathlib import Path
from collect import collect,public_job
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
if __name__=='__main__':unittest.main()

