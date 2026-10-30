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

    def test_sana_software_reliability_is_low_priority(self):
        for title in ('Site Reliability Engineer - SRE', 'Sr. Engineer, Database Reliability', 'Senior Database Reliability Engineer - DBRE'):
            with self.subTest(title=title):
                self.assertLess(rank({'title':title},'sana')['priority_score'],3)

    def test_sana_physical_reliability_stays_high(self):
        self.assertGreaterEqual(rank({'title':'Reliability Field Engineer'},'sana')['priority_score'],5)

    def test_farhan_software_and_industrial_collisions_are_low(self):
        for title in ('Staff Engineer - CRM & Automation', 'Software Development Engineer II - CRM', 'Automation Engineer (Manufacturing Support)', 'Automation / CSV Engineer'):
            with self.subTest(title=title):
                self.assertLess(rank({'title':title},'farhan')['priority_score'],3)

if __name__=='__main__': unittest.main()
