import unittest
from recruiter_priority import rank

class PriorityTests(unittest.TestCase):
    def test_farhan_relevant_beats_sales(self):
        good=rank({'title':'CRM Implementation and Automation Lead'},'farhan')
        bad=rank({'title':'Affiliate Sales Manager'},'farhan')
        self.assertGreater(good['priority_score'],bad['priority_score'])
    def test_sana_energy_beats_software(self):
        good=rank({'title':'Power Plant Reliability Engineer'},'sana')
        bad=rank({'title':'Cloud Software Engineer'},'sana')
        self.assertGreater(good['priority_score'],bad['priority_score'])
    def test_priority_not_eligibility(self):
        self.assertTrue(rank({'title':'CRM Implementation'},'farhan')['priority_only'])
    def test_unknown_candidate(self):
        with self.assertRaises(ValueError): rank({},'invalid')

if __name__=='__main__': unittest.main()
