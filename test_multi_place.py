"""Offline checks of plan B2: a Workday posting listed as "N Locations" is stored with its places, not the count."""
import json
import unittest
from unittest import mock

from engine import more_sources
from engine.multi_place import count_location, from_count, places_text, workday_path_place


class Places(unittest.TestCase):
    def test_count(self):
        self.assertEqual(count_location('8 Locations'), 8)
        self.assertEqual(count_location('1 Location'), 1)
        self.assertIsNone(count_location('Pune, India'))
        self.assertIsNone(count_location(''))

    def test_path_place(self):
        self.assertEqual(workday_path_place('https://4flow.wd3.myworkdayjobs.com/x/job/Berlin/AI-Engineer_R4362'), 'Berlin')
        self.assertEqual(workday_path_place('https://shell.wd3.myworkdayjobs.com/en-US/ShellCareers/job/Brockville---Lube-Plant/Maintenance-Millwright_R214965'),
                         'Brockville - Lube Plant')
        self.assertIsNone(workday_path_place('https://jobs.lever.co/x/job/Berlin/y'))

    def test_from_count_and_text(self):
        self.assertEqual(from_count('8 Locations', 'https://4flow.wd3.myworkdayjobs.com/x/job/Berlin/AI-Engineer_R4362'), 'Berlin; +7 more')
        self.assertEqual(from_count('8 Locations', 'https://example.com/8'), '8 Locations', 'no place to read: the count stays')
        self.assertEqual(from_count('Pune, India', 'https://x.myworkdayjobs.com/a/job/Pune/b'), 'Pune, India')
        self.assertEqual(places_text(['Assen', 'Norg', 'Delfzijl - Tankenpark', 'Grijpskerk', 'Ameland Westgat'], 5, 'Netherlands'),
                         'Assen; Norg; Delfzijl - Tankenpark; +2 more (Netherlands)')
        self.assertEqual(places_text(['Pune', 'Chennai'], 2, 'India'), 'Pune; Chennai (India)')
        self.assertEqual(places_text(['Pune, India', 'pune, india'], None, 'India'), 'Pune, India')

    def test_workday_detail_lists_the_places(self):
        j = {'url': 'https://shell.wd3.myworkdayjobs.com/en-US/ShellCareers/job/Assen/E-I-Technician_R212193', 'location': 'Assen; +4 more', 'posted_at': ''}
        info = {'jobPostingInfo': {'jobDescription': 'Maintain things.', 'location': 'Assen', 'additionalLocations': ['Norg', 'Delfzijl - Tankenpark', 'Grijpskerk', 'Ameland Westgat'],
                                   'jobRequisitionLocation': {'country': {'descriptor': 'Netherlands'}}}}
        with mock.patch.object(more_sources, 'http', lambda *a, **k: json.dumps(info)):
            more_sources._detail_workday(j)
        self.assertEqual(j['location'], 'Assen; Norg; Delfzijl - Tankenpark; +2 more (Netherlands)')
        one = {'url': j['url'], 'location': 'Assen', 'posted_at': ''}
        with mock.patch.object(more_sources, 'http', lambda *a, **k: json.dumps(info)):
            more_sources._detail_workday(one)
        self.assertEqual(one['location'], 'Assen', 'a posting listed with one place keeps it')


if __name__ == '__main__':
    unittest.main()
