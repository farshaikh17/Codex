"""engine/robots.py: the run-time robots.txt check every reader uses. Offline: robots.txt texts below are recorded (14 Nov 2026)."""
import io
import json
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from engine import more_sources as ms
from engine import remote_boards as rb
from engine import robots

# Recorded robots.txt excerpts (14 Nov 2026).
REMOTIVE = """User-agent: *
Sitemap:https://remotive.com/sitemap.xml
Disallow: /*search=
Disallow: /api/*
Disallow: /jobs/*
"""
SUCCESSFACTORS = """User-agent: *
Disallow: /applybutton/
Disallow: /talentcommunity/
Disallow: /services/
Disallow: /preapply/
"""
SMARTRECRUITERS_API = """User-agent: LinkedInBot
Allow: /v1/companies/
User-agent: *
Disallow: /
"""
JOBSPRESSO = """User-agent: *
Disallow: /cdn-cgi*
Allow: /*.css
Disallow: /*?
"""
SCHNEIDER = """User-agent: *
Allow: /
Sitemap: http://careers.se.com/sitemap.xml
crawl-delay: 5
"""
FOURDAYWEEK = """User-Agent: *
Allow: /
Allow: /api/v2
Disallow: /api/
Disallow: /job-search

User-Agent: Turnitin
Disallow: /
"""
NAUKRI_STYLE = """User-agent: ExampleBot
Disallow: /

User-agent: *
Disallow:/advertiser/
"""


def fetcher(body=None, status=None):
    def fetch(origin, timeout):
        if status is not None:
            return robots.parse('') if 400 <= status < 500 and status != 429 else [(['*'], [(False, '/')], None)]
        return robots.parse(body)
    return fetch


class Robots(unittest.TestCase):
    def setUp(self):
        robots.reset()

    def ok(self, body, path, agent=robots.AGENT):
        return robots.path_allowed(robots.parse(body), path, agent)

    def test_wildcards_and_query(self):
        self.assertFalse(self.ok(REMOTIVE, '/api/remote-jobs?limit=10&search=implementation'), 'Remotive API is disallowed')
        self.assertFalse(self.ok(REMOTIVE, '/remote-jobs?search=x'), '"/*search=" matches anywhere')
        self.assertTrue(self.ok(REMOTIVE, '/remote-jobs'))
        self.assertFalse(self.ok(JOBSPRESSO, '/feed/?post_type=job_listing'), '"Disallow: /*?" refuses any address with a query')
        self.assertTrue(self.ok(JOBSPRESSO, '/jobs/feed/'))
        self.assertTrue(self.ok(JOBSPRESSO, '/style.css'))

    def test_successfactors_services_disallowed_search_allowed(self):
        self.assertFalse(self.ok(SUCCESSFACTORS, '/services/rss/job/?locale=en_US&keywords=maintenance'))
        self.assertTrue(self.ok(SUCCESSFACTORS, '/search/?q=&startrow=0'))
        self.assertTrue(self.ok(SUCCESSFACTORS, '/job/Riyadh-Engineer/1/'))
        self.assertTrue(self.ok(SUCCESSFACTORS, '/sitemap.xml'))

    def test_agent_groups(self):
        self.assertFalse(self.ok(SMARTRECRUITERS_API, '/v1/companies/Masdar/postings'), 'only LinkedInBot is allowed')
        self.assertTrue(self.ok(SMARTRECRUITERS_API, '/v1/companies/Masdar/postings', 'LinkedInBot'))
        self.assertTrue(self.ok(NAUKRI_STYLE, '/jobapi/v3/search'), 'the * group applies to our own agent name')
        self.assertFalse(self.ok(NAUKRI_STYLE, '/jobapi/v3/search', 'ExampleBot'))

    def test_longest_rule_wins_and_allow_on_tie(self):
        self.assertTrue(self.ok(FOURDAYWEEK, '/api/v2/jobs?work_arrangement=remote&country=India'), '"Allow: /api/v2" is longer than "Disallow: /api/"')
        self.assertFalse(self.ok(FOURDAYWEEK, '/api/v1/other'))
        self.assertFalse(self.ok(FOURDAYWEEK, '/job-search'))
        self.assertTrue(self.ok('User-agent: *\nDisallow: /a\nAllow: /a\n', '/a'), 'Allow wins a tie')
        self.assertTrue(self.ok('User-agent: *\nDisallow: /x$\n', '/x/y'), '$ anchors the end')
        self.assertFalse(self.ok('User-agent: *\nDisallow: /x$\n', '/x'))
        self.assertTrue(self.ok('', '/anything'), 'an empty robots.txt allows everything')

    def test_crawl_delay(self):
        self.assertEqual(robots.crawl_delay('https://careers.se.com/api/jobs', fetch=fetcher(SCHNEIDER)), 5.0)
        robots.reset()
        self.assertEqual(robots.crawl_delay('https://x.example/a', fetch=fetcher('User-agent: *\nCrawl-delay: 999\n')), 30.0, 'capped at 30 s')

    def test_status_codes(self):
        self.assertTrue(robots.allowed('https://a.example/x', fetch=fetcher(status=404)), 'no robots.txt: allowed')
        self.assertFalse(robots.allowed('https://b.example/x', fetch=fetcher(status=503)), 'server error: do not crawl this run')

    def test_fetch_status_handling(self):
        def raise_code(code):
            return mock.patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('u', code, 'x', {}, io.BytesIO(b'')))
        with raise_code(404):
            self.assertTrue(robots.allowed('https://c.example/x'))
        robots.reset()
        with raise_code(401):
            self.assertTrue(robots.allowed('https://d.example/x'), 'an API host answering 401 for robots.txt: unavailable, allowed (RFC 9309)')
        robots.reset()
        for code in (429, 500, 521):
            with raise_code(code):
                self.assertFalse(robots.allowed(f'https://e{code}.example/x'), f'{code}: unreachable, disallowed')
        with mock.patch('urllib.request.urlopen', side_effect=TimeoutError('slow')):
            self.assertFalse(robots.allowed('https://f.example/x'))

    def test_read_once_per_host(self):
        n = []
        def fetch(origin, timeout):
            n.append(origin)
            return robots.parse(SUCCESSFACTORS)
        for p in ('/search/', '/job/1/', '/services/rss/job/'):
            robots.allowed('https://careers.acwapower.com' + p, fetch=fetch)
        self.assertEqual(n, ['https://careers.acwapower.com'])

    def test_readers_refuse_disallowed_paths_before_any_request(self):
        robots._cache['https://remotive.com'] = robots.parse(REMOTIVE)
        robots._cache['https://careers.acwapower.com'] = robots.parse(SUCCESSFACTORS)
        with mock.patch.object(robots, 'urlopen') as op:
            with self.assertRaises(robots.RobotsDisallowed):
                ms.http('https://careers.acwapower.com/services/rss/job/?keywords=x')
            with self.assertRaises(robots.RobotsDisallowed):
                rb.get('https://remotive.com/api/remote-jobs?search=x')
            op.assert_not_called()

    def test_reader_pacing_uses_crawl_delay(self):
        robots._cache['https://careers.se.com'] = robots.parse(SCHNEIDER)
        resp = mock.MagicMock()
        resp.__enter__.return_value.read.return_value = b'{}'
        sleeps = []
        with mock.patch.object(robots, 'urlopen', return_value=resp), mock.patch.object(ms.time, 'sleep', side_effect=sleeps.append):
            ms._LAST.clear()
            ms.http('https://careers.se.com/api/jobs?page=1')
            ms.http('https://careers.se.com/api/jobs?page=2')
        self.assertTrue(sleeps and sleeps[-1] > 4.0, 'the second request to a host waits for its Crawl-delay')

    def test_redirect_to_a_disallowed_address_is_refused(self):
        robots._cache['https://own.example'] = robots.parse('User-agent: *\nDisallow: /careers\n')
        h = robots.CheckedRedirects()
        req = __import__('urllib.request').request.Request('https://careers.smartrecruiters.com/X')
        with self.assertRaises(robots.RobotsDisallowed):
            h.redirect_request(req, None, 302, 'Found', {}, 'https://own.example/careers')
        robots._cache['https://ok.example'] = robots.parse('')
        self.assertIsNotNone(h.redirect_request(req, None, 302, 'Found', {}, 'https://ok.example/jobs'))

    def test_adzuna_needs_owner_api_terms_decision(self):
        robots._cache['https://api.adzuna.com'] = robots.parse('User-agent: *\nDisallow: /\n')
        sent = []
        def fake_open(req, timeout=40):
            sent.append(req.full_url)
            r = mock.MagicMock(); r.__enter__.return_value.read.return_value = json.dumps({'results': []}).encode(); return r
        env = {'ADZUNA_APP_ID': 'test-id', 'ADZUNA_APP_KEY': 'test-key'}
        with mock.patch.dict('os.environ', env, clear=False), mock.patch.object(robots, 'urlopen', side_effect=fake_open), mock.patch.object(ms.time, 'sleep'):
            with self.assertRaises(robots.RobotsDisallowed):
                list(ms.adzuna({'sana_ansari': [('in', 'maintenance engineer')]}))
            self.assertEqual(sent, [])
            with mock.patch.dict('os.environ', {'ADZUNA_API_TERMS_ACCEPTED': 'true'}):
                list(ms.adzuna({'sana_ansari': [('in', 'maintenance engineer')]}))
        self.assertEqual(len(sent), 1)
        with mock.patch.dict('os.environ', {'ADZUNA_APP_ID': '', 'ADZUNA_APP_KEY': ''}), mock.patch.object(robots, 'urlopen') as op:
            self.assertEqual(list(ms.adzuna({'sana_ansari': [('in', 'x')]})), [], 'no keys: nothing is read')
            op.assert_not_called()


class JobSitesRobotsReport(unittest.TestCase):
    def test_report_says_which_sites_robots_disallow(self):
        import tempfile
        from engine import jobsite_discovery as jd
        disallowed = {'https://apis.indeed.com/graphql'}
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'p.json').write_text(json.dumps({'sana_ansari': {'role': 'engineer', 'exclude': '', 'home': 'india'}}))
            with mock.patch.object(jd, 'QUERIES', {'sana_ansari': [('reliability engineer', 'India', 'India', ['indeed', 'naukri'])]}), \
                    mock.patch.object(jd, 'run_search', lambda *a, **k: []), mock.patch.object(jd.robots, 'allowed', lambda url: url not in disallowed), \
                    mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'p.json')), '--out', d]):
                jd.main()
            rep = json.loads(Path(d, 'jobsite_report.json').read_text())
        self.assertEqual(rep['robots']['indeed'], 'disallowed'); self.assertEqual(rep['robots']['linkedin'], 'allowed')
        self.assertEqual([x['site'] for x in rep['log']], ['indeed'], 'naukri in an old query list is never searched')
        self.assertEqual(rep['log'][0].get('error'), 'robots.txt: disallowed', 'a disallowed site is skipped, not searched')
        self.assertEqual(rep['blocked'], 1)


class Compliance(unittest.TestCase):
    def test_naukri_and_getro_and_remotive_are_not_read(self):
        from engine import jobsite_discovery as jd
        self.assertNotIn('naukri', jd.SITES); self.assertNotIn('naukri', jd.INDIA_SITES)
        for q in jd.QUERIES.values():
            for term, loc, country, sites in q:
                self.assertNotIn('naukri', sites)
        self.assertEqual(set(jd.SITE_ENDPOINT), set(jd.SITES), 'every job site has its endpoint checked against robots.txt')
        src = Path(ms.__file__).read_text()
        self.assertNotIn("'getro': getro", src)
        self.assertNotIn('/services/rss/', src)
        self.assertNotIn('api.smartrecruiters.com/v1/companies/{', src)
        mig = (Path(__file__).resolve().parent / 'dashboard' / 'migrations' / '0024_drop_remotive_source.sql').read_text()
        self.assertIn("kind = 'remotive'", mig); self.assertIn('enabled = 0', mig)


if __name__ == '__main__':
    unittest.main()
