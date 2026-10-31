import unittest
from triage_collector import analyze

class CollectorBridgeTests(unittest.TestCase):
    def test_real_schema_and_dedup(self):
        job={'key':'lever:demo:1','title':'CRM Implementation Specialist','url':'https://jobs.lever.co/demo/1','locations':[{'text':'India'}],'workplace_type':'remote','description':'workflow '*100}
        board={'schema':'public-job-board-1','source':'demo','jobs':[job,dict(job)]}
        out=analyze(board,'farhan')
        self.assertEqual(out['jobs_seen'],2)
        self.assertEqual(out['unique_jobs'],1)
        self.assertEqual(out['counts'],{'HOLD':1})
        self.assertIn('compensation threshold not independently verified',out['results'][0]['reasons'])
    def test_explicit_us_only(self):
        job={'key':'lever:demo:2','title':'CRM Specialist','url':'https://jobs.lever.co/demo/2','locations':[{'text':'US only'}],'workplace_type':'remote','description':'workflow '*100}
        out=analyze({'schema':'public-job-board-1','source':'demo','jobs':[job]},'farhan')
        self.assertEqual(out['counts'],{'REJECT':1})
    def test_schema_guard(self):
        with self.assertRaises(ValueError): analyze({'schema':'unexpected','jobs':[]},'farhan')

if __name__=='__main__': unittest.main()
