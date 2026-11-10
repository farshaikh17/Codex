"""engine/more_sources.py: response shapes are parsed, role rules filter, one failing source is skipped. Offline."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import more_sources as ms

RSS = b"""<rss><channel><item><title>Reliability Engineer (Riyadh, SA, 11564)</title><link>https://careers.acwapower.com/job/1</link>
<description>Plant</description><pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>"""


def fake_http(url, data=None, headers=None, timeout=40):
    if 'workable' in url:
        return json.dumps({'jobs': [{'id': 'w1', 'title': 'RevOps Manager', 'url': 'https://jobs.workable.com/view/1', 'workplace': 'remote',
                                     'company': {'title': 'Acme'}, 'location': {'city': '', 'countryName': 'India'}, 'description': '<p>CRM</p>',
                                     'created': '2026-11-06T00:00:00Z'}], 'nextPageToken': None}).encode()
    if 'arbeitnow' in url:
        return json.dumps({'data': [{'title': 'Maintenance Engineer', 'company_name': 'Kraftwerk GmbH', 'url': 'https://www.arbeitnow.com/jobs/x',
                                     'location': 'Hamburg', 'remote': False, 'description': 'Turbines', 'created_at': 1794000000, 'visa_sponsorship': True}]}).encode()
    if 'services/rss' in url:
        return RSS
    if 'siemens-energy' in url:
        return (b'<rss><channel><item><title>Gas Turbine Field Service Technician</title><link>https://jobs.siemens-energy.com/jobs/FolderDetail/x/1</link>'
                b'<description>Canada</description><pubDate>Thu, 12 Sep 2024 00:00:00 +0000</pubDate></item></channel></rss>')
    if 'careers.fluor.com' in url:
        return json.dumps({'positions': [{'id': '1', 'name': 'Electrical Engineer IV', 'location': 'Houston, US-TX', 'work_location_option': 'onsite',
                                          'canonicalPositionUrl': 'https://careers.fluor.com/careers/job/1', 't_create': 1793970544, 'department': ['Engineering']}]}).encode()
    if 'careers.neom.com' in url or 'careers.taqa.com' in url:
        raise OSError('Name or service not known')
    if 'un.org' in url:
        return json.dumps({'data': {'list': [{'jobId': 5, 'postingTitle': 'Energy Efficiency Consultant', 'jobDescription': 'Home-based assignment',
                                              'startDate': '2026-11-05T00:00:00Z'}]}}).encode()
    raise TimeoutError('down')


class MoreSources(unittest.TestCase):
    def test_parse_and_filter(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'profiles.json').write_text(json.dumps({'farhan_shaikh': {'role': 'revops', 'exclude': ''},
                                                            'sana_ansari': {'role': 'maintenance engineer|reliability engineer|energy efficiency|turbine|electrical engineer', 'exclude': ''}}))
            with mock.patch.object(ms, 'http', fake_http), mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'profiles.json')), '--out', d, '--days', '30']):
                ms.main()
            jobs = {j['ats_type']: j for j in json.loads(Path(d, 'jobsite_raw.json').read_text())['jobs']}
            self.assertEqual(jobs['workable']['location'], 'Remote (India)'); self.assertEqual(jobs['workable']['candidates'], ['farhan_shaikh'])
            self.assertTrue(jobs['arbeitnow']['description'].startswith('Visa sponsorship available.'))
            self.assertEqual(jobs['successfactors']['title'], 'Reliability Engineer'); self.assertEqual(jobs['successfactors']['location'], 'Riyadh, SA, 11564')
            self.assertEqual(jobs['successfactors']['company'], 'ENGIE')
            self.assertTrue(jobs['uncareers']['is_remote']); self.assertEqual(jobs['uncareers']['location'], 'Remote (home-based)')
            self.assertEqual(jobs['avature']['title'], 'Gas Turbine Field Service Technician', 'an old posting date on an employer site is not a cutoff')
            self.assertEqual(jobs['eightfold']['company'], 'Fluor', 'one Eightfold host failing keeps the others')
            report = json.loads(Path(d, 'more_sources_report.json').read_text())
            self.assertIn('error', report['getro'])
            self.assertEqual(report['eightfold']['kept'], 1)


    def test_doosan_group_feed_skips_bobcat_postings(self):
        rss = (b'<rss><channel>'
               b'<item><title>Forklift Operator (Statesville, NC, US, 28625)</title><link>https://jobs.doosan.com/bobcat/job/Statesville-Forklift/1/</link><description>x</description></item>'
               b'<item><title>No jobs currently available - Check out our other sites</title><link>https://jobs.doosan.com/go/x/1/</link><description>x</description></item>'
               b'<item><title>Turbine Maintenance Engineer (Changwon, KR, 51392)</title><link>https://jobs.doosan.com/job/Changwon-Turbine-Maintenance/2/</link><description>x</description></item>'
               b'</channel></rss>')
        def only_doosan(url, data=None, headers=None, timeout=40):
            if 'jobs.doosan.com' in url:
                return rss
            return b'<rss><channel></channel></rss>'
        with mock.patch.object(ms, 'http', only_doosan):
            got = [j for j in ms.successfactors() if j['company'] == 'Doosan']
        self.assertTrue(got)
        self.assertTrue(all('/bobcat/' not in j['url'] for j in got), 'Bobcat postings are skipped')
        self.assertEqual({j['title'] for j in got}, {'Turbine Maintenance Engineer'})
        self.assertIn('Emirates Global Aluminium', [c[0] for c in ms.SUCCESSFACTORS])
        self.assertIn('Black & Veatch', [c[0] for c in ms.SUCCESSFACTORS])


    def test_workday_reads_public_career_sites(self):
        calls = []
        def fake(url, data=None, headers=None, timeout=40):
            calls.append((url, data))
            if 'kbr.wd5' in url:
                return json.dumps({'jobPostings': [{'title': 'Maintenance Engineer', 'externalPath': '/job/Saudi-Arabia-Rabigh/Maintenance-Engineer_R1',
                                                    'locationsText': 'Saudi Arabia, Rabigh'},
                                                   {'title': 'Remote Planner', 'externalPath': '/job/Remote/Planner_R2', 'locationsText': 'Remote - UK'}]}).encode()
            raise OSError('down')
        with mock.patch.object(ms, 'http', fake):
            got = list(ms.workday(pages=1))
        self.assertEqual([j['title'] for j in got], ['Maintenance Engineer', 'Remote Planner'], 'a repeated posting across search terms is read once; other tenants down keep KBR')
        self.assertEqual(got[0]['url'], 'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/Saudi-Arabia-Rabigh/Maintenance-Engineer_R1')
        self.assertEqual(got[0]['company'], 'KBR'); self.assertEqual(got[0]['location'], 'Saudi Arabia, Rabigh')
        self.assertFalse(got[0]['is_remote']); self.assertTrue(got[1]['is_remote'])
        self.assertEqual(calls[0][1]['searchText'], ms.SF_TERMS[0])
        self.assertEqual({c[0] for c in ms.WORKDAY}, {'KBR', 'GE Vernova', 'Hitachi'})

    def test_smartrecruiters_reads_public_postings(self):
        page = {'content': [{'id': '7', 'name': 'Reliability Engineer', 'releasedDate': '2026-11-10T10:00:00.000Z',
                             'location': {'fullLocation': 'Abu Dhabi, United Arab Emirates', 'remote': False},
                             'function': {'label': 'Engineering'}, 'industry': {'label': 'Renewables'}},
                            {'id': '8', 'name': 'Remote Analyst', 'location': {'city': 'Oslo', 'country': 'no', 'remote': True}}]}
        def fake(url, data=None, headers=None, timeout=40):
            if 'api.smartrecruiters.com' in url and '/Masdar/' in url:
                return json.dumps(page).encode()
            raise OSError('down')
        with mock.patch.object(ms, 'http', fake):
            got = list(ms.smartrecruiters())
        self.assertEqual([j['title'] for j in got], ['Reliability Engineer', 'Remote Analyst'], 'other employers failing keeps Masdar')
        self.assertEqual(got[0]['company'], 'Masdar')
        self.assertEqual(got[0]['url'], 'https://jobs.smartrecruiters.com/Masdar/7')
        self.assertEqual(got[0]['location'], 'Abu Dhabi, United Arab Emirates')
        self.assertTrue(got[1]['is_remote']); self.assertTrue(got[1]['location'].startswith('Remote'))
        self.assertIn('Statkraft1', [c[1] for c in ms.SMARTRECRUITERS])


if __name__ == '__main__':
    unittest.main()
