import unittest
from recruiter_triage import triage

class TriageTests(unittest.TestCase):
    def test_excluded_role(self):
        d=triage({'title':'DevOps Engineer','url':'https://example.com/1'}, 'farhan')
        self.assertEqual((d.status,d.evidence['queue']),('HOLD','below_relevance'))  # relevance routes, never rejects
    def test_us_only(self):
        self.assertEqual(triage({'title':'CRM Implementation','location':'US only','url':'https://example.com/1'}, 'farhan').status, 'REJECT')
    def test_unknown_india(self):
        d=triage({'title':'CRM Implementation','location':'Remote','url':'https://example.com/1'}, 'farhan')
        self.assertEqual(d.status, 'HOLD')
        self.assertTrue(any(r.startswith('India eligibility not established') for r in d.reasons))
    def test_india_not_auto_ready(self):
        self.assertEqual(triage({'title':'CRM Implementation','location':'Remote India','url':'https://example.com/1','description':'workflow '*100}).status,'HOLD')
    def test_sana_not_farhan_filters(self):
        self.assertEqual(triage({'title':'Electrical Maintenance Engineer','location':'Dubai','url':'https://example.com/1'},'sana').status,'HOLD')
    def test_invalid_candidate(self):
        with self.assertRaises(ValueError): triage({},'other')

    def test_salary_region_is_not_hiring_exclusion(self):
        job={'title':'CRM Implementation','location':'Remote India','url':'https://example.com/1',
             'description':'The base salary range for this role is for residents of the United States only. '+ 'workflow '*100}
        self.assertEqual(triage(job).status,'HOLD')

    def test_salary_notice_does_not_hide_separate_hiring_exclusion(self):
        job={'title':'CRM Implementation','location':'Remote','url':'https://example.com/1',
             'description':'Salary range is for the United States only. Applicants must reside in the US.'}
        self.assertEqual(triage(job).status,'REJECT')

if __name__=='__main__': unittest.main()
