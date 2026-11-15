"""New boards and watchlist employers (14 Nov): 4dayweek.io, Real Work From Anywhere, WWR customer support, the watchlist employers'
own boards (Lever, Ashby, Greenhouse, JazzHR, Workable), and the source-layer hold on reposting sites and VA staffing firms. Offline,
recorded samples."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import more_sources as ms
from engine import remote_boards as rb
from engine import reposters

FIX = Path(__file__).resolve().parent / 'tests' / 'fixtures' / 'sources'


class Boards(unittest.TestCase):
    def test_fourdayweek(self):
        calls = []
        def fake(url, timeout=30):
            calls.append(url)
            return (FIX / 'fourdayweek_india.json').read_bytes()
        with mock.patch.object(rb, 'get', fake):
            got = list(rb.fourdayweek())
        self.assertEqual(len(calls), 1, 'has_more false: one request')
        self.assertIn('country=India', calls[0]); self.assertIn('/api/v2/', calls[0])
        paired = next(j for j in got if j['title'] == 'Revenue Operations Manager')
        self.assertEqual(paired['company'], 'Paired', 'company from the address when the posting has no company object')
        self.assertIn('India', paired['location']); self.assertTrue(paired['location'].startswith('Remote ('))
        self.assertTrue(paired['url'].startswith('https://4dayweek.io/job/'), 'link back to 4dayweek.io')
        self.assertTrue(paired['is_remote']); self.assertIs(paired['board'], True)

    def test_real_work_from_anywhere(self):
        with mock.patch.object(rb, 'get', lambda url, timeout=30: (FIX / 'rwfa.xml').read_bytes()):
            got = list(rb.realworkfromanywhere())
        self.assertEqual((got[0]['title'], got[0]['company']), ('Marketing Operations', 'Metabase'))
        self.assertTrue(all(j['location'] == 'Remote (Worldwide)' for j in got))
        self.assertIn('realworkfromanywhere', rb.SOURCES); self.assertIn('fourdayweek', rb.SOURCES)

    def test_wwr_customer_support_category(self):
        self.assertIn('remote-customer-support-jobs', rb.WWR)


class WatchBoards(unittest.TestCase):
    def fake(self, url, data=None, headers=None, timeout=40):
        if 'api.lever.co/v0/postings/massive-rocket' in url:
            return (FIX / 'lever_massive_rocket.json').read_bytes()
        if 'api.ashbyhq.com/posting-api/job-board/uptimeai' in url:
            return (FIX / 'ashby_uptimeai.json').read_bytes()
        if 'boards-api.greenhouse.io/v1/boards/fingerprint/' in url:
            return (FIX / 'greenhouse_fingerprint.json').read_bytes()
        if url == 'https://monetizem.applytojob.com/apply/jobs/':
            return (FIX / 'jazzhr_monetizem.html').read_bytes()
        raise OSError('down')

    def test_each_system(self):
        with mock.patch.object(ms, 'http', self.fake):
            got = list(ms.watch_boards())
        by = {}
        for j in got:
            by.setdefault(j['company'], []).append(j)
        self.assertEqual(set(by), {'Massive Rocket', 'UptimeAI', 'Fingerprint', 'MonetizeMore'}, 'employers down (Sprinto, Paired ...) keep the others')
        crm = by['Massive Rocket'][0]
        self.assertEqual(crm['title'], '(Talent Pool) CRM Consultant - Latin America'); self.assertTrue(crm['is_remote'])
        self.assertTrue(crm['url'].startswith('https://jobs.lever.co/massive-rocket/'))
        impl = next(j for j in by['UptimeAI'] if j['title'] == 'Implementation Engineer')
        self.assertTrue(impl['url'].startswith('https://jobs.ashbyhq.com/uptimeai/'))
        se = next(j for j in by['Fingerprint'] if j['title'].startswith('Solutions Engineer'))
        self.assertTrue(se['description'])
        mm = by['MonetizeMore'][0]
        self.assertEqual(mm['title'], 'Group Product Manager (Remote)'); self.assertEqual(mm['location'], 'Remote (India)')
        self.assertTrue(mm['is_remote']); self.assertTrue(mm['posted_at'].startswith('2026-06-29'))
        self.assertTrue(all(j['board'] is False for j in got))
        self.assertEqual({w[0] for w in ms.WATCH}, {'MonetizeMore', 'Massive Rocket', 'Sprinto', 'UptimeAI', 'Canvas Medical', 'Fingerprint', 'Paired', 'Firework'})

    def test_jazzhr_detail_and_places(self):
        page = (FIX / 'jazzhr_monetizem_job.html').read_bytes()
        j = {'url': 'https://monetizem.applytojob.com/apply/jobs/details/QMtZDQf0Lj', 'description': '', 'location': 'Remote (India)', 'posted_at': ''}
        with mock.patch.object(ms, 'http', lambda url, **k: page):
            self.assertTrue(ms.enrich_full_text(j, 'watch_boards', {}, [0.0]))
        self.assertIn('MonetizeMore', j['description']); self.assertNotIn('<span', j['description'])
        with mock.patch.object(ms, 'http', self.fake):
            places = [x['location'] for x, _ in ms.watch_board('MonetizeMore', 'jazzhr', 'monetizem')]
        self.assertEqual(places, ['Remote (India)'], 'the same posting listed for Viet Nam and Venezuela is not read')

    def test_watchlist_run_reads_them(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'profiles.json').write_text(json.dumps({'farhan_shaikh': {'role': 'implementation|crm|solutions', 'exclude': ''}}))
            with mock.patch.object(ms, 'http', self.fake), mock.patch.object(ms.time, 'sleep'), mock.patch('sys.argv', ['x', '--fast', '--profiles', str(Path(d, 'profiles.json')), '--out', d]):
                ms.main()
            report = json.loads(Path(d, 'more_sources_report.json').read_text())
            jobs = json.loads(Path(d, 'jobsite_raw.json').read_text())['jobs']
        self.assertIn('watch_boards', report)
        self.assertGreaterEqual(report['watch_boards']['kept'], 3)
        self.assertTrue(any(j['company'] == 'UptimeAI' and j['title'] == 'Implementation Engineer' for j in jobs))


class Reposters(unittest.TestCase):
    def test_names(self):
        for c in ('Jobgether', 'Jobgether.com', '20four7VA', 'Turing', 'Virtual Assistants PH', 'Acme 24/7 VA'):
            self.assertTrue(reposters.is_reposter(c), c)
        for c in ('Turing Labs', 'Canvas Medical', 'Nava', 'Shiva Engineering', 'Java Labs', 'Paired'):
            self.assertFalse(reposters.is_reposter(c), c)

    def test_capped_across_sources_in_one_run(self):
        rows = [{'title': 'Implementation Manager', 'company': 'Jobgether', 'location': 'Remote', 'description': 'x', 'posted_at': '',
                 'url': f'https://jobs.lever.co/jobgether/{i}', 'is_remote': True} for i in range(6)]
        rows += [{'title': 'Implementation Manager', 'company': 'Acme', 'location': 'Remote', 'description': 'x', 'posted_at': '', 'url': 'https://acme.example/1', 'is_remote': True}]
        def fake_src():
            for r in rows:
                yield rb.job('himalayas', r['url'], r['title'], r['company'], r['location'], r['description'], None)
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'profiles.json').write_text(json.dumps({'farhan_shaikh': {'role': 'implementation', 'exclude': ''}}))
            Path(d, 'jobsite_raw.json').write_text(json.dumps({'source': 'job_sites', 'jobs': [
                {'id': 'js:workable:x', 'company': 'Jobgether', 'title': 'Implementation Lead', 'url': 'https://x'}]}))
            with mock.patch.object(rb, 'SOURCES', {'himalayas': fake_src}), mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'profiles.json')), '--out', d]):
                rb.main()
            jobs = json.loads(Path(d, 'jobsite_raw.json').read_text())['jobs']
        self.assertEqual(sum(j['company'] == 'Jobgether' for j in jobs), reposters.REPOSTER_CAP, 'the one already in the file counts')
        self.assertTrue(any(j['company'] == 'Acme' for j in jobs))
        self.assertTrue(all(j.get('reposter') for j in jobs if j['company'] == 'Jobgether' and j['id'] != 'js:workable:x'))


if __name__ == '__main__':
    unittest.main()
