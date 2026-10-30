import unittest
from recruiter_triage import triage

class TriageTests(unittest.TestCase):
    def test_excluded_role(self):
        self.assertEqual(triage({'title':'DevOps Engineer','url':'https://example.com/1'}, 'farhan').status, 'REJECT')
    def test_us_only(self):
        self.assertEqual(triage({'title':'CRM Implementation','location':'US only','url':'https://example.com/1'}, 'farhan').status, 'REJECT')
    def test_unknown_india(self):
        d=triage({'title':'CRM Implementation','location':'Remote','url':'https://example.com/1'}, 'farhan')
        self.assertEqual(d.status, 'HOLD')
        self.assertIn('India work eligibility not affirmatively established', d.reasons)
    def test_india_not_auto_ready(self):
        self.assertEqual(triage({'title':'CRM Implementation','location':'Remote India','url':'https://example.com/1','description':'workflow '*100}).status,'HOLD')
    def test_sana_not_farhan_filters(self):
        self.assertEqual(triage({'title':'Electrical Maintenance Engineer','location':'Dubai','url':'https://example.com/1'},'sana').status,'HOLD')
    def test_invalid_candidate(self):
        with self.assertRaises(ValueError): triage({},'other')

if __name__=='__main__': unittest.main()
