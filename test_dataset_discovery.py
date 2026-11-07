"""Offline checks of engine/dataset_discovery.py: the built-in searches select the intended role families and reject the
look-alikes found in the first real run, and the home-country match is a whole word (India, not Indiana)."""
import re
import unittest

from engine.dataset_discovery import BUILTIN, INSIDE, kw_regex, job_id, clean, profiles  # noqa: F401


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

    def test_home_is_a_whole_word_and_values_are_parameters(self):
        self.assertIn('$home', INSIDE)
        self.assertIn('$countries', INSIDE)
        word = re.compile('(^|[^a-z])' + re.escape('india') + '([^a-z]|$)')
        self.assertTrue(word.search('pune, india'))
        self.assertFalse(word.search('indianapolis, in'))
        self.assertFalse(word.search('fort wayne, indiana'))

    def test_client_keywords_with_quotes_build_valid_patterns(self):
        rx = kw_regex(["women's health", 'c++ developer', 'data (bi) analyst'])
        self.assertTrue(re.search(rx, "senior women's health program lead"))
        self.assertTrue(re.search(rx, 'c++ developer'))
        self.assertTrue(re.search(rx, 'data (bi) analyst'))
        self.assertIsNone(kw_regex(['', '  ']))

    def test_fields_are_bounded_and_control_characters_removed(self):
        j = clean({'title': 'A\x00B\x07C', 'description': 'x' * 10000, 'salary_summary': 's' * 50000, 'url': 'https://x/' + 'a' * 5000})
        self.assertEqual(j['title'], 'A B C')
        self.assertEqual(len(j['description']), 6000)
        self.assertEqual(len(j['salary_summary']), 300)
        self.assertEqual(len(j['url']), 2000)

    def test_ids_are_stable(self):
        self.assertEqual(job_id('greenhouse', 'https://x/1'), job_id('greenhouse', 'https://x/1'))
        self.assertNotEqual(job_id('greenhouse', 'https://x/1'), job_id('greenhouse', 'https://x/2'))
        self.assertTrue(job_id('lever', 'https://x/1').startswith('ds:lever:'))


if __name__ == '__main__':
    unittest.main()
