"""engine/jobsite_discovery.py: a refusal that JobSpy only logs (403/429) is counted as blocked. Offline."""
import json
import logging
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import jobsite_discovery as jd


class BlockedCount(unittest.TestCase):
    def test_blocked_note_needs_an_empty_answer_and_a_refusal(self):
        self.assertEqual(jd.blocked_note([], ['LinkedIn: 429 Too Many Requests']), 'LinkedIn: 429 Too Many Requests')
        self.assertIsNone(jd.blocked_note([{'title': 'x'}], ['429 seen once but results came back']))
        self.assertIsNone(jd.blocked_note([], []), 'nothing found, nothing refused')

    def test_handler_keeps_only_jobspy_refusals(self):
        w = jd.BlockWatch()
        for name, level, msg in [('JobSpy:LinkedIn', logging.ERROR, 'response status code 429 Too Many Requests'),
                                 ('JobSpy:Bayt', logging.ERROR, 'Bayt response status code 403'),
                                 ('JobSpy:Indeed', logging.WARNING, 'parsed 20 jobs'), ('urllib3', logging.ERROR, '403 forbidden')]:
            w.handle(logging.LogRecord(name, level, __file__, 1, msg, None, None))
        self.assertEqual(len(w.messages), 2)
        self.assertEqual(w.take()[0][:3], 'res'); self.assertEqual(w.messages, [])

    def test_report_counts_logged_refusals_as_blocked(self):
        profs = {'sana_ansari': {'home': 'india', 'role': 'engineer', 'keywords': []}}
        queries = {'sana_ansari': [('reliability engineer', 'India', 'India', ['linkedin', 'bayt', 'indeed'])]}

        def fake_search(site, term, loc, results, hours, country='India'):
            lg = logging.getLogger(f'JobSpy:{site.title()}')
            if site == 'linkedin': lg.error('response status code 429 Too Many Requests')
            if site == 'bayt': lg.error('Bayt: status code 403')
            return []   # JobSpy returns an empty frame in both cases, and also for a site with no matches
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'p.json').write_text(json.dumps(profs))
            with mock.patch.object(jd, 'QUERIES', queries), mock.patch.object(jd, 'run_search', fake_search), \
                    mock.patch.object(jd.robots, 'allowed', lambda url: True), mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'p.json')), '--out', d]):
                jd.main()
            rep = json.loads(Path(d, 'jobsite_report.json').read_text())
        self.assertEqual(rep['blocked'], 2, 'linkedin 429 and bayt 403; indeed simply found nothing')
        self.assertEqual(rep['searches'], 3)



class QueryList(unittest.TestCase):
    def test_every_built_in_search_is_run_and_matches_its_role_rule(self):
        # 20 Nov (max discovery): the built-in searches are no longer cut at MAX_QUERIES (that limit is for a client's own keywords); the
        # parallel jobs of discovery.yml each run one shard of them.
        from engine.dataset_discovery import BUILTIN
        import re
        for cid, qs in jd.QUERIES.items():
            for term, loc, country, sites in qs:
                self.assertTrue(set(sites) <= set(jd.SITES), (cid, term))
                self.assertIn(jd.shard_of(cid, country), jd.SHARDS)
            self.assertEqual(len({(t.lower(), c) for t, _, c, _ in qs}), len(qs), f'{cid}: no search twice in one country')
        sana = [(t, l) for t, l, _, _ in jd.QUERIES['sana_ansari']]
        self.assertIn(('maintenance engineer thermal power plant', 'India'), sana)
        self.assertIn(('maintenance engineer', 'Abu Dhabi'), sana)
        for country in jd.GULF_COUNTRIES:   # every Gulf country is searched on Indeed
            self.assertTrue(any(c == country and 'indeed' in s for _, _, c, s in jd.QUERIES['sana_ansari']), country)
        for cid in jd.QUERIES:
            role = re.compile(BUILTIN[cid]['wide_role'], re.I)
            for t, _, _, _ in jd.QUERIES[cid]:   # each search term is itself one of their titles, so its own results are not all dropped
                self.assertTrue(role.search(t.lower()) or t in ('HubSpot', 'GoHighLevel', 'Zapier', 'n8n', 'Workato'), (cid, t))
        self.assertEqual(jd.ORIGINAL['sana_ansari'], jd.QUERIES['sana_ansari'][:len(jd.ORIGINAL['sana_ansari'])], 'the original searches run first')


class Shards(unittest.TestCase):
    def run_main(self, profs, queries, extra=(), search=None):
        calls = []

        def fake_search(site, term, loc, results, hours, country='India', remote=False):
            calls.append((site, term, country, remote))
            return search(site, term) if search else [{'title': term.title(), 'job_url': f'https://x.example/{site}/{term}/{country}', 'company': 'Acme'}]
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'p.json').write_text(json.dumps(profs))
            with mock.patch.object(jd, 'QUERIES', queries), mock.patch.object(jd, 'run_search', fake_search), \
                    mock.patch.object(jd.robots, 'allowed', lambda url: True), \
                    mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'p.json')), '--out', d, *extra]):
                jd.main()
            rep = json.loads(Path(d, 'jobsite_report.json').read_text())
            raw = json.loads(Path(d, 'jobsite_raw.json').read_text())
        return calls, rep, raw

    PROFS = {'sana_ansari': {'home': 'india', 'role': 'engineer', 'keywords': []},
             'farhan_shaikh': {'home': 'india', 'role': 'manager', 'keywords': [], 'mode': 'REMOTE_FROM_HOME'}}
    Q = {'sana_ansari': [('maintenance engineer', 'India', 'India', ['indeed']), ('maintenance engineer', 'Qatar', 'Qatar', ['indeed'])],
         'farhan_shaikh': [('implementation manager', 'India', 'India', ['indeed'])]}

    def test_a_shard_runs_only_its_searches(self):
        calls, rep, _ = self.run_main(self.PROFS, self.Q, ['--shard', 'sana_gulf'])
        self.assertEqual(calls, [('indeed', 'maintenance engineer', 'Qatar', False)])
        self.assertEqual(rep['shard'], 'sana_gulf')
        calls, _, _ = self.run_main(self.PROFS, self.Q, ['--shard', 'farhan'])
        self.assertEqual(calls, [('indeed', 'implementation manager', 'India', True)], "Farhan's searches use the remote filter")
        calls, _, _ = self.run_main(self.PROFS, self.Q)
        self.assertEqual(len(calls), 3, 'no shard: every search')

    def test_wide_role_is_the_title_filter_when_the_profile_has_it(self):
        profs = {'sana_ansari': {'home': 'india', 'role': 'nothing-matches', 'wide_role': 'engineer', 'keywords': []}}
        _, _, raw = self.run_main(profs, {'sana_ansari': self.Q['sana_ansari'][:1]})
        self.assertEqual(len(raw['jobs']), 1)

    def test_a_site_that_keeps_refusing_is_not_asked_again(self):
        q = {'sana_ansari': [(f'term{i} engineer', 'India', 'India', ['linkedin', 'indeed']) for i in range(5)]}

        def search(site, term):
            if site == 'linkedin':
                logging.getLogger('JobSpy:LinkedIn').error('response status code 429')
                return []
            return [{'title': term, 'job_url': f'https://x.example/{term}', 'company': 'Acme'}]
        calls, rep, _ = self.run_main({'sana_ansari': self.PROFS['sana_ansari']}, q, search=search)
        self.assertEqual(sum(1 for c in calls if c[0] == 'linkedin'), jd.BLOCK_LIMIT)
        self.assertEqual(sum(1 for c in calls if c[0] == 'indeed'), 5, 'the other site goes on')
        self.assertEqual(rep['skipped_after_refusals'], 5 - jd.BLOCK_LIMIT)
        self.assertEqual(rep['blocked'], jd.BLOCK_LIMIT)

    def test_no_search_starts_after_the_time_budget(self):
        with mock.patch.object(jd.time, 'monotonic', side_effect=[0.0] + [1000.0] * 50):
            calls, rep, _ = self.run_main(self.PROFS, self.Q, ['--budget-seconds', '10'])
        self.assertEqual(calls, [])
        self.assertEqual(rep['skipped_for_time'], 3)


if __name__ == '__main__':
    unittest.main()
