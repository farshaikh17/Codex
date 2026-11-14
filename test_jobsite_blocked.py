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


if __name__ == '__main__':
    unittest.main()
