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
    if 'un.org' in url:
        return json.dumps({'data': {'list': [{'jobId': 5, 'postingTitle': 'Energy Efficiency Consultant', 'jobDescription': 'Home-based assignment',
                                              'startDate': '2026-11-05T00:00:00Z'}]}}).encode()
    raise TimeoutError('down')


class MoreSources(unittest.TestCase):
    def test_parse_and_filter(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'profiles.json').write_text(json.dumps({'farhan_shaikh': {'role': 'revops', 'exclude': ''},
                                                            'sana_ansari': {'role': 'maintenance engineer|reliability engineer|energy efficiency', 'exclude': ''}}))
            with mock.patch.object(ms, 'http', fake_http), mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'profiles.json')), '--out', d, '--days', '100000']):
                ms.main()
            jobs = {j['ats_type']: j for j in json.loads(Path(d, 'jobsite_raw.json').read_text())['jobs']}
            self.assertEqual(jobs['workable']['location'], 'Remote (India)'); self.assertEqual(jobs['workable']['candidates'], ['farhan_shaikh'])
            self.assertTrue(jobs['arbeitnow']['description'].startswith('Visa sponsorship available.'))
            self.assertEqual(jobs['successfactors']['title'], 'Reliability Engineer'); self.assertEqual(jobs['successfactors']['location'], 'Riyadh, SA, 11564')
            self.assertEqual(jobs['successfactors']['company'], 'ENGIE')
            self.assertTrue(jobs['uncareers']['is_remote']); self.assertEqual(jobs['uncareers']['location'], 'Remote (home-based)')
            report = json.loads(Path(d, 'more_sources_report.json').read_text())
            for name in ('eightfold', 'siemens_energy', 'getro'):
                self.assertIn('error', report[name], name)


if __name__ == '__main__':
    unittest.main()
