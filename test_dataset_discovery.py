"""Offline checks of engine/dataset_discovery.py: the built-in searches select the intended role families and reject the
look-alikes found in the first real run, and the home-country match is a whole word (India, not Indiana)."""
import re
import unittest

from engine.dataset_discovery import BUILTIN, location_sql, job_id


def picks(cid, title):
    p = BUILTIN[cid]
    t = title.lower()
    return bool(re.search(p['role'], t)) and not (p.get('exclude') and re.search(p['exclude'], t))


class Searches(unittest.TestCase):
    def test_farhan(self):
        for t in ['Senior Implementation Consultant', 'Solutions Engineer', 'Zoho CRM Developer', 'Revenue Operations Analyst',
                  'Integration Specialist', 'Business Systems Analyst: Salesforce', 'Technical Operations Manager']:
            self.assertTrue(picks('farhan_shaikh', t), t)
        for t in ['Operations Executive (PUW)', 'Warehouse Operations Associate', 'QA Automation Engineer', 'Site Reliability Engineer',
                  'Software Engineer, Integrations', 'Team Sales Manager']:
            self.assertFalse(picks('farhan_shaikh', t), t)

    def test_sana(self):
        for t in ['Repair & Maintenance Engineer', 'Commissioning Engineer', 'Solar O&M Engineer', 'Electrical Engineer – Power System Studies',
                  'Maintenance Manager', 'Substation Engineer']:
            self.assertTrue(picks('sana_ansari', t), t)
        for t in ['Site Reliability Engineer', 'Customer Reliability Engineer', 'Product Reliability Engineer', 'Power BI Developer',
                  'Network Reliability Engineer', 'Commercial Energy Sales Executive']:
            self.assertFalse(picks('sana_ansari', t), t)

    def test_home_is_a_whole_word(self):
        where, inside = location_sql(BUILTIN['farhan_shaikh'])
        rx = re.search(r"'\(\^\|\[\^a-z\]\)(\w+)\(\[\^a-z\]\|\$\)'", inside)
        self.assertIsNotNone(rx, inside)
        word = re.compile(r'(^|[^a-z])india([^a-z]|$)')
        self.assertTrue(word.search('pune, india'))
        self.assertFalse(word.search('indianapolis, in'))
        self.assertFalse(word.search('fort wayne, indiana'))

    def test_ids_are_stable(self):
        self.assertEqual(job_id('greenhouse', 'https://x/1'), job_id('greenhouse', 'https://x/1'))
        self.assertNotEqual(job_id('greenhouse', 'https://x/1'), job_id('greenhouse', 'https://x/2'))
        self.assertTrue(job_id('lever', 'https://x/1').startswith('ds:lever:'))


if __name__ == '__main__':
    unittest.main()
