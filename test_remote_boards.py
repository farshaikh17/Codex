"""engine/remote_boards.py: each feed shape is parsed, filtered by the candidate's role rule, de-duplicated and merged; one
failing feed does not stop the others. No network: the fetch function is replaced."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import remote_boards as rb

RSS = b"""<rss><channel><item><title>Acme: Implementation Manager</title><link>https://weworkremotely.com/remote-jobs/acme-im</link>
<region>Anywhere in the World</region><description>&lt;p&gt;CRM work&lt;/p&gt;</description><pubDate>Fri, 06 Nov 2026 10:00:00 +0000</pubDate></item>
<item><title>Beta: Senior Software Engineer</title><link>https://weworkremotely.com/remote-jobs/beta-swe</link><region>USA Only</region>
<description>x</description><pubDate>Fri, 06 Nov 2026 10:00:00 +0000</pubDate></item></channel></rss>"""


def fake_get(url, timeout=30):
    if 'remoteok' in url:
        return json.dumps([{'legal': 'terms'}, {'position': 'RevOps Manager', 'company': 'Gamma', 'location': '', 'url': 'https://remoteOK.com/remote-jobs/1',
                                                 'description': '<b>Ops</b>', 'date': '2026-11-06T00:00:00+00:00', 'salary_min': 60000, 'salary_max': 0}]).encode()
    if 'weworkremotely' in url:
        return RSS
    if 'himalayas' in url:
        raise TimeoutError('feed down')
    return json.dumps([{'title': 'Reliability Engineer', 'company_name': 'Delta', 'url': 'https://www.workingnomads.com/jobs/2', 'location': 'Dubai',
                        'description': 'Plant', 'pub_date': '2026-11-06T00:00:00Z'}]).encode()


class RemoteBoards(unittest.TestCase):
    def test_parse_filter_merge(self):
        with tempfile.TemporaryDirectory() as d:
            prof = {'farhan_shaikh': {'role': 'implementation|revops', 'exclude': 'software'}, 'sana_ansari': {'role': 'reliability engineer', 'exclude': ''}}
            Path(d, 'profiles.json').write_text(json.dumps(prof))
            Path(d, 'jobsite_raw.json').write_text(json.dumps({'source': 'job_sites', 'jobs': [{'id': 'js:indeed:x', 'title': 'Kept'}]}))
            with mock.patch.object(rb, 'get', fake_get), mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'profiles.json')), '--out', d, '--days', '100000']):
                rb.main()
            jobs = json.loads(Path(d, 'jobsite_raw.json').read_text())['jobs']
            by = {j['ats_type']: j for j in jobs if j['id'] != 'js:indeed:x'}
            self.assertEqual(jobs[0]['id'], 'js:indeed:x', 'earlier job-site results are kept')
            self.assertEqual(by['weworkremotely']['company'], 'Acme')
            self.assertEqual(by['weworkremotely']['title'], 'Implementation Manager')
            self.assertEqual(by['weworkremotely']['location'], 'Anywhere in the World')
            self.assertEqual(by['remoteok']['candidates'], ['farhan_shaikh'])
            self.assertEqual(by['remoteok']['salary_min'], 60000)
            self.assertEqual(by['workingnomads']['candidates'], ['sana_ansari'])
            self.assertTrue(all(j.get('board') and j['is_remote'] for j in by.values()))
            self.assertEqual(len(by), 3, 'the software role was filtered out')
            report = json.loads(Path(d, 'boards_report.json').read_text())
            self.assertIn('error', report['himalayas'])


if __name__ == '__main__':
    unittest.main()
