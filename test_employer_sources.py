"""New employer career sites (14 Nov): Schneider Electric (Jibe JSON), Oracle entries with their own filters (Cummins India, Apraava,
Transguard, Wood Gulf), KBR Gulf and JLL on Workday, and Sana's engineering facilities titles. Offline, recorded samples."""
import json
import re
import unittest
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd
from engine import more_sources as ms

FIX = Path(__file__).resolve().parent / 'tests' / 'fixtures' / 'sources'
RULES = {c: (re.compile(p['role'], re.I), re.compile(p['exclude'], re.I) if p.get('exclude') else None) for c, p in dd.BUILTIN.items()}


class Jibe(unittest.TestCase):
    def test_schneider_india_list_with_text(self):
        page = (FIX / 'jibe_schneider_india.json').read_bytes()
        calls = []
        def fake(url, data=None, headers=None, timeout=40):
            calls.append(url)
            return page if 'location=India' in url else json.dumps({'jobs': []}).encode()
        with mock.patch.object(ms, 'http', fake):
            got = list(ms.jibe())
        self.assertEqual(got[0]['title'], 'Senior Engineer I, Design for Safety & Reliability')
        self.assertEqual(got[0]['company'], 'Schneider Electric'); self.assertEqual(got[0]['location'], 'India')
        self.assertEqual(got[0]['url'], 'https://careers.se.com/jobs/141433?lang=en-us')
        self.assertIn('Schneider Electric', got[0]['description']); self.assertIs(got[0]['board'], False)
        self.assertTrue(got[0]['posted_at'].startswith('2026-11-11'))
        self.assertEqual(len(calls), 3, 'one page per place when a page holds fewer than 100 postings')
        self.assertIn('jibe', ms.EMPLOYER_SITES)


class OracleEntries(unittest.TestCase):
    def test_filters_terms_and_gulf(self):
        calls = []
        rows = [{'Id': '1', 'Title': 'Maintenance Engineer', 'PostedDate': '2026-11-10', 'PrimaryLocation': 'Abu Dhabi, United Arab Emirates', 'WorkplaceType': 'On-site'},
                {'Id': '2', 'Title': 'Maintenance Engineer', 'PostedDate': '2026-11-10', 'PrimaryLocation': 'Basra, Iraq', 'WorkplaceType': 'On-site'}]
        def fake(url, data=None, headers=None, timeout=40):
            calls.append(url)
            return json.dumps({'items': [{'requisitionList': rows}]}).encode()
        with mock.patch.object(ms, 'http', fake):
            got = list(ms.oracle_hcm())
        by = {}
        for j in got:
            by.setdefault(j['company'], []).append(j)
        self.assertEqual(len(by['Wood']), 2, 'Wood worldwide and Wood Gulf share one seen-list: each posting once')
        cummins = [u for u in calls if 'fa-espx-saasfaprod1' in u]
        self.assertTrue(cummins and all('locationId=300000000440677' in u and 'keyword=' not in u for u in cummins), 'Cummins: India filter, no keyword')
        self.assertTrue(any('iaarcp' in u for u in calls) and any('iaboey' in u for u in calls), 'Apraava and Transguard are read')
        self.assertEqual({c[0] for c in ms.ORACLE}, {'Wood', 'Cummins', 'Apraava Energy', 'Transguard Group'})

    def test_gulf_entry_keeps_gulf_places_only(self):
        rows = [{'Id': '7', 'Title': 'Electrical Engineer', 'PrimaryLocation': 'Basra, Iraq'}, {'Id': '8', 'Title': 'Electrical Engineer', 'PrimaryLocation': 'Jubail, Saudi Arabia'}]
        with mock.patch.object(ms, 'ORACLE', [('Wood', 'h.example', 'CX_1', {'terms': ['Saudi Arabia'], 'pages': 1, 'gulf': True})]), \
                mock.patch.object(ms, 'http', lambda url, **k: json.dumps({'items': [{'requisitionList': rows}]}).encode()):
            got = list(ms.oracle_hcm())
        self.assertEqual([j['location'] for j in got], ['Jubail, Saudi Arabia'])


class WorkdayGulf(unittest.TestCase):
    def test_kbr_gulf_entry(self):
        rows = {'jobPostings': [{'title': 'Reliability Engineer', 'externalPath': '/job/Jubail/Reliability-Engineer_R9', 'locationsText': 'Jubail, Saudi Arabia'},
                                {'title': 'Reliability Engineer', 'externalPath': '/job/Houston/Reliability-Engineer_R8', 'locationsText': 'Houston, Texas'}]}
        with mock.patch.object(ms, 'WORKDAY', [('KBR', 'kbr', 'wd5', 'KBR_Careers', {'terms': ['Jubail'], 'gulf': True, 'pages': 1})]), \
                mock.patch.object(ms, 'http', lambda url, data=None, **k: json.dumps(rows).encode()):
            got = list(ms.workday())
        self.assertEqual([j['location'] for j in got], ['Jubail, Saudi Arabia'])


class FacilitiesTitles(unittest.TestCase):
    IN = ['Shift Engineer', 'Chief Engineer', 'Facility Manager – Engineering', 'Facility Manager - Technical', 'Facility Manager-Engineering',
          'Technical Supervisor', 'MEP Engineer', 'Facilities Engineer', 'Assistant Facility Manager - Technical', 'Shift In-charge']
    OUT = ['Facility Manager', 'Facility Manager - Admin', 'Office Facilities Manager', 'Facilities Coordinator', 'Workplace Experience Manager',
           'Facility Executive - Housekeeping', 'Chief Engineer, AI Platform', 'Technical Supervisor - Security Systems', 'Front Office Supervisor',
           'MEP Estimator', 'Administrative Assistant - Facilities', 'Soft Services Manager']

    def test_sana_engineering_facilities_titles_in_office_roles_out(self):
        for t in self.IN:
            self.assertIn('sana_ansari', ms.title_candidates(t, RULES), t)
        for t in self.OUT:
            self.assertNotIn('sana_ansari', ms.title_candidates(t, RULES), t)
        self.assertNotIn('farhan_shaikh', ms.title_candidates('Shift Engineer', RULES))

    def test_search_terms_include_them(self):
        for term in ('shift engineer', 'chief engineer', 'facility manager technical', 'MEP engineer'):
            self.assertIn(term, ms.QUERIES['sana_ansari'])
        jll = next(c for c in ms.WORKDAY if c[0] == 'JLL')
        self.assertIn('shift engineer', jll[4]['terms'])


if __name__ == '__main__':
    unittest.main()
